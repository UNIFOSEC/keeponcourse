import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { timestamp } from "../dates";
import { sanitizePlan } from "../plan";
import type { Course, CourseDraft, CourseInput, CoursePatch } from "../types";
import { hasErrors, validateCourse } from "../validation";
import { StoreError, type CourseStore } from "./store";

const COLUMNS = "id, name, description, target_date, status, created_at, updated_at, plan";

interface Row {
  id: number;
  name: string;
  description: string;
  target_date: string;
  status: Course["status"];
  created_at: string;
  updated_at: string | null;
  plan: unknown;
}

/** Same timestamp format as the other data sources. */
function toCourse(row: Row): Course {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    target_date: row.target_date,
    status: row.status,
    created_at: timestamp(new Date(row.created_at)),
    ...(row.updated_at ? { updated_at: timestamp(new Date(row.updated_at)) } : {}),
    plan: sanitizePlan(row.plan),
  };
}

/** A plan in a create/update must be valid; null removes it. */
function checkPlan(plan: unknown): Course["plan"] {
  if (plan === null || plan === undefined) return null;
  const clean = sanitizePlan(plan);
  if (!clean) throw new StoreError("That study plan isn't valid.", 400);
  return clean;
}

function fail(error: PostgrestError | null, fallback: string): never {
  // PGRST116: .single() found no row, so the course doesn't exist (or isn't yours)
  if (error?.code === "PGRST116") throw new StoreError("That course no longer exists.", 404);
  if (error?.code === "23514" && error.message.includes("500 courses")) throw new StoreError("You can keep up to 500 courses.", 400);
  if (error?.message?.includes("Failed to fetch")) throw new StoreError("Can't reach the server. Check your connection and try again.");
  throw new StoreError(fallback, Number(error?.code) || 0);
}

/**
 * Courses stored in the user's account (Supabase Postgres).
 * Row-level security in the database guarantees each user only ever sees and
 * changes their own rows; this class never sends a user id.
 */
export class AccountStore implements CourseStore {
  readonly kind = "account";
  readonly supportsPlans = true;

  constructor(private sb: SupabaseClient) {}

  async list(): Promise<Course[]> {
    const { data, error } = await this.sb.from("courses").select(COLUMNS).order("id");
    if (error) fail(error, "Couldn't load your courses.");
    return (data as Row[]).map(toCourse);
  }

  async create(input: CourseDraft): Promise<Course> {
    this.check(input, false);
    const { data, error } = await this.sb
      .from("courses")
      .insert({
        name: input.name.trim(),
        description: input.description.trim(),
        target_date: input.target_date,
        status: input.status,
        plan: checkPlan(input.plan),
      })
      .select(COLUMNS)
      .single();
    if (error) fail(error, "Couldn't save the course.");
    return toCourse(data as Row);
  }

  async update(id: number, patch: CoursePatch): Promise<Course> {
    this.check(patch, true);
    const changes: CoursePatch = {};
    if (patch.name !== undefined) changes.name = patch.name.trim();
    if (patch.description !== undefined) changes.description = patch.description.trim();
    if (patch.target_date !== undefined) changes.target_date = patch.target_date;
    if (patch.status !== undefined) changes.status = patch.status;
    if (patch.plan !== undefined) changes.plan = checkPlan(patch.plan);
    const { data, error } = await this.sb.from("courses").update(changes).eq("id", id).select(COLUMNS).single();
    if (error) fail(error, "Couldn't save your changes.");
    return toCourse(data as Row);
  }

  async remove(id: number): Promise<Course> {
    const { data, error } = await this.sb.from("courses").delete().eq("id", id).select(COLUMNS).single();
    if (error) fail(error, "Couldn't remove the course.");
    return toCourse(data as Row);
  }

  /** The database assigns ids, so a restored course comes back as a new row. */
  async restore(course: Course): Promise<Course> {
    const { name, description, target_date, status } = course;
    return this.create({ name, description, target_date, status });
  }

  /** Copies courses in one request (used to bring demo courses into a new account). */
  async importMany(courses: CourseDraft[]): Promise<number> {
    const rows = courses
      .filter((c) => !hasErrors(validateCourse(c)))
      .map(({ name, description, target_date, status, plan }) => ({ name: name.trim(), description: description.trim(), target_date, status, plan: sanitizePlan(plan) }));
    if (rows.length === 0) return 0;
    const { error } = await this.sb.from("courses").insert(rows);
    if (error) fail(error, "Couldn't copy your courses.");
    return rows.length;
  }

  private check(input: Partial<CourseInput>, partial: boolean) {
    const errors = validateCourse(input, partial);
    if (hasErrors(errors)) throw new StoreError(Object.values(errors).join(" "), 400);
  }
}
