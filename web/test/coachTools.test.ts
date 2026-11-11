// @vitest-environment happy-dom
import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import type { Account } from "../src/account";
import { App } from "../src/app";
import { runTool, undoAction } from "../src/coach/tools";

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
});
