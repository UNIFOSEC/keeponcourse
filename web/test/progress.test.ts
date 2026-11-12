import { describe, expect, it } from "vitest";
import { studyStreak, weekProgress, weekStart, type PlanSession, type StudyPlan } from "../src/plan";

const plan = (sessions: PlanSession[]): StudyPlan => ({
  version: 1,
  days: [1, 3, 5],
  session_minutes: 60,
  start_time: "19:00",
  start_date: "2026-10-01",
  modules: [{ title: "M", summary: "", hours: 20, done: false }],
  sessions,
});
const s = (date: string, status?: PlanSession["status"]): PlanSession => ({ date, minutes: 60, module: 0, ...(status ? { status } : {}) });

// Thursday Nov 12, 2026; that week runs Mon Nov 9 – Sun Nov 15
const TODAY = "2026-11-12";

describe("weekStart", () => {
  it("finds the Monday, including from a Sunday or a Monday", () => {
    expect(weekStart("2026-11-12")).toBe("2026-11-09");
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
  });
});

describe("weekProgress", () => {
  it("counts this week's sessions across plans, leaving out skipped ones", () => {
    const a = plan([s("2026-11-09", "done"), s("2026-11-11", "skipped"), s("2026-11-13"), s("2026-11-16")]);
    const b = plan([s("2026-11-10", "done"), s("2026-11-15"), s("2026-11-08", "done")]);
    expect(weekProgress([a, b], TODAY)).toEqual({ done: 2, total: 4 });
  });

  it("is empty with no sessions this week", () => {
    expect(weekProgress([plan([s("2026-11-02", "done")])], TODAY)).toEqual({ done: 0, total: 0 });
  });
});

describe("studyStreak", () => {
  it("counts consecutive weeks with a done session, back from last week", () => {
    const p = plan([s("2026-10-20", "done"), s("2026-10-28", "done"), s("2026-11-04", "done"), s("2026-11-09")]);
    expect(studyStreak([p], TODAY)).toBe(3); // weeks of Oct 19, Oct 26, Nov 2; this week not done yet
  });

  it("adds this week once a session is done", () => {
    const p = plan([s("2026-11-04", "done"), s("2026-11-10", "done")]);
    expect(studyStreak([p], TODAY)).toBe(2);
  });

  it("breaks on a week without any done session, and ignores sessions marked done in the future", () => {
    const p = plan([s("2026-10-20", "done"), s("2026-11-04", "done"), s("2026-11-20", "done")]);
    expect(studyStreak([p], TODAY)).toBe(1);
  });

  it("combines plans", () => {
    expect(studyStreak([plan([s("2026-11-03", "done")]), plan([s("2026-10-29", "done")])], TODAY)).toBe(2);
  });
});
