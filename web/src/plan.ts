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

/** A check-in: the learner did the session, or chose to skip it. No status = not checked in yet. */
export type SessionStatus = "done" | "skipped";

export interface PlanSession {
  date: string; // YYYY-MM-DD
  minutes: number;
  module: number; // index into modules
  status?: SessionStatus;
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
export function schedule(modules: Pick<PlanModule, "hours">[], options: ScheduleOptions): PlanSession[] {
  const counts = modules.map((m) => Math.max(1, Math.ceil((m.hours * 60) / options.sessionMinutes)));
  return layOut(counts, options);
}

/** Places counts[i] sessions of module i, modules in order, skipping busy dates. */
function layOut(counts: number[], { startDate, days, sessionMinutes }: ScheduleOptions, limit: number = PLAN_LIMITS.sessions, busy = new Set<string>()): PlanSession[] {
  const sessions: PlanSession[] = [];
  if (days.length === 0 || sessionMinutes <= 0) return sessions;
  let date = startDate;
  for (let index = 0; index < counts.length; index++) {
    let remaining = counts[index];
    while (remaining > 0 && sessions.length < limit) {
      if (days.includes(weekday(date)) && !busy.has(date)) {
        sessions.push({ date, minutes: sessionMinutes, module: index });
        remaining--;
      }
      date = addDays(date, 1);
    }
  }
  return sessions;
}

/** The date of the last session still to do (skipped sessions don't count). */
export function finishDate(plan: Pick<StudyPlan, "sessions">): string | null {
  let last: string | null = null;
  for (const s of plan.sessions) if (s.status !== "skipped" && (last === null || s.date > last)) last = s.date;
  return last;
}

export function totalHours(modules: Pick<PlanModule, "hours">[]): number {
  return modules.reduce((sum, m) => sum + m.hours, 0);
}

export function progress(plan: StudyPlan): { done: number; total: number; pct: number } {
  const total = plan.modules.length;
  const done = plan.modules.filter((m) => m.done).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/** The next session that's today or later, not checked in yet, and belongs to an unfinished module. */
export function nextSession(plan: StudyPlan, today = todayISO()): PlanSession | null {
  return plan.sessions.find((s) => s.date >= today && !s.status && !plan.modules[s.module]?.done) ?? null;
}

/** Sessions before today that were never checked in, for modules that aren't done: what "behind" means. */
export function missedSessions(plan: StudyPlan, today = todayISO()): PlanSession[] {
  return plan.sessions.filter((s) => s.date < today && !s.status && !plan.modules[s.module]?.done);
}

/** The Monday of the week containing a date (weeks run Monday to Sunday). */
export function weekStart(iso: string): string {
  return addDays(iso, -((weekday(iso) + 6) % 7));
}

/** This week's sessions across plans: how many are done, out of those not skipped. */
export function weekProgress(plans: StudyPlan[], today = todayISO()): { done: number; total: number } {
  const start = weekStart(today);
  const end = addDays(start, 6);
  let done = 0;
  let total = 0;
  for (const plan of plans) {
    for (const s of plan.sessions) {
      if (s.date < start || s.date > end || s.status === "skipped") continue;
      total++;
      if (s.status === "done") done++;
    }
  }
  return { done, total };
}

/**
 * Weeks in a row with at least one study session done, counting back from
 * last week. This week adds to the streak once a session is done, but an
 * unfinished week in progress doesn't break it.
 */
export function studyStreak(plans: StudyPlan[], today = todayISO()): number {
  const weeks = new Set<string>();
  for (const plan of plans) for (const s of plan.sessions) if (s.status === "done" && s.date <= today) weeks.add(weekStart(s.date));
  let week = weekStart(today);
  let streak = weeks.has(week) ? 1 : 0;
  week = addDays(week, -7);
  while (weeks.has(week)) {
    streak++;
    week = addDays(week, -7);
  }
  return streak;
}

/** Done sessions out of all sessions that aren't skipped. */
export function sessionProgress(plan: StudyPlan): { done: number; total: number } {
  const counted = plan.sessions.filter((s) => s.status !== "skipped");
  return { done: counted.filter((s) => s.status === "done").length, total: counted.length };
}

/**
 * Checks a session in (done or skipped) or clears its check-in. Marking the
 * last open session of a module done also marks the module done.
 */
export function setSessionStatus(plan: StudyPlan, index: number, status: SessionStatus | null): { plan: StudyPlan; finishedModule: number | null } {
  const target = plan.sessions[index];
  if (!target) return { plan, finishedModule: null };
  const sessions: PlanSession[] = plan.sessions.map((s, i) => {
    if (i !== index) return s;
    const { status: _old, ...rest } = s;
    return status ? { ...rest, status } : rest;
  });
  let finishedModule: number | null = null;
  let modules = plan.modules;
  const module = plan.modules[target.module];
  if (status === "done" && module && !module.done) {
    const open = sessions.some((s) => s.module === target.module && s.status !== "done" && s.status !== "skipped");
    if (!open) {
      finishedModule = target.module;
      modules = plan.modules.map((m, i) => (i === target.module ? { ...m, done: true } : m));
    }
  }
  return { plan: { ...plan, sessions, modules }, finishedModule };
}

export interface CatchUpOptions {
  today?: string;
  days?: number[];
  sessionMinutes?: number;
}

/**
 * Reschedules the work that's left so the plan starts again from today.
 * Done sessions stay where they are; past sessions that were never checked in
 * stay on record as skipped. Each unfinished module gets the time it still
 * needs (its hours minus the time already done), in the new session length,
 * on the chosen days, from today on.
 */
export function catchUp(plan: StudyPlan, { today = todayISO(), days = plan.days, sessionMinutes = plan.session_minutes }: CatchUpOptions = {}): StudyPlan {
  const kept: PlanSession[] = [];
  for (const s of plan.sessions) {
    if (s.status === "done") kept.push(s);
    else if (s.date < today) kept.push(s.status ? s : { ...s, status: "skipped" });
  }
  const doneMinutes = new Map<number, number>();
  for (const s of kept) if (s.status === "done") doneMinutes.set(s.module, (doneMinutes.get(s.module) ?? 0) + s.minutes);

  const counts = plan.modules.map((m, i) => {
    if (m.done) return 0;
    const left = m.hours * 60 - (doneMinutes.get(i) ?? 0);
    return left > 0 ? Math.ceil(left / sessionMinutes) : 0;
  });
  const busy = new Set(kept.filter((s) => s.date >= today).map((s) => s.date));
  const fresh = layOut(counts, { startDate: today, days, sessionMinutes }, Math.max(0, PLAN_LIMITS.sessions - kept.length), busy);
  const sessions = [...kept, ...fresh].sort((a, b) => a.date.localeCompare(b.date) || a.module - b.module);
  return { ...plan, days: [...days].sort(), session_minutes: sessionMinutes, sessions };
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
    .map((s) => {
      // Sessions keep their own length (it can differ after a catch-up changed the session length)
      const own = Number(s.minutes);
      const session: PlanSession = { date: s.date as string, minutes: Number.isInteger(own) && own >= 15 && own <= 240 ? own : minutes, module: s.module as number };
      if (s.status === "done" || s.status === "skipped") session.status = s.status;
      return session;
    });

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
      return plan.sessions.some((s) => s.date === session.date && !s.status && !plan.modules[s.module]?.done && otherStart < end && start < otherStart + s.minutes);
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
