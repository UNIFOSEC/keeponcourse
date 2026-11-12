/**
 * Usage statistics for the site owner: GET /stats.
 *
 * Signed-in usage comes from the database function app_stats(), which only
 * answers for accounts listed in stats_viewers, so the Worker needs no
 * separate admin secret: it passes the caller's sign-in token along and the
 * database decides.
 *
 * Anonymous Coach usage lives in Workers KV as one counter per visitor per
 * day (see usage.ts), keyed by a one-way hash and kept for two days. A daily
 * cron job adds up yesterday's counters into a single totals record, which is
 * kept for 400 days; it holds only numbers, never a hash or an IP.
 */
import type { UsageEnv } from "./usage";

export interface AnonDay {
  day: string;
  messages: number;
  visitors: number;
  limit_hits: number;
}

export interface AnonMeta {
  /** Messages this visitor sent that day */
  n?: number;
  /** Set once the visitor reached the daily limit */
  hit?: 1;
}

const DAY_MS = 86_400_000;
export const utcDay = (date: Date) => date.toISOString().slice(0, 10);
const totalsKey = (day: string) => `stats:anon:${day}`;

/** Adds up one day's per-visitor counters (only today's and yesterday's still exist). */
export async function summarizeAnonDay(kv: KVNamespace, day: string): Promise<AnonDay> {
  const totals: AnonDay = { day, messages: 0, visitors: 0, limit_hits: 0 };
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const list: KVNamespaceListResult<AnonMeta> = await kv.list<AnonMeta>({ prefix: `anon:${day}:`, cursor });
    for (const key of list.keys) {
      totals.visitors++;
      totals.messages += Math.max(0, Number(key.metadata?.n) || 0);
      if (key.metadata?.hit) totals.limit_hits++;
    }
    if (list.list_complete) break;
    cursor = list.cursor;
  }
  return totals;
}

/** Cron job: store yesterday's anonymous totals before the per-visitor counters expire. */
export async function rollUpAnon(kv: KVNamespace, now = new Date()): Promise<AnonDay> {
  const day = utcDay(new Date(now.getTime() - DAY_MS));
  const totals = await summarizeAnonDay(kv, day);
  await kv.put(totalsKey(day), JSON.stringify(totals), { expirationTtl: 400 * 24 * 60 * 60 });
  return totals;
}

/** The last `days` days of anonymous totals, oldest first. Today is counted live. */
export async function anonHistory(kv: KVNamespace, days = 30, now = new Date()): Promise<AnonDay[]> {
  const list = Array.from({ length: days }, (_, i) => utcDay(new Date(now.getTime() - (days - 1 - i) * DAY_MS)));
  const today = list[list.length - 1];
  const yesterday = list[list.length - 2];
  return Promise.all(
    list.map(async (day) => {
      if (day === today) return summarizeAnonDay(kv, day);
      const stored = await kv.get<AnonDay>(totalsKey(day), "json");
      if (stored) return { ...stored, day };
      // Before the cron job has run, yesterday's counters still exist
      if (day === yesterday) return summarizeAnonDay(kv, day);
      return { day, messages: 0, visitors: 0, limit_hits: 0 };
    }),
  );
}

/** Dollars per million tokens. Cache writes are 1.25x input, cache reads 0.1x. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

export interface TokenCounts {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

/** Estimated cost in dollars, or null for a model without a known price. */
export function estimateCost(model: string, t: TokenCounts): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const perToken = (dollarsPerMillion: number) => dollarsPerMillion / 1_000_000;
  return (
    t.input_tokens * perToken(price.input) +
    t.cache_write_tokens * perToken(price.input * 1.25) +
    t.cache_read_tokens * perToken(price.input * 0.1) +
    t.output_tokens * perToken(price.output)
  );
}

export class StatsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Signed-in totals from the database, as the caller. Throws StatsError(403) for anyone but a stats viewer. */
export async function accountStats(env: UsageEnv, token: string, userLimit: number): Promise<Record<string, unknown>> {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw new StatsError("Statistics aren't configured.", 503);
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/app_stats`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_limit: userLimit }),
  });
  if (response.status === 401) throw new StatsError("Your sign-in has expired. Please sign in again.", 401);
  // The function refuses accounts that aren't stats viewers (PostgREST: 403, or 400/404 before the schema is updated)
  if (response.status === 403 || response.status === 404) throw new StatsError("Statistics are only available to the site owner.", 403);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (/not allowed|insufficient_privilege|42501/i.test(text)) throw new StatsError("Statistics are only available to the site owner.", 403);
    console.error("app_stats failed:", response.status, text);
    throw new StatsError("Statistics are temporarily unavailable.", 503);
  }
  return (await response.json()) as Record<string, unknown>;
}
