// @vitest-environment happy-dom
import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import type { Account } from "../src/account";
import { App } from "../src/app";
import { runTool, undoAction } from "../src/coach/tools";
import { schedule, type StudyPlan } from "../src/plan";
import { addDays, todayISO } from "../src/dates";

// Coach's tool calls are model output, so they're untrusted input: these tests
// check they go through the same validation as the course form.

const signedOut = { state: { status: "signed-out" }, signedIn: false } as unknown as Account;

async function freshApp(): Promise<App> {
  localStorage.clear();
  const app = new App(signedOut);
  await app.load();
  return app;
}

const call = (name: string, input: unknown): Anthropic.Beta.BetaToolUseBlock =>
  ({ type: "tool_use", id: "toolu_test", name, input }) as Anthropic.Beta.BetaToolUseBlock;

const result = (outcome: Awaited<ReturnType<typeof runTool>>) => JSON.parse(outcome.result.content as string);

let app: App;
beforeEach(async () => {
  app = await freshApp();
});

describe("Coach tools", () => {
  it("adds a valid course and can undo it", async () => {
    const outcome = await runTool(app, call("add_course", { name: "Excel", description: "Pivot tables", target_date: "2027-02-01" }));
    expect(result(outcome)).toMatchObject({ ok: true, course: { name: "Excel", status: "Not Started" } });
    expect(app.courses).toHaveLength(9);
    await undoAction(app, outcome.action!);
    expect(app.courses).toHaveLength(8);
  });

  it("rejects invalid input with an error result instead of saving it", async () => {
    for (const input of [{ name: "", description: "d", target_date: "2027-01-01" }, { name: "X", description: "d", target_date: "2027-02-30" }, { name: "X", description: "d", target_date: "2027-01-01", status: "Hacked" }]) {
      const outcome = await runTool(app, call("add_course", input));
      expect(outcome.result.is_error).toBe(true);
      expect(outcome.action).toBeUndefined();
    }
    expect(app.courses).toHaveLength(8);
  });

  it("updates only known fields of an existing course, and undo restores it", async () => {
    const before = app.courses[0];
    const outcome = await runTool(app, call("update_course", { id: before.id, status: "Completed", user_id: "someone-else" }));
    expect(result(outcome).ok).toBe(true);
    expect(app.courses.find((c) => c.id === before.id)?.status).toBe("Completed");
    await undoAction(app, outcome.action!);
    expect(app.courses.find((c) => c.id === before.id)?.status).toBe(before.status);
  });

  it("refuses unknown ids, empty updates and unknown tools", async () => {
    expect((await runTool(app, call("update_course", { id: 999, status: "Completed" }))).result.is_error).toBe(true);
    expect((await runTool(app, call("update_course", { id: app.courses[0].id }))).result.is_error).toBe(true);
    expect((await runTool(app, call("remove_course", { id: "1" }))).result.is_error).toBe(true); // id must be an integer
    expect((await runTool(app, call("delete_everything", {}))).result.is_error).toBe(true);
    expect(app.courses).toHaveLength(8);
  });

  it("removes a course and restores it on undo", async () => {
    const target = app.courses[2];
    const outcome = await runTool(app, call("remove_course", { id: target.id }));
    expect(app.courses.some((c) => c.id === target.id)).toBe(false);
    await undoAction(app, outcome.action!);
    expect(app.courses.some((c) => c.name === target.name)).toBe(true);
  });

  it("reschedules a study plan that fell behind, and undo restores it", async () => {
    // Three 1-hour modules on every weekday, started two weeks ago, nothing checked in
    const start = addDays(todayISO(), -14);
    const modules = [1, 2, 3].map((n) => ({ title: `Module ${n}`, summary: "", hours: 1, done: false }));
    const days = [0, 1, 2, 3, 4, 5, 6];
    const plan: StudyPlan = { version: 1, days, session_minutes: 60, start_time: "19:00", start_date: start, modules, sessions: schedule(modules, { startDate: start, days, sessionMinutes: 60 }) };
    const course = await app.create({ name: "Behind", description: "d", target_date: addDays(todayISO(), -1), status: "In Progress", plan });

    const outcome = await runTool(app, call("reschedule_plan", { id: course.id, move_target_date: true }));
    const body = result(outcome);
    expect(body.ok).toBe(true);
    expect(body.sessions_left).toBe(3);
    expect(body.planned_finish).toBe(addDays(todayISO(), 2));
    const after = app.courses.find((c) => c.id === course.id)!;
    expect(after.target_date).toBe(addDays(todayISO(), 2));
    expect(after.plan!.sessions.filter((s) => s.status === "skipped")).toHaveLength(3);

    await undoAction(app, outcome.action!);
    const restored = app.courses.find((c) => c.id === course.id)!;
    expect(restored.target_date).toBe(course.target_date);
    expect(restored.plan!.sessions.some((s) => s.status)).toBe(false);
  });

  it("refuses to reschedule a course without a plan, or with bad days or lengths", async () => {
    const plain = app.courses.find((c) => !c.plan)!;
    expect((await runTool(app, call("reschedule_plan", { id: plain.id }))).result.is_error).toBe(true);
    const start = todayISO();
    const modules = [{ title: "Only", summary: "", hours: 1, done: false }];
    const plan: StudyPlan = { version: 1, days: [1], session_minutes: 60, start_time: "19:00", start_date: start, modules, sessions: schedule(modules, { startDate: start, days: [1], sessionMinutes: 60 }) };
    const course = await app.create({ name: "Planned", description: "d", target_date: addDays(start, 30), status: "Not Started", plan });
    expect((await runTool(app, call("reschedule_plan", { id: course.id, days: [9] }))).result.is_error).toBe(true);
    expect((await runTool(app, call("reschedule_plan", { id: course.id, days: [] }))).result.is_error).toBe(true);
    expect((await runTool(app, call("reschedule_plan", { id: course.id, session_minutes: 50 }))).result.is_error).toBe(true);
  });
});
