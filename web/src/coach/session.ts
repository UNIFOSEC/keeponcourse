import type Anthropic from "@anthropic-ai/sdk";
import { errorMessage, type App } from "../app";
import { todayISO } from "../dates";
import { runTool, undoAction, type CoachAction } from "./tools";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlock = Anthropic.Beta.BetaContentBlock;

/** Coach proxy base URL, set at build time (web/.env.*). Empty = Coach not configured. */
export const COACH_URL = (import.meta.env.VITE_COACH_URL ?? "").trim().replace(/\/+$/, "");

export const MAX_INPUT = 2000;
const MAX_MESSAGES = 50; // the proxy accepts 60; this leaves room for a round of tool calls
const MAX_TOOL_ROUNDS = 4;
const MAX_SNAPSHOT_CHARS = 38_000; // the proxy accepts 40,000
const STORAGE_KEY = "cch.coach.v1";

export type Item =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string; streaming: boolean }
  | { id: string; kind: "action"; action: CoachAction; undone: boolean }
  | { id: string; kind: "notice"; tone: "error" | "info"; text: string };

export type Phase = "idle" | "thinking" | "writing" | "acting";

type CoachEvent =
  | { type: "status"; state: "thinking" | "tool"; name?: string }
  | { type: "text"; text: string }
  | { type: "done"; stop_reason: string | null; content: ContentBlock[] }
  | { type: "error"; code: string; message: string };

class CoachError extends Error {
  constructor(
    message: string,
    readonly code = "error",
  ) {
    super(message);
  }
}

let nextId = 0;
const uid = () => `i${Date.now().toString(36)}${(nextId++).toString(36)}`;

/** Text to show for a reply: after a refusal fallback, only the model that answered. */
function displayText(content: ContentBlock[]): string {
  const lastFallback = content.map((b) => b.type).lastIndexOf("fallback");
  return content
    .slice(lastFallback + 1)
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n\n")
    .trim();
}

/**
 * The visitor's courses as data for Coach, sent at the start of every user turn.
 * Tagged so the system prompt can tell Claude to treat it as data, not instructions.
 */
function snapshot(app: App): string {
  const courses = app.courses.map(({ id, name, description, target_date, status }) => ({
    id,
    name,
    description: description.slice(0, 280),
    target_date,
    status,
  }));
  let json = JSON.stringify(courses);
  while (json.length > MAX_SNAPSHOT_CHARS && courses.length) {
    courses.pop();
    json = JSON.stringify(courses);
  }
  return `<course_data today="${todayISO()}" source="${app.store.kind}">\n${json}\n</course_data>`;
}

/**
 * One Coach conversation. Runs the request → tool → request loop in the browser,
 * because the courses (and the actions on them) live here, not on the server.
 *
 * The history sent to Claude is append-only: each assistant turn is stored
 * exactly as returned (thinking blocks included), and a failed turn is dropped
 * as a whole instead of being edited.
 */
export class CoachSession {
  items: Item[] = [];
  phase: Phase = "idle";
  /** Text to put back in the composer after a send that failed without side effects. */
  restoredDraft: string | null = null;
  /** Today's Coach allowance, from the proxy (null until known). */
  usage: { limit: number; remaining: number; signedIn: boolean } | null = null;

  private history: MessageParam[] = [];
  private controller: AbortController | null = null;
  private listeners = new Set<() => void>();
  private frame = 0;

  constructor(private app: App) {
    this.load();
  }

  get configured(): boolean {
    return COACH_URL !== "";
  }

  get busy(): boolean {
    return this.phase !== "idle";
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Asks the proxy how many messages are left today (counts nothing). */
  async refreshUsage(): Promise<void> {
    if (!this.configured) return;
    try {
      const response = await this.fetchWithAuth("/usage", { method: "GET" });
      if (!response.ok) return;
      const body = (await response.json()) as { limit: number; remaining: number; signedIn: boolean };
      this.usage = { limit: body.limit, remaining: body.remaining, signedIn: body.signedIn };
      this.emit();
    } catch {
      // Not critical: the count shows up after the next message
    }
  }

  /**
   * Calls the proxy, sending the user's sign-in token when signed in. If the
   * token was rejected as expired, refreshes it once and retries.
   */
  private async fetchWithAuth(path: string, init: RequestInit): Promise<Response> {
    const send = async (token: string | null) =>
      fetch(`${COACH_URL}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
    const token = await this.app.account.accessToken();
    const response = await send(token);
    if (response.status === 401 && token) {
      const fresh = await this.app.account.accessToken(true);
      if (fresh && fresh !== token) return send(fresh);
    }
    return response;
  }

  private readUsageHeaders(response: Response) {
    const limit = Number(response.headers.get("X-Coach-Limit"));
    const remaining = Number(response.headers.get("X-Coach-Remaining"));
    if (Number.isFinite(limit) && limit > 0 && Number.isFinite(remaining)) {
      this.usage = { limit, remaining, signedIn: this.app.account.signedIn };
    }
  }

  async send(input: string): Promise<void> {
    const text = input.trim().slice(0, MAX_INPUT);
    if (!text || this.busy || !this.configured) return;
    if (this.history.length >= MAX_MESSAGES) {
      this.notice("info", "This chat is getting long. Start a new chat to keep going.");
      this.restoredDraft = text;
      this.emit();
      return;
    }

    const userItem: Item = { id: uid(), kind: "user", text };
    const pending: MessageParam[] = [
      ...this.history,
      { role: "user", content: [{ type: "text", text: snapshot(this.app) }, { type: "text", text }] },
    ];
    const controller = (this.controller = new AbortController());
    let acted = false;

    this.items.push(userItem);
    this.phase = "thinking";
    this.emit();

    try {
      for (let round = 1; ; round++) {
        const reply = await this.request(pending, controller.signal);
        const toolUses = reply.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");

        if (reply.stop_reason === "refusal") {
          this.dropItem(reply.itemId);
          throw new CoachError("Coach can't help with that request. Try asking in a different way.", "refusal");
        }
        if (reply.stop_reason === "max_tokens" && toolUses.length) {
          // A cut-off tool call may have incomplete input: never run it
          this.dropItem(reply.itemId);
          throw new CoachError("Coach's reply was cut off before it finished. Please try again.", "truncated");
        }

        pending.push({ role: "assistant", content: reply.content });
        if (reply.stop_reason !== "tool_use" || toolUses.length === 0) break;

        this.phase = "acting";
        this.emit();
        // All results go back together in one user message
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const block of toolUses) {
          const outcome = await runTool(this.app, block);
          results.push(outcome.result);
          if (outcome.action) {
            acted = true;
            this.items.push({ id: uid(), kind: "action", action: outcome.action, undone: false });
            this.emit();
          }
        }
        pending.push({ role: "user", content: results });

        if (round >= MAX_TOOL_ROUNDS) {
          this.notice("info", "Coach paused after several changes. Ask it to keep going if there's more to do.");
          break;
        }
        this.phase = "thinking";
        this.emit();
      }
      this.history = pending; // commit the whole exchange at once
    } catch (error) {
      const stopped = controller.signal.aborted;
      if (!acted && !stopped) {
        // Nothing changed: take the message back so it can be sent again
        this.items = this.items.filter((item) => item !== userItem);
        this.restoredDraft = text;
      }
      if (stopped) this.notice("info", "Stopped.");
      else this.notice("error", errorMessage(error));
    } finally {
      for (const item of this.items) if (item.kind === "assistant") item.streaming = false;
      this.controller = null;
      this.phase = "idle";
      this.save();
      this.emit();
    }
  }

  stop(): void {
    this.controller?.abort();
  }

  reset(): void {
    this.stop();
    this.items = [];
    this.history = [];
    this.restoredDraft = null;
    this.usage = null;
    this.save();
    this.emit();
    void this.refreshUsage(); // a different person may be signed in now
  }

  async undo(itemId: string): Promise<void> {
    const item = this.items.find((i) => i.id === itemId);
    if (!item || item.kind !== "action" || item.undone) return;
    await undoAction(this.app, item.action);
    item.undone = true;
    this.save();
    this.emit();
  }

  private async request(
    messages: MessageParam[],
    signal: AbortSignal,
  ): Promise<{ stop_reason: string | null; content: ContentBlock[]; itemId?: string }> {
    let response: Response;
    try {
      response = await this.fetchWithAuth("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new CoachError("Can't reach Coach right now. Check your connection and try again.", "network");
    }

    if (!response.ok || !response.body) {
      let body: { error?: string; code?: string } | null = null;
      try {
        body = await response.json();
      } catch {
        // not JSON
      }
      if (body?.code === "quota" || body?.code === "quota_anon") {
        this.usage = { limit: this.usage?.limit ?? 0, remaining: 0, signedIn: this.app.account.signedIn };
      }
      throw new CoachError(body?.error ?? `Coach request failed (HTTP ${response.status}).`, body?.code);
    }
    this.readUsageHeaders(response);

    let item: Extract<Item, { kind: "assistant" }> | null = null;
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const event = JSON.parse(line) as CoachEvent;

        if (event.type === "status") {
          if (this.phase !== "writing" || event.state === "tool") this.phase = event.state === "tool" ? "acting" : "thinking";
          this.emit();
        } else if (event.type === "text") {
          if (!item) {
            item = { id: uid(), kind: "assistant", text: "", streaming: true };
            this.items.push(item);
          }
          item.text += event.text;
          this.phase = "writing";
          this.emitSoon();
        } else if (event.type === "done") {
          const shown = displayText(event.content);
          if (item) {
            item.text = shown;
            item.streaming = false;
          } else if (shown) {
            item = { id: uid(), kind: "assistant", text: shown, streaming: false };
            this.items.push(item);
          }
          this.emit();
          return { stop_reason: event.stop_reason, content: event.content, itemId: item?.id };
        } else if (event.type === "error") {
          throw new CoachError(event.message, event.code);
        }
      }
    }
    throw new CoachError("Coach's reply ended unexpectedly. Please try again.", "incomplete");
  }

  private dropItem(id: string | undefined) {
    if (id) this.items = this.items.filter((item) => item.id !== id);
  }

  private notice(tone: "error" | "info", text: string) {
    this.items.push({ id: uid(), kind: "notice", tone, text });
  }

  private emit() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const listener of this.listeners) listener();
  }

  /** Streaming text arrives in many small pieces: render at most once per frame. */
  private emitSoon() {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.emit());
  }

  // Kept for the browser tab's lifetime, so the chat survives page navigation and reloads
  private save() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ items: this.items, history: this.history }));
    } catch {
      // Storage unavailable or full: the chat still works for this page view
    }
  }

  private load() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
      if (saved && Array.isArray(saved.items) && Array.isArray(saved.history)) {
        this.items = saved.items;
        this.history = saved.history;
      }
    } catch {
      // Start fresh
    }
  }
}
