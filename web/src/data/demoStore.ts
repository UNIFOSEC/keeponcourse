import { isValidDate, hasErrors, validateCourse } from "../validation";
import { timestamp } from "../dates";
import { sanitizePlan } from "../plan";
import { isStatus, type Course, type CourseDraft, type CourseInput, type CoursePatch } from "../types";
import { seedCourses } from "./seed";
import { readJSON, writeJSON } from "./storage";
import { StoreError, type CourseStore } from "./store";

// v2: sample courses now cover any subject (v1 held the developer-only samples)
const STORAGE_KEY = "cch.demo.courses.v2";

/** Drop anything in storage that isn't a well-formed course (storage is user-editable). */
function sanitize(value: unknown): Course[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter(
      (c): c is Course =>
        typeof c === "object" &&
        c !== null &&
        Number.isInteger(c.id) &&
        c.id > 0 &&
        typeof c.name === "string" &&
        typeof c.description === "string" &&
        isValidDate(c.target_date) &&
        isStatus(c.status) &&
        typeof c.created_at === "string",
    )
    .map((c) => ({ ...c, plan: sanitizePlan(c.plan) }));
}

/** A plan in a create/update must be valid; null removes it. */
function checkPlan(plan: unknown): Course["plan"] {
  if (plan === null || plan === undefined) return null;
  const clean = sanitizePlan(plan);
  if (!clean) throw new StoreError("That study plan isn't valid.", 400);
  return clean;
}

/**
 * Courses stored in this browser's localStorage, seeded with sample data.
 * Each visitor gets a private sandbox: nothing is sent over the network.
 * If storage is unavailable, it keeps working in memory for the visit.
 */
export class DemoStore implements CourseStore {
  readonly kind = "demo";
  readonly supportsPlans = true;
  private courses: Course[];

  constructor() {
    this.courses = sanitize(readJSON<unknown>(STORAGE_KEY, null)) ?? seedCourses();
    this.persist();
  }

  async list(): Promise<Course[]> {
    return structuredClone(this.courses);
  }

  async create(input: CourseDraft): Promise<Course> {
    this.check(input, false);
    const course: Course = {
      id: this.nextId(),
      name: input.name.trim(),
      description: input.description.trim(),
      target_date: input.target_date,
      status: input.status,
      created_at: timestamp(),
      plan: checkPlan(input.plan),
    };
    this.courses.push(course);
    this.persist();
    return structuredClone(course);
  }

  async update(id: number, patch: CoursePatch): Promise<Course> {
    this.check(patch, true);
    const course = this.find(id);
    if (patch.name !== undefined) course.name = patch.name.trim();
    if (patch.description !== undefined) course.description = patch.description.trim();
    if (patch.target_date !== undefined) course.target_date = patch.target_date;
    if (patch.status !== undefined) course.status = patch.status;
    if (patch.plan !== undefined) course.plan = checkPlan(patch.plan);
    course.updated_at = timestamp();
    this.persist();
    return structuredClone(course);
  }

  async remove(id: number): Promise<Course> {
    const course = this.find(id);
    this.courses = this.courses.filter((c) => c.id !== id);
    this.persist();
    return structuredClone(course);
  }

  async restore(course: Course): Promise<Course> {
    if (this.courses.some((c) => c.id === course.id)) return this.create(course);
    this.courses.push(structuredClone(course));
    this.courses.sort((a, b) => a.id - b.id);
    this.persist();
    return structuredClone(course);
  }

  /** Back to the sample courses. */
  reset(): void {
    this.courses = seedCourses();
    this.persist();
  }

  private check(input: Partial<CourseInput>, partial: boolean): void {
    const errors = validateCourse(input, partial);
    if (hasErrors(errors)) throw new StoreError(Object.values(errors).join(" "), 400);
  }

  private find(id: number): Course {
    const course = this.courses.find((c) => c.id === id);
    if (!course) throw new StoreError(`Course with ID ${id} not found`, 404);
    return course;
  }

  private nextId(): number {
    return this.courses.reduce((max, c) => Math.max(max, c.id), 0) + 1;
  }

  private persist(): void {
    writeJSON(STORAGE_KEY, this.courses);
  }
}
