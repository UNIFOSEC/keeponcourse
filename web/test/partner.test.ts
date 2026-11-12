// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../src/app";
import { describeCheer, partnerLink, sanitizeShared, summarize, todayIn, tokenFromHash, type SharedProgress } from "../src/partner";
import { ago, createPartnerDialog, namesList } from "../src/ui/partnerDialog";

const TOKEN = "ab".repeat(32);
const flush = () => new Promise((r) => setTimeout(r, 0));

// Thursday Nov 12, 2026; the week runs Mon Nov 9 – Sun Nov 15
const TODAY = "2026-11-12";
const done = (date: string, actual_minutes?: number) => ({ date, minutes: 60, module: 0, status: "done", ...(actual_minutes ? { actual_minutes } : {}) });

function shared(overrides: Record<string, unknown> = {}): SharedProgress {
  return sanitizeShared({
    display_name: "Alex",
    show_names: false,
    timezone: "America/New_York",
    cheers_today: 1,
    courses: [
      {
        name: null,
        target_date: "2026-11-30",
        status: "In Progress",
        modules: [{ title: null, done: false }, { title: null, done: false }],
        sessions: [
          done("2026-10-28"),
          done("2026-11-04"),
          done("2026-11-09", 45),
          { date: "2026-11-10", minutes: 60, module: 0 }, // missed
          { date: "2026-11-11", minutes: 60, module: 0, status: "skipped" },
          { date: "2026-11-12", minutes: 60, module: 1 }, // today
          { date: "2026-11-14", minutes: 60, module: 1 },
          { date: "2026-11-20", minutes: 60, module: 1 },
        ],
      },
      { name: "Finished one", target_date: "2026-10-01", status: "Completed", modules: [{ title: "M", done: true }], sessions: [done("2026-09-20")] },
    ],
    ...overrides,
  })!;
}

describe("partner links", () => {
  it("builds and reads #/p/<token> links, and nothing else", () => {
    expect(partnerLink(TOKEN, "https://keeponcourse.com")).toBe(`https://keeponcourse.com/#/p/${TOKEN}`);
    expect(tokenFromHash(`#/p/${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(`#/p/${TOKEN}x`)).toBeNull();
    expect(tokenFromHash("#/p/abc")).toBeNull();
    expect(tokenFromHash("#/courses")).toBeNull();
  });
});

describe("sanitizeShared", () => {
  it("keeps only valid sessions and safe fields", () => {
    const s = sanitizeShared({
      display_name: "  Alex  ",
      courses: [
        { name: "  ", target_date: "2026-12-01", status: "weird", modules: [{ title: "x".repeat(200), done: "yes" }], sessions: [{ date: "nope", module: 0 }, { date: "2026-11-02", module: 4 }, { date: "2026-11-03", module: 0, minutes: 9999, status: "done", actual_minutes: 5000, extra: "<b>" }] },
        { name: "No date", target_date: "soon", modules: [], sessions: [] },
      ],
    })!;
    expect(s.display_name).toBe("Alex");
    expect(s.courses).toHaveLength(1);
    const [c] = s.courses;
    expect(c).toMatchObject({ name: null, status: "Not Started" });
    expect(c.modules[0]).toEqual({ title: "x".repeat(80), done: false });
    expect(c.sessions).toEqual([{ date: "2026-11-03", minutes: 60, module: 0, status: "done" }]);
    expect(sanitizeShared(null)).toBeNull();
    expect(sanitizeShared("x")).toBeNull();
  });
});

describe("summarize", () => {
  it("works out this week, the streak and each plan's state", () => {
    const s = summarize(shared(), TODAY);
    // 4 sessions this week that aren't skipped; 1 done (45 timed minutes)
    expect(s.week).toEqual({ done: 1, total: 4, minutes: 45 });
    expect(s.streak).toBe(3); // Oct 26, Nov 2 and this week
    expect(s.lastStudied).toBe("2026-11-09");
    expect(s.days.map((d) => `${d.date.slice(8)}:${d.state}`)).toEqual(["09:done", "10:missed", "11:skipped", "12:today", "14:upcoming"]);

    const [active, finished] = s.courses;
    expect(active).toMatchObject({ name: "Course 1", done: 3, total: 7, missed: 1, tone: "behind", finish: "2026-11-20", slack: 10, next: { date: TODAY, module: null } });
    expect(finished).toMatchObject({ name: "Finished one", tone: "done", missed: 0, next: null });
  });

  it("calls a plan late when it finishes after the target, and good otherwise", () => {
    const late = shared({ courses: [{ name: "Late", target_date: "2026-11-15", status: "In Progress", modules: [{ title: "M", done: false }], sessions: [{ date: "2026-11-20", minutes: 60, module: 0 }] }] });
    expect(summarize(late, TODAY).courses[0]).toMatchObject({ tone: "late", slack: -5 });
    const good = shared({ courses: [{ name: "Good", target_date: "2026-11-30", status: "In Progress", modules: [{ title: "Verbs", done: false }], sessions: [{ date: "2026-11-20", minutes: 60, module: 0 }] }] });
    expect(summarize(good, TODAY).courses[0]).toMatchObject({ tone: "good", next: { date: "2026-11-20", module: "Verbs" } });
    expect(summarize(good, TODAY).lastStudied).toBeNull();
  });

  it("uses the learner's own date", () => {
    const at = new Date("2026-11-13T03:00:00Z"); // still Thursday evening in New York, already Friday in Tokyo
    expect(todayIn("America/New_York", at)).toBe("2026-11-12");
    expect(todayIn("Asia/Tokyo", at)).toBe("2026-11-13");
    expect(todayIn("Not/AZone", at)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("wording", () => {
  it("lists names and times the way people say them", () => {
    expect(namesList(["Sam"])).toBe("Sam");
    expect(namesList(["Sam", "Kim"])).toBe("Sam and Kim");
    expect(namesList(["Sam", "Kim", "Lee"])).toBe("Sam, Kim and Lee");
    expect(namesList(["Sam", "Kim", "Lee", "Ana"])).toBe("Sam, Kim and 2 others");
    expect(ago("2026-11-12T10:00:00", TODAY)).toBe("today");
    expect(ago("2026-11-11T10:00:00", TODAY)).toBe("yesterday");
    expect(ago("2026-11-08T10:00:00", TODAY)).toBe("4 days ago");
    expect(describeCheer({ kind: "keep_going", from: "Sam" })).toBe("Sam: 👏 Keep going!");
  });
});

describe("Study partners dialog", () => {
  beforeEach(async () => {
    document.body.replaceChildren();
    localStorage.clear();
    (await import("../src/ui/toast")).initToasts(document.body);
  });
  const fill = (el: Element, id: string, value: string) => (el.querySelector<HTMLInputElement>(id)!.value = value);
  const toasts = () => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | ");

  it("emails the new link when an address is given, and remembers that it was sent", async () => {
    const sendEmail = vi.fn(async () => {});
    const { dialog, el } = setup({}, sendEmail);
    dialog.open();
    await flush();
    fill(el, "#partner-label", "Sam");
    fill(el, "#partner-display", "Alex");
    fill(el, "#partner-email", "not-an-address");
    el.querySelector<HTMLFormElement>(".partner-form")!.requestSubmit();
    expect(el.querySelector(".field-error")!.textContent).toMatch(/doesn't look right/);
    expect(sendEmail).not.toHaveBeenCalled();

    fill(el, "#partner-email", " sam@example.com ");
    el.querySelector<HTMLInputElement>("#partner-reply")!.checked = true;
    el.querySelector<HTMLFormElement>(".partner-form")!.requestSubmit();
    await flush();
    await flush();
    expect(sendEmail).toHaveBeenCalledWith(7, "sam@example.com", true);
    expect(toasts()).toContain("Link created and emailed to Sam.");
    expect(el.querySelector<HTMLInputElement>("#partner-email")!.value).toBe("");
    expect(el.textContent).toContain("Invite emailed today");
    expect(el.textContent).toContain("Email again");
  });

  it("keeps the link when the email fails, and can email it again from the list", async () => {
    const sendEmail = vi.fn().mockRejectedValueOnce(new Error("You've sent 5 invite emails today.")).mockResolvedValue(undefined);
    const { dialog, el } = setup({}, sendEmail);
    dialog.open();
    await flush();
    fill(el, "#partner-label", "Sam");
    fill(el, "#partner-display", "Alex");
    fill(el, "#partner-email", "sam@example.com");
    el.querySelector<HTMLFormElement>(".partner-form")!.requestSubmit();
    await flush();
    await flush();
    expect(toasts()).toContain("Link created, but the email wasn't sent: You've sent 5 invite emails today.");
    expect(el.querySelector(".partner-link")).not.toBeNull();

    const row = el.querySelector<HTMLFormElement>(".partner-email-row")!;
    expect(row.hidden).toBe(true);
    [...el.querySelectorAll<HTMLButtonElement>(".partner-link-row button")].find((b) => b.textContent === "Email")!.click();
    expect(row.hidden).toBe(false);
    row.querySelector<HTMLInputElement>("input[type=email]")!.value = "sam@example.com";
    row.requestSubmit();
    await flush();
    expect(sendEmail).toHaveBeenLastCalledWith(7, "sam@example.com", false);
    expect(toasts()).toContain("Invite emailed to Sam.");
  });

  it("offers no email field when email can't be sent", async () => {
    const { dialog, el } = setup();
    dialog.open();
    await flush();
    expect(el.querySelector("#partner-email")).toBeNull();
  });

  function setup(replies: Record<string, unknown> = {}, sendEmail?: (id: number, email: string, replyTo: boolean) => Promise<void>) {
    const calls: [string, unknown][] = [];
    let invites: unknown[] = (replies.my_partners as unknown[]) ?? [];
    const rpc = vi.fn(async (name: string, args?: unknown) => {
      calls.push([name, args]);
      if (name === "create_partner_invite") {
        invites = [...invites, { id: 7, label: "Sam", display_name: "Alex", token: TOKEN, show_names: false, created_at: "2026-11-12T10:00:00Z", last_viewed_at: null, cheers: 0 }];
        return { data: { id: 7, token: TOKEN }, error: null };
      }
      if (name === "my_partners") return { data: invites, error: null };
      return { data: replies[name] ?? null, error: null };
    });
    const app = { account: { signedIn: true, state: { status: "signed-in", userId: "u1", email: "a@example.com" }, db: async () => ({ rpc }) } } as unknown as App;
    const onChange = vi.fn();
    const dialog = createPartnerDialog(app, onChange, sendEmail);
    document.body.append(dialog.el);
    return { dialog, calls, onChange, el: dialog.el };
  }

  it("creates a private link, and asks who it's for and how you're shown", async () => {
    const { dialog, calls, el } = setup();
    dialog.open();
    await flush();
    const form = el.querySelector<HTMLFormElement>(".partner-form")!;
    form.requestSubmit();
    expect(el.querySelector(".field-error")!.textContent).toMatch(/who you're inviting/);
    el.querySelector<HTMLInputElement>("#partner-label")!.value = " Sam ";
    form.requestSubmit();
    expect(el.querySelector(".field-error")!.textContent).toMatch(/Add your name/);
    el.querySelector<HTMLInputElement>("#partner-display")!.value = "Alex";
    el.querySelector<HTMLInputElement>("#partner-show-names")!.checked = true;
    form.requestSubmit();
    await flush();
    await flush();
    const [, args] = calls.find(([name]) => name === "create_partner_invite")!;
    expect(args).toMatchObject({ label: "Sam", display_name: "Alex", show_names: true });
    const link = el.querySelector<HTMLInputElement>(".partner-invite.is-fresh .partner-link")!;
    expect(link.value).toBe(`${location.origin}/#/p/${TOKEN}`);
    expect(el.textContent).toContain("Sharing with 1 person");
    expect(el.textContent).toContain("Hasn't opened the link yet");
  });

  it("announces new cheers once, marks them seen, and lists them", async () => {
    const cheers = [
      { id: 1, kind: "proud", from: "Sam", seen: false, created_at: new Date().toISOString() },
      { id: 2, kind: "streak", from: "Kim", seen: false, created_at: new Date().toISOString() },
    ];
    const { dialog, calls, onChange } = setup({ my_cheers: cheers });
    await dialog.load();
    expect(document.querySelector(".toast")?.textContent).toContain("2 new cheers from Sam and Kim");
    expect(calls.some(([name]) => name === "mark_cheers_seen")).toBe(true);
    expect(onChange).toHaveBeenCalled();
    expect(dialog.state.cheers).toHaveLength(2);
    // Not again within a few minutes
    const before = calls.length;
    await dialog.load();
    expect(calls.length).toBe(before);
  });

  it("hides the form at 5 partners, and stops sharing on a second click", async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, label: `P${i + 1}`, display_name: "Alex", token: TOKEN, show_names: false, created_at: "2026-11-01T10:00:00Z", last_viewed_at: "2026-11-11T10:00:00Z", cheers: i }));
    const { dialog, calls, el } = setup({ my_partners: five });
    dialog.open();
    await flush();
    expect(el.querySelector<HTMLFormElement>(".partner-form")!.hidden).toBe(true);
    expect(el.textContent).toContain("up to 5 study partners");
    const stop = el.querySelector<HTMLButtonElement>(".partner-stop")!;
    stop.click();
    expect(calls.some(([name]) => name === "delete_partner_invite")).toBe(false);
    expect(stop.textContent).toContain("Click again");
    stop.click();
    await flush();
    expect(calls.find(([name]) => name === "delete_partner_invite")?.[1]).toEqual({ invite_id: 1 });
  });
});
