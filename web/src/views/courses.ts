import { errorMessage } from "../app";
import { formatDate } from "../dates";
import { readString, writeString } from "../data/storage";
import { STATUSES, STATUS_KEY, type Course, type Status } from "../types";
import {
  button,
  dueChip,
  emptyState,
  errorState,
  iconButton,
  newCourseButton,
  pageHeader,
  removeWithUndo,
  skeleton,
  statusBadge,
  type Ctx,
  type View,
} from "../ui/components";
import { cx, h } from "../ui/dom";
import { icon } from "../ui/icons";
import { progress } from "../plan";
import { toast } from "../ui/toast";

type Mode = "board" | "list";
const MODE_KEY = "cch.courses.view";

export function createCourses(ctx: Ctx): View {
  let query = "";
  let filter: Status | "" = "";
  let mode: Mode = readString(MODE_KEY) === "list" ? "list" : "board";
  let draggingId: number | null = null;

  const search = h("input", {
    class: "input search-input",
    attrs: { type: "search", placeholder: "Search courses", "aria-label": "Search courses", "aria-keyshortcuts": "/" },
    on: {
      input: () => {
        query = search.value.trim().toLowerCase();
        renderResults();
      },
    },
  });

  const filterSelect = h(
    "select",
    {
      class: "input select",
      attrs: { "aria-label": "Filter by status" },
      on: {
        change: () => {
          filter = filterSelect.value as Status | "";
          renderResults();
        },
      },
    },
    h("option", { attrs: { value: "" } }, "All statuses"),
    STATUSES.map((s) => h("option", { attrs: { value: s } }, s)),
  );

  const modeButtons = (["board", "list"] as const).map((m) =>
    h(
      "button",
      {
        class: "segment",
        attrs: { type: "button" },
        on: {
          click: () => {
            mode = m;
            writeString(MODE_KEY, m);
            renderResults();
          },
        },
      },
      icon(m === "board" ? "board" : "list", 17),
      h("span", {}, m === "board" ? "Board" : "List"),
    ),
  );

  const count = h("span", {});
  const results = h("div", { class: "results" });

  const el = h(
    "div",
    { class: "page" },
    pageHeader("Courses", count, [
      button("Import syllabus", () => ctx.openPlanWizard(), { iconName: "upload" }),
      newCourseButton(ctx),
    ]),
    h(
      "div",
      { class: "toolbar" },
      h("div", { class: "search" }, icon("search", 18), search, h("kbd", { attrs: { "aria-hidden": "true" } }, "/")),
      filterSelect,
      h("div", { class: "segmented", attrs: { role: "group", "aria-label": "View" } }, modeButtons),
    ),
    results,
  );

  function matches(course: Course): boolean {
    return !query || course.name.toLowerCase().includes(query) || course.description.toLowerCase().includes(query);
  }

  function renderResults() {
    const { app } = ctx;
    modeButtons.forEach((btn, i) => btn.setAttribute("aria-pressed", String((i === 0 ? "board" : "list") === mode)));
    // The board already groups by status, so the status filter only applies to the list
    filterSelect.hidden = mode === "board";

    const total = app.courses.length;
    count.textContent = app.loadState === "ready" ? `${total} course${total === 1 ? "" : "s"}` : "";

    if (app.loadState === "loading") {
      results.replaceChildren(h("div", { class: "board" }, skeleton("column-skeleton", 3)));
      return;
    }
    if (app.loadState === "error") {
      results.replaceChildren(errorState(ctx));
      return;
    }
    if (total === 0) {
      results.replaceChildren(
        emptyState("book", "No courses yet", "Add the first thing you want to learn. Press N anytime.", newCourseButton(ctx)),
      );
      return;
    }

    const visible = app.courses
      .filter(matches)
      .filter((c) => mode === "board" || !filter || c.status === filter)
      .sort((a, b) => a.target_date.localeCompare(b.target_date));

    if (visible.length === 0) {
      results.replaceChildren(
        emptyState(
          "search",
          "No matching courses",
          query ? `Nothing matches "${search.value.trim()}".` : "No courses have this status.",
          button("Clear filters", clearFilters, { iconName: "x" }),
        ),
      );
      return;
    }

    results.replaceChildren(mode === "board" ? board(visible) : list(visible));
  }

  function clearFilters() {
    query = "";
    filter = "";
    search.value = "";
    filterSelect.value = "";
    renderResults();
    search.focus();
  }

  // ---------------------------------------------------------------- board

  function board(courses: Course[]): HTMLElement {
    return h("div", { class: "board" }, STATUSES.map((status) => column(status, courses.filter((c) => c.status === status))));
  }

  function column(status: Status, items: Course[]): HTMLElement {
    const key = STATUS_KEY[status];
    const col = h(
      "section",
      {
        class: `column column-${key}`,
        attrs: { "aria-label": `${status}: ${items.length} course${items.length === 1 ? "" : "s"}` },
        on: {
          dragover: (event) => {
            if (draggingId === null) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
            col.classList.add("drop-target");
          },
          dragleave: (event) => {
            if (!col.contains(event.relatedTarget as Node | null)) col.classList.remove("drop-target");
          },
          drop: (event) => {
            event.preventDefault();
            col.classList.remove("drop-target");
            const id = draggingId;
            draggingId = null;
            if (id !== null) void moveTo(id, status);
          },
        },
      },
      h(
        "header",
        { class: "column-head" },
        h("span", { class: `dot dot-${key}` }),
        h("h2", {}, status),
        h("span", { class: "column-count" }, String(items.length)),
      ),
      h(
        "div",
        { class: "column-body" },
        items.length ? items.map(card) : h("div", { class: "column-empty" }, query ? "No matches" : "Drop a course here"),
      ),
    );
    return col;
  }

  function card(course: Course): HTMLElement {
    return h(
      "article",
      {
        class: "course-card",
        attrs: {
          tabindex: 0,
          role: "button",
          draggable: "true",
          "aria-label": `${course.name}. ${course.status}. Press Enter to edit.`,
        },
        on: {
          click: () => ctx.openCourse(course),
          keydown: (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              ctx.openCourse(course);
            }
          },
          dragstart: (event) => {
            draggingId = course.id;
            event.dataTransfer?.setData("text/plain", String(course.id));
            if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
            (event.currentTarget as HTMLElement).classList.add("dragging");
          },
          dragend: (event) => {
            draggingId = null;
            (event.currentTarget as HTMLElement).classList.remove("dragging");
            el.querySelectorAll(".drop-target").forEach((c) => c.classList.remove("drop-target"));
          },
        },
      },
      h("h3", { class: "card-title" }, course.name),
      h("p", { class: "card-desc" }, course.description),
      course.plan && planBar(course),
      h("footer", { class: "card-foot" }, dueChip(course), h("span", { class: "card-id" }, `#${course.id}`)),
    );
  }

  async function moveTo(id: number, status: Status) {
    try {
      if (await ctx.app.move(id, status)) toast(`Moved to ${status}`, { tone: "success" });
    } catch (error) {
      toast(errorMessage(error), { tone: "error" });
    }
  }

  // ----------------------------------------------------------------- list

  function list(courses: Course[]): HTMLElement {
    return h(
      "div",
      { class: "list card" },
      h(
        "div",
        { class: "list-head", attrs: { "aria-hidden": "true" } },
        h("span", {}, "Course"),
        h("span", {}, "Status"),
        h("span", {}, "Target date"),
        h("span", {}),
      ),
      h(
        "ul",
        { class: "list-rows" },
        courses.map((course) =>
          h(
            "li",
            { class: "list-row" },
            h(
              "button",
              { class: "row-main", attrs: { type: "button" }, on: { click: () => ctx.openCourse(course) } },
              h("span", { class: "row-title" }, course.name),
              h("span", { class: "row-desc" }, course.description),
            ),
            h("div", { class: "row-status" }, statusBadge(course.status)),
            h(
              "div",
              { class: cx("row-date") },
              h("span", { class: "row-date-text" }, formatDate(course.target_date)),
              dueChip(course),
            ),
            h(
              "div",
              { class: "row-actions" },
              iconButton("pencil", `Edit ${course.name}`, () => ctx.openCourse(course)),
              iconButton("trash", `Remove ${course.name}`, () => void removeWithUndo(ctx.app, course), "danger"),
            ),
          ),
        ),
      ),
    );
  }

  renderResults();
  return { el, update: renderResults, focusSearch: () => search.focus() };
}

/** Small progress bar for courses with a study plan. */
function planBar(course: Course): HTMLElement | null {
  if (!course.plan) return null;
  const { done, total, pct } = progress(course.plan);
  const fill = h("span", {});
  fill.style.width = `${pct}%`;
  return h(
    "div",
    { class: "card-plan", attrs: { "aria-label": `Study plan: ${done} of ${total} modules done` } },
    h("div", { class: "progress-bar progress-bar-sm" }, fill),
    h("span", { class: "card-plan-text" }, `${done}/${total}`),
  );
}
