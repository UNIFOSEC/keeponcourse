import { beforeAll, describe, expect, it } from "vitest";
import { buildIcs } from "../src/ics";
import { schedule, type StudyPlan } from "../src/plan";
import type { Course } from "../src/types";

// Calendar times are converted from the learner's local time to UTC
beforeAll(() => {
  process.env.TZ = "America/New_York";
});

const course: Course = { id: 7, name: "Stats, 101; intro", description: "d", target_date: "2026-12-31", status: "In Progress", created_at: "2026-11-01 00:00:00" };

function plan(): StudyPlan {
  const modules = [
    { title: "Describing data", summary: "Line one\nline two", hours: 1, done: false },
    { title: "Probability", summary: "", hours: 1, done: true },
    { title: "A very long module title that is definitely going to need folding in the file", summary: "", hours: 1, done: false },
  ];
  // Oct 26 (EDT) and Nov 2/9 (EST) are Mondays
  return { version: 1, days: [1], session_minutes: 60, start_time: "19:00", start_date: "2026-10-26", modules, sessions: schedule(modules, { startDate: "2026-10-26", days: [1], sessionMinutes: 60 }) };
}

const unfold = (text: string) => text.replace(/\r\n /g, "");

describe("buildIcs", () => {
  it("adds one event per upcoming session of an unfinished module", () => {
    const { text, count } = buildIcs([{ course, plan: plan() }], "2026-10-01");
    expect(count).toBe(2); // module 2 is done
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it("leaves out past sessions", () => {
    expect(buildIcs([{ course, plan: plan() }], "2026-11-03").count).toBe(1);
  });

  it("converts local time to UTC, across the daylight-saving change", () => {
    const starts = [...buildIcs([{ course, plan: plan() }], "2026-10-01").text.matchAll(/DTSTART:(\S+)/g)].map((m) => m[1]);
    expect(starts).toEqual(["20261026T230000Z", "20261110T000000Z"]); // 7 PM EDT, then 7 PM EST
  });

  it("follows RFC 5545: CRLF lines, folded at 75 octets, escaped text", () => {
    const { text } = buildIcs([{ course, plan: plan() }], "2026-10-01");
    expect(text.endsWith("\r\n")).toBe(true);
    expect(Math.max(...text.split("\r\n").map((l) => new TextEncoder().encode(l).length))).toBeLessThanOrEqual(75);
    const flat = unfold(text);
    expect(flat).toContain("SUMMARY:Study: Stats\\, 101\\; intro · Describing data");
    expect(flat).toContain("Line one\\nline two");
    expect(flat).toContain("TRIGGER:-PT10M");
  });

  it("is still a valid calendar when there is nothing to add", () => {
    const { text, count } = buildIcs([], "2026-10-01");
    expect(count).toBe(0);
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(text.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });
});
