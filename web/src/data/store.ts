import type { Course, CourseInput } from "../types";
import { readJSON, writeJSON } from "./storage";

/** Everything the UI needs from a data source. Demo and API modes both implement it. */
export interface CourseStore {
  readonly kind: "demo" | "api" | "account";
  list(): Promise<Course[]>;
  create(input: CourseInput): Promise<Course>;
  update(id: number, patch: Partial<CourseInput>): Promise<Course>;
  remove(id: number): Promise<Course>;
  /** Put a removed course back (used by Undo). */
  restore(course: Course): Promise<Course>;
}

export class StoreError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

export interface Settings {
  source: "demo" | "api";
  apiUrl: string;
}

const SETTINGS_KEY = "cch.settings.v1";
export const DEFAULT_API_URL = "http://localhost:5000/api/courses";
const DEFAULT_SETTINGS: Settings = { source: "demo", apiUrl: DEFAULT_API_URL };

export function loadSettings(): Settings {
  const saved = readJSON<Partial<Settings> | null>(SETTINGS_KEY, null);
  const apiUrl = typeof saved?.apiUrl === "string" ? normalizeApiUrl(saved.apiUrl) : null;
  return {
    source: saved?.source === "api" && apiUrl ? "api" : "demo",
    apiUrl: apiUrl ?? DEFAULT_SETTINGS.apiUrl,
  };
}

export function saveSettings(settings: Settings): void {
  writeJSON(SETTINGS_KEY, settings);
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Returns a cleaned-up API URL, or null if it isn't allowed.
 * Only localhost is accepted: it matches the page's Content Security Policy,
 * and stops the app from being pointed at a third-party server.
 */
export function normalizeApiUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!LOCAL_HOSTS.has(url.hostname)) return null;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}
