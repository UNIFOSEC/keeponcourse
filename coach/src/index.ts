/**
 * Coach proxy for KeepOnCourse (Cloudflare Worker).
 *
 * The browser can't hold a Claude API key, so it sends the conversation here.
 * This Worker checks where the request came from, rate-limits it, validates it,
 * adds the fixed system prompt and tools, and streams Claude's reply back as
 * newline-delimited JSON events:
 *
 *   {"type":"status","state":"thinking" | "tool"}
 *   {"type":"text","text":"..."}                     reply text, as it's written
 *   {"type":"done","stop_reason":"...","content":[...]}  full assistant content, to append to history
 *   {"type":"error","code":"...","message":"..."}
 */
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, TOOLS } from "./prompt";
import { RequestError, validateMessages } from "./validate";

export interface Env {
  ANTHROPIC_API_KEY: string;
  /** Comma-separated list, e.g. "https://unifosec.github.io,http://localhost:5173" */
  ALLOWED_ORIGINS: string;
  /** Optional override; defaults to DEFAULT_MODEL */
  COACH_MODEL?: string;
  /** Only for local testing against dev/mock-anthropic.mjs */
  ANTHROPIC_BASE_URL?: string;
  /** Workers Rate Limiting binding (see wrangler.jsonc) */
  CHAT_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

// Fast and low-cost, which suits a public demo. Override with COACH_MODEL (e.g. "claude-opus-5-5").
const DEFAULT_MODEL = "claude-haiku-5-5";
const MAX_BODY_BYTES = 256 * 1024;

// Models with server-side refusal fallback. Haiku 5.5 has none (a fallback list there is a 400),
// so its refusals are handled in the browser, which shows a "try asking another way" notice.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = allowedOrigin(request.headers.get("Origin"), env);
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return origin ? new Response(null, { status: 204, headers: { ...cors, "Access-Control-Max-Age": "86400" } }) : new Response(null, { status: 403 });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, model: model(env) }, 200, cors);
    }
    if (url.pathname !== "/chat") return json({ error: "Not found" }, 404, cors);
    if (request.method !== "POST") return json({ error: "Use POST" }, 405, cors);

    // Browsers always send Origin on cross-site POSTs; anything else isn't the web app
    if (!origin) return json({ error: "This origin isn't allowed to use Coach.", code: "forbidden" }, 403);

    if (!env.ANTHROPIC_API_KEY) {
      console.error("ANTHROPIC_API_KEY is not set");
      return json({ error: "Coach isn't configured yet.", code: "config" }, 503, cors);
    }

    if (env.CHAT_LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const { success } = await env.CHAT_LIMITER.limit({ key: ip });
      if (!success) {
        return json({ error: "You're sending messages quickly. Wait a minute, then try again.", code: "rate_limited" }, 429, cors);
      }
    }

    if (!(request.headers.get("Content-Type") ?? "").includes("application/json")) {
      return json({ error: "Send JSON.", code: "bad_request" }, 415, cors);
    }
    const length = Number(request.headers.get("Content-Length") ?? 0);
    if (length > MAX_BODY_BYTES) return json({ error: "This conversation is too long. Start a new chat.", code: "too_large" }, 413, cors);

    let messages: Anthropic.Beta.BetaMessageParam[];
    try {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) throw new RequestError("This conversation is too long. Start a new chat.");
      messages = validateMessages(JSON.parse(text));
    } catch (error) {
      const message = error instanceof RequestError ? error.message : "The request wasn't valid JSON.";
      return json({ error: message, code: "bad_request" }, 400, cors);
    }

    return streamReply(messages, env, cors, ctx);
  },
} satisfies ExportedHandler<Env>;

function model(env: Env): string {
  return env.COACH_MODEL?.trim() || DEFAULT_MODEL;
}

function streamReply(
  messages: Anthropic.Beta.BetaMessageParam[],
  env: Env,
  cors: Record<string, string>,
  ctx: ExecutionContext,
): Response {
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.ANTHROPIC_BASE_URL || undefined,
    maxRetries: 1,
  });
  const modelId = model(env);

  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let clientGone = false;

  const send = async (event: Record<string, unknown>) => {
    if (clientGone) return;
    try {
      await writer.write(encoder.encode(JSON.stringify(event) + "\n"));
    } catch {
      clientGone = true; // the browser stopped the request
    }
  };

  const run = async () => {
    const stream = client.beta.messages.stream({
      model: modelId,
      // A cost cap for a public demo; chat replies are short at low effort
      max_tokens: 8_000,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
      output_config: { effort: "low" },
      // Caches the stable system prompt + tools + earlier turns between requests
      cache_control: { type: "ephemeral" },
      ...(FALLBACK_MODELS.has(modelId)
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
    });

    try {
      for await (const event of stream) {
        if (clientGone) {
          stream.abort();
          return;
        }
        if (event.type === "content_block_start") {
          if (event.content_block.type === "thinking" || event.content_block.type === "redacted_thinking") {
            await send({ type: "status", state: "thinking" });
          } else if (event.content_block.type === "tool_use") {
            await send({ type: "status", state: "tool", name: event.content_block.name });
          }
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          await send({ type: "text", text: event.delta.text });
        }
      }
      const message = await stream.finalMessage();
      await send({ type: "done", stop_reason: message.stop_reason, content: message.content, model: message.model });
    } catch (error) {
      if (!clientGone) {
        console.error("Claude request failed:", error);
        await send({ type: "error", ...describeError(error) });
      }
    } finally {
      if (!clientGone) await writer.close().catch(() => {});
    }
  };

  ctx.waitUntil(run());

  return new Response(readable, {
    headers: {
      ...cors,
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** User-facing message for a failed Claude call. Details stay in the Worker logs. */
function describeError(error: unknown): { code: string; message: string } {
  if (error instanceof Anthropic.RateLimitError) {
    return { code: "busy", message: "Coach is busy right now. Try again in a minute." };
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return { code: "config", message: "Coach isn't configured correctly. The site owner has been notified in the logs." };
  }
  if (error instanceof Anthropic.BadRequestError) {
    // An account problem (e.g. no API credits) also comes back as a 400, but a new chat won't fix it
    if (/credit balance|billing/i.test(error.message)) {
      return { code: "unavailable", message: "Coach is unavailable right now. Please try again later." };
    }
    return { code: "bad_request", message: "Coach couldn't process this conversation. Start a new chat and try again." };
  }
  if (error instanceof Anthropic.InternalServerError || error instanceof Anthropic.APIConnectionError) {
    return { code: "unavailable", message: "Coach is temporarily unavailable. Try again shortly." };
  }
  if (error instanceof Anthropic.APIError) {
    return { code: "unavailable", message: "Coach is temporarily unavailable. Try again shortly." };
  }
  // e.g. a tool input that wasn't valid JSON (eager input streaming): safe to resend
  return { code: "retry", message: "Coach hit a hiccup while answering. Please send that again." };
}

function allowedOrigin(origin: string | null, env: Env): string | null {
  if (!origin) return null;
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
