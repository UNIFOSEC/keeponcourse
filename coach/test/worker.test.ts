/**
 * End-to-end tests of the Worker's request handling. Claude is replaced by
 * dev/mock-anthropic.mjs (scripted replies), so no API key or cost is involved.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { memoryKv } from "./memoryKv";

const MOCK_PORT = 9188;
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
const APP = "https://keeponcourse.com";

let mock: ChildProcess;

beforeAll(async () => {
  const script = fileURLToPath(new URL("../dev/mock-anthropic.mjs", import.meta.url));
  mock = spawn(process.execPath, [script], { env: { ...process.env, PORT: String(MOCK_PORT) }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise<void>((resolve, reject) => {
    mock.stdout!.on("data", (chunk) => String(chunk).includes("Mock Claude API") && resolve());
    mock.on("exit", (code) => reject(new Error(`mock exited with ${code}`)));
  });
});

afterAll(() => {
  mock?.kill();
});

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ANTHROPIC_API_KEY: "test-key-not-real",
    ANTHROPIC_BASE_URL: MOCK_URL,
    ALLOWED_ORIGINS: `${APP},http://localhost:5173`,
    ANON_DAILY_LIMIT: "15",
    COACH_USAGE: memoryKv().kv,
    ...overrides,
  };
}

/** Runs a request through the Worker and waits for any background work. */
async function call(request: Request, env = makeEnv()) {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const response = await worker.fetch(request, env, ctx);
  const body = await response.text();
  await Promise.all(pending);
  return { response, body };
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://coach.example${path}`, {
    method: "POST",
    headers: { Origin: APP, "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const chat = (text: string) => ({ messages: [{ role: "user", content: [{ type: "text", text: '<course_data today="2026-11-11">\n[]\n</course_data>' }, { type: "text", text }] }] });

describe("routing and origin checks", () => {
  it("answers /health", async () => {
    const { response, body } = await call(new Request("https://coach.example/health"));
    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toEqual({ ok: true, model: "claude-haiku-5-5" });
  });

  it("allows CORS preflight only from the app's own origins", async () => {
    const ok = await call(new Request("https://coach.example/chat", { method: "OPTIONS", headers: { Origin: APP } }));
    expect(ok.response.status).toBe(204);
    expect(ok.response.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    const bad = await call(new Request("https://coach.example/chat", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }));
    expect(bad.response.status).toBe(403);
    expect(bad.response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("refuses chat and plan requests from other sites", async () => {
    for (const path of ["/chat", "/plan", "/usage"]) {
      const request = path === "/usage" ? new Request("https://coach.example/usage", { headers: { Origin: "https://evil.example" } }) : post(path, chat("hi"), { Origin: "https://evil.example" });
      expect((await call(request)).response.status).toBe(403);
    }
  });

  it("returns 404 and 405 for other paths and methods", async () => {
    expect((await call(new Request("https://coach.example/admin"))).response.status).toBe(404);
    expect((await call(new Request("https://coach.example/chat", { headers: { Origin: APP } }))).response.status).toBe(405);
  });
});

describe("POST /chat", () => {
  it("rejects bad input before it costs anything", async () => {
    const env = makeEnv();
    expect((await call(post("/chat", "{not json"), env)).response.status).toBe(400);
    expect((await call(post("/chat", { messages: [{ role: "system", content: "x" }] }), env)).response.status).toBe(400);
    expect((await call(post("/chat", chat("hi"), { "Content-Type": "text/plain" }), env)).response.status).toBe(415);
    // None of these used up any of the allowance
    const usage = await call(new Request("https://coach.example/usage", { headers: { Origin: APP, "CF-Connecting-IP": "203.0.113.9" } }), env);
    expect(JSON.parse(usage.body)).toMatchObject({ used: 0, remaining: 15 });
  });

  it("says so when the API key isn't set", async () => {
    const { response } = await call(post("/chat", chat("hi")), makeEnv({ ANTHROPIC_API_KEY: "" }));
    expect(response.status).toBe(503);
  });

  it("streams a reply as JSON lines and counts the message", async () => {
    const env = makeEnv();
    const { response, body } = await call(post("/chat", chat("What should I study next?")), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(response.headers.get("X-Coach-Remaining")).toBe("14");

    const events = body.trim().split("\n").map((line) => JSON.parse(line));
    expect(events.some((e) => e.type === "text")).toBe(true);
    const done = events.at(-1);
    expect(done.type).toBe("done");
    expect(done.content.some((b: { type: string }) => b.type === "thinking")).toBe(true);
  });

  it("sends Claude the fixed system prompt, tools, model and effort", async () => {
    await call(post("/chat", chat("Add a course on photography")));
    const sent = (await (await fetch(`${MOCK_URL}/__requests`)).json()).at(-1);
    expect(sent.headers.credential).toBe("(set)");
    expect(sent.body.model).toBe("claude-haiku-5-5");
    expect(sent.body.output_config).toEqual({ effort: "low" });
    expect(sent.body.tools.map((t: { name: string }) => t.name).sort()).toEqual(["add_course", "remove_course", "reschedule_plan", "update_course"]);
    expect(sent.body.system).toBeTruthy();
    expect(sent.body.fallbacks).toBeUndefined(); // Haiku has no fallback models
  });

  it("stops at the daily allowance", async () => {
    const env = makeEnv({ ANON_DAILY_LIMIT: "1" });
    expect((await call(post("/chat", chat("hi")), env)).response.status).toBe(200);
    const second = await call(post("/chat", chat("hi again")), env);
    expect(second.response.status).toBe(429);
    expect(JSON.parse(second.body).code).toBe("quota_anon");
  });

  it("honours the per-minute rate limiter", async () => {
    const env = makeEnv({ CHAT_LIMITER: { limit: async () => ({ success: false }) } });
    expect((await call(post("/chat", chat("hi")), env)).response.status).toBe(429);
  });
});

describe("POST /plan", () => {
  it("returns a study outline from syllabus text", async () => {
    const { response, body } = await call(post("/plan", { text: "Intro to Python\nWeek 1: Variables\nWeek 2: Loops\nWeek 3: Functions" }));
    expect(response.status).toBe(200);
    expect(JSON.parse(body).plan.modules.map((m: { title: string }) => m.title)).toEqual(["Variables", "Loops", "Functions"]);
  });

  it("rejects material it can't use", async () => {
    expect((await call(post("/plan", { text: "too short" }))).response.status).toBe(400);
  });
});

describe("signed-in usage", () => {
  const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlLXRlc3Q";
  const realFetch = globalThis.fetch;

  /** Supabase stand-in: counts messages and captures token records; everything else goes to the mock Claude API. */
  function stubDatabase() {
    const recorded: Record<string, number>[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://db.example/")) return realFetch(input, init);
      if (url.endsWith("/rpc/use_coach_message")) return Response.json(1);
      if (url.endsWith("/rpc/record_coach_tokens")) {
        recorded.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 204 });
      }
      return new Response("unexpected", { status: 500 });
    });
    return recorded;
  }
  const signedInEnv = () => makeEnv({ SUPABASE_URL: "https://db.example", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });

  afterEach(() => vi.unstubAllGlobals());

  it("records the tokens of a chat reply against the user", async () => {
    const recorded = stubDatabase();
    const { response } = await call(post("/chat", chat("What should I study next?"), { Authorization: `Bearer ${JWT}` }), signedInEnv());
    expect(response.status).toBe(200);
    expect(recorded).toEqual([{ input_tokens: 100, output_tokens: 42, cache_read_tokens: 0, cache_write_tokens: 0 }]);
  });

  it("records the tokens of a syllabus plan", async () => {
    const recorded = stubDatabase();
    const { response } = await call(post("/plan", { text: "Intro to Python\nWeek 1: Variables\nWeek 2: Loops" }, { Authorization: `Bearer ${JWT}` }), signedInEnv());
    expect(response.status).toBe(200);
    expect(recorded).toEqual([{ input_tokens: 200, output_tokens: 120, cache_read_tokens: 0, cache_write_tokens: 0 }]);
  });

  it("records nothing for anonymous visitors", async () => {
    const recorded = stubDatabase();
    await call(post("/chat", chat("hi")), signedInEnv());
    expect(recorded).toEqual([]);
  });
});
