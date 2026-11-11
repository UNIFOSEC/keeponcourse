import { afterEach, describe, expect, it, vi } from "vitest";
import { peekUsage, UsageError, useMessage, type UsageEnv } from "../src/usage";

/** In-memory stand-in for Workers KV */
function memoryKv() {
  const data = new Map<string, string>();
  return {
    data,
    kv: {
      get: async (key: string) => data.get(key) ?? null,
      put: async (key: string, value: string) => void data.set(key, value),
    } as unknown as KVNamespace,
  };
}

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlLXRlc3Q";
const anon = (ip = "203.0.113.7") => new Request("https://coach.example/chat", { headers: { "CF-Connecting-IP": ip } });
const signedIn = () => new Request("https://coach.example/chat", { headers: { Authorization: `Bearer ${JWT}` } });

afterEach(() => vi.unstubAllGlobals());

describe("anonymous allowance", () => {
  it("counts per visitor and stops at the daily limit", async () => {
    const { kv, data } = memoryKv();
    const env: UsageEnv = { ANON_DAILY_LIMIT: "2", COACH_USAGE: kv };
    expect((await useMessage(anon(), env)).used).toBe(1);
    expect((await useMessage(anon(), env)).used).toBe(2);
    await expect(useMessage(anon(), env)).rejects.toMatchObject({ status: 429, code: "quota_anon" });
    expect((await useMessage(anon("198.51.100.1"), env)).used).toBe(1); // a different visitor

    // Only a hash is stored, never the IP itself
    expect([...data.keys()].every((key) => /^anon:\d{4}-\d{2}-\d{2}:[0-9a-f]{64}$/.test(key))).toBe(true);
    expect([...data.keys()].join()).not.toContain("203.0.113.7");
  });

  it("peeks without counting", async () => {
    const { kv } = memoryKv();
    const env: UsageEnv = { COACH_USAGE: kv };
    await useMessage(anon(), env);
    expect(await peekUsage(anon(), env)).toMatchObject({ signedIn: false, limit: 15, used: 1 });
    expect((await peekUsage(anon(), env)).used).toBe(1);
  });

  it("ignores a malformed Authorization header instead of trusting it", async () => {
    const { kv } = memoryKv();
    const request = new Request("https://coach.example/chat", { headers: { Authorization: "Bearer short" } });
    expect((await useMessage(request, { COACH_USAGE: kv })).signedIn).toBe(false);
  });
});

describe("signed-in allowance", () => {
  const env: UsageEnv = { SUPABASE_URL: "https://db.example", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", USER_DAILY_LIMIT: "3" };

  it("lets the database verify the token and count the message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(2));
    vi.stubGlobal("fetch", fetchMock);
    const usage = await useMessage(signedIn(), env);
    expect(usage).toMatchObject({ signedIn: true, limit: 3, used: 2 });
    expect(usage.who).toMatch(/^user:[0-9a-f]{32}$/);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://db.example/rest/v1/rpc/use_coach_message");
    expect(init.headers.Authorization).toBe(`Bearer ${JWT}`);
  });

  it("refuses once the count passes the limit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(4)));
    await expect(useMessage(signedIn(), env)).rejects.toMatchObject({ status: 429, code: "quota" });
  });

  it("treats a rejected token as an expired sign-in", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("JWT expired", { status: 401 })));
    await expect(useMessage(signedIn(), env)).rejects.toMatchObject({ status: 401, code: "auth" });
  });

  it("reports a database outage as unavailable, and a missing config as 503", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    await expect(peekUsage(signedIn(), env)).rejects.toMatchObject({ status: 503, code: "unavailable" });
    await expect(useMessage(signedIn(), {})).rejects.toBeInstanceOf(UsageError);
  });
});
