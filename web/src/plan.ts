import { addDays, daysUntil, todayISO } from "./dates";
import { isValidDate } from "./validation";

/**
 * Study plans: a course broken into modules (from a syllabus, via Coach) and
 * laid out as study sessions on the days and times the learner chooses.
 * Scheduling is deterministic and runs in the browser; the model only
 * suggests the modules and hour estimates.
 */

export interface PlanModule {
  title: string;
  summary: string;
  hours: number;
  done: boolean;
}

export interface PlanSession {
  date: string; // YYYY-MM-DD
  minutes: number;
  module: number; // index into modules
}

export interface StudyPlan {
  version: 1;
  days: number[]; // 0 = Sunday … 6 = Saturday
  session_minutes: number;
  start_time: string; // "HH:MM", local time
  start_date: string; // YYYY-MM-DD
  modules: PlanModule[];
  sessions: PlanSession[];
}

export interface ScheduleOptions {
  startDate: string;
  days: number[];
  sessionMinutes: number;
}

export const PLAN_LIMITS = { modules: 25, sessions: 400, hours: 60 } as const;
export const SESSION_LENGTHS = [30, 45, 60, 90, 120] as const;
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const weekday = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
};

/** Lays modules out as sessions, in order, on the chosen weekdays. */
export function schedule(modules: Pick<PlanModule, "hours">[], { startDate, days, sessionMinutes }: ScheduleOptions): PlanSession[] {
  const sessions: PlanSession[] = [];
  if (days.length === 0 || sessionMinutes <= 0) return sessions;
  let date = startDate;
  for (let index = 0; index < modules.length; index++) {
    let remaining = Math.max(1, Math.ceil((modules[index].hours * 60) / sessionMinutes));
    while (remaining > 0 && sessions.length < PLAN_LIMITS.sessions) {
      if (days.includes(weekday(date))) {
        sessions.push({ date, minutes: sessionMinutes, module: index });
        remaining--;
      }
      date = addDays(date, 1);
    }
  }
  return sessions;
}

export function finishDate(plan: Pick<StudyPlan, "sessions">): string | null {
  return plan.sessions.length ? plan.sessions[plan.sessions.length - 1].date : null;
}

export function totalHours(modules: Pick<PlanModule, "hours">[]): number {
  return modules.reduce((sum, m) => sum + m.hours, 0);
}

export function progress(plan: StudyPlan): { done: number; total: number; pct: number } {
  const total = plan.modules.length;
  const done = plan.modules.filter((m) => m.done).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/** The next session that's today or later and belongs to an unfinished module. */
export function nextSession(plan: StudyPlan, today = todayISO()): PlanSession | null {
  return plan.sessions.find((s) => s.date >= today && !plan.modules[s.module]?.done) ?? null;
}

/** Days the plan finishes before (+) or after (−) the target date. */
export function slackDays(plan: Pick<StudyPlan, "sessions">, targetDate: string): number | null {
  const end = finishDate(plan);
  return end ? daysUntil(targetDate, end) : null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Checks a plan read from storage, the API or the database, which are all
 * user-controllable. Returns a clean copy, or null if it isn't a valid plan.
 */
export function sanitizePlan(value: unknown): StudyPlan | null {
  if (!isObject(value) || value.version !== 1) return null;
  const days = Array.isArray(value.days) ? [...new Set(value.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  const minutes = Number(value.session_minutes);
  if (!days.length || !Number.isInteger(minutes) || minutes < 15 || minutes > 240) return null;
  if (typeof value.start_time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.start_time)) return null;
  if (!isValidDate(value.start_date)) return null;
  if (!Array.isArray(value.modules) || !Array.isArray(value.sessions)) return null;

  const modules: PlanModule[] = value.modules
    .filter(isObject)
    .slice(0, PLAN_LIMITS.modules)
    .map((m) => ({
      title: String(m.title ?? "").slice(0, 80),
      summary: String(m.summary ?? "").slice(0, 200),
      hours: Math.min(PLAN_LIMITS.hours, Math.max(0.25, Number(m.hours) || 1)),
      done: m.done === true,
    }))
    .filter((m) => m.title.trim());
  if (!modules.length) return null;

  const sessions: PlanSession[] = value.sessions
    .filter(isObject)
    .slice(0, PLAN_LIMITS.sessions)
    .filter((s) => isValidDate(s.date) && Number.isInteger(s.module) && (s.module as number) >= 0 && (s.module as number) < modules.length)
    .map((s) => ({ date: s.date as string, minutes: minutes, module: s.module as number }));

  return { version: 1, days, session_minutes: minutes, start_time: value.start_time, start_date: value.start_date, modules, sessions };
}

export function defaultStartDate(): string {
  return addDays(todayISO(), 1);
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const fromMinutes = (total: number) => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

interface OtherPlan {
  name: string;
  plan: StudyPlan;
}

/** How many of these sessions overlap sessions from other plans at the same time. */
export function countConflicts(sessions: PlanSession[], startTime: string, others: OtherPlan[]): { count: number; names: string[] } {
  const start = toMinutes(startTime);
  const names = new Set<string>();
  let count = 0;
  for (const session of sessions) {
    const end = start + session.minutes;
    const clash = others.find(({ plan }) => {
      const otherStart = toMinutes(plan.start_time);
      return plan.sessions.some((s) => s.date === session.date && !plan.modules[s.module]?.done && otherStart < end && start < otherStart + s.minutes);
    });
    if (clash) {
      count++;
      names.add(clash.name);
    }
  }
  return { count, names: [...names] };
}

/** The earliest start time (30-minute steps, from 6 AM to 10 PM) with no clashes. */
export function suggestFreeTime(sessions: PlanSession[], preferred: string, others: OtherPlan[]): string | null {
  const preferredMinutes = toMinutes(preferred);
  const candidates: number[] = [];
  for (let t = 6 * 60; t <= 22 * 60; t += 30) candidates.push(t);
  // Prefer times closest to what the learner picked
  candidates.sort((a, b) => Math.abs(a - preferredMinutes) - Math.abs(b - preferredMinutes) || a - b);
  for (const t of candidates) {
    const time = fromMinutes(t);
    if (countConflicts(sessions, time, others).count === 0) return time;
  }
  return null;
}
