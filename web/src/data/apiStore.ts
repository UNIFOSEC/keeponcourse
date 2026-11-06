import type { Course, CourseDraft, CourseInput, CoursePatch } from "../types";
import { StoreError, type CourseStore } from "./store";

interface ApiError {
  success: false;
  error?: string;
}
type ApiResponse<T> = ({ success: true } & T) | ApiError;

/** Talks to the project's Express API (app.js in the repository root). */
export class ApiStore implements CourseStore {
  readonly kind = "api";
  /** The Express API stores the four course fields only */
  readonly supportsPlans = false;

  constructor(readonly baseUrl: string) {}

  async list(): Promise<Course[]> {
    return (await this.request<{ courses: Course[] }>("")).courses;
  }

  async create(input: CourseDraft): Promise<Course> {
    const { name, description, target_date, status } = input;
    const fields: CourseInput = { name, description, target_date, status };
    return (await this.request<{ course: Course }>("", { method: "POST", body: JSON.stringify(fields) })).course;
  }

  async update(id: number, patch: CoursePatch): Promise<Course> {
    const { plan, ...fields } = patch;
    if (plan !== undefined && Object.keys(fields).length === 0) {
      throw new StoreError("Study plans are saved with demo data or an account, not the local API.", 400);
    }
    return (await this.request<{ course: Course }>(`/${id}`, { method: "PUT", body: JSON.stringify(fields) }))
      .course;
  }

  async remove(id: number): Promise<Course> {
    return (await this.request<{ deleted_course: Course }>(`/${id}`, { method: "DELETE" })).deleted_course;
  }

  /** The API assigns IDs, so a restored course comes back as a new one. */
  async restore(course: Course): Promise<Course> {
    const { name, description, target_date, status } = course;
    return this.create({ name, description, target_date, status });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        ...init,
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      throw new StoreError(
        `Can't reach the API at ${this.baseUrl}. Start it with "npm start" in the project folder.`,
      );
    }

    let body: ApiResponse<T> | null = null;
    try {
      body = (await response.json()) as ApiResponse<T>;
    } catch {
      // Not JSON; handled below
    }

    if (!response.ok || !body || body.success === false) {
      const message = body && body.success === false && body.error ? body.error : null;
      throw new StoreError(message ?? `Request failed (HTTP ${response.status})`, response.status);
    }
    return body;
  }
}
