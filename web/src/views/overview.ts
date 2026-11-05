import { dueInfo, formatLongToday, greeting, isOverdue } from "../dates";
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
    if (courses.length === 0) {
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
      h(
        "section",
        { class: "kpis", attrs: { "aria-label": "Summary" } },
        kpi("Total courses", courses.length, "book", "neutral"),
        kpi("In progress", count("In Progress"), "play", "ip"),
        kpi("Completed", count("Completed"), "checkCircle", "done"),
        kpi("Overdue", overdue, "alert", overdue > 0 ? "danger" : "neutral", overdue > 0 ? "Past their target date" : "You're on track"),
      ),
      h("div", { class: "overview-grid" }, progressCard(courses), deadlinesCard(courses)),
    ];
  }

  function welcome(): Child {
    if (ctx.app.settings.source !== "demo" || readString(WELCOME_KEY)) return null;
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
          h("a", { class: "btn btn-secondary btn-sm", attrs: { href: "#/about" } }, h("span", {}, "How it's built")),
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
