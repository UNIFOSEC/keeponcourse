import type { App } from "./app";
import { isInstalled } from "./install";
import { studyStreak } from "./plan";

/**
 * Feedback from signed-in users to the site owner, through database
 * functions (supabase/schema.sql): users send and read their own; the owner
 * (a stats viewer) reads all of it in the Stats page and replies.
 */

export type FeedbackKind = "idea" | "problem" | "praise";
export type FeedbackStatus = "new" | "planned" | "done" | "closed";

export interface FeedbackItem {
  id: number;
  kind: FeedbackKind;
  message: string;
  status: FeedbackStatus;
  reply: string | null;
  replied_at: string | null;
  reply_seen: boolean;
  created_at: string;
}

export interface AdminFeedbackItem extends Omit<FeedbackItem, "reply_seen"> {
  context: Record<string, unknown> | null;
  author: string;
  author_since: string | null;
}

export const FEEDBACK_MAX = 2000;
export const KINDS: Record<FeedbackKind, { emoji: string; label: string }> = {
  idea: { emoji: "💡", label: "Idea" },
  problem: { emoji: "🐞", label: "Problem" },
  praise: { emoji: "💜", label: "Something I like" },
};
export const STATUSES: Record<FeedbackStatus, string> = { new: "New", planned: "Planned", done: "Done", closed: "Closed" };

/** App details sent along with feedback (when the user leaves "Include app details" on). Nothing personal. */
export function feedbackContext(app: App): Record<string, string | number | boolean> {
  const plans = app.courses.filter((c) => c.plan).map((c) => c.plan!);
  const phone = window.matchMedia?.("(max-width: 860px)").matches ?? false;
  return {
    page: location.hash || "#/",
    version: typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev",
    device: phone ? "phone" : "computer",
    installed: isInstalled(),
    courses: app.courses.length,
    with_plan: plans.length,
    streak_weeks: studyStreak(plans),
  };
}

/** A readable one-line summary of the context, for the dialog and the inbox. */
export function describeContext(context: Record<string, unknown> | null): string {
  if (!context) return "No app details";
  const parts: string[] = [];
  if (context.page) parts.push(`page ${context.page}`);
  if (context.device) parts.push(`${context.device}${context.installed ? " (installed app)" : ""}`);
  if (typeof context.courses === "number") parts.push(`${context.courses} course${context.courses === 1 ? "" : "s"}, ${context.with_plan ?? 0} with a plan`);
  if (typeof context.streak_weeks === "number" && context.streak_weeks > 0) parts.push(`${context.streak_weeks}-week streak`);
  if (context.version) parts.push(`version ${context.version}`);
  return parts.join(" · ");
}

function readable(error: { message?: string } | null, fallback: string): Error {
  const text = error?.message ?? "";
  // Messages raised on purpose by the database are written for people; anything else gets the fallback
  return new Error(/Please try again tomorrow|Not allowed/.test(text) ? text.replace(/^.*?(You've|Not allowed)/, "$1") : fallback);
}

export async function submitFeedback(app: App, kind: FeedbackKind, message: string, context: Record<string, unknown> | null): Promise<void> {
  const sb = await app.account.db();
  const { error } = await sb.rpc("submit_feedback", { kind, message, context });
  if (error) throw readable(error, "Couldn't send your feedback. Please try again.");
}

export async function myFeedback(app: App): Promise<FeedbackItem[]> {
  const sb = await app.account.db();
  const { data, error } = await sb.rpc("my_feedback");
  if (error) throw readable(error, "Couldn't load your feedback.");
  return Array.isArray(data) ? (data as FeedbackItem[]) : [];
}

export async function markRepliesSeen(app: App): Promise<void> {
  const sb = await app.account.db();
  await sb.rpc("mark_feedback_replies_seen");
}

export async function adminFeedback(app: App, status: FeedbackStatus | null): Promise<AdminFeedbackItem[]> {
  const sb = await app.account.db();
  const { data, error } = await sb.rpc("admin_feedback", { filter_status: status });
  if (error) throw readable(error, "Couldn't load feedback.");
  return Array.isArray(data) ? (data as AdminFeedbackItem[]) : [];
}

export async function updateFeedback(app: App, id: number, status: FeedbackStatus, reply: string | null): Promise<void> {
  const sb = await app.account.db();
  const { error } = await sb.rpc("admin_update_feedback", { feedback_id: id, new_status: status, new_reply: reply });
  if (error) throw readable(error, "Couldn't save. Please try again.");
}
