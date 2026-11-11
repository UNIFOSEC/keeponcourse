import { describe, expect, it } from "vitest";
import {
  countConflicts,
  finishDate,
  nextSession,
  progress,
  sanitizePlan,
  schedule,
  slackDays,
  suggestFreeTime,
  type StudyPlan,
} from "../src/plan";

const MON = 1;
const WED = 3;
const SAT = 6;

const weekday = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
};

function plan(overrides: Partial<StudyPlan> = {}): StudyPlan {
  const modules = [
    { title: "One", summary: "", hours: 2, done: false },
    { title: "Two", summary: "", hours: 1, done: false },
  ];
  const opts = { startDate: "2026-11-09", days: [MON, WED], sessionMinutes: 60 }; // Nov 9, 2026 is a Monday
  return { version: 1, days: opts.days, session_minutes: 60, start_time: "19:00", start_date: opts.startDate, modules, sessions: schedule(modules, opts), ...overrides };
}

describe("schedule", () => {
  it("places sessions only on the chosen weekdays, modules in order", () => {
    const sessions = schedule(
      [{ hours: 2 }, { hours: 1.5 }],
      { startDate: "2026-11-09", days: [MON, WED, SAT], sessionMinutes: 60 },
    );
    expect(sessions.map((s) => s.date)).toEqual(["2026-11-09", "2026-11-11", "2026-11-14", "2026-11-16"]);
    expect(sessions.map((s) => s.module)).toEqual([0, 0, 1, 1]); // 1.5 h → 2 sessions of 60 min
    expect(sessions.every((s) => [MON, WED, SAT].includes(weekday(s.date)))).toBe(true);
  });

  it("gives every module at least one session", () => {
    expect(schedule([{ hours: 0.25 }], { startDate: "2026-11-09", days: [MON], sessionMinutes: 90 })).toHaveLength(1);
  });

  it("returns nothing without study days", () => {
    expect(schedule([{ hours: 3 }], { startDate: "2026-11-09", days: [], sessionMinutes: 60 })).toEqual([]);
  });

  it("is capped so a huge plan can't explode", () => {
    expect(schedule([{ hours: 60 }, { hours: 60 }, { hours: 60 }, { hours: 60 }, { hours: 60 }, { hours: 60 }, { hours: 60 }], { startDate: "2026-11-09", days: [MON], sessionMinutes: 30 })).toHaveLength(400);
  });
});

describe("plan summaries", () => {
  it("finds the finish date, progress and slack against a target", () => {
    const p = plan();
    expect(finishDate(p)).toBe("2026-11-16");
    expect(slackDays(p, "2026-11-20")).toBe(4);
    expect(slackDays(p, "2026-11-13")).toBe(-3);
    expect(progress(p)).toEqual({ done: 0, total: 2, pct: 0 });
  });

  it("skips sessions of finished modules when finding the next one", () => {
    const p = plan();
    p.modules[0].done = true;
    expect(nextSession(p, "2026-11-01")?.module).toBe(1);
    expect(progress(p)).toEqual({ done: 1, total: 2, pct: 50 });
  });
});

describe("sanitizePlan", () => {
  it("keeps a valid plan", () => {
    const p = plan();
    expect(sanitizePlan(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it("rejects malformed plans", () => {
    for (const bad of [null, "x", {}, { ...plan(), version: 2 }, { ...plan(), days: [] }, { ...plan(), start_time: "25:00" }, { ...plan(), modules: [] }]) {
      expect(sanitizePlan(bad)).toBeNull();
    }
  });

  it("clamps values and drops sessions that point nowhere", () => {
    const p = sanitizePlan({ ...plan(), modules: [{ title: "A".repeat(500), hours: 9999 }], sessions: [{ date: "2026-11-09", module: 0 }, { date: "2026-11-11", module: 7 }, { date: "bad", module: 0 }] });
    expect(p?.modules[0].title).toHaveLength(80);
    expect(p?.modules[0].hours).toBe(60);
    expect(p?.sessions).toEqual([{ date: "2026-11-09", minutes: 60, module: 0 }]);
  });
});

describe("double-booking", () => {
  const other = { name: "Spanish", plan: plan() }; // Mon/Wed at 19:00 for 60 min

  it("counts sessions that overlap another plan", () => {
    const mine = schedule([{ hours: 2 }], { startDate: "2026-11-09", days: [MON], sessionMinutes: 60 });
    expect(countConflicts(mine, "19:30", [other])).toEqual({ count: 2, names: ["Spanish"] });
    expect(countConflicts(mine, "20:00", [other]).count).toBe(0); // starts as the other ends
  });

  it("ignores sessions of modules already done", () => {
    const done = plan();
    done.modules.forEach((m) => (m.done = true));
    const mine = schedule([{ hours: 1 }], { startDate: "2026-11-09", days: [MON], sessionMinutes: 60 });
    expect(countConflicts(mine, "19:00", [{ name: "Done", plan: done }]).count).toBe(0);
  });

  it("suggests the nearest free start time", () => {
    const mine = schedule([{ hours: 1 }], { startDate: "2026-11-09", days: [MON], sessionMinutes: 60 });
    expect(suggestFreeTime(mine, "19:00", [other])).toBe("18:00");
  });
});
