import { errorMessage, type App } from "../app";
import { formatDate } from "../dates";
import { downloadIcs } from "../ics";
import { nextSession, progress, type StudyPlan } from "../plan";
import type { Course } from "../types";
import { cx, h, setChildren } from "./dom";
import { icon } from "./icons";
import { toast } from "./toast";

function formatTime(hhmm: string): string {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hours, minutes));
}

/**
 * The "Study plan" part of the course panel: progress, a module checklist
 * (ticking saves right away), the next session, calendar export, rebuild and
 * remove. For a new course it offers to import a syllabus instead.
 */
export function createPlanSection(app: App, { planCourse }: { planCourse: (course?: Course) => void }) {
  const el = h("section", { class: "plan-section", attrs: { "aria-labelledby": "plan-section-title" } });
  let courseId: number | null = null;
  let isNew = false;
  let removeArmed: ReturnType<typeof setTimeout> | undefined;
  let saving = false;

  app.subscribe(() => {
    if (courseId !== null && !saving) render();
  });

  function show(course: Course | null) {
    courseId = course?.id ?? null;
    isNew = !course;
    clearTimeout(removeArmed);
    removeArmed = undefined;
    render();
  }

  function render() {
    if (!app.store.supportsPlans) {
      el.hidden = true;
      return;
    }
    el.hidden = false;

    if (isNew) {
      setChildren(
        el,
        h(
          "button",
          { class: "plan-import-hint", attrs: { type: "button" }, on: { click: () => planCourse() } },
          icon("fileText", 18),
          h("span", {}, h("strong", {}, "Have a syllabus?"), " Import it to get modules and a study schedule."),
        ),
      );
      return;
    }

    const course = app.courses.find((c) => c.id === courseId);
    if (!course) {
      setChildren(el);
      return;
    }

    if (!course.plan) {
      setChildren(
        el,
        h("h3", { class: "plan-section-heading", attrs: { id: "plan-section-title" } }, "Study plan"),
        h("p", { class: "muted" }, "Break this course into modules and schedule your study sessions."),
        h(
          "button",
          { class: "btn btn-secondary btn-sm", attrs: { type: "button" }, on: { click: () => planCourse(course) } },
          icon("calendarPlus", 16),
          h("span", {}, "Create a study plan"),
        ),
      );
      return;
    }

    const plan = course.plan;
    const { done, total, pct } = progress(plan);
    const next = nextSession(plan);
    const bar = h("div", { class: "progress-bar", attrs: { role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct, "aria-label": "Modules completed" } });
    const fill = h("span", {});
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);

    const removeBtn = h(
      "button",
      { class: "btn btn-ghost-danger btn-sm", attrs: { type: "button" }, on: { click: () => onRemove(course) } },
      icon(removeArmed ? "alert" : "trash", 16),
      h("span", {}, removeArmed ? "Click again to remove" : "Remove plan"),
    );

    setChildren(
      el,
      h(
        "div",
        { class: "plan-section-top" },
        h("h3", { class: "plan-section-heading", attrs: { id: "plan-section-title" } }, "Study plan"),
        h("span", { class: "muted" }, `${done} of ${total} modules · ${pct}%`),
      ),
      bar,
      h(
        "p",
        { class: "plan-next" },
        icon(next ? "clock" : "checkCircle", 16),
        next
          ? h("span", {}, "Next: ", h("strong", {}, `${formatDate(next.date)}, ${formatTime(plan.start_time)}`), ` · ${plan.modules[next.module].title}`)
          : h("span", {}, done === total ? "All modules done. Nice work!" : "No more sessions scheduled. Rebuild the plan to schedule the rest."),
      ),
      h(
        "ul",
        { class: "plan-checklist" },
        plan.modules.map((module, index) => {
          const box = h("input", {
            attrs: { type: "checkbox", id: `plan-mod-${index}`, checked: module.done },
            on: { change: () => toggle(course, plan, index, box.checked) },
          });
          return h(
            "li",
            { class: cx(module.done && "is-done") },
            box,
            h("label", { attrs: { for: `plan-mod-${index}` } }, h("span", {}, module.title), h("span", { class: "muted" }, `${module.hours} h`)),
          );
        }),
      ),
      h(
        "div",
        { class: "row-gap" },
        h(
          "button",
          {
            class: "btn btn-secondary btn-sm",
            attrs: { type: "button", disabled: !next },
            on: {
              click: () => {
                const count = downloadIcs(course, plan);
                toast(`Calendar file downloaded: ${count} session${count === 1 ? "" : "s"}. Open it to add them to your calendar.`, { tone: "success" });
              },
            },
          },
          icon("calendarPlus", 16),
          h("span", {}, "Add to calendar"),
        ),
        h(
          "button",
          { class: "btn btn-secondary btn-sm", attrs: { type: "button" }, on: { click: () => planCourse(course) } },
          icon("refresh", 16),
          h("span", {}, "Rebuild"),
        ),
        h("span", { class: "spacer" }),
        removeBtn,
      ),
    );
  }

  async function toggle(course: Course, plan: StudyPlan, index: number, checked: boolean) {
    const updated: StudyPlan = { ...plan, modules: plan.modules.map((m, i) => (i === index ? { ...m, done: checked } : m)) };
    saving = true;
    try {
      const saved = await app.update(course.id, { plan: updated });
      const finished = saved.plan && progress(saved.plan).done === saved.plan.modules.length;
      if (finished && saved.status !== "Completed") {
        toast("Every module is done!", {
          tone: "success",
          action: { label: "Mark course completed", run: () => void app.update(course.id, { status: "Completed" }).catch((e) => toast(errorMessage(e), { tone: "error" })) },
        });
      }
    } catch (error) {
      toast(errorMessage(error), { tone: "error" });
    } finally {
      saving = false;
      render();
    }
  }

  async function onRemove(course: Course) {
    if (!removeArmed) {
      removeArmed = setTimeout(() => {
        removeArmed = undefined;
        render();
      }, 4000);
      render();
      return;
    }
    clearTimeout(removeArmed);
    removeArmed = undefined;
    try {
      await app.update(course.id, { plan: null });
      toast("Study plan removed", { tone: "success" });
    } catch (error) {
      toast(errorMessage(error), { tone: "error" });
    }
  }

  return { el, show };
}
