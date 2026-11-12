import { dueInfo, formatLongToday, formatTime, greeting, isOverdue, todayISO } from "../dates";
import { formatMinutes, missedSessions, studyStreak, weekProgress } from "../plan";
import { checkInControls } from "../ui/checkIn";
import { gettingStartedCard } from "../ui/gettingStarted";
import { ago, namesList } from "../ui/partnerDialog";
import { CHEERS } from "../partner";
import { readString, writeString } from "../data/storage";
import { STATUSES, STATUS_KEY, type Course } from "../types";
import {
  dueChip,
  emptyState,
  errorState,
  newCourseButton,
  pageHeader,
  skeleton,
  statusBadge,
  type Ctx,
  type View,
} from "../ui/components";
import { append, cx, h, type Child } from "../ui/dom";
import { icon, svgEl, type IconName } from "../ui/icons";

const WELCOME_KEY = "cch.welcome.dismissed";

export function createOverview(ctx: Ctx): View {
  const el = h("div", { class: "page" });

  function update() {
    el.replaceChildren(pageHeader(greeting(), formatLongToday(), newCourseButton(ctx)));
    append(el, body());
  }

  function body(): Child[] {
    const { app } = ctx;
    if (app.loadState === "loading") {
      return [h("div", { class: "kpis" }, skeleton("kpi-skeleton", 4)), h("div", { class: "overview-grid" }, skeleton("card-skeleton", 2))];
    }
    if (app.loadState === "error") return [errorState(ctx)];

    const courses = app.courses;
    // New accounts get a step-by-step start instead of an empty page
    const gettingStarted = gettingStartedCard(ctx, courses, update);
    if (courses.length === 0) {
      if (gettingStarted) return [gettingStarted];
      return [
        welcome(),
        emptyState(
          "book",
          "No courses yet",
          "Add the first thing you want to learn, and give yourself a target date.",
          newCourseButton(ctx),
        ),
      ];
    }

    const count = (status: Course["status"]) => courses.filter((c) => c.status === status).length;
    const overdue = courses.filter(isOverdue).length;

    return [
      welcome(),
      gettingStarted,
      h(
        "section",
        { class: "kpis", attrs: { "aria-label": "Summary" } },
        kpi("Total courses", courses.length, "book", "neutral"),
        kpi("In progress", count("In Progress"), "play", "ip"),
        kpi("Completed", count("Completed"), "checkCircle", "done"),
        kpi("Overdue", overdue, "alert", overdue > 0 ? "danger" : "neutral", overdue > 0 ? "Past their target date" : "You're on track"),
      ),
      studyCard(courses),
      h("div", { class: "overview-grid" }, progressCard(courses), deadlinesCard(courses)),
    ];
  }

  function welcome(): Child {
    if (ctx.app.store.kind !== "demo" || readString(WELCOME_KEY)) return null;
    const card = h(
      "section",
      { class: "welcome", attrs: { "aria-label": "Welcome" } },
      h("div", { class: "welcome-icon" }, icon("sparkles", 22)),
      h(
        "div",
        { class: "welcome-text" },
        h("h2", {}, "Welcome to KeepOnCourse"),
        h(
          "p",
          {},
          "Whatever you're learning, KeepOnCourse helps you finish it: plan your study time, track progress and deadlines, and ask Coach, your AI study coach, when you're stuck or falling behind. Your courses are saved in this browser only, and are sent out only when you chat with Coach.",
        ),
        h(
          "div",
          { class: "row-gap" },
          h("a", { class: "btn btn-primary btn-sm", attrs: { href: "#/courses" } }, h("span", {}, "Explore courses"), icon("arrowRight", 16)),
          h("a", { class: "btn btn-secondary btn-sm", attrs: { href: "#/coach" } }, icon("sparkles", 16), h("span", {}, "Ask Coach")),
          h("a", { class: "btn btn-secondary btn-sm", attrs: { href: "#/about" } }, h("span", {}, "Learn more")),
        ),
      ),
      h(
        "button",
        {
          class: "icon-btn welcome-close",
          attrs: { type: "button", "aria-label": "Dismiss welcome message" },
          on: {
            click: () => {
              writeString(WELCOME_KEY, "1");
              card.remove();
            },
          },
        },
        icon("x", 18),
      ),
    );
    return card;
  }

  function progressCard(courses: Course[]): HTMLElement {
    const total = courses.length;
    const done = courses.filter((c) => c.status === "Completed").length;
    const pct = Math.round((done / total) * 100);

    return h(
      "section",
      { class: "card" },
      h("header", { class: "card-head" }, h("h2", {}, "Progress")),
      h(
        "div",
        { class: "progress-body" },
        ring(pct),
        h(
          "div",
          { class: "progress-detail" },
          stackedBar(courses),
          h(
            "ul",
            { class: "legend" },
            STATUSES.map((status) => {
              const n = courses.filter((c) => c.status === status).length;
              return h(
                "li",
                {},
                h("span", { class: `dot dot-${STATUS_KEY[status]}` }),
                h("span", { class: "legend-label" }, status),
                h("span", { class: "legend-value" }, String(n)),
                h("span", { class: "legend-pct" }, `${Math.round((n / total) * 100)}%`),
              );
            }),
          ),
        ),
      ),
    );
  }

  /** Today's study sessions (with check-in) and plans that have fallen behind. Hidden when there's neither. */
  function studyCard(courses: Course[]): HTMLElement | null {
    const today = todayISO();
    const todays = courses.flatMap((course) =>
      (course.plan?.sessions ?? [])
        .filter((s) => s.date === today && !course.plan!.modules[s.module]?.done)
        .map((session) => ({ course, plan: course.plan!, session })),
    );
    const behind = courses
      .filter((c) => c.plan && c.status !== "Completed")
      .map((course) => ({ course, missed: missedSessions(course.plan!, today).length }))
      .filter((b) => b.missed > 0);
    const plans = courses.filter((c) => c.plan).map((c) => c.plan!);
    const week = weekProgress(plans, today);
    const streak = studyStreak(plans, today);
    if (!todays.length && !behind.length && week.total === 0) return null;

    return h(
      "section",
      { class: "card study-today", attrs: { "aria-labelledby": "study-today-title" } },
      h("header", { class: "card-head" }, h("h2", { attrs: { id: "study-today-title" } }, "Today's study"), h("a", { class: "link", attrs: { href: "#/calendar" } }, "Calendar")),
      week.total > 0 &&
        h(
          "div",
          { class: "study-week" },
          h(
            "div",
            { class: "study-week-text" },
            h("strong", {}, `This week: ${week.done} of ${week.total} session${week.total === 1 ? "" : "s"} done${week.minutes ? ` · ${formatMinutes(week.minutes)}` : ""}`),
            streak >= 2 && h("span", { class: "study-streak" }, icon("flag", 14), `${streak}-week streak`),
          ),
          weekBar(week.done, week.total),
        ),
      todays.length > 0 &&
        h(
          "ul",
          { class: "study-list" },
          todays.map(({ course, plan, session }) =>
            h(
              "li",
              { class: "study-item" },
              h(
                "button",
                { class: "study-main", attrs: { type: "button" }, on: { click: () => ctx.openCourse(course) } },
                h("strong", {}, plan.modules[session.module].title),
                h("span", { class: "muted" }, `${course.name} · ${formatTime(plan.start_time)} · ${session.minutes} min`),
              ),
              checkInControls(ctx.app, course, plan, session, today),
            ),
          ),
        ),
      !todays.length && h("p", { class: "muted" }, "No study sessions today."),
      behind.length > 0 &&
        h(
          "ul",
          { class: "study-list study-behind" },
          behind.map(({ course, missed }) =>
            h(
              "li",
              { class: "study-item" },
              h(
                "span",
                { class: "study-main" },
                h("strong", {}, course.name),
                h("span", { class: "study-missed" }, icon("alert", 14), `${missed} missed session${missed === 1 ? "" : "s"}`),
              ),
              h("button", { class: "btn btn-secondary btn-sm", attrs: { type: "button" }, on: { click: () => ctx.openCatchUp(course) } }, icon("refresh", 15), h("span", {}, "Catch up")),
            ),
          ),
        ),
      partnerRow(),
    );
  }

  /** Who this progress is shared with, and the latest cheer; or an invitation to add a partner. */
  function partnerRow(): Child {
    const account = ctx.app.account.state;
    if (!ctx.openPartners || account.status === "disabled" || account.status === "loading") return null;
    if (account.status !== "signed-in") {
      return h(
        "div",
        { class: "study-partners" },
        h("span", { class: "study-partners-icon" }, icon("users", 16)),
        h("span", { class: "study-partners-text muted" }, "Sign in to share your progress with a study partner."),
        h("button", { class: "btn btn-ghost btn-sm", attrs: { type: "button" }, on: { click: () => ctx.openAccount() } }, "Sign in"),
      );
    }
    const invites = ctx.partners?.invites;
    if (!invites) return null;
    const weekAgo = Date.now() - 7 * 86_400_000;
    const cheer = ctx.partners?.cheers.find((c) => new Date(c.created_at).getTime() > weekAgo);
    return h(
      "div",
      { class: "study-partners" },
      h("span", { class: "study-partners-icon" }, icon("users", 16)),
      h(
        "span",
        { class: "study-partners-text" },
        invites.length ? h("strong", {}, `Shared with ${namesList(invites.map((i) => i.label))}`) : h("span", { class: "muted" }, "Studying is easier when someone is following along."),
        cheer && h("span", { class: "muted" }, `${CHEERS[cheer.kind].emoji} ${cheer.from} cheered you on ${ago(cheer.created_at)}`),
      ),
      h(
        "button",
        { class: "btn btn-secondary btn-sm", attrs: { type: "button" }, on: { click: () => ctx.openPartners?.() } },
        invites.length ? h("span", {}, "Study partners") : [icon("plus", 15), h("span", {}, "Add a study partner")],
      ),
    );
  }

  function weekBar(done: number, total: number): HTMLElement {
    const pct = total ? Math.round((done / total) * 100) : 0;
    const fill = h("span", {});
    fill.style.width = `${pct}%`; // CSSOM, allowed by the strict CSP
    return h("div", { class: "progress-bar", attrs: { role: "progressbar", "aria-label": "Sessions done this week", "aria-valuemin": 0, "aria-valuemax": total, "aria-valuenow": done } }, fill);
  }

  function deadlinesCard(courses: Course[]): HTMLElement {
    const upcoming = courses
      .filter((c) => c.status !== "Completed")
      .sort((a, b) => a.target_date.localeCompare(b.target_date))
      .slice(0, 5);

    return h(
      "section",
      { class: "card" },
      h(
        "header",
        { class: "card-head" },
        h("h2", {}, "Upcoming deadlines"),
        h("a", { class: "link", attrs: { href: "#/courses" } }, "View all"),
      ),
      upcoming.length === 0
        ? h("p", { class: "muted card-empty" }, "Nothing due. Every course is complete. 🎉")
        : h(
            "ul",
            { class: "deadlines" },
            upcoming.map((course) =>
              h(
                "li",
                {},
                h(
                  "button",
                  {
                    class: cx("deadline", dueInfo(course).tone === "overdue" && "is-overdue"),
                    attrs: { type: "button" },
                    on: { click: () => ctx.openCourse(course) },
                  },
                  h("span", { class: "deadline-main" }, h("span", { class: "deadline-name" }, course.name), statusBadge(course.status)),
                  dueChip(course),
                ),
              ),
            ),
          ),
    );
  }

  update();
  return { el, update };
}

function kpi(label: string, value: number, iconName: IconName, tone: string, hint?: string): HTMLElement {
  return h(
    "div",
    { class: `kpi kpi-${tone}` },
    h("div", { class: "kpi-top" }, h("span", { class: "kpi-label" }, label), h("span", { class: "kpi-icon" }, icon(iconName, 18))),
    h("div", { class: "kpi-value" }, String(value)),
    hint && h("div", { class: "kpi-hint" }, hint),
  );
}

/** Completion ring. Its geometry is set through the CSSOM, which the strict CSP allows. */
function ring(pct: number): HTMLElement {
  const r = 52;
  const c = 2 * Math.PI * r;
  const svg = svgEl("svg", { viewBox: "0 0 120 120", width: 132, height: 132, "aria-hidden": "true" });
  const track = svgEl("circle", { cx: 60, cy: 60, r, class: "ring-track" });
  const value = svgEl("circle", { cx: 60, cy: 60, r, class: "ring-value" });
  value.style.strokeDasharray = String(c);
  value.style.strokeDashoffset = String(c * (1 - pct / 100));
  svg.append(track, value);
  return h(
    "div",
    { class: "ring", attrs: { role: "img", "aria-label": `${pct}% of courses completed` } },
    svg,
    h("div", { class: "ring-center" }, h("span", { class: "ring-pct" }, `${pct}%`), h("span", { class: "ring-label" }, "complete")),
  );
}

function stackedBar(courses: Course[]): HTMLElement {
  const bar = h("div", { class: "stacked-bar", attrs: { "aria-hidden": "true" } });
  for (const status of STATUSES) {
    const n = courses.filter((c) => c.status === status).length;
    if (n === 0) continue;
    const seg = h("span", { class: `seg seg-${STATUS_KEY[status]}` });
    seg.style.flexGrow = String(n);
    bar.appendChild(seg);
  }
  return bar;
}
