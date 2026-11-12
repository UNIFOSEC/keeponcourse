// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../src/app";
import { describeContext, feedbackContext } from "../src/feedback";
import { createFeedbackDialog } from "../src/ui/feedbackDialog";
import { createFeedbackInbox } from "../src/ui/feedbackInbox";

const flush = () => new Promise((r) => setTimeout(r, 0));

/** An app whose database calls are recorded and answered from `replies`. */
function fakeApp(replies: Record<string, unknown> = {}) {
  const rpc = vi.fn(async (name: string, _args?: unknown) => ({ data: replies[name] ?? null, error: null }));
  const app = {
    courses: [{ id: 1, name: "Spanish", plan: { sessions: [], modules: [] } }, { id: 2, name: "Stats" }],
    account: { signedIn: true, db: async () => ({ rpc }) },
  } as unknown as App;
  return { app, rpc };
}

const button = (root: Element, text: string) => [...root.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;

beforeEach(() => document.body.replaceChildren());

describe("feedback context", () => {
  it("holds only app details, and reads well", () => {
    const { app } = fakeApp();
    const context = feedbackContext(app);
    expect(Object.keys(context).sort()).toEqual(["courses", "device", "installed", "page", "streak_weeks", "version", "with_plan"]);
    expect(context).toMatchObject({ courses: 2, with_plan: 1 });
    expect(describeContext({ page: "#/calendar", device: "phone", installed: true, courses: 3, with_plan: 1, streak_weeks: 2, version: "abc" })).toBe(
      "page #/calendar · phone (installed app) · 3 courses, 1 with a plan · 2-week streak · version abc",
    );
    expect(describeContext(null)).toBe("No app details");
  });
});

describe("Feedback dialog", () => {
  function open(replies: Record<string, unknown> = {}) {
    const { app, rpc } = fakeApp({ my_feedback: [], ...replies });
    const onUnread = vi.fn();
    const dialog = createFeedbackDialog(app, onUnread);
    document.body.append(dialog.el);
    dialog.open();
    return { dialog, rpc, onUnread, el: dialog.el };
  }

  it("sends the chosen kind and message, with app details unless turned off", async () => {
    const { rpc, el } = open();
    button(el, "Problem").click();
    el.querySelector<HTMLTextAreaElement>("#feedback-message")!.value = "  PDF import failed  ";
    el.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const [, args] = rpc.mock.calls.find(([name]) => name === "submit_feedback")!;
    expect(args).toMatchObject({ kind: "problem", message: "PDF import failed" });
    expect((args as { context: Record<string, unknown> }).context).toHaveProperty("courses", 2);

    el.querySelector<HTMLInputElement>("#feedback-context")!.checked = false;
    el.querySelector<HTMLTextAreaElement>("#feedback-message")!.value = "Love the streaks";
    el.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    const last = rpc.mock.calls.filter(([name]) => name === "submit_feedback").at(-1)!;
    expect(last[1]).toMatchObject({ context: null });
  });

  it("won't send an empty message", async () => {
    const { rpc, el } = open();
    el.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(rpc.mock.calls.some(([name]) => name === "submit_feedback")).toBe(false);
    expect(el.textContent).toContain("Write a few words first.");
  });

  it("shows earlier feedback with the developer's reply, and marks it read", async () => {
    const { rpc, el, onUnread } = open({
      my_feedback: [{ id: 1, kind: "idea", message: "Add notes", status: "planned", reply: "On the list!", replied_at: "2026-11-12T10:00:00Z", reply_seen: false, created_at: "2026-11-10T10:00:00Z" }],
    });
    await flush();
    await flush();
    expect(el.textContent).toContain("Your feedback");
    expect(el.textContent).toContain("Reply from the developer");
    expect(el.textContent).toContain("On the list!");
    expect(el.textContent).toContain("Planned");
    expect(rpc.mock.calls.some(([name]) => name === "mark_feedback_replies_seen")).toBe(true);
    expect(onUnread).toHaveBeenLastCalledWith(0);
  });

  it("shows messages as text, never as HTML", async () => {
    const { el } = open({
      my_feedback: [{ id: 1, kind: "problem", message: "<img src=x onerror=alert(1)>", status: "new", reply: null, replied_at: null, reply_seen: true, created_at: "2026-11-10T10:00:00Z" }],
    });
    await flush();
    await flush();
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain("<img src=x");
  });
});

describe("Feedback inbox", () => {
  const item = { id: 7, kind: "problem", message: "PDF import failed", context: { page: "#/courses", device: "phone" }, status: "new", reply: null, replied_at: null, created_at: "2026-11-12T09:00:00Z", author: "a1b2c3", author_since: "2026-11-01" };

  it("lists feedback with its details, and saves a status and reply", async () => {
    const { app, rpc } = fakeApp({ admin_feedback: [item] });
    const inbox = createFeedbackInbox(app);
    document.body.append(inbox.el);
    await inbox.load();
    expect(inbox.el.textContent).toContain("PDF import failed");
    expect(inbox.el.textContent).toContain("User a1b2c3");
    expect(inbox.el.textContent).toContain("page #/courses · phone");
    expect(rpc).toHaveBeenCalledWith("admin_feedback", { filter_status: "new" });

    inbox.el.querySelector<HTMLSelectElement>("select")!.value = "planned";
    inbox.el.querySelector<HTMLTextAreaElement>("textarea")!.value = "Thanks, fixing it this week.";
    button(inbox.el, "Save").click();
    await flush();
    expect(rpc).toHaveBeenCalledWith("admin_update_feedback", { feedback_id: 7, new_status: "planned", new_reply: "Thanks, fixing it this week." });
  });

  it("changes the status without touching an existing reply", async () => {
    const { app, rpc } = fakeApp({ admin_feedback: [{ ...item, reply: "Looking into it", status: "planned" }] });
    const inbox = createFeedbackInbox(app);
    document.body.append(inbox.el);
    await inbox.load();
    inbox.el.querySelector<HTMLSelectElement>("select")!.value = "done";
    button(inbox.el, "Save").click();
    await flush();
    expect(rpc).toHaveBeenCalledWith("admin_update_feedback", { feedback_id: 7, new_status: "done", new_reply: null });
  });

  it("filters by status", async () => {
    const { app, rpc } = fakeApp({ admin_feedback: [] });
    const inbox = createFeedbackInbox(app);
    document.body.append(inbox.el);
    await inbox.load();
    expect(inbox.el.textContent).toContain("No new feedback.");
    button(inbox.el, "All").click();
    await flush();
    expect(rpc).toHaveBeenLastCalledWith("admin_feedback", { filter_status: null });
  });
});
