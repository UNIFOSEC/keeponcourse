import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, daysUntil, dueInfo, isOverdue, timestamp, toISODate } from "../src/dates";
import type { Course } from "../src/types";

const course = (target_date: string, status: Course["status"] = "In Progress"): Course => ({
  id: 1,
  name: "Course",
  description: "d",
  target_date,
  status,
  created_at: "2026-01-01 00:00:00",
});

describe("date helpers", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts whole days, unaffected by daylight-saving changes", () => {
    expect(daysUntil("2026-11-10", "2026-10-30")).toBe(11); // spans the US DST change
    expect(daysUntil("2026-11-01", "2026-11-11")).toBe(-10);
  });

  it("formats local dates and UTC timestamps the same way as the API", () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(timestamp(new Date("2026-11-11T17:06:26.923Z"))).toBe("2026-11-11 17:06:26");
  });
});

describe("dueInfo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 11, 12, 0)); // Nov 11, 2026, local noon
  });
  afterEach(() => vi.useRealTimers());

  it("describes deadlines in plain words", () => {
    expect(dueInfo(course("2026-11-11"))).toEqual({ text: "Due today", tone: "soon" });
    expect(dueInfo(course("2026-11-12"))).toEqual({ text: "Due tomorrow", tone: "soon" });
    expect(dueInfo(course("2026-11-16"))).toEqual({ text: "Due in 5 days", tone: "soon" });
    expect(dueInfo(course("2026-12-01")).tone).toBe("normal");
    expect(dueInfo(course("2026-11-10"))).toEqual({ text: "1 day overdue", tone: "overdue" });
    expect(dueInfo(course("2026-11-08"))).toEqual({ text: "3 days overdue", tone: "overdue" });
  });

  it("never calls a completed course overdue", () => {
    expect(dueInfo(course("2026-01-01", "Completed"))).toEqual({ text: "Completed", tone: "done" });
    expect(isOverdue(course("2026-01-01", "Completed"))).toBe(false);
    expect(isOverdue(course("2026-01-01"))).toBe(true);
  });
});
