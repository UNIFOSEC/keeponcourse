import { errorMessage, type App } from "../app";
import { daysUntil, formatDate, todayISO } from "../dates";
import { catchUp, finishDate, missedSessions, SESSION_LENGTHS, WEEKDAYS, type StudyPlan } from "../plan";
import type { Course } from "../types";
import { h, setChildren } from "./dom";
import { icon } from "./icons";
import { toast } from "./toast";

/**
 * "Catch up": reschedules the work left in a study plan from today, after
 * missed sessions. The learner can add study days or change the session
 * length and sees the new finish date against their target before saving;
 * if it's later, they can move the target date too. Undo restores the old
 * plan and target date.
 */
export function createCatchUpDialog(app: App) {
  let course: Course | null = null;
  let days: number[] = [];
  let sessionMinutes = 60;
  let moveTarget = false;
  let busy = false;

  const title = h("h2", { attrs: { id: "catchup-title" } });
  const body = h("div", { class: "modal-body catchup" });
  const foot = h("footer", { class: "modal-foot" });

  const dialog = h(
    "dialog",
    {
      class: "modal",
      attrs: { "aria-labelledby": "catchup-title" },
      on: {
        click: (event) => {
          if (event.target === dialog && !busy) dialog.close();
        },
        cancel: (event) => {
          if (busy) event.preventDefault();
        },
      },
    },
    h(
      "div",
      { class: "modal-form" },
      h(
        "header",
        { class: "modal-head" },
        title,
        h("button", { class: "icon-btn", attrs: { type: "button", "aria-label": "Close" }, on: { click: () => !busy && dialog.close() } }, icon("x", 18)),
      ),
      body,
      foot,
    ),
  );

  function preview(plan: StudyPlan): StudyPlan {
    return catchUp(plan, { today: todayISO(), days, sessionMinutes });
  }

  function render() {
    if (!course?.plan) return;
    const plan = course.plan;
    const missed = missedSessions(plan).length;
    title.textContent = `Catch up on “${course.name}”`;

    const dayButtons = WEEKDAYS.map((label, day) =>
      h(
        "button",
        {
          class: "day-chip",
          attrs: { type: "button", "aria-pressed": days.includes(day) },
          on: {
            click: () => {
              days = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort();
              render();
            },
          },
        },
        label,
      ),
    );
    const lengthSelect = h(
      "select",
      { class: "input select", attrs: { id: "catchup-length" }, on: { change: () => ((sessionMinutes = Number(lengthSelect.value)), render()) } },
      SESSION_LENGTHS.map((n) => h("option", { attrs: { value: n, selected: n === sessionMinutes } }, n < 60 ? `${n} min` : n === 60 ? "1 hour" : `${n / 60} hours`)),
    );

    const next = days.length ? preview(plan) : null;
    const end = next ? finishDate(next) : null;
    const remaining = next ? next.sessions.filter((s) => !s.status && s.date >= todayISO()).length : 0;
    const late = end ? daysUntil(course.target_date, end) : 0; // negative: finishes after the target
    if (end && late >= 0) moveTarget = false;

    const summary = !days.length
      ? h("p", { class: "field-error", attrs: { role: "alert" } }, "Pick at least one study day.")
      : remaining === 0
        ? h("p", {}, "There's nothing left to schedule: every module is done or has its time checked in.")
        : h(
            "div",
            { class: "catchup-summary", attrs: { "aria-live": "polite" } },
            h("p", {}, `${remaining} session${remaining === 1 ? "" : "s"} from today, finishing `, h("strong", {}, formatDate(end!)), "."),
            late >= 0
              ? h("p", { class: "catchup-ok" }, icon("checkCircle", 16), late === 0 ? "That's on your target date." : `That's ${late} day${late === 1 ? "" : "s"} before your target date.`)
              : h(
                  "div",
                  { class: "catchup-late" },
                  h("p", {}, icon("alert", 16), `That's ${-late} day${late === -1 ? "" : "s"} after your target date (${formatDate(course.target_date)}). Add a study day or longer sessions to finish sooner, or move the target.`),
                  h(
                    "label",
                    { class: "catchup-move" },
                    h("input", {
                      attrs: { type: "checkbox", checked: moveTarget },
                      on: { change: (event) => (moveTarget = (event.target as HTMLInputElement).checked) },
                    }),
                    `Move my target date to ${formatDate(end!)}`,
                  ),
                ),
          );

    setChildren(
      body,
      h(
        "p",
        {},
        missed > 0
          ? `You missed ${missed} session${missed === 1 ? "" : "s"}. No problem: this moves the work that's left so it starts today. What you've done stays done, and missed sessions are kept as skipped.`
          : "This moves the work that's left so it starts today. What you've done stays done.",
      ),
      h("div", { class: "field" }, h("span", { class: "field-label", attrs: { id: "catchup-days-label" } }, "Study days"), h("div", { class: "day-chips", attrs: { role: "group", "aria-labelledby": "catchup-days-label" } }, dayButtons)),
      h("div", { class: "field" }, h("label", { class: "field-label", attrs: { for: "catchup-length" } }, "Session length"), lengthSelect),
      summary,
    );

    const save = h(
      "button",
      { class: "btn btn-primary", attrs: { type: "button", disabled: !next || remaining === 0 }, on: { click: () => void onSave() } },
      icon("refresh", 17),
      h("span", {}, "Reschedule"),
    );
    setChildren(foot, h("button", { class: "btn btn-ghost", attrs: { type: "button" }, on: { click: () => dialog.close() } }, "Cancel"), h("span", { class: "spacer" }), save);

    async function onSave() {
      if (!course?.plan || !next || busy) return;
      const before = { plan: course.plan, target_date: course.target_date };
      busy = true;
      save.disabled = true;
      save.classList.add("loading");
      try {
        const saved = await app.update(course.id, { plan: next, ...(moveTarget && end ? { target_date: end } : {}) });
        busy = false;
        dialog.close();
        toast(`Plan rescheduled: finishing ${formatDate(end!)}`, {
          tone: "success",
          action: { label: "Undo", run: () => void app.update(saved.id, before).catch((e) => toast(errorMessage(e), { tone: "error" })) },
        });
      } catch (error) {
        busy = false;
        save.disabled = false;
        save.classList.remove("loading");
        toast(errorMessage(error), { tone: "error" });
      }
    }
  }

  function open(target: Course) {
    if (!target.plan) return;
    course = target;
    days = [...target.plan.days];
    sessionMinutes = target.plan.session_minutes;
    moveTarget = false;
    render();
    dialog.showModal();
  }

  return { el: dialog, open };
}
