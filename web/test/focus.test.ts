// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { elapsedMs, findSession, formatClock, loadFocus, pause, remainingMs, resume, saveFocus, studiedMinutes, type FocusState } from "../src/focus";
import type { StudyPlan } from "../src/plan";

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const state = (overrides: Partial<FocusState> = {}): FocusState => ({ courseId: 4, date: "2026-11-12", module: 1, plannedMinutes: 60, startedAt: T0, pausedAt: null, pausedMs: 0, ...overrides });

beforeEach(() => localStorage.clear());

describe("focus timer", () => {
  it("counts from timestamps, so it stays right after the tab sleeps", () => {
    expect(elapsedMs(state(), T0 + 25 * MIN)).toBe(25 * MIN);
    expect(remainingMs(state(), T0 + 25 * MIN)).toBe(35 * MIN);
    expect(remainingMs(state(), T0 + 70 * MIN)).toBe(-10 * MIN);
  });

  it("leaves paused time out", () => {
    let s = pause(state(), T0 + 10 * MIN);
    expect(elapsedMs(s, T0 + 40 * MIN)).toBe(10 * MIN); // frozen while paused
    s = resume(s, T0 + 40 * MIN);
    expect(elapsedMs(s, T0 + 50 * MIN)).toBe(20 * MIN);
    expect(pause(pause(state(), T0 + MIN), T0 + 2 * MIN).pausedAt).toBe(T0 + MIN); // pausing twice is harmless
  });

  it("records whole minutes, at least one", () => {
    expect(studiedMinutes(state(), T0 + 20 * 1000)).toBe(1);
    expect(studiedMinutes(state(), T0 + 47.6 * MIN)).toBe(48);
  });

  it("formats the clock, including overtime and hours", () => {
    expect(formatClock(35 * MIN + 5000)).toBe("35:05");
    expect(formatClock(-(3 * MIN + 12_000))).toBe("+3:12");
    expect(formatClock(65 * MIN)).toBe("1:05:00");
  });

  it("finds the timed session by date and module, if it's still open", () => {
    const plan = { sessions: [{ date: "2026-11-10", module: 1, minutes: 60 }, { date: "2026-11-12", module: 1, minutes: 60 }] } as StudyPlan;
    expect(findSession(plan, state())).toBe(1);
    expect(findSession({ sessions: [{ date: "2026-11-12", module: 1, minutes: 60, status: "done" }] } as StudyPlan, state())).toBe(-1);
    expect(findSession(null, state())).toBe(-1);
  });

  it("survives a reload, but forgets a timer left running for half a day", () => {
    saveFocus(state());
    expect(loadFocus(T0 + 30 * MIN)).toEqual(state());
    expect(loadFocus(T0 + 13 * 60 * MIN)).toBeNull();
    expect(localStorage.getItem("koc.focus.v1")).toBeNull();
  });

  it("ignores tampered saved state", () => {
    localStorage.setItem("koc.focus.v1", JSON.stringify({ courseId: "4", date: "x", module: 1 }));
    expect(loadFocus(T0)).toBeNull();
  });
});
