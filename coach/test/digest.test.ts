import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDigest, lastWeekLine, runWeeklyDigest, type DigestUser } from "../src/digest";
import worker, { type Env } from "../src/index";
import { memoryKv } from "./memoryKv";

// Monday Nov 16, 2026, 8:05 AM in New York
const NOW = new Date("2026-11-16T13:05:00Z");
const TOKEN = "f".repeat(64);
const JOB_KEY = "a".repeat(64);

function user(overrides: Partial<DigestUser> = {}): DigestUser {
  return {
    user_id: "00000000-0000-0000-0000-00000000000a",
    email: "learner@example.com",
    timezone: "America/New_York",
    unsubscribe_token: TOKEN,
    courses: [
      {
        name: "Spanish <A2>",
        target_date: "2026-11-30",
        status: "In Progress",
        plan: {
          start_time: "19:00",
          modules: [
            { title: "Past tense", done: false },
            { title: "Travel", done: false },
          ],
          sessions: [
            { date: "2026-11-11", module: 0, minutes: 60 }, // missed
            { date: "2026-11-13", module: 0, minutes: 60, status: "done" },
            { date: "2026-11-14", module: 0, minutes: 60, status: "skipped" },
            { date: "2026-11-16", module: 0, minutes: 60 }, // this week
            { date: "2026-11-18", module: 1, minutes: 45 }, // this week
            { date: "2026-11-23", module: 1, minutes: 45 }, // next week
          ],
        },
      },
    ],
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("buildDigest", () => {
  it("lists this week's sessions, missed ones and the finish date, in the user's time zone", () => {
    const email = buildDigest(user(), { now: NOW, unsubscribeUrl: "https://coach.example/unsubscribe/x" })!;
    expect(email.subject).toBe("Your study week: 2 sessions · 1 to catch up");
    expect(email.text).toContain("Mon, Nov 16, 7:00 PM: Past tense (60 min)");
    expect(email.text).toContain("Wed, Nov 18, 7:00 PM: Travel (45 min)");
    expect(email.text).not.toContain("Nov 23, 7:00 PM"); // next week
    expect(email.text).toContain("1 missed session");
    expect(email.text).toContain("On track: finishing Nov 23, 2026, 7 days before your target.");
    expect(email.text).toContain("Unsubscribe: https://coach.example/unsubscribe/x");
  });

  it("recaps last week, and shows a streak of 2 weeks or more", () => {
    expect(buildDigest(user(), { now: NOW })!.text).toContain("Last week: 1 of 2 sessions done");
    const done = (date: string) => ({ date, module: 0, minutes: 60, status: "done" });
    const courses = [{ name: "X", target_date: "2026-12-31", status: "In Progress", plan: { modules: [{ title: "M" }], sessions: [done("2026-10-28"), done("2026-11-03"), done("2026-11-10"), done("2026-11-12")] } }];
    expect(lastWeekLine(courses, "2026-11-16", "2026-11-16")).toBe("Last week: 2 of 2 sessions done · 3-week streak");
    expect(lastWeekLine([], "2026-11-16", "2026-11-16")).toBeNull();
  });

  it("escapes course and module names in the HTML", () => {
    const html = buildDigest(user(), { now: NOW })!.html;
    expect(html).toContain("Spanish &lt;A2&gt;");
    expect(html).not.toContain("<A2>");
  });

  it("sends nothing when there's nothing scheduled or missed, unless it's a sample", () => {
    const idle = user({ courses: [] });
    expect(buildDigest(idle, { now: NOW })).toBeNull();
    expect(buildDigest(idle, { now: NOW, sample: true })?.subject).toBe("[Sample] Your study week: 0 sessions");
  });

  it("uses the user's own day: at 16:00 UTC it's already Tuesday in Tokyo", () => {
    const email = buildDigest(user({ timezone: "Asia/Tokyo" }), { now: new Date("2026-11-16T16:00:00Z") })!;
    expect(email.text).toContain("(Mon, Nov 16 – Sun, Nov 22)");
    expect(email.text).not.toContain("Nov 16, 7:00 PM"); // Monday's session is already in the past there
    expect(email.text).toContain("2 missed sessions");
  });

  it("survives malformed plans", () => {
    const broken = user({ courses: [{ name: "X", target_date: "nope", status: "In Progress", plan: { sessions: [{ date: "bad", module: 9 }], modules: "x" } }] });
    expect(() => buildDigest(broken, { now: NOW, sample: true })).not.toThrow();
  });
});

describe("runWeeklyDigest", () => {
  const env = (): Env => ({
    ANTHROPIC_API_KEY: "x",
    ALLOWED_ORIGINS: "https://keeponcourse.com",
    SUPABASE_URL: "https://db.example",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    RESEND_API_KEY: "re_test_not_real",
    DIGEST_JOB_KEY: JOB_KEY,
    PUBLIC_URL: "https://coach.example",
  });

  function stub(resendStatus = 200) {
    const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
    const idle = user({ user_id: "00000000-0000-0000-0000-00000000000b", email: "idle@example.com", courses: [] });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body, headers: init.headers as Record<string, string> });
      if (url.endsWith("/rpc/weekly_digest_due")) return Response.json([user(), idle]);
      if (url.endsWith("/rpc/weekly_digest_sent")) return Response.json(body.user_ids.length);
      if (url === "https://api.resend.com/emails/batch") return Response.json({ data: [{ id: "e1" }] }, { status: resendStatus });
      return new Response("unexpected", { status: 500 });
    });
    return calls;
  }

  it("does nothing until the secrets are set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await runWeeklyDigest({ ...env(), RESEND_API_KEY: undefined }, NOW)).toEqual({ due: 0, sent: 0, skipped: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends one batch with unsubscribe headers, then marks everyone handled", async () => {
    const calls = stub();
    expect(await runWeeklyDigest(env(), NOW)).toEqual({ due: 2, sent: 1, skipped: 1 });

    expect(calls[0].body).toEqual({ job_key: JOB_KEY });
    const batch = calls.find((c) => c.url.includes("resend"))!;
    expect(batch.headers.Authorization).toBe("Bearer re_test_not_real");
    expect(batch.headers["Idempotency-Key"]).toMatch(/^weekly-2026-11-16-[0-9a-f]{32}$/);
    const [email] = batch.body as { to: string[]; headers: Record<string, string>; from: string }[];
    expect(email.to).toEqual(["learner@example.com"]);
    expect(email.from).toBe("KeepOnCourse <hello@keeponcourse.com>");
    expect(email.headers).toEqual({
      "List-Unsubscribe": `<https://coach.example/unsubscribe/${TOKEN}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    const sent = calls.find((c) => c.url.endsWith("/rpc/weekly_digest_sent"))!;
    expect((sent.body as { user_ids: string[] }).user_ids.sort()).toEqual(["00000000-0000-0000-0000-00000000000a", "00000000-0000-0000-0000-00000000000b"]);
  });

  it("leaves users unmarked when sending fails, so the next hourly run retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = stub(500);
    expect((await runWeeklyDigest(env(), NOW)).sent).toBe(0);
    const sent = calls.find((c) => c.url.endsWith("/rpc/weekly_digest_sent"))!;
    expect((sent.body as { user_ids: string[] }).user_ids).toEqual(["00000000-0000-0000-0000-00000000000b"]); // only the one with nothing to send
  });
});

describe("Worker routes", () => {
  const APP = "https://keeponcourse.com";
  const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlLXRlc3Q";
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const env = (): Env => ({
    ANTHROPIC_API_KEY: "x",
    ALLOWED_ORIGINS: APP,
    SUPABASE_URL: "https://db.example",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    RESEND_API_KEY: "re_test_not_real",
    PUBLIC_URL: "https://coach.example",
    COACH_USAGE: memoryKv().kv,
  });

  it("unsubscribe: GET only shows a button, POST unsubscribes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(true));
    vi.stubGlobal("fetch", fetchMock);
    const get = await worker.fetch(new Request(`https://coach.example/unsubscribe/${TOKEN}`), env(), ctx);
    expect(get.status).toBe(200);
    expect(await get.text()).toContain('<form method="post"');
    expect(fetchMock).not.toHaveBeenCalled();

    const post = await worker.fetch(new Request(`https://coach.example/unsubscribe/${TOKEN}`, { method: "POST", body: "List-Unsubscribe=One-Click" }), env(), ctx);
    expect(post.status).toBe(200);
    expect(await post.text()).toContain("unsubscribed</h1>");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: TOKEN });
    expect(post.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
  });

  it("sample email: needs sign-in and the app's origin, and is capped at 3 a day", async () => {
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url.endsWith("/rpc/my_weekly_digest")) return Response.json(user());
      if (url.includes("resend")) {
        sent.push(JSON.parse(String(init.body)));
        return Response.json({ data: [{ id: "e1" }] });
      }
      return new Response("unexpected", { status: 500 });
    });
    const e = env();
    const post = (headers: Record<string, string>) => worker.fetch(new Request("https://coach.example/digest/test", { method: "POST", headers }), e, ctx);

    expect((await post({ Origin: APP })).status).toBe(401);
    expect((await post({ Origin: "https://evil.example", Authorization: `Bearer ${JWT}` })).status).toBe(403);
    for (let i = 0; i < 3; i++) expect((await post({ Origin: APP, Authorization: `Bearer ${JWT}` })).status).toBe(200);
    expect((await post({ Origin: APP, Authorization: `Bearer ${JWT}` })).status).toBe(429);
    expect(sent).toHaveLength(3);
    expect((sent[0] as { subject: string }[])[0].subject).toMatch(/^\[Sample\] Your study week/);
  });
});
