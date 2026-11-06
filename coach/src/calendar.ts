/**
 * Live calendar subscription: GET /calendar/<token>.ics
 *
 * Calendar apps (Google, Outlook, Apple) fetch this URL every few hours, so
 * new or rebuilt study plans show up without the user doing anything. The
 * token is the credential; the database function calendar_feed() returns
 * plans only for the user who owns it (see supabase/schema.sql).
 *
 * Times are sent in UTC, converted from the user's chosen local study time in
 * their time zone, because every calendar app handles UTC identically.
 */

interface FeedEnv {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
}

interface FeedRow {
  course_id: number;
  course_name: string;
  timezone: string;
  plan: {
    start_time?: string;
    session_minutes?: number;
    modules?: { title?: string; summary?: string; done?: boolean }[];
    sessions?: { date?: string; module?: number; minutes?: number }[];
  };
}

const TOKEN = /^\/calendar\/([0-9a-f]{64})\.ics$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function matchFeedPath(pathname: string): string | null {
  return TOKEN.exec(pathname)?.[1] ?? null;
}

/** Minutes the time zone is ahead of UTC at a given instant. */
function offsetMinutes(timestamp: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(timestamp));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return (Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - timestamp) / 60_000;
}

/** A wall-clock date and time in a time zone, as a UTC instant (handles DST). */
function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = offsetMinutes(guess, timeZone);
  const utc = guess - first * 60_000;
  const second = offsetMinutes(utc, timeZone);
  return new Date(second === first ? utc : guess - second * 60_000);
}

function safeTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

const icsStamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escapeText = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** Sessions from 30 days ago onward; future sessions of finished modules are left out. */
export function buildFeed(rows: FeedRow[], now = new Date()): string {
  const timeZone = safeTimeZone(rows[0]?.timezone ?? "UTC");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now); // YYYY-MM-DD
  const from = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const stamp = icsStamp(now);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//KeepOnCourse//Study plans//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:KeepOnCourse study plan",
    `X-WR-TIMEZONE:${timeZone}`,
    // Ask calendar apps to check for changes every few hours
    "REFRESH-INTERVAL;VALUE=DURATION:PT4H",
    "X-PUBLISHED-TTL:PT4H",
  ];

  for (const row of rows) {
    const plan = row.plan ?? {};
    const time = typeof plan.start_time === "string" && TIME.test(plan.start_time) ? plan.start_time : "19:00";
    const modules = Array.isArray(plan.modules) ? plan.modules : [];
    const sessions = Array.isArray(plan.sessions) ? plan.sessions.slice(0, 400) : [];
    sessions.forEach((session, index) => {
      const module = typeof session.module === "number" ? modules[session.module] : undefined;
      if (!module || typeof session.date !== "string" || !DATE.test(session.date) || session.date < from) return;
      if (module.done && session.date >= today) return;
      const minutes = Math.min(240, Math.max(15, Number(session.minutes ?? plan.session_minutes) || 60));
      const title = String(module.title ?? "Study session").slice(0, 80);
      const course = String(row.course_name ?? "Course").slice(0, 100);
      lines.push(
        "BEGIN:VEVENT",
        `UID:koc-${row.course_id}-${index}-${session.date.replace(/-/g, "")}@keeponcourse`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${icsStamp(zonedToUtc(session.date, time, timeZone))}`,
        `DURATION:PT${minutes}M`,
        `SUMMARY:${escapeText(`Study: ${course} · ${title}`)}`,
        `DESCRIPTION:${escapeText(`Module ${(session.module as number) + 1} of ${modules.length}: ${title}\n${String(module.summary ?? "").slice(0, 200)}\n\nFrom your KeepOnCourse study plan.`)}`,
        "BEGIN:VALARM",
        "TRIGGER:-PT10M",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeText(`Study session: ${title}`)}`,
        "END:VALARM",
        "END:VEVENT",
      );
    });
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export async function serveFeed(token: string, env: FeedEnv): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return new Response("Calendar isn't configured.", { status: 503 });
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/calendar_feed`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ feed_token: token }),
  });
  if (!response.ok) {
    console.error("calendar_feed failed:", response.status, await response.text().catch(() => ""));
    return new Response("Calendar is temporarily unavailable.", { status: 503, headers: { "Retry-After": "600" } });
  }
  const rows = (await response.json()) as FeedRow[];
  // An unknown token looks the same as an empty calendar, so tokens can't be probed
  return new Response(buildFeed(Array.isArray(rows) ? rows : []), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="keeponcourse.ics"',
      "Cache-Control": "private, max-age=900",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
