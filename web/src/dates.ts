import type { Course } from "./types";

const DAY_MS = 86_400_000;

/** Local calendar date as YYYY-MM-DD (not UTC, so "today" matches the user's clock). */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toISODate(new Date(y, m - 1, d + days));
}

/** Whole days from `from` to `iso` (negative when `iso` is in the past). */
export function daysUntil(iso: string, from = todayISO()): number {
  const [y, m, d] = iso.split("-").map(Number);
  const [fy, fm, fd] = from.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(fy, fm - 1, fd)) / DAY_MS);
}

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return dateFormat.format(new Date(y, m - 1, d));
}

export function formatLongToday(): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date());
}

export type DueTone = "overdue" | "soon" | "normal" | "done";

/** Human wording for a course's deadline: "Due in 5 days", "3 days overdue", ... */
export function dueInfo(course: Course): { text: string; tone: DueTone } {
  if (course.status === "Completed") return { text: "Completed", tone: "done" };
  const days = daysUntil(course.target_date);
  const plural = (n: number) => (n === 1 ? "day" : "days");
  if (days < 0) return { text: `${-days} ${plural(-days)} overdue`, tone: "overdue" };
  if (days === 0) return { text: "Due today", tone: "soon" };
  if (days === 1) return { text: "Due tomorrow", tone: "soon" };
  if (days <= 7) return { text: `Due in ${days} days`, tone: "soon" };
  if (days <= 60) return { text: `Due in ${days} days`, tone: "normal" };
  return { text: `Due ${formatDate(course.target_date)}`, tone: "normal" };
}

export function isOverdue(course: Course): boolean {
  return course.status !== "Completed" && daysUntil(course.target_date) < 0;
}

/** Same timestamp format the API uses: "YYYY-MM-DD HH:MM:SS" in UTC. */
export function timestamp(date = new Date()): string {
  return date.toISOString().replace("T", " ").substring(0, 19);
}

export function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** "19:00" → "7:00 PM" (or the locale's own format). */
export function formatTime(hhmm: string): string {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hours, minutes));
}
