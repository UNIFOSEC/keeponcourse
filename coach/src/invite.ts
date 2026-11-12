/**
 * Study partner invite emails. POST /partners/invite sends one invite link,
 * for an invite the signed-in user created, to an address they typed in.
 *
 * Because anyone with an account could type in any address, this is kept
 * hard to misuse:
 * - the email is a fixed template; the only text the user controls is their
 *   name, which must look like a name (no links or web addresses);
 * - at most 5 invite emails a day per account;
 * - the address is used once and not stored anywhere;
 * - the reply-to is the user's own (verified) address only if they ask.
 */
import { escapeHtml, rpc, sha256, type DigestEnv } from "./digest";
import { bearerToken } from "./usage";

export const INVITES_PER_DAY = 5;
const TOKEN = /^[0-9a-f]{64}$/;
// Practical address check: one @, no spaces or separators, a dot in the domain
const EMAIL = /^[^\s@,;<>"()]{1,64}@[^\s@,;<>"()]+\.[^\s@,;<>"()]{2,}$/;

/** A name as people write it ("Alex", "Ana María", "J. O'Neil"), not a link or a sentence. */
export function isPlainName(name: string): boolean {
  const n = name.trim();
  return /^\p{L}[\p{L}\p{M}' .-]{0,39}$/u.test(n) && !/\.\p{L}{2,}/u.test(n) && !/(^|\s)www/iu.test(n);
}

export const isEmail = (value: string) => value.length <= 254 && EMAIL.test(value);

export interface InviteEmail {
  subject: string;
  html: string;
  text: string;
}

export function buildInviteEmail(name: string, link: string, canReply: boolean): InviteEmail {
  const n = escapeHtml(name);
  const subject = `${name} invited you to follow their study progress`;
  const muted = "color:#5a6b85;";
  const footer = `You're getting this one email because ${name} entered your address on KeepOnCourse. We don't keep your address and won't email you again.${canReply ? ` Reply to this email to reach ${name}.` : ""} If you don't know ${name}, you can ignore it.`;
  const text = [
    `${name} wants you in their corner`,
    "",
    `${name} is studying with KeepOnCourse and invited you to follow along. You'll see their study sessions each week, their streak, and whether they're on track, and you can send a cheer with one tap.`,
    "",
    `See ${name}'s progress: ${link}`,
    "",
    "No account or app needed. The link is private to you, so please don't share it.",
    "",
    "--",
    footer,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light only" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f8fc;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">See how ${n} is doing and cheer them on. No account needed.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fc;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e3e9f2;border-radius:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f1a2e;">
<tr><td style="padding:28px 32px 0;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
  <td style="width:32px;height:32px;border-radius:8px;background:#7c3aed;color:#ffffff;font-size:16px;font-weight:700;text-align:center;line-height:32px;">&#10148;</td>
  <td style="padding-left:10px;font-size:17px;font-weight:800;">KeepOnCourse</td></tr></table></td></tr>
<tr><td style="padding:22px 32px 0;">
  <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:800;">${n} wants you in their corner</h1>
  <p style="margin:0;font-size:15px;line-height:1.6;${muted}">${n} is studying with KeepOnCourse and invited you to follow along. You'll see their study sessions each week, their streak, and whether they're on track, and you can send a cheer with one tap.</p>
</td></tr>
<tr><td style="padding:24px 32px 0;"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#7c3aed;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">See ${n}'s progress</a></td></tr>
<tr><td style="padding:14px 32px 0;"><p style="margin:0;font-size:13px;line-height:1.6;${muted}">No account or app needed. The link is private to you, so please don't share it.</p></td></tr>
<tr><td style="padding:24px 32px 28px;"><hr style="border:0;border-top:1px solid #e3e9f2;margin:0 0 14px;" />
  <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">${escapeHtml(footer)}</p>
</td></tr>
</table></td></tr></table>
</body></html>`;
  return { subject, html, text };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

interface Invite {
  id: number;
  label: string;
  display_name: string;
  token: string;
}

export async function handlePartnerInvite(request: Request, env: DigestEnv, cors: Record<string, string>): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return json({ error: "Sign in to send invites.", code: "auth" }, 401, cors);
  if (!env.RESEND_API_KEY || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    return json({ error: "Email invites aren't set up yet. Copy the link instead.", code: "config" }, 503, cors);
  }

  let body: { invite_id?: unknown; email?: unknown; reply_to?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Send JSON.", code: "bad_request" }, 400, cors);
  }
  const inviteId = Number(body?.invite_id);
  const to = typeof body?.email === "string" ? body.email.trim() : "";
  if (!Number.isInteger(inviteId) || inviteId <= 0) return json({ error: "Unknown invite.", code: "bad_request" }, 400, cors);
  if (!isEmail(to)) return json({ error: "That email address doesn't look right.", code: "bad_request" }, 400, cors);

  // Who is asking: the sign-in service checks the token and gives the verified address
  const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
  if (userResponse.status === 401 || userResponse.status === 403) return json({ error: "Your sign-in has expired. Please sign in again.", code: "auth" }, 401, cors);
  if (!userResponse.ok) return json({ error: "Couldn't check your sign-in. Try again shortly.", code: "unavailable" }, 503, cors);
  const user = (await userResponse.json()) as { id?: string; email?: string };
  if (!user.id) return json({ error: "Please sign in again.", code: "auth" }, 401, cors);

  // The invite must be one of the caller's own
  const invitesResponse = await rpc(env, "my_partners", {}, token);
  if (!invitesResponse.ok) return json({ error: "Couldn't load your invite. Try again shortly.", code: "unavailable" }, 503, cors);
  const invites = (await invitesResponse.json()) as Invite[] | null;
  const invite = Array.isArray(invites) ? invites.find((i) => i.id === inviteId) : undefined;
  if (!invite || !TOKEN.test(invite.token)) return json({ error: "That invite no longer exists.", code: "not_found" }, 404, cors);
  if (!isPlainName(invite.display_name)) {
    return json({ error: "To send an email, your name must be just a name (letters, spaces, hyphens). Copy the link instead, or invite them again with your first name.", code: "bad_request" }, 400, cors);
  }

  // At most 5 a day per account
  const day = new Date().toISOString().slice(0, 10);
  const limitKey = `partner-invite:${day}:${await sha256(user.id)}`;
  const count = Number((await env.COACH_USAGE?.get(limitKey)) ?? 0) || 0;
  if (count >= INVITES_PER_DAY) return json({ error: `You've sent ${INVITES_PER_DAY} invite emails today. Copy the link instead, or try again tomorrow.`, code: "quota" }, 429, cors);
  await env.COACH_USAGE?.put(limitKey, String(count + 1), { expirationTtl: 2 * 24 * 60 * 60 });

  const replyTo = body.reply_to === true && typeof user.email === "string" && isEmail(user.email) ? user.email : null;
  const link = `${(env.APP_URL || "https://keeponcourse.com").replace(/\/+$/, "")}/#/p/${invite.token}`;
  const email = buildInviteEmail(invite.display_name.trim(), link, replyTo !== null);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      // A double click sends once
      "Idempotency-Key": `partner-invite-${inviteId}-${(await sha256(to.toLowerCase())).slice(0, 24)}-${day}-${count + 1}`,
    },
    body: JSON.stringify({
      from: env.DIGEST_FROM || "KeepOnCourse <hello@keeponcourse.com>",
      to: [to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!response.ok) {
    console.error("Invite email failed:", response.status, (await response.text().catch(() => "")).slice(0, 300));
    return json({ error: "Couldn't send the email. Copy the link instead, or try again shortly.", code: "unavailable" }, 502, cors);
  }
  return json({ ok: true }, 200, cors);
}
