import type { App } from "./app";
import { addDays, daysUntil, todayISO } from "./dates";
import { finishDate, missedSessions, sessionProgress, studyStreak, weekProgress, weekStart, type PlanSession } from "./plan";
import { isValidDate } from "./validation";

/**
 * Study partners: a learner shares a private link with a friend or mentor,
 * who sees a read-only summary of their progress and can send one-tap
 * cheers. Everything goes through database functions (supabase/schema.sql);
 * the link's token is the only credential a partner has.
 */

export type CheerKind = "keep_going" | "proud" | "streak" | "you_got_this";

export const CHEERS: Record<CheerKind, { emoji: string; text: string }> = {
  keep_going: { emoji: "👏", text: "Keep going!" },
  proud: { emoji: "⭐", text: "Proud of you!" },
  streak: { emoji: "🔥", text: "Great streak!" },
  you_got_this: { emoji: "💪", text: "You've got this!" },
};
export const CHEERS_PER_DAY = 5;
export const MAX_PARTNERS = 5;
export const NAME_MAX = 40;

export interface PartnerInvite {
  id: number;
  label: string;
  display_name: string;
  token: string;
  show_names: boolean;
  created_at: string;
  last_viewed_at: string | null;
  cheers: number;
}

export interface Cheer {
  id: number;
  kind: CheerKind;
  from: string;
  seen: boolean;
  created_at: string;
}

/** A course as a partner sees it: no description, and names only if the learner allowed it. */
export interface SharedCourse {
  name: string | null;
  target_date: string;
  status: "Not Started" | "In Progress" | "Completed";
  modules: { title: string | null; done: boolean }[];
  sessions: PlanSession[];
}

export interface SharedProgress {
  display_name: string;
  show_names: boolean;
  timezone: string;
  cheers_today: number;
  courses: SharedCourse[];
}

const TOKEN = /^[0-9a-f]{64}$/;

/** The partner page's address for a token. */
export function partnerLink(token: string, origin = location.origin): string {
  return `${origin}/#/p/${token}`;
}

/** The token in a partner page's hash ("#/p/<token>"), or null. */
export function tokenFromHash(hash: string): string | null {
  const match = /^#\/p\/([0-9a-f]{64})$/.exec(hash);
  return match ? match[1] : null;
}

export const isPartnerHash = (hash: string) => hash.startsWith("#/p/");

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

/** Checks the shared progress from the database (it comes from a learner's own plan data). */
export function sanitizeShared(value: unknown): SharedProgress | null {
  if (!isObject(value)) return null;
  const courses = (Array.isArray(value.courses) ? value.courses : []).filter(isObject).slice(0, 100).flatMap((c): SharedCourse[] => {
    if (!isValidDate(c.target_date)) return [];
    const modules = (Array.isArray(c.modules) ? c.modules : []).filter(isObject).slice(0, 25).map((m) => ({ title: text(m.title, 80), done: m.done === true }));
    const sessions = (Array.isArray(c.sessions) ? c.sessions : [])
      .filter(isObject)
      .slice(0, 400)
      .filter((s) => isValidDate(s.date) && Number.isInteger(s.module) && (s.module as number) >= 0 && (s.module as number) < modules.length)
      .map((s) => {
        const own = Number(s.minutes);
        const session: PlanSession = { date: s.date as string, minutes: Number.isInteger(own) && own >= 15 && own <= 240 ? own : 60, module: s.module as number };
        if (s.status === "done" || s.status === "skipped") session.status = s.status;
        const actual = Number(s.actual_minutes);
        if (session.status === "done" && Number.isInteger(actual) && actual >= 1 && actual <= 600) session.actual_minutes = actual;
        return session;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    const status = c.status === "Completed" || c.status === "In Progress" ? c.status : "Not Started";
    return [{ name: text(c.name, 100), target_date: c.target_date as string, status, modules, sessions }];
  });
  return {
    display_name: text(value.display_name, NAME_MAX) ?? "Your partner",
    show_names: value.show_names === true,
    timezone: typeof value.timezone === "string" ? value.timezone : "UTC",
    cheers_today: Number.isInteger(value.cheers_today) ? (value.cheers_today as number) : 0,
    courses,
  };
}

/** Today in the learner's time zone, so "this week" and "missed" mean the same to both people. */
export function todayIn(timezone: string, now = new Date()): string {
  try {
    // en-CA formats dates as YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return todayISO();
  }
}

export type DayState = "done" | "skipped" | "missed" | "today" | "upcoming";

export interface CourseSummary {
  name: string;
  status: SharedCourse["status"];
  done: number;
  total: number;
  missed: number;
  target_date: string;
  finish: string | null;
  /** Days the plan finishes before (+) or after (−) the target */
  slack: number | null;
  next: { date: string; module: string | null } | null;
  tone: "done" | "good" | "behind" | "late";
}

export interface ProgressSummary {
  today: string;
  week: { done: number; total: number; minutes: number };
  streak: number;
  lastStudied: string | null;
  days: { date: string; state: DayState }[];
  courses: CourseSummary[];
}

/** Everything the partner page shows, worked out from the shared plans. */
export function summarize(shared: SharedProgress, today = todayIn(shared.timezone)): ProgressSummary {
  const plans = shared.courses;
  const start = weekStart(today);
  const end = addDays(start, 6);
  let lastStudied: string | null = null;
  const days: { date: string; state: DayState }[] = [];
  for (const course of plans) {
    for (const s of course.sessions) {
      if (s.status === "done" && s.date <= today && (!lastStudied || s.date > lastStudied)) lastStudied = s.date;
      if (s.date < start || s.date > end || course.status === "Completed") continue;
      const state: DayState = s.status ?? (course.modules[s.module]?.done ? "done" : s.date < today ? "missed" : s.date === today ? "today" : "upcoming");
      days.push({ date: s.date, state });
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  const courses = plans.map((course, i): CourseSummary => {
    const { done, total } = sessionProgress(course);
    const missed = course.status === "Completed" ? 0 : missedSessions(course, today).length;
    const finish = finishDate(course);
    const slack = finish ? daysUntil(course.target_date, finish) : null;
    const upcoming = course.sessions.find((s) => s.date >= today && !s.status && !course.modules[s.module]?.done);
    const tone = course.status === "Completed" ? "done" : missed > 0 ? "behind" : slack !== null && slack < 0 ? "late" : "good";
    return {
      name: course.name ?? `Course ${i + 1}`,
      status: course.status,
      done,
      total,
      missed,
      target_date: course.target_date,
      finish,
      slack,
      next: upcoming && course.status !== "Completed" ? { date: upcoming.date, module: course.modules[upcoming.module]?.title ?? null } : null,
      tone,
    };
  });

  return { today, week: weekProgress(plans.filter((c) => c.status !== "Completed"), today), streak: studyStreak(plans, today), lastStudied, days, courses };
}

// ----------------------------------------------------------------- API

function readable(error: { message?: string } | null, fallback: string): Error {
  const message = error?.message ?? "";
  // Messages raised on purpose by the database are written for people
  return new Error(/up to 5 study partners|plenty of cheering/.test(message) ? message.replace(/^.*?(You can|That's)/, "$1") : fallback);
}

export async function myPartners(app: App): Promise<PartnerInvite[]> {
  const sb = await app.account.db();
  const { data, error } = await sb.rpc("my_partners");
  if (error) throw readable(error, "Couldn't load your study partners.");
  return Array.isArray(data) ? (data as PartnerInvite[]) : [];
}

export async function createInvite(app: App, label: string, displayName: string, showNames: boolean): Promise<{ id: number; token: string }> {
  const sb = await app.account.db();
  let tz: string | null = null;
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    // Unknown: the database uses UTC
  }
  const { data, error } = await sb.rpc("create_partner_invite", { label, display_name: displayName, show_names: showNames, tz });
  if (error || !isObject(data) || typeof data.token !== "string" || !TOKEN.test(data.token)) throw readable(error, "Couldn't create the invite. Please try again.");
  return { id: Number(data.id), token: data.token };
}

export async function updateInvite(app: App, id: number, showNames: boolean, displayName?: string): Promise<void> {
  const sb = await app.account.db();
  const { error } = await sb.rpc("update_partner_invite", { invite_id: id, show_names: showNames, display_name: displayName ?? null });
  if (error) throw readable(error, "Couldn't save. Please try again.");
}

export async function deleteInvite(app: App, id: number): Promise<void> {
  const sb = await app.account.db();
  const { error } = await sb.rpc("delete_partner_invite", { invite_id: id });
  if (error) throw readable(error, "Couldn't stop sharing. Please try again.");
}

/** The partner page's data. Works without signing in; null when the link isn't valid (any more). */
export async function loadShared(app: App, token: string): Promise<SharedProgress | null> {
  if (!TOKEN.test(token)) return null;
  const sb = await app.account.db();
  const { data, error } = await sb.rpc("partner_view", { token });
  if (error) throw readable(error, "Couldn't load this progress page. Please try again.");
  return data ? sanitizeShared(data) : null;
}

export async function sendCheer(app: App, token: string, kind: CheerKind): Promise<boolean> {
  const sb = await app.account.db();
  const { data, error } = await sb.rpc("send_cheer", { token, kind });
  if (error) throw readable(error, "Couldn't send your cheer. Please try again.");
  return data === true;
}

export async function myCheers(app: App): Promise<Cheer[]> {
  const sb = await app.account.db();
  const { data, error } = await sb.rpc("my_cheers");
  if (error) throw readable(error, "Couldn't load your cheers.");
  return Array.isArray(data) ? (data as Cheer[]).filter((c) => c.kind in CHEERS) : [];
}

export async function markCheersSeen(app: App): Promise<void> {
  const sb = await app.account.db();
  await sb.rpc("mark_cheers_seen");
}

/** "Sam: 👏 Keep going!" */
export function describeCheer(cheer: Pick<Cheer, "kind" | "from">): string {
  const c = CHEERS[cheer.kind];
  return `${cheer.from}: ${c.emoji} ${c.text}`;
}
