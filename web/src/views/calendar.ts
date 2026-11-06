import { accountsEnabled } from "../account";
import { errorMessage } from "../app";
import { COACH_URL } from "../coach/session";
import { addDays, formatDate, formatTime, todayISO, toISODate } from "../dates";
import { downloadAllIcs } from "../ics";
import type { PlanModule, PlanSession } from "../plan";
import type { Course } from "../types";
import { button, emptyState, pageHeader, type Ctx, type View } from "../ui/components";
import { cx, h, setChildren } from "../ui/dom";
import { icon } from "../ui/icons";
import { toast } from "../ui/toast";

interface Entry {
  course: Course;
  session: PlanSession;
  module: PlanModule;
  color: number;
}

const COLORS = 6;

/** Date to show when the Calendar page opens next (e.g. a new plan's first session). */
let pendingFocus: string | null = null;
export function focusCalendarOn(date: string): void {
  pendingFocus = date;
}
const WEEK_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** All study sessions across planned courses, by date. */
function collect(courses: Course[]): { byDate: Map<string, Entry[]>; legend: { course: Course; color: number }[] } {
  const planned = courses.filter((c) => c.plan && c.plan.sessions.length).sort((a, b) => a.id - b.id);
  const byDate = new Map<string, Entry[]>();
  planned.forEach((course, i) => {
    const plan = course.plan!;
    for (const session of plan.sessions) {
      const module = plan.modules[session.module];
      if (!module) continue;
      const list = byDate.get(session.date) ?? [];
      list.push({ course, session, module, color: i % COLORS });
      byDate.set(session.date, list);
    }
  });
  return { byDate, legend: planned.map((course, i) => ({ course, color: i % COLORS })) };
}

const monthLabel = (first: string) => {
  const [y, m] = first.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
};

const firstOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`;

function shiftMonth(first: string, delta: number): string {
  const [y, m] = first.split("-").map(Number);
  return toISODate(new Date(y, m - 1 + delta, 1));
}

/** Monday-first grid start for the month containing `first`. */
function gridStart(first: string): string {
  const [y, m] = first.split("-").map(Number);
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  return addDays(first, -offset);
}

export function createCalendar(ctx: Ctx): View {
  const { app } = ctx;
  let selected = pendingFocus ?? todayISO();
  let month = firstOfMonth(selected);
  pendingFocus = null;
  let feedToken: string | null = null;
  let feedState: "idle" | "loading" | "error" = "idle";
  let resetArmed: ReturnType<typeof setTimeout> | undefined;

  const monthTitle = h("h2", { class: "cal-month" });
  const grid = h("div", { class: "cal-grid", attrs: { role: "grid", "aria-label": "Study sessions by day" } });
  const dayPanel = h("section", { class: "card cal-day", attrs: { "aria-live": "polite" } });
  const upcoming = h("section", { class: "card cal-upcoming" });
  const sync = h("section", { class: "card cal-sync" });
  const legend = h("div", { class: "cal-legend" });
  const body = h("div", { class: "cal-body" });

  const el = h(
    "div",
    { class: "page calendar-page" },
    pageHeader("Calendar", "Your study sessions across every course.", button("Import syllabus", () => ctx.openPlanWizard(), { iconName: "upload" })),
    body,
  );

  const calendarCard = h(
    "section",
    { class: "card cal-card" },
    h(
      "header",
      { class: "cal-head" },
      monthTitle,
      h(
        "div",
        { class: "row-gap" },
        button("Today", () => {
          month = firstOfMonth(todayISO());
          selected = todayISO();
          update();
        }, { size: "sm" }),
        h("button", { class: "icon-btn cal-prev", attrs: { type: "button", "aria-label": "Previous month" }, on: { click: () => ((month = shiftMonth(month, -1)), update()) } }, icon("arrowRight", 18)),
        h("button", { class: "icon-btn", attrs: { type: "button", "aria-label": "Next month" }, on: { click: () => ((month = shiftMonth(month, 1)), update()) } }, icon("arrowRight", 18)),
      ),
    ),
    h("div", { class: "cal-weekdays", attrs: { "aria-hidden": "true" } }, WEEK_LABELS.map((d) => h("span", {}, d))),
    grid,
    legend,
  );

  function update() {
    if (app.loadState !== "ready") {
      setChildren(body, h("div", { class: "skeleton card-skeleton" }));
      return;
    }
    if (!app.store.supportsPlans) {
      setChildren(body, emptyState("calendar", "Study plans need demo data or an account", "The local API stores courses only. Switch the data source to plan your study sessions."));
      return;
    }
    const { byDate, legend: legendItems } = collect(app.courses);
    if (legendItems.length === 0) {
      setChildren(
        body,
        emptyState(
          "calendar",
          "No study sessions yet",
          "Import a syllabus and choose when you'll study. Your sessions will appear here, and can sync to your own calendar.",
          button("Import syllabus", () => ctx.openPlanWizard(), { variant: "primary", iconName: "upload" }),
        ),
      );
      return;
    }

    renderGrid(byDate);
    setChildren(
      legend,
      legendItems.map(({ course, color }) =>
        h("button", { class: "cal-legend-item", attrs: { type: "button" }, on: { click: () => ctx.openCourse(course) } }, h("span", { class: `cal-dot c${color}` }), course.name),
      ),
    );
    renderDay(byDate);
    renderUpcoming(byDate);
    renderSync();
    if (!body.contains(calendarCard)) {
      setChildren(body, h("div", { class: "cal-main" }, calendarCard, dayPanel), h("aside", { class: "cal-side" }, sync, upcoming));
    }
  }

  function renderGrid(byDate: Map<string, Entry[]>) {
    monthTitle.textContent = monthLabel(month);
    const start = gridStart(month);
    const today = todayISO();
    const cells: HTMLElement[] = [];
    for (let i = 0; i < 42; i++) {
      const date = addDays(start, i);
      const entries = byDate.get(date) ?? [];
      const inMonth = date.slice(0, 7) === month.slice(0, 7);
      const label = `${formatDate(date)}: ${entries.length ? `${entries.length} session${entries.length === 1 ? "" : "s"}` : "no sessions"}`;
      cells.push(
        h(
          "button",
          {
            class: cx("cal-cell", !inMonth && "is-outside", date === today && "is-today", date === selected && "is-selected", entries.length > 0 && "has-sessions"),
            attrs: { type: "button", role: "gridcell", "aria-label": label, "aria-selected": date === selected },
            on: {
              click: () => {
                selected = date;
                if (!inMonth) month = firstOfMonth(date);
                update();
              },
            },
          },
          h("span", { class: "cal-date" }, String(Number(date.slice(8)))),
          h(
            "span",
            { class: "cal-chips" },
            entries.slice(0, 2).map((e) =>
              h(
                "span",
                {
                  class: cx("cal-chip", `c${e.color}`, e.module.done && "is-done"),
                  attrs: { title: `${formatTime(e.course.plan!.start_time)} · ${e.course.name}: ${e.module.title}` },
                },
                e.course.name,
              ),
            ),
            entries.length > 2 && h("span", { class: "cal-more" }, `+${entries.length - 2} more`),
          ),
          entries.length > 0 && h("span", { class: "cal-dots", attrs: { "aria-hidden": "true" } }, entries.slice(0, 3).map((e) => h("span", { class: `cal-dot c${e.color}` }))),
        ),
      );
    }
    grid.replaceChildren(...cells);
  }

  function entryRow(e: Entry, showDate: boolean): HTMLElement {
    const plan = e.course.plan!;
    return h(
      "li",
      {},
      h(
        "button",
        { class: cx("cal-entry", e.module.done && "is-done"), attrs: { type: "button" }, on: { click: () => ctx.openCourse(e.course) } },
        h("span", { class: `cal-bar c${e.color}` }),
        h(
          "span",
          { class: "cal-entry-main" },
          h("strong", {}, e.module.title),
          h("span", { class: "muted" }, `${e.course.name} · Module ${e.session.module + 1} of ${plan.modules.length}`),
        ),
        h(
          "span",
          { class: "cal-entry-time" },
          showDate && h("span", {}, formatDate(e.session.date)),
          h("span", { class: "muted" }, `${formatTime(plan.start_time)} · ${e.session.minutes} min`),
        ),
      ),
    );
  }

  function renderDay(byDate: Map<string, Entry[]>) {
    const entries = byDate.get(selected) ?? [];
    setChildren(
      dayPanel,
      h("h2", {}, selected === todayISO() ? `Today · ${formatDate(selected)}` : formatDate(selected)),
      entries.length
        ? h("ul", { class: "cal-list" }, entries.map((e) => entryRow(e, false)))
        : h("p", { class: "muted" }, "No study sessions this day."),
    );
  }

  function renderUpcoming(byDate: Map<string, Entry[]>) {
    const today = todayISO();
    const next = [...byDate.entries()]
      .filter(([date]) => date >= today)
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([, entries]) => entries.filter((e) => !e.module.done))
      .slice(0, 6);
    setChildren(
      upcoming,
      h("h2", {}, "Upcoming"),
      next.length ? h("ul", { class: "cal-list" }, next.map((e) => entryRow(e, true))) : h("p", { class: "muted" }, "Nothing scheduled ahead. Nice work!"),
    );
  }

  // ----------------------------------------------------- calendar sync

  function feedUrls(token: string) {
    const https = `${COACH_URL}/calendar/${token}.ics`;
    const webcal = https.replace(/^https?:/, "webcal:");
    return {
      https,
      webcal,
      google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`,
      outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent("KeepOnCourse study plan")}`,
    };
  }

  async function loadFeed(reset = false) {
    feedState = "loading";
    renderSync();
    try {
      feedToken = await app.account.calendarFeedToken(reset);
      feedState = "idle";
      if (reset) toast("New calendar link created. The old link no longer works.", { tone: "success" });
    } catch (error) {
      feedState = "error";
      toast(errorMessage(error), { tone: "error" });
    }
    renderSync();
  }

  function renderSync() {
    const signedIn = app.account.signedIn;
    const canSubscribe = accountsEnabled && COACH_URL !== "";
    const download = h(
      "button",
      {
        class: "btn btn-ghost btn-sm",
        attrs: { type: "button" },
        on: {
          click: () => {
            const count = downloadAllIcs(app.courses);
            toast(`Calendar file downloaded: ${count} session${count === 1 ? "" : "s"}.`, { tone: "success" });
          },
        },
      },
      icon("download", 16),
      h("span", {}, "Download .ics"),
    );

    if (!canSubscribe || !signedIn) {
      setChildren(
        sync,
        h("h2", {}, icon("calendarPlus", 18), "Sync with your calendar"),
        h("p", { class: "muted" }, canSubscribe ? "Sign in, then add your sessions to Google, Outlook or Apple Calendar once. New and updated plans appear there automatically." : "Download your sessions and import them into your calendar app."),
        h("div", { class: "row-gap" }, canSubscribe && button("Sign in to sync", () => ctx.openAccount(), { variant: "primary", size: "sm", iconName: "user" }), download),
      );
      return;
    }

    if (!feedToken) {
      setChildren(
        sync,
        h("h2", {}, icon("calendarPlus", 18), "Sync with your calendar"),
        h("p", { class: "muted" }, feedState === "loading" ? "Setting up your private calendar link…" : "Couldn't set up your calendar link."),
        feedState === "error" && button("Try again", () => void loadFeed(), { size: "sm", iconName: "refresh" }),
      );
      if (feedState === "idle") void loadFeed();
      return;
    }

    const urls = feedUrls(feedToken);
    const link = (href: string, label: string) =>
      h("a", { class: "btn btn-secondary btn-sm cal-sync-btn", attrs: { href, target: "_blank", rel: "noopener noreferrer" } }, h("span", {}, label));
    const resetBtn = h("button", { class: "btn btn-ghost-danger btn-sm", attrs: { type: "button" }, on: { click: onReset } }, icon(resetArmed ? "alert" : "refresh", 16), h("span", {}, resetArmed ? "Click again to reset" : "Reset link"));

    setChildren(
      sync,
      h("h2", {}, icon("calendarPlus", 18), "Sync with your calendar"),
      h("p", { class: "muted" }, "Add it once. New and updated plans then appear in your calendar automatically (calendar apps check every few hours)."),
      h("div", { class: "cal-sync-buttons" }, link(urls.google, "Google Calendar"), link(urls.outlook, "Outlook"), link(urls.webcal, "Apple Calendar")),
      h(
        "div",
        { class: "row-gap cal-sync-more" },
        h(
          "button",
          {
            class: "btn btn-ghost btn-sm",
            attrs: { type: "button" },
            on: {
              click: async () => {
                try {
                  await navigator.clipboard.writeText(urls.https);
                  toast("Calendar link copied. Keep it private: anyone with it can see your study plan.", { tone: "success" });
                } catch {
                  toast("Couldn't copy. Your browser blocked clipboard access.", { tone: "error" });
                }
              },
            },
          },
          icon("fileText", 16),
          h("span", {}, "Copy link"),
        ),
        download,
        resetBtn,
      ),
      h("p", { class: "cal-sync-note" }, icon("shield", 14), "Your link is private. Reset it if you shared it by mistake."),
    );
  }

  function onReset() {
    if (!resetArmed) {
      resetArmed = setTimeout(() => {
        resetArmed = undefined;
        renderSync();
      }, 4000);
      renderSync();
      return;
    }
    clearTimeout(resetArmed);
    resetArmed = undefined;
    void loadFeed(true);
  }

  const unsubscribeAccount = app.account.subscribe(() => {
    feedToken = null;
    feedState = "idle";
    update();
  });

  update();
  return { el, update, destroy: unsubscribeAccount };
}
