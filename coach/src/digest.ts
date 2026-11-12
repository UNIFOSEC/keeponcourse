/**
 * Weekly check-in email (opt-in): every Monday morning in the user's time
 * zone, this week's study sessions, sessions to catch up on, and when each
 * plan finishes against its target.
 *
 * An hourly cron trigger asks the database who's due (weekly_digest_due,
 * authorised by a job key whose hash is stored in the database), sends the
 * emails through Resend in one batch, and marks those users as done for the
 * week. Users with nothing scheduled and nothing missed get no email.
 *
 * GET/POST /unsubscribe/<token> is the one-click unsubscribe link (GET shows
 * a page with a button, so mail scanners that open links don't unsubscribe
 * anyone; POST, including RFC 8058 one-click from the mail app, does it).
 * POST /digest/test sends a signed-in user a sample of their own email.
 */
import { bearerToken, type UsageEnv } from "./usage";

export interface DigestEnv extends UsageEnv {
  RESEND_API_KEY?: string;
  DIGEST_JOB_KEY?: string;
  /** e.g. "KeepOnCourse <hello@keeponcourse.com>" */
  DIGEST_FROM?: string;
  /** The web app, for links in the email */
  APP_URL?: string;
  /** This Worker's public URL, for unsubscribe links */
  PUBLIC_URL?: string;
}

interface DigestCourse {
  name: string;
  target_date: string;
  status: string;
  plan: unknown;
}

export interface DigestUser {
  user_id?: string;
  email: string;
  timezone: string;
  unsubscribe_token: string | null;
  courses: DigestCourse[];
}

export interface DigestEmail {
  subject: string;
  html: string;
  text: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TOKEN = /^[0-9a-f]{64}$/;
const DAY_MS = 86_400_000;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function safeTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

const isoToUtc = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const addDays = (iso: string, n: number) => new Date(isoToUtc(iso) + n * DAY_MS).toISOString().slice(0, 10);
const dayLabel = (iso: string) => new Date(isoToUtc(iso)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const longDate = (iso: string) => new Date(isoToUtc(iso)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

interface Session {
  date: string;
  module: number;
  minutes: number;
  status?: string;
}
interface CourseWeek {
  name: string;
  time: string;
  week: { date: string; title: string; minutes: number }[];
  missed: number;
  finish: string | null;
  target: string;
}

/** This week's view of one course's plan. The plan is user data, so it's read defensively. */
function courseWeek(course: DigestCourse, today: string, monday: string, sunday: string): CourseWeek | null {
  const plan = (course.plan ?? {}) as { modules?: unknown; sessions?: unknown; start_time?: unknown };
  const modules = Array.isArray(plan.modules) ? (plan.modules as { title?: unknown; done?: unknown }[]) : [];
  const sessions = (Array.isArray(plan.sessions) ? (plan.sessions as Session[]) : []).filter(
    (s) => s && typeof s.date === "string" && DATE.test(s.date) && Number.isInteger(s.module) && modules[s.module],
  );
  const open = (s: Session) => !s.status && modules[s.module]?.done !== true;
  const week = sessions
    .filter((s) => open(s) && s.date >= today && s.date >= monday && s.date <= sunday)
    .map((s) => ({ date: s.date, title: String(modules[s.module].title ?? "Study session").slice(0, 80), minutes: Math.min(240, Math.max(15, Number(s.minutes) || 60)) }));
  const missed = sessions.filter((s) => open(s) && s.date < today).length;
  if (!week.length && !missed) return null;
  const remaining = sessions.filter((s) => s.status !== "skipped").map((s) => s.date);
  return {
    name: String(course.name ?? "Course").slice(0, 100),
    time: typeof plan.start_time === "string" && TIME.test(plan.start_time) ? plan.start_time : "19:00",
    week: week.sort((a, b) => a.date.localeCompare(b.date)),
    missed,
    finish: remaining.length ? remaining.sort().at(-1)! : null,
    target: typeof course.target_date === "string" && DATE.test(course.target_date) ? course.target_date : "",
  };
}

/** Every valid session across the user's plans (for last week's tally and the streak). */
function allSessions(courses: DigestCourse[]): Session[] {
  const out: Session[] = [];
  for (const course of courses) {
    const plan = (course.plan ?? {}) as { sessions?: unknown };
    if (!Array.isArray(plan.sessions)) continue;
    for (const s of plan.sessions as Session[]) if (s && typeof s.date === "string" && DATE.test(s.date)) out.push(s);
  }
  return out;
}

/** "Last week: 3 of 4 sessions done · 5-week streak", or null when there's nothing to report. */
export function lastWeekLine(courses: DigestCourse[], today: string, monday: string): string | null {
  const sessions = allSessions(courses);
  const lastMonday = addDays(monday, -7);
  const lastWeek = sessions.filter((s) => s.date >= lastMonday && s.date < monday && s.status !== "skipped");
  const done = lastWeek.filter((s) => s.status === "done").length;

  // Weeks in a row with a done session, back from last week (this week counts once it has one)
  const weeks = new Set(sessions.filter((s) => s.status === "done" && s.date <= today).map((s) => addDays(s.date, -((new Date(isoToUtc(s.date)).getUTCDay() + 6) % 7))));
  let streak = weeks.has(monday) ? 1 : 0;
  for (let week = lastMonday; weeks.has(week); week = addDays(week, -7)) streak++;

  const parts: string[] = [];
  if (lastWeek.length) parts.push(`Last week: ${done} of ${lastWeek.length} session${lastWeek.length === 1 ? "" : "s"} done`);
  if (streak >= 2) parts.push(`${streak}-week streak`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The email for one user, or null when there's nothing to say (no sessions
 * this week and nothing missed). `sample` always returns an email.
 */
export function buildDigest(user: DigestUser, { now = new Date(), appUrl = "https://keeponcourse.com", unsubscribeUrl = null as string | null, sample = false } = {}): DigestEmail | null {
  const timeZone = safeTimeZone(user.timezone || "UTC");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  const weekday = (new Date(isoToUtc(today)).getUTCDay() + 6) % 7; // 0 = Monday
  const monday = addDays(today, -weekday);
  const sunday = addDays(monday, 6);

  const courses = (Array.isArray(user.courses) ? user.courses : []).map((c) => courseWeek(c, today, monday, sunday)).filter((c): c is CourseWeek => c !== null);
  if (!courses.length && !sample) return null;

  const recap = lastWeekLine(Array.isArray(user.courses) ? user.courses : [], today, monday);
  const sessions = courses.reduce((n, c) => n + c.week.length, 0);
  const missed = courses.reduce((n, c) => n + c.missed, 0);
  const subject = `${sample ? "[Sample] " : ""}Your study week: ${sessions} session${sessions === 1 ? "" : "s"}${missed ? ` · ${missed} to catch up` : ""}`;
  const home = `${appUrl.replace(/\/+$/, "")}/#/`;

  // ------------------------------------------------------------------ text
  const lines: string[] = [`Your study week (${dayLabel(monday)} – ${dayLabel(sunday)})`, ...(recap ? [recap] : []), ""];
  if (!courses.length) lines.push("No study sessions this week, and nothing to catch up on.", "");
  for (const c of courses) {
    lines.push(c.name);
    if (c.missed) lines.push(`  ${c.missed} missed session${c.missed === 1 ? "" : "s"}: catch up in one click at ${home}`);
    for (const s of c.week) lines.push(`  ${dayLabel(s.date)}, ${timeLabel(c.time)}: ${s.title} (${s.minutes} min)`);
    if (c.finish && c.target) lines.push(`  ${finishLine(c.finish, c.target)}`);
    lines.push("");
  }
  lines.push(`Open KeepOnCourse: ${home}`, "");
  lines.push("You're getting this because you turned on the weekly check-in in your KeepOnCourse account.");
  if (unsubscribeUrl) lines.push(`Unsubscribe: ${unsubscribeUrl}`);
  const text = lines.join("\n");

  // ------------------------------------------------------------------ html
  const muted = "color:#5a6b85;";
  const courseBlocks = courses
    .map((c) => {
      const rows = c.week
        .map(
          (s) =>
            `<tr><td style="padding:6px 0;font-size:14px;color:#0f1a2e;white-space:nowrap;vertical-align:top;">${escapeHtml(dayLabel(s.date))}</td><td style="padding:6px 0 6px 12px;font-size:14px;${muted}vertical-align:top;">${escapeHtml(timeLabel(c.time))} · <strong style="color:#0f1a2e;">${escapeHtml(s.title)}</strong> (${s.minutes} min)</td></tr>`,
        )
        .join("");
      return `<tr><td style="padding:20px 32px 0;">
  <p style="margin:0 0 6px;font-size:16px;font-weight:800;color:#0f1a2e;">${escapeHtml(c.name)}</p>
  ${c.missed ? `<p style="margin:0 0 8px;padding:8px 12px;border-radius:8px;background:#fef3c7;color:#a14b08;font-size:13.5px;font-weight:600;">${c.missed} missed session${c.missed === 1 ? "" : "s"}. <a href="${escapeHtml(home)}" style="color:#a14b08;">Catch up in one click</a></p>` : ""}
  ${rows ? `<table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>` : `<p style="margin:0;font-size:14px;${muted}">No sessions left this week.</p>`}
  ${c.finish && c.target ? `<p style="margin:8px 0 0;font-size:13px;${muted}">${escapeHtml(finishLine(c.finish, c.target))}</p>` : ""}
</td></tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light only" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f8fc;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(`${sessions} study session${sessions === 1 ? "" : "s"} this week${missed ? `, ${missed} to catch up` : ""}.`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fc;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e3e9f2;border-radius:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f1a2e;">
<tr><td style="padding:28px 32px 0;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
  <td style="width:32px;height:32px;border-radius:8px;background:#7c3aed;color:#ffffff;font-size:16px;font-weight:700;text-align:center;line-height:32px;">&#10148;</td>
  <td style="padding-left:10px;font-size:17px;font-weight:800;">KeepOnCourse</td></tr></table></td></tr>
<tr><td style="padding:18px 32px 0;">
  <h1 style="margin:0 0 4px;font-size:21px;line-height:1.3;font-weight:800;">Your study week</h1>
  <p style="margin:0;font-size:14px;${muted}">${escapeHtml(dayLabel(monday))} – ${escapeHtml(dayLabel(sunday))}</p>
  ${recap ? `<p style="margin:10px 0 0;display:inline-block;padding:6px 12px;border-radius:999px;background:#dcfce7;color:#157a3c;font-size:13px;font-weight:600;">${escapeHtml(recap)}</p>` : ""}
</td></tr>
${courses.length ? courseBlocks : `<tr><td style="padding:20px 32px 0;"><p style="margin:0;font-size:14px;${muted}">No study sessions this week, and nothing to catch up on. Plan your next course any time.</p></td></tr>`}
<tr><td style="padding:24px 32px 0;"><a href="${escapeHtml(home)}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#7c3aed;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Open KeepOnCourse</a></td></tr>
<tr><td style="padding:24px 32px 28px;"><hr style="border:0;border-top:1px solid #e3e9f2;margin:0 0 14px;" />
  <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">You're getting this because you turned on the weekly check-in in your KeepOnCourse account.${unsubscribeUrl ? ` <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6d28d9;">Unsubscribe</a>` : ""}</p>
</td></tr>
</table></td></tr></table>
</body></html>`;

  return { subject, html, text };
}

function finishLine(finish: string, target: string): string {
  const days = Math.round((isoToUtc(target) - isoToUtc(finish)) / DAY_MS);
  if (days >= 0) return `On track: finishing ${longDate(finish)}${days > 0 ? `, ${days} day${days === 1 ? "" : "s"} before your target` : ", on your target date"}.`;
  return `Finishing ${longDate(finish)}, ${-days} day${days === -1 ? "" : "s"} after your target (${longDate(target)}).`;
}

const unsubscribeUrlFor = (env: DigestEnv, token: string | null) =>
  token && TOKEN.test(token) && env.PUBLIC_URL ? `${env.PUBLIC_URL.replace(/\/+$/, "")}/unsubscribe/${token}` : null;

interface Outgoing extends DigestEmail {
  to: string;
  unsubscribeUrl: string | null;
}

/** Sends up to 100 emails in one Resend batch. Throws on failure. */
async function sendBatch(env: DigestEnv, emails: Outgoing[], idempotencyKey: string): Promise<void> {
  const response = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(
      emails.map((e) => ({
        from: env.DIGEST_FROM || "KeepOnCourse <hello@keeponcourse.com>",
        to: [e.to],
        subject: e.subject,
        html: e.html,
        text: e.text,
        ...(e.unsubscribeUrl ? { headers: { "List-Unsubscribe": `<${e.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
      })),
    ),
  });
  if (!response.ok) throw new Error(`Resend ${response.status}: ${(await response.text().catch(() => "")).slice(0, 300)}`);
}

async function rpc(env: DigestEnv, name: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY!,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cron job: sends this hour's due weekly emails. */
export async function runWeeklyDigest(env: DigestEnv, now = new Date()): Promise<{ due: number; sent: number; skipped: number }> {
  if (!env.RESEND_API_KEY || !env.DIGEST_JOB_KEY || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    return { due: 0, sent: 0, skipped: 0 }; // not set up yet
  }
  const response = await rpc(env, "weekly_digest_due", { job_key: env.DIGEST_JOB_KEY });
  if (!response.ok) {
    console.error("weekly_digest_due failed:", response.status, await response.text().catch(() => ""));
    return { due: 0, sent: 0, skipped: 0 };
  }
  const users = (await response.json()) as DigestUser[];
  if (!Array.isArray(users) || !users.length) return { due: 0, sent: 0, skipped: 0 };

  const outgoing: Outgoing[] = [];
  const handled: string[] = [];
  const empty: string[] = [];
  for (const user of users) {
    const unsubscribeUrl = unsubscribeUrlFor(env, user.unsubscribe_token);
    const email = typeof user.email === "string" ? buildDigest(user, { now, appUrl: env.APP_URL, unsubscribeUrl }) : null;
    if (email) {
      outgoing.push({ ...email, to: user.email, unsubscribeUrl });
      if (user.user_id) handled.push(user.user_id);
    } else if (user.user_id) {
      empty.push(user.user_id);
    }
  }

  let sent = 0;
  if (outgoing.length) {
    try {
      const key = `weekly-${now.toISOString().slice(0, 10)}-${(await sha256(handled.join(","))).slice(0, 32)}`;
      await sendBatch(env, outgoing, key);
      sent = outgoing.length;
    } catch (error) {
      // Not marked as sent, so the next hourly run tries again
      console.error("Weekly email batch failed:", error);
      handled.length = 0;
    }
  }
  const done = [...handled, ...empty];
  if (done.length) {
    const marked = await rpc(env, "weekly_digest_sent", { job_key: env.DIGEST_JOB_KEY, user_ids: done });
    if (!marked.ok) console.error("weekly_digest_sent failed:", marked.status, await marked.text().catch(() => ""));
  }
  return { due: users.length, sent, skipped: empty.length };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

/** POST /digest/test: emails the signed-in caller a sample of their weekly check-in (3 a day at most). */
export async function handleDigestTest(request: Request, env: DigestEnv, cors: Record<string, string>): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return json({ error: "Sign in to get a sample email.", code: "auth" }, 401, cors);
  if (!env.RESEND_API_KEY || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    return json({ error: "Weekly emails aren't set up yet.", code: "config" }, 503, cors);
  }
  const response = await rpc(env, "my_weekly_digest", {}, token);
  if (response.status === 401 || response.status === 403) return json({ error: "Your sign-in has expired. Please sign in again.", code: "auth" }, 401, cors);
  if (!response.ok) {
    console.error("my_weekly_digest failed:", response.status, await response.text().catch(() => ""));
    return json({ error: "Couldn't prepare the email. Try again shortly.", code: "unavailable" }, 503, cors);
  }
  const user = (await response.json()) as DigestUser | null;
  if (!user?.email) return json({ error: "Your account has no email address.", code: "bad_request" }, 400, cors);

  // At most 3 samples a day per account
  const day = new Date().toISOString().slice(0, 10);
  const limitKey = `digest-test:${day}:${await sha256(user.email.toLowerCase())}`;
  const count = Number((await env.COACH_USAGE?.get(limitKey)) ?? 0) || 0;
  if (count >= 3) return json({ error: "You've sent 3 samples today. Try again tomorrow.", code: "quota" }, 429, cors);
  await env.COACH_USAGE?.put(limitKey, String(count + 1), { expirationTtl: 2 * 24 * 60 * 60 });

  const unsubscribeUrl = unsubscribeUrlFor(env, user.unsubscribe_token);
  const email = buildDigest(user, { appUrl: env.APP_URL, unsubscribeUrl, sample: true })!;
  try {
    await sendBatch(env, [{ ...email, to: user.email, unsubscribeUrl }], `sample-${limitKey}-${count + 1}`);
  } catch (error) {
    console.error("Sample email failed:", error);
    return json({ error: "Couldn't send the email. Try again shortly.", code: "unavailable" }, 502, cors);
  }
  return json({ ok: true, to: user.email }, 200, cors);
}

export function matchUnsubscribePath(pathname: string): string | null {
  return /^\/unsubscribe\/([0-9a-f]{64})$/.exec(pathname)?.[1] ?? null;
}

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>${escapeHtml(title)} · KeepOnCourse</title></head>
<body style="margin:0;background:#f6f8fc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f1a2e;">
<main style="max-width:440px;margin:64px auto;padding:32px;background:#fff;border:1px solid #e3e9f2;border-radius:16px;">
<p style="margin:0 0 16px;font-weight:800;">KeepOnCourse</p><h1 style="margin:0 0 12px;font-size:22px;">${escapeHtml(title)}</h1>${body}
</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/** GET shows a confirm button (link scanners don't unsubscribe anyone); POST unsubscribes. */
export async function handleUnsubscribe(request: Request, env: DigestEnv, token: string): Promise<Response> {
  const muted = "color:#5a6b85;font-size:15px;line-height:1.6;";
  const settings = `${(env.APP_URL || "https://keeponcourse.com").replace(/\/+$/, "")}/#/`;
  if (request.method === "GET" || request.method === "HEAD") {
    return page(
      "Unsubscribe from the weekly check-in?",
      `<p style="${muted}">You'll stop getting the Monday email with your study week. Your account and plans stay as they are.</p>
<form method="post" style="margin:20px 0 0;"><button type="submit" style="padding:12px 20px;border:0;border-radius:10px;background:#7c3aed;color:#fff;font-size:15px;font-weight:700;cursor:pointer;">Unsubscribe</button></form>`,
    );
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return page("Something went wrong", `<p style="${muted}">Please try again later.</p>`, 503);
  const response = await rpc(env, "unsubscribe_weekly", { token });
  if (!response.ok) {
    console.error("unsubscribe_weekly failed:", response.status, await response.text().catch(() => ""));
    return page("Something went wrong", `<p style="${muted}">We couldn't unsubscribe you just now. Please try again, or turn the weekly check-in off in your account.</p>`, 503);
  }
  return page(
    "You're unsubscribed",
    `<p style="${muted}">You won't get the weekly check-in email anymore. You can turn it back on any time in your <a href="${escapeHtml(settings)}" style="color:#6d28d9;">KeepOnCourse account</a>.</p>`,
  );
}
