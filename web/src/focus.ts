import { readJSON, writeJSON } from "./data/storage";
import type { StudyPlan } from "./plan";

/**
 * Focus timer state. It's based on timestamps, not on counting ticks, so it
 * stays right when the tab sleeps or the app reloads, and it's saved in this
 * browser so a running timer survives closing the app.
 */
export interface FocusState {
  courseId: number;
  /** The session, identified by date and module (indexes can shift after a catch-up) */
  date: string;
  module: number;
  plannedMinutes: number;
  startedAt: number;
  /** Set while paused */
  pausedAt: number | null;
  /** Total time spent paused before the current pause */
  pausedMs: number;
}

const KEY = "koc.focus.v1";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function elapsedMs(state: FocusState, now = Date.now()): number {
  return Math.max(0, (state.pausedAt ?? now) - state.startedAt - state.pausedMs);
}

export function remainingMs(state: FocusState, now = Date.now()): number {
  return state.plannedMinutes * 60_000 - elapsedMs(state, now);
}

export function pause(state: FocusState, now = Date.now()): FocusState {
  return state.pausedAt === null ? { ...state, pausedAt: now } : state;
}

export function resume(state: FocusState, now = Date.now()): FocusState {
  return state.pausedAt === null ? state : { ...state, pausedMs: state.pausedMs + (now - state.pausedAt), pausedAt: null };
}

/** Whole minutes studied, at least 1 (what gets recorded on the session). */
export function studiedMinutes(state: FocusState, now = Date.now()): number {
  return Math.max(1, Math.round(elapsedMs(state, now) / 60_000));
}

/** "48:05", or "+3:12" once past the planned time; "1:05:00" past an hour. */
export function formatClock(ms: number): string {
  const over = ms < 0;
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const body = h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  return over ? `+${body}` : body;
}

/** The plan's index of the timed session, if it's still there and not checked in yet. */
export function findSession(plan: StudyPlan | null | undefined, state: FocusState): number {
  return plan ? plan.sessions.findIndex((s) => s.date === state.date && s.module === state.module && !s.status) : -1;
}

export function loadFocus(now = Date.now()): FocusState | null {
  const raw = readJSON<Partial<FocusState> | null>(KEY, null);
  if (
    !raw ||
    !Number.isInteger(raw.courseId) ||
    typeof raw.date !== "string" ||
    !Number.isInteger(raw.module) ||
    !Number.isFinite(raw.plannedMinutes) ||
    !Number.isFinite(raw.startedAt) ||
    !Number.isFinite(raw.pausedMs) ||
    (raw.pausedAt !== null && !Number.isFinite(raw.pausedAt))
  ) {
    return null;
  }
  // A timer left running for half a day was forgotten, not studied
  if (now - (raw.startedAt as number) > MAX_AGE_MS) {
    saveFocus(null);
    return null;
  }
  return raw as FocusState;
}

export function saveFocus(state: FocusState | null): void {
  if (state) writeJSON(KEY, state);
  else {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Storage blocked: nothing was saved either
    }
  }
}
