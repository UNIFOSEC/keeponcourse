// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { DemoStore } from "../src/data/demoStore";
import { StoreError } from "../src/data/store";
import { schedule, type StudyPlan } from "../src/plan";

const KEY = "cch.demo.courses.v2";
const input = { name: "Rust", description: "Ownership and borrowing", target_date: "2027-03-01", status: "Not Started" as const };

function plan(): StudyPlan {
  const modules = [{ title: "Basics", summary: "", hours: 2, done: false }];
  return { version: 1, days: [1], session_minutes: 60, start_time: "19:00", start_date: "2026-11-09", modules, sessions: schedule(modules, { startDate: "2026-11-09", days: [1], sessionMinutes: 60 }) };
}

beforeEach(() => localStorage.clear());

describe("DemoStore", () => {
  it("starts with the sample courses and saves them", async () => {
    const store = new DemoStore();
    expect(await store.list()).toHaveLength(8);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(8);
  });

  it("creates, updates, removes and restores courses", async () => {
    const store = new DemoStore();
    const created = await store.create({ ...input, name: "  Rust  " });
    expect(created).toMatchObject({ id: 9, name: "Rust" });

    const updated = await store.update(created.id, { status: "In Progress" });
    expect(updated.status).toBe("In Progress");
    expect(updated.updated_at).toBeDefined();

    await store.remove(created.id);
    expect((await store.list()).some((c) => c.id === created.id)).toBe(false);

    await store.restore(updated);
    expect((await store.list()).find((c) => c.id === created.id)?.status).toBe("In Progress");
  });

  it("rejects invalid input and unknown ids", async () => {
    const store = new DemoStore();
    await expect(store.create({ ...input, target_date: "2026-02-30" })).rejects.toMatchObject({ status: 400 });
    await expect(store.update(999, { status: "Completed" })).rejects.toBeInstanceOf(StoreError);
    await expect(store.update(999, { status: "Completed" })).rejects.toMatchObject({ status: 404 });
  });

  it("stores valid study plans and refuses broken ones", async () => {
    const store = new DemoStore();
    const course = await store.create({ ...input, plan: plan() });
    expect(course.plan?.modules).toHaveLength(1);
    await expect(store.update(course.id, { plan: { ...plan(), days: [] } })).rejects.toMatchObject({ status: 400 });
    expect((await store.update(course.id, { plan: null })).plan).toBeNull();
  });

  it("drops tampered entries from storage instead of trusting them", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { id: 1, name: "Good", description: "d", target_date: "2027-01-01", status: "In Progress", created_at: "2026-01-01 00:00:00" },
        { id: "2", name: "<img onerror=alert(1)>", description: "d", target_date: "2027-01-01", status: "In Progress", created_at: "x" },
        { id: 3, name: "Bad status", description: "d", target_date: "2027-01-01", status: "Hacked", created_at: "x" },
        { id: 4, name: "Bad plan", description: "d", target_date: "2027-01-01", status: "Not Started", created_at: "x", plan: { version: 1 } },
      ]),
    );
    const courses = await new DemoStore().list();
    expect(courses.map((c) => c.name)).toEqual(["Good", "Bad plan"]);
    expect(courses[1].plan).toBeNull(); // invalid plan removed, course kept
  });
});
