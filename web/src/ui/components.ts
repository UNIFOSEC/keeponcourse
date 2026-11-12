import { errorMessage, type App } from "../app";
import type { PartnersState } from "./partnerDialog";
import type { CoachSession } from "../coach/session";
import { dueInfo } from "../dates";
import { STATUS_KEY, type Course, type Status } from "../types";
import { cx, h, type Child } from "./dom";
import { icon, type IconName } from "./icons";
import { toast } from "./toast";

/** Things views can ask the shell to do. */
export interface Ctx {
  app: App;
  coach: CoachSession;
  openCourse(course?: Course): void;
  openSettings(): void;
  openAccount(): void;
  /** Import a syllabus / build a study plan, for a new course or an existing one. */
  openPlanWizard(course?: Course): void;
  /** Reschedule the rest of a study plan from today, after missed sessions. */
  openCatchUp(course: Course): void;
  /** Study partners (signed-in users): the dialog, and who progress is shared with. */
  openPartners?(): void;
  partners?: PartnersState;
}

export interface View {
  el: HTMLElement;
  update(): void;
  focusSearch?(): void;
  /** Called when the view is replaced, to drop subscriptions. */
  destroy?(): void;
}

export function pageHeader(title: string, subtitle: Child, actions?: Child): HTMLElement {
  return h(
    "header",
    { class: "page-header" },
    h("div", {}, h("h1", { class: "page-title" }, title), subtitle && h("p", { class: "page-subtitle" }, subtitle)),
    actions && h("div", { class: "page-actions" }, actions),
  );
}

export function button(
  label: string,
  onClick: () => void,
  { variant = "secondary", iconName, size }: { variant?: "primary" | "secondary" | "ghost" | "danger"; iconName?: IconName; size?: "sm" } = {},
): HTMLButtonElement {
  return h(
    "button",
    { class: cx("btn", `btn-${variant}`, size && `btn-${size}`), attrs: { type: "button" }, on: { click: onClick } },
    iconName && icon(iconName, size === "sm" ? 16 : 18),
    h("span", {}, label),
  );
}

export function iconButton(iconName: IconName, label: string, onClick: () => void, tone?: "danger"): HTMLButtonElement {
  return h(
    "button",
    {
      class: cx("icon-btn", tone && `icon-btn-${tone}`),
      attrs: { type: "button", "aria-label": label, title: label },
      on: { click: onClick },
    },
    icon(iconName, 17),
  );
}

export function newCourseButton(ctx: Ctx): HTMLButtonElement {
  const btn = button("New course", () => ctx.openCourse(), { variant: "primary", iconName: "plus" });
  btn.append(h("kbd", { class: "kbd-hint", attrs: { "aria-hidden": "true" } }, "N"));
  btn.setAttribute("aria-keyshortcuts", "N");
  return btn;
}

export function statusBadge(status: Status): HTMLElement {
  const key = STATUS_KEY[status];
  return h("span", { class: `badge badge-${key}` }, h("span", { class: `dot dot-${key}` }), status);
}

export function dueChip(course: Course): HTMLElement {
  const { text, tone } = dueInfo(course);
  const iconName: IconName = tone === "overdue" ? "alert" : tone === "done" ? "check" : "clock";
  return h("span", { class: `chip chip-${tone}` }, icon(iconName, 14), text);
}

export function emptyState(iconName: IconName, title: string, text: string, action?: Child): HTMLElement {
  return h(
    "div",
    { class: "empty-state" },
    h("div", { class: "empty-icon" }, icon(iconName, 26)),
    h("h2", {}, title),
    h("p", {}, text),
    action,
  );
}

export function errorState(ctx: Ctx): HTMLElement {
  return h(
    "div",
    { class: "empty-state error-state", attrs: { role: "alert" } },
    h("div", { class: "empty-icon" }, icon("server", 26)),
    h("h2", {}, "Couldn't load your courses"),
    h("p", {}, ctx.app.loadError),
    h(
      "div",
      { class: "row-gap" },
      button("Try again", () => void ctx.app.load(), { variant: "primary", iconName: "refresh" }),
      button("Change data source", () => ctx.openSettings(), { iconName: "database" }),
    ),
  );
}

export function skeleton(className: string, count = 1): HTMLElement[] {
  return Array.from({ length: count }, () => h("div", { class: cx("skeleton", className), attrs: { "aria-hidden": "true" } }));
}

/** Remove a course right away and offer Undo, instead of an "are you sure?" dialog. */
export async function removeWithUndo(app: App, course: Course): Promise<void> {
  try {
    await app.remove(course);
    toast(`Removed "${course.name}"`, {
      action: {
        label: "Undo",
        run: () => {
          app.restore(course).then(
            () => toast("Course restored", { tone: "success" }),
            (error) => toast(errorMessage(error), { tone: "error" }),
          );
        },
      },
    });
  } catch (error) {
    toast(errorMessage(error), { tone: "error" });
  }
}
