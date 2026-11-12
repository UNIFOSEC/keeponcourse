// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "../src/ui/components";
import { gettingStartedCard } from "../src/ui/gettingStarted";
import type { Course } from "../src/types";

let accounts = 0;
/** Each call is a different account (the weekly-email setting is cached per account) */
function ctx(kind: "account" | "demo" = "account", weeklyOn = false, partners = 0) {
  const userId = `u${++accounts}`;
  return {
    app: {
      store: { kind },
      account: { state: { status: "signed-in", userId, email: "a@x.test" }, weeklyCheckin: vi.fn().mockResolvedValue(weeklyOn) },
    },
    openPlanWizard: vi.fn(),
    openCourse: vi.fn(),
    openAccount: vi.fn(),
    openPartners: vi.fn(),
    partners: { invites: Array.from({ length: partners }, (_, i) => ({ id: i + 1 })), cheers: [] },
  } as unknown as Ctx;
}

const course = (overrides: Partial<Course> = {}): Course => ({ id: 1, name: "Spanish", description: "d", target_date: "2027-01-01", status: "In Progress", created_at: "2026-01-01 00:00:00", ...overrides });
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => localStorage.clear());

describe("Getting started", () => {
  it("is only for signed-in accounts, not the demo", () => {
    expect(gettingStartedCard(ctx("demo"), [], () => {})).toBeNull();
  });

  it("starts at step 1 with ways to add a course", () => {
    const c = ctx();
    const card = gettingStartedCard(c, [], () => {})!;
    expect(card.textContent).toContain("0 of 6 done");
    expect(card.querySelector(".is-next")?.textContent).toContain("Add the course you're taking");
    [...card.querySelectorAll("button")].find((b) => b.textContent?.includes("Import a syllabus"))!.click();
    expect(c.openPlanWizard).toHaveBeenCalled();
  });

  it("ticks steps off from the data and points at the next one", async () => {
    const c = ctx("account", true);
    const rerender = vi.fn();
    gettingStartedCard(c, [], rerender); // starts fetching the weekly-email setting
    await flush();
    expect(rerender).toHaveBeenCalled();

    const plan = { version: 1, days: [1], session_minutes: 60, start_time: "19:00", start_date: "2026-11-02", modules: [{ title: "M", summary: "", hours: 1, done: false }], sessions: [{ date: "2026-11-02", minutes: 60, module: 0, status: "done" as const }] } as Course["plan"];
    const card = gettingStartedCard(c, [course({ plan })], rerender)!;
    expect(card.textContent).toContain("4 of 6 done"); // course, plan, check-in, weekly email
    expect(card.querySelector(".is-next")?.textContent).toContain("Invite a study partner");
    [...card.querySelectorAll("button")].find((b) => b.textContent?.includes("Invite someone"))!.click();
    expect(c.openPartners).toHaveBeenCalled();
  });

  it("counts a study partner once one is invited", async () => {
    const c = ctx("account", true, 1);
    gettingStartedCard(c, [], () => {});
    await flush();
    const plan = { version: 1, days: [1], session_minutes: 60, start_time: "19:00", start_date: "2026-11-02", modules: [{ title: "M", summary: "", hours: 1, done: false }], sessions: [{ date: "2026-11-02", minutes: 60, module: 0, status: "done" as const }] } as Course["plan"];
    const card = gettingStartedCard(c, [course({ plan })], () => {})!;
    expect(card.textContent).toContain("5 of 6 done");
    expect(card.querySelector(".is-next")?.textContent).toContain("Put KeepOnCourse on your phone");
  });

  it("offers to plan the first course without one", () => {
    const c = ctx();
    const card = gettingStartedCard(c, [course({ name: "Guitar" })], () => {})!;
    [...card.querySelectorAll("button")].find((b) => b.textContent?.includes("Plan “Guitar”"))!.click();
    expect(c.openPlanWizard).toHaveBeenCalledWith(expect.objectContaining({ name: "Guitar" }));
  });

  it("stays hidden once hidden", () => {
    const c = ctx();
    const rerender = vi.fn();
    const card = gettingStartedCard(c, [], rerender)!;
    [...card.querySelectorAll("button")].find((b) => b.textContent === "Hide")!.click();
    expect(rerender).toHaveBeenCalled();
    expect(gettingStartedCard(c, [], rerender)).toBeNull();
  });
});
