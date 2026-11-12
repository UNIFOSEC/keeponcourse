/**
 * Daily Coach allowances.
 *
 * Signed-in users: the browser sends the user's Supabase access token. The
 * Worker calls a database function with that token, so Supabase verifies it
 * (an invalid or expired token is rejected) and the count is exact and
 * per user. No service key is involved.
 *
 * Anonymous visitors: counted per visitor in Workers KV, keyed by a one-way
 * hash of their IP address and the day, so no IP is ever stored.
 */

import type { AnonMeta, TokenCounts } from "./stats";

export interface UsageEnv {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  USER_DAILY_LIMIT?: string;
  ANON_DAILY_LIMIT?: string;
  COACH_USAGE?: KVNamespace;
}

export interface Usage {
  signedIn: boolean;
  limit: number;
  used: number;
  /** Key for the per-minute rate limiter */
  who: string;
}

export class UsageError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export const limitOf = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const today = () => new Date().toISOString().slice(0, 10); // UTC

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/.exec(header.trim());
  return match ? match[1] : null;
}

/** Calls a usage function in the database as the signed-in user. */
async function callUserFunction(env: UsageEnv, token: string, name: "use_coach_message" | "coach_messages_used"): Promise<{ count: number; userKey: string }> {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new UsageError("Signed-in Coach isn't configured.", 503, "config");
  }
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (response.status === 401 || response.status === 403) {
    throw new UsageError("Your sign-in has expired. Please sign in again.", 401, "auth");
  }
  if (!response.ok) {
    console.error("Usage function failed:", response.status, await response.text().catch(() => ""));
    throw new UsageError("Coach is temporarily unavailable. Try again shortly.", 503, "unavailable");
  }
  const count = Number(await response.json());
  // The token was accepted, so its subject is the verified user id
  const userKey = `user:${(await sha256(token.split(".")[1] ?? token)).slice(0, 32)}`;
  return { count: Number.isFinite(count) ? count : 0, userKey };
}

async function anonKey(request: Request): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  return `anon:${today()}:${await sha256(`${today()}|${ip}`)}`;
}

/** Today's usage without counting anything (for showing "N left today"). */
export async function peekUsage(request: Request, env: UsageEnv): Promise<Usage> {
  const token = bearerToken(request);
  if (token) {
    const { count, userKey } = await callUserFunction(env, token, "coach_messages_used");
    return { signedIn: true, limit: limitOf(env.USER_DAILY_LIMIT, 60), used: count, who: userKey };
  }
  const key = await anonKey(request);
  const { used } = await readAnon(env, key);
  return { signedIn: false, limit: limitOf(env.ANON_DAILY_LIMIT, 15), used, who: key };
}

const ANON_TTL = 2 * 24 * 60 * 60;

/** One visitor's count today. The count is also kept as metadata, so the daily totals (stats.ts) need only a list. */
async function readAnon(env: UsageEnv, key: string): Promise<{ used: number; meta: AnonMeta }> {
  const entry = await env.COACH_USAGE?.getWithMetadata<AnonMeta>(key);
  return { used: Number(entry?.value ?? 0) || 0, meta: entry?.metadata ?? {} };
}

/**
 * Counts one Coach message, or throws a 429 UsageError when today's
 * allowance is used up.
 */
export async function useMessage(request: Request, env: UsageEnv): Promise<Usage> {
  const token = bearerToken(request);
  if (token) {
    const limit = limitOf(env.USER_DAILY_LIMIT, 60);
    const { count, userKey } = await callUserFunction(env, token, "use_coach_message");
    if (count > limit) {
      throw new UsageError(`You've used today's ${limit} Coach messages. They reset at midnight UTC.`, 429, "quota");
    }
    return { signedIn: true, limit, used: count, who: userKey };
  }

  const limit = limitOf(env.ANON_DAILY_LIMIT, 15);
  const key = await anonKey(request);
  const { used, meta } = await readAnon(env, key);
  if (used >= limit) {
    // Remember (once) that this visitor reached the limit, for the statistics
    if (!meta.hit) await env.COACH_USAGE?.put(key, String(used), { expirationTtl: ANON_TTL, metadata: { n: used, hit: 1 } });
    throw new UsageError(`You've used today's ${limit} free Coach messages. Sign in for a bigger daily allowance.`, 429, "quota_anon");
  }
  // KV is eventually consistent, so this can overshoot slightly under bursts; the
  // per-minute rate limiter bounds that
  await env.COACH_USAGE?.put(key, String(used + 1), { expirationTtl: ANON_TTL, metadata: { n: used + 1 } });
  return { signedIn: false, limit, used: used + 1, who: key };
}

/**
 * Adds the tokens of one Claude reply to the signed-in user's daily totals
 * (for the owner's cost statistics). Best effort: a failure is only logged.
 */
export async function recordTokens(env: UsageEnv, token: string, tokens: TokenCounts): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return;
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/record_coach_tokens`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(tokens),
    });
    if (!response.ok) console.error("record_coach_tokens failed:", response.status, await response.text().catch(() => ""));
  } catch (error) {
    console.error("record_coach_tokens failed:", error);
  }
}
