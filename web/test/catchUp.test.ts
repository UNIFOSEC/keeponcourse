import { describe, expect, it } from "vitest";
import { catchUp, finishDate, missedSessions, nextSession, sanitizePlan, schedule, sessionProgress, setSessionStatus, type StudyPlan } from "../src/plan";

const MON = 1;
const WED = 3;
const FRI = 5;

/** Two modules (2 h and 1 h) on Mon/Wed at 60 min, from Mon Nov 2, 2026: Nov 2, 4, 9 */
function plan(): StudyPlan {
  const modules = [
    { title: "Basics", summary: "", hours: 2, done: false },
    { title: "Practice", summary: "", hours: 1, done: false },
  ];
  const opts = { startDate: "2026-11-02", days: [MON, WED], sessionMinutes: 60 };
  return { version: 1, days: opts.days, session_minutes: 60, start_time: "19:00", start_date: opts.startDate, modules, sessions: schedule(modules, opts) };
}

describe("check-ins", () => {
  it("marks a session done or skipped, and can clear it again", () => {
    const p = plan();
    const done = setSessionStatus(p, 0, "done").plan;
    expect(done.sessions[0].status).toBe("done");
    expect(setSessionStatus(done, 0, null).plan.sessions[0]).not.toHaveProperty("status");
    expect(setSessionStatus(p, 1, "skipped").plan.sessions[1].status).toBe("skipped");
    expect(p.sessions[0]).not.toHaveProperty("status"); // the original is unchanged
  });

  it("finishes a module when its last open session is done", () => {
    const first = setSessionStatus(plan(), 0, "done");
    expect(first.finishedModule).toBeNull();
    const second = setSessionStatus(first.plan, 1, "done");
    expect(second.finishedModule).toBe(0);
    expect(second.plan.modules[0].done).toBe(true);
    expect(sessionProgress(second.plan)).toEqual({ done: 2, total: 3 });
  });

  it("knows which sessions were missed, and skips checked-in ones when finding the next", () => {
    const p = setSessionStatus(plan(), 0, "done").plan;
    expect(missedSessions(p, "2026-11-06").map((s) => s.date)).toEqual(["2026-11-04"]);
    expect(missedSessions(p, "2026-11-02")).toEqual([]); // today isn't missed yet
    expect(nextSession(setSessionStatus(p, 2, "skipped").plan, "2026-11-05")).toBeNull();
  });

  it("keeps check-ins and per-session lengths through sanitizing", () => {
    const p = setSessionStatus(plan(), 0, "done").plan;
    p.sessions[1] = { ...p.sessions[1], minutes: 90, status: "skipped" };
    const clean = sanitizePlan(JSON.parse(JSON.stringify({ ...p, sessions: [...p.sessions, { date: "2026-11-11", module: 0, minutes: 60, status: "hacked" }] })));
    expect(clean?.sessions.map((s) => [s.minutes, s.status])).toEqual([
      [60, "done"],
      [90, "skipped"],
      [60, undefined],
      [60, undefined],
    ]);
  });
});

describe("catchUp", () => {
  // Basics session 1 done (Nov 2), session 2 missed (Nov 4), Practice missed (Nov 9); today is Thu Nov 12
  const behind = () => setSessionStatus(plan(), 0, "done").plan;

  it("keeps what's done, records missed sessions as skipped, and reschedules the rest from today", () => {
    const p = catchUp(behind(), { today: "2026-11-12" });
    expect(p.sessions.map((s) => [s.date, s.module, s.status ?? "open"])).toEqual([
      ["2026-11-02", 0, "done"],
      ["2026-11-04", 0, "skipped"],
      ["2026-11-09", 1, "skipped"],
      ["2026-11-16", 0, "open"], // the 1 hour of Basics still to do
      ["2026-11-18", 1, "open"],
    ]);
    expect(missedSessions(p, "2026-11-12")).toEqual([]);
    expect(finishDate(p)).toBe("2026-11-18");
  });

  it("can add study days and change the session length to finish sooner", () => {
    const p = catchUp(behind(), { today: "2026-11-12", days: [MON, WED, FRI], sessionMinutes: 30 });
    const open = p.sessions.filter((s) => !s.status);
    // 60 min left of Basics and 60 of Practice, in 30-minute sessions: 4 sessions from Fri Nov 13
    expect(open.map((s) => [s.date, s.module, s.minutes])).toEqual([
      ["2026-11-13", 0, 30],
      ["2026-11-16", 0, 30],
      ["2026-11-18", 1, 30],
      ["2026-11-20", 1, 30],
    ]);
    expect(p.days).toEqual([MON, WED, FRI]);
    expect(p.session_minutes).toBe(30);
  });

  it("schedules nothing for finished modules, and keeps sessions done ahead of time", () => {
    let p = behind();
    p = { ...p, modules: p.modules.map((m, i) => (i === 1 ? { ...m, done: true } : m)) };
    p = setSessionStatus(p, 1, "done").plan; // Basics session 2, done (Nov 4)
    const result = catchUp(p, { today: "2026-11-03" });
    expect(result.sessions.filter((s) => !s.status)).toEqual([]);
    expect(result.modules[0].done).toBe(true); // both Basics sessions done
  });

  it("doesn't put a new session on a day that already has a done one", () => {
    let p = plan();
    // Future session done early: Nov 9 (Practice)
    p = setSessionStatus(p, 2, "done").plan;
    const result = catchUp(p, { today: "2026-11-05" });
    const dates = result.sessions.map((s) => s.date);
    expect(new Set(dates).size).toBe(dates.length);
  });
});

describe("timed check-ins", () => {
  it("records the minutes studied, clamped, and clears them when the check-in is undone", () => {
    const p = setSessionStatus(plan(), 0, "done", 52.4).plan;
    expect(p.sessions[0]).toMatchObject({ status: "done", actual_minutes: 52 });
    expect(setSessionStatus(plan(), 0, "done", 9999).plan.sessions[0].actual_minutes).toBe(600);
    expect(setSessionStatus(p, 0, null).plan.sessions[0]).not.toHaveProperty("actual_minutes");
    expect(setSessionStatus(plan(), 1, "skipped", 30).plan.sessions[1]).not.toHaveProperty("actual_minutes");
    expect(sanitizePlan(JSON.parse(JSON.stringify(p)))?.sessions[0].actual_minutes).toBe(52);
  });
});
