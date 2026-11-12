import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { anonHistory, estimateCost, rollUpAnon, summarizeAnonDay } from "../src/stats";
import { useMessage } from "../src/usage";
import { memoryKv } from "./memoryKv";

const NOW = new Date("2026-11-12T10:00:00Z");
const visitor = (ip: string) => new Request("https://coach.example/chat", { headers: { "CF-Connecting-IP": ip } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("anonymous totals", () => {
  it("adds up visitors, messages and limit hits for one day, across list pages", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { kv } = memoryKv(2); // force several list pages
    const env = { COACH_USAGE: kv, ANON_DAILY_LIMIT: "2" };
    for (const ip of ["198.51.100.1", "198.51.100.2", "198.51.100.3"]) await useMessage(visitor(ip), env);
    await useMessage(visitor("198.51.100.1"), env); // 2 of 2
    await expect(useMessage(visitor("198.51.100.1"), env)).rejects.toMatchObject({ status: 429 });
    await expect(useMessage(visitor("198.51.100.1"), env)).rejects.toMatchObject({ status: 429 });

    expect(await summarizeAnonDay(kv, "2026-11-12")).toEqual({ day: "2026-11-12", messages: 4, visitors: 3, limit_hits: 1 });
    expect(await summarizeAnonDay(kv, "2026-11-11")).toEqual({ day: "2026-11-11", messages: 0, visitors: 0, limit_hits: 0 });
  });

  it("rolls up yesterday into a totals record that holds no hashes", async () => {
    const { kv, data } = memoryKv();
    await kv.put("anon:2026-11-11:" + "a".repeat(64), "3", { metadata: { n: 3 } });
    await kv.put("anon:2026-11-11:" + "b".repeat(64), "15", { metadata: { n: 15, hit: 1 } });
    await kv.put("anon:2026-11-12:" + "c".repeat(64), "1", { metadata: { n: 1 } });

    expect(await rollUpAnon(kv, NOW)).toEqual({ day: "2026-11-11", messages: 18, visitors: 2, limit_hits: 1 });
    const stored = data.get("stats:anon:2026-11-11")!.value;
    expect(JSON.parse(stored)).toEqual({ day: "2026-11-11", messages: 18, visitors: 2, limit_hits: 1 });
    expect(stored).not.toMatch(/[0-9a-f]{64}/);
  });

  it("gives 30 days, oldest first: stored totals, yesterday before the rollup, and today live", async () => {
    const { kv } = memoryKv();
    await kv.put("stats:anon:2026-11-01", JSON.stringify({ day: "2026-11-01", messages: 40, visitors: 9, limit_hits: 2 }));
    await kv.put("anon:2026-11-11:" + "a".repeat(64), "5", { metadata: { n: 5 } });
    await kv.put("anon:2026-11-12:" + "b".repeat(64), "2", { metadata: { n: 2 } });

    const days = await anonHistory(kv, 30, NOW);
    expect(days).toHaveLength(30);
    expect(days[0].day).toBe("2026-10-14");
    expect(days.at(-1)).toEqual({ day: "2026-11-12", messages: 2, visitors: 1, limit_hits: 0 });
    expect(days.at(-2)).toMatchObject({ day: "2026-11-11", messages: 5 });
    expect(days.find((d) => d.day === "2026-11-01")).toMatchObject({ messages: 40, visitors: 9 });
    expect(days.find((d) => d.day === "2026-11-02")).toMatchObject({ messages: 0 });
  });
});

describe("estimateCost", () => {
  it("prices Haiku 5.5 tokens, with cache reads and writes", () => {
    const cost = estimateCost("claude-haiku-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_tokens: 1_000_000, cache_write_tokens: 1_000_000 });
    expect(cost).toBeCloseTo(0.1 + 0.5 + 0.01 + 0.125, 10);
  });

  it("returns null for a model without a known price", () => {
    expect(estimateCost("some-other-model", { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0 })).toBeNull();
  });
});

describe("GET /stats", () => {
  const APP = "https://keeponcourse.com";
  const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvd25lciJ9.c2lnbmF0dXJlLXRlc3Q";
  const env = (): Env => ({
    ANTHROPIC_API_KEY: "test-key-not-real",
    ALLOWED_ORIGINS: APP,
    SUPABASE_URL: "https://db.example",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    COACH_USAGE: memoryKv().kv,
  });
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const get = (headers: Record<string, string>) => new Request("https://coach.example/stats", { headers: { Origin: APP, ...headers } });

  const day = (messages: number, input_tokens = 0, output_tokens = 0) => ({ day: "2026-11-12", messages, people: 1, limit_hits: 0, input_tokens, output_tokens, cache_read_tokens: 0, cache_write_tokens: 0 });

  it("needs a sign-in and an allowed origin", async () => {
    expect((await worker.fetch(get({}), env(), ctx)).status).toBe(401);
    const other = new Request("https://coach.example/stats", { headers: { Origin: "https://evil.example", Authorization: `Bearer ${JWT}` } });
    expect((await worker.fetch(other, env(), ctx)).status).toBe(403);
  });

  it("is refused for anyone the database doesn't list as a stats viewer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: "42501", message: "Not allowed." }, { status: 403 })));
    const response = await worker.fetch(get({ Authorization: `Bearer ${JWT}` }), env(), ctx);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
  });

  it("combines account totals, anonymous totals and a measured cost estimate", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ accounts: 12, active_7d: 5, coach_daily: [day(10), day(20, 160_000, 20_000)] }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(get({ Authorization: `Bearer ${JWT}` }), env(), ctx);
    expect(response.status).toBe(200);
    const body = await response.json();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://db.example/rest/v1/rpc/app_stats");
    expect(init.headers.Authorization).toBe(`Bearer ${JWT}`); // the database checks the caller
    expect(JSON.parse(init.body)).toEqual({ user_limit: 60 });

    expect(body.accounts).toMatchObject({ accounts: 12, active_7d: 5 });
    expect(body.anonymous).toHaveLength(30);
    expect(body.limits).toEqual({ user: 60, anon: 15 });
    // Measured on the day with tokens: (160k × $0.10 + 20k × $0.50) / 1M / 20 messages
    expect(body.cost.per_message).toBeCloseTo(0.0013, 6);
    expect(body.cost.measured_messages).toBe(20);
    expect(body.cost.messages_30d).toBe(30);
    expect(body.cost.estimate_30d).toBeCloseTo(0.039, 6);
  });
});
