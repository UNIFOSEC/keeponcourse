import type { Account } from "./account";
import { AccountStore } from "./data/accountStore";
import { ApiStore } from "./data/apiStore";
import { DemoStore } from "./data/demoStore";
import { loadSettings, saveSettings, type CourseStore, type Settings } from "./data/store";
import type { Course, CourseDraft, CoursePatch, Status } from "./types";

export type LoadState = "loading" | "ready" | "error";

function createStore(settings: Settings): CourseStore {
  return settings.source === "api" ? new ApiStore(settings.apiUrl) : new DemoStore();
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

/**
 * App state: the course list plus the data source it came from.
 * Signed in, courses come from the user's account; signed out, from the
 * data source in settings (demo data or the local API).
 * Views subscribe and re-render on every change.
 */
export class App {
  settings: Settings = loadSettings();
  store: CourseStore = createStore(this.settings);
  courses: Course[] = [];
  loadState: LoadState = "loading";
  loadError = "";
  private listeners = new Set<() => void>();
  private loadSeq = 0;
  private accountUser: string | null = null;

  constructor(readonly account: Account) {}

  /** Switches to the account's courses on sign-in, and back on sign-out. */
  async syncWithAccount(): Promise<void> {
    const state = this.account.state;
    const userId = state.status === "signed-in" ? state.userId : null;
    if (state.status === "loading") return;
    if (userId === this.accountUser && this.loadState !== "loading") return;
    this.accountUser = userId;
    this.store = userId ? new AccountStore(await this.account.db()) : createStore(this.settings);
    await this.load();
  }

  /** Copies the browser's demo courses into the signed-in account. */
  async importDemoCourses(): Promise<number> {
    if (!(this.store instanceof AccountStore)) return 0;
    const count = await this.store.importMany(await new DemoStore().list());
    await this.load();
    return count;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async load(): Promise<void> {
    const seq = ++this.loadSeq;
    this.loadState = "loading";
    this.emit();
    try {
      const courses = await this.store.list();
      if (seq !== this.loadSeq) return; // a newer load (e.g. after switching source) won
      this.courses = courses;
      this.loadState = "ready";
    } catch (error) {
      if (seq !== this.loadSeq) return;
      this.courses = [];
      this.loadState = "error";
      this.loadError = errorMessage(error);
    }
    this.emit();
  }

  async create(input: CourseDraft): Promise<Course> {
    const course = await this.store.create(input);
    this.courses = [...this.courses, course];
    this.emit();
    return course;
  }

  async update(id: number, patch: CoursePatch): Promise<Course> {
    const course = await this.store.update(id, patch);
    this.replace(course);
    return course;
  }

  /** Status change from drag and drop: shown immediately, rolled back if the save fails. */
  async move(id: number, status: Status): Promise<boolean> {
    const before = this.courses.find((c) => c.id === id);
    if (!before || before.status === status) return false;
    this.replace({ ...before, status });
    try {
      this.replace(await this.store.update(id, { status }));
      return true;
    } catch (error) {
      this.replace(before);
      throw error;
    }
  }

  async remove(course: Course): Promise<Course> {
    const removed = await this.store.remove(course.id);
    this.courses = this.courses.filter((c) => c.id !== course.id);
    this.emit();
    return removed;
  }

  async restore(course: Course): Promise<Course> {
    const restored = await this.store.restore(course);
    this.courses = [...this.courses, restored].sort((a, b) => a.id - b.id);
    this.emit();
    return restored;
  }

  async applySettings(settings: Settings): Promise<void> {
    this.settings = settings;
    saveSettings(settings);
    if (this.account.signedIn) return; // takes effect after signing out
    this.store = createStore(settings);
    await this.load();
  }

  async resetDemo(): Promise<void> {
    if (this.store instanceof DemoStore) {
      this.store.reset();
      await this.load();
    }
  }

  private replace(course: Course): void {
    this.courses = this.courses.map((c) => (c.id === course.id ? course : c));
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
