import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFeed, matchFeedPath, serveFeed } from "../src/calendar";

const TOKEN = "a".repeat(64);
const NOW = new Date("2026-10-20T12:00:00Z");

const row = (overrides: Record<string, unknown> = {}) => ({
  course_id: 3,
  course_name: "Spanish, A2",
  timezone: "America/New_York",
  plan: {
    start_time: "19:00",
    session_minutes: 60,
    modules: [
      { title: "Past tense", summary: "Preterite; imperfect", done: false },
      { title: "Already done", summary: "", done: true },
    ],
    sessions: [
      { date: "2026-10-26", module: 0, minutes: 60 }, // EDT
      { date: "2026-11-02", module: 0, minutes: 60 }, // EST
      { date: "2026-11-03", module: 1, minutes: 60 }, // finished module: left out
      { date: "2026-11-04", module: 9, minutes: 60 }, // no such module: left out
    ],
  },
  ...overrides,
});

const events = (ics: string) => ics.match(/BEGIN:VEVENT/g)?.length ?? 0;
const starts = (ics: string) => [...ics.matchAll(/DTSTART:(\S+)/g)].map((m) => m[1]);

describe("matchFeedPath", () => {
  it("only matches a 64-character hex token", () => {
    expect(matchFeedPath(`/calendar/${TOKEN}.ics`)).toBe(TOKEN);
    for (const path of [`/calendar/${TOKEN.slice(1)}.ics`, `/calendar/${TOKEN.toUpperCase()}.ics`, `/calendar/${TOKEN}`, `/calendar/../${TOKEN}.ics`]) {
      expect(matchFeedPath(path)).toBeNull();
    }
  });
});

describe("buildFeed", () => {
  it("converts the learner's local study time to UTC, across DST", () => {
    const ics = buildFeed([row()], NOW);
    expect(events(ics)).toBe(2);
    expect(starts(ics)).toEqual(["20261026T230000Z", "20261103T000000Z"]);
  });

  it("uses each learner's own time zone", () => {
    expect(starts(buildFeed([row({ timezone: "Asia/Tokyo" })], NOW))[0]).toBe("20261026T100000Z");
  });

  it("falls back to UTC for an unknown time zone, and to 7 PM for a bad time", () => {
    const ics = buildFeed([row({ timezone: "Mars/Olympus", plan: { ...row().plan, start_time: "99:99" } })], NOW);
    expect(starts(ics)[0]).toBe("20261026T190000Z");
    expect(ics).toContain("X-WR-TIMEZONE:UTC");
  });

  it("keeps the last 30 days but drops older sessions", () => {
    const old = row({ plan: { ...row().plan, sessions: [{ date: "2026-09-01", module: 0 }, { date: "2026-10-01", module: 0 }] } });
    expect(events(buildFeed([old], NOW))).toBe(1);
  });

  it("escapes text and folds long lines", () => {
    const ics = buildFeed([row({ course_name: "x".repeat(90) })], NOW);
    expect(ics.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(buildFeed([row()], NOW).replace(/\r\n /g, "")).toContain("SUMMARY:Study: Spanish\\, A2 · Past tense");
  });

  it("survives malformed rows", () => {
    expect(() => buildFeed([{ course_id: 1, course_name: "X", timezone: "UTC", plan: null as never }], NOW)).not.toThrow();
    expect(events(buildFeed([], NOW))).toBe(0);
  });
});

describe("serveFeed", () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = { SUPABASE_URL: "https://db.example", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };

  it("asks the database for the token's plans and returns a calendar", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([row()]));
    vi.stubGlobal("fetch", fetchMock);
    const response = await serveFeed(TOKEN, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    expect(await response.text()).toContain("BEGIN:VEVENT");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://db.example/rest/v1/rpc/calendar_feed");
    expect(JSON.parse(init.body)).toEqual({ feed_token: TOKEN });
  });

  it("answers an unknown token with an empty calendar, so tokens can't be probed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));
    const response = await serveFeed(TOKEN, env);
    expect(response.status).toBe(200);
    expect(events(await response.text())).toBe(0);
  });

  it("reports a database outage as 503", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 500 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await serveFeed(TOKEN, env)).status).toBe(503);
  });
});
