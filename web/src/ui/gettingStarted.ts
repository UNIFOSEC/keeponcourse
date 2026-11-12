import { readString, writeString } from "../data/storage";
import { canInstall, isInstalled, promptInstall } from "../install";
import type { Course } from "../types";
import type { Ctx } from "./components";
import { cx, h } from "./dom";
import { icon, type IconName } from "./icons";

/**
 * "Getting started" on the Overview for a new account: six steps from an
 * empty list to a working routine, with someone following along. Each ticks itself off as it's done; the
 * card disappears when all are done, or when hidden.
 */

const hiddenKey = (userId: string) => `koc.gettingStarted.hidden.${userId}`;

/** The weekly-email setting, fetched once per account per page load. */
const weekly = new Map<string, boolean | "loading">();

interface Step {
  done: boolean;
  icon: IconName;
  title: string;
  text: string;
  action?: HTMLElement | false;
}

export function gettingStartedCard(ctx: Ctx, courses: Course[], rerender: () => void): HTMLElement | null {
  const account = ctx.app.account;
  const state = account.state;
  if (state.status !== "signed-in" || ctx.app.store.kind !== "account" || readString(hiddenKey(state.userId))) return null;

  if (!weekly.has(state.userId)) {
    weekly.set(state.userId, "loading");
    account.weeklyCheckin().then(
      (on) => {
        weekly.set(state.userId, on);
        rerender();
      },
      () => weekly.set(state.userId, false),
    );
  }
  const weeklyOn = weekly.get(state.userId) === true;

  const unplanned = courses.find((c) => !c.plan && c.status !== "Completed");
  const steps: Step[] = [
    {
      done: courses.length > 0,
      icon: "book",
      title: "Add the course you're taking",
      text: "Import its syllabus to get modules straight away, or add the basics yourself.",
      action: h(
        "span",
        { class: "row-gap" },
        h("button", { class: "btn btn-primary btn-sm", attrs: { type: "button" }, on: { click: () => ctx.openPlanWizard() } }, icon("upload", 15), h("span", {}, "Import a syllabus")),
        h("button", { class: "btn btn-secondary btn-sm", attrs: { type: "button" }, on: { click: () => ctx.openCourse() } }, h("span", {}, "Add it myself")),
      ),
    },
    {
      done: courses.some((c) => c.plan),
      icon: "calendarPlus",
      title: "Make a study plan",
      text: "Pick your study days, session length and time; KeepOnCourse schedules every session.",
      action: unplanned
        ? h("button", { class: "btn btn-secondary btn-sm", attrs: { type: "button" }, on: { click: () => ctx.openPlanWizard(unplanned) } }, h("span", {}, `Plan “${unplanned.name}”`))
        : false,
    },
    {
      done: courses.some((c) => c.plan?.sessions.some((s) => s.status === "done")),
      icon: "checkCircle",
      title: "Check in your first session",
      text: "After you study, mark the session Done. That's what builds your streak.",
      action: h("a", { class: "btn btn-secondary btn-sm", attrs: { href: "#/calendar" } }, h("span", {}, "Open the calendar")),
    },
    {
      done: weeklyOn,
      icon: "mail",
      title: "Turn on the weekly check-in",
      text: "A short email every Monday with your study week and anything to catch up on.",
      action: h("button", { class: "btn btn-secondary btn-sm", attrs: { type: "button" }, on: { click: () => ctx.openAccount() } }, h("span", {}, "Turn it on")),
    },
    ...(ctx.openPartners
      ? [
          {
            done: (ctx.partners?.invites?.length ?? 0) > 0,
            icon: "users" as const,
            title: "Invite a study partner",
            text: "Share your progress with a friend or mentor. They can cheer you on, with no account needed.",
            action: h("button", { class: "btn btn-secondary btn-sm", attrs: { type: "button" }, on: { click: () => ctx.openPartners?.() } }, icon("plus", 15), h("span", {}, "Invite someone")),
          },
        ]
      : []),
    {
      done: isInstalled(),
      icon: "download",
      title: "Put KeepOnCourse on your phone",
      text: "Install it from your browser, so checking in is one tap away.",
      action: canInstall()
        ? h("button", { class: "btn btn-secondary btn-sm", attrs: { type: "button" }, on: { click: () => void promptInstall().then(rerender) } }, h("span", {}, "Install app"))
        : h("a", { class: "btn btn-secondary btn-sm", attrs: { href: "#/about" } }, h("span", {}, "How to install")),
    },
  ];

  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const next = steps.findIndex((s) => !s.done);

  const fill = h("span", {});
  fill.style.width = `${Math.round((done / steps.length) * 100)}%`;

  return h(
    "section",
    { class: "card getting-started", attrs: { "aria-labelledby": "getting-started-title" } },
    h(
      "header",
      { class: "card-head" },
      h("div", {}, h("h2", { attrs: { id: "getting-started-title" } }, "Getting started"), h("p", { class: "muted" }, `${done} of ${steps.length} done`)),
      h(
        "button",
        {
          class: "btn btn-ghost btn-sm",
          attrs: { type: "button" },
          on: {
            click: () => {
              writeString(hiddenKey(state.userId), "1");
              rerender();
            },
          },
        },
        "Hide",
      ),
    ),
    h("div", { class: "progress-bar", attrs: { role: "progressbar", "aria-label": "Getting started", "aria-valuemin": 0, "aria-valuemax": steps.length, "aria-valuenow": done } }, fill),
    h(
      "ol",
      { class: "gs-steps" },
      steps.map((step, i) =>
        h(
          "li",
          { class: cx("gs-step", step.done && "is-done", i === next && "is-next") },
          h("span", { class: "gs-mark", attrs: { "aria-hidden": "true" } }, icon(step.done ? "check" : step.icon, 16)),
          h(
            "div",
            { class: "gs-body" },
            h("strong", {}, step.title, step.done && h("span", { class: "sr-only" }, " (done)")),
            i === next && h("p", { class: "muted" }, step.text),
            i === next && step.action,
          ),
        ),
      ),
    ),
  );
}
