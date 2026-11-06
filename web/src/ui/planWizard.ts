import { errorMessage, type App } from "../app";
import type { CoachSession, SyllabusOutline } from "../coach/session";
import { addDays, formatDate, formatTime, todayISO } from "../dates";
import { downloadIcs } from "../ics";
import {
  countConflicts,
  defaultStartDate,
  suggestFreeTime,
  finishDate,
  PLAN_LIMITS,
  schedule,
  SESSION_LENGTHS,
  slackDays,
  totalHours,
  WEEKDAYS,
  type PlanModule,
  type StudyPlan,
} from "../plan";
import type { Course } from "../types";
import { LIMITS, isValidDate } from "../validation";
import { cx, h, setChildren } from "./dom";
import { icon } from "./icons";
import { toast } from "./toast";
import { focusCalendarOn } from "../views/calendar";

const MAX_PDF_BYTES = 4 * 1024 * 1024;
const MAX_TEXT = 40_000;

interface DraftModule {
  title: string;
  summary: string;
  hours: number;
  done: boolean;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new Error("That file couldn't be read."));
    reader.readAsDataURL(file);
  });
}

/**
 * Two steps: (1) syllabus text or PDF → Coach outlines the modules, or add
 * modules by hand; (2) review modules and choose when to study. The schedule
 * is computed in the browser and previewed live against the target date.
 */
export function createPlanWizard(app: App, coach: CoachSession) {
  let course: Course | null = null; // set when planning an existing course
  let pdf: File | null = null;
  let busy = false;
  let modules: DraftModule[] = [];
  const opts = { startDate: defaultStartDate(), days: [1, 3, 5], sessionMinutes: 60, startTime: "19:00", targetDate: addDays(todayISO(), 56) };

  const title = h("h2", { attrs: { id: "plan-title" } });
  const body = h("div", { class: "modal-body plan-body" });
  const foot = h("footer", { class: "modal-foot" });

  const dialog = h(
    "dialog",
    {
      class: "modal modal-wide",
      attrs: { "aria-labelledby": "plan-title" },
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
        h(
          "button",
          { class: "icon-btn", attrs: { type: "button", "aria-label": "Close" }, on: { click: () => !busy && dialog.close() } },
          icon("x", 18),
        ),
      ),
      body,
      foot,
    ),
  );

  // ------------------------------------------------------------ step 1

  function renderSource(error = "") {
    title.textContent = course ? `Plan “${course.name}”` : "Import a syllabus";
    const nameHint = h("input", {
      class: "input",
      attrs: { id: "plan-name", maxlength: LIMITS.name, placeholder: "e.g. Intro to Statistics", autocomplete: "off" },
    });
    const text = h("textarea", {
      class: "input textarea plan-text",
      attrs: {
        id: "plan-text",
        rows: 9,
        maxlength: MAX_TEXT,
        placeholder: "Paste the syllabus, course outline or table of contents…\n\nWeek 1: Introduction\nWeek 2: …",
      },
    });
    const fileInput = h("input", {
      attrs: { type: "file", accept: "application/pdf,.pdf", class: "sr-only", id: "plan-pdf" },
      on: {
        change: () => {
          const file = fileInput.files?.[0] ?? null;
          if (file && (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"))) {
            renderSource("Choose a PDF file.");
            return;
          }
          if (file && file.size > MAX_PDF_BYTES) {
            renderSource("That PDF is too large. Use one under 4 MB.");
            return;
          }
          pdf = file;
          renderSource();
        },
      },
    });
    const message = h("p", { class: "field-error", attrs: { role: "alert" } }, error);

    const pdfChip = pdf
      ? h(
          "div",
          { class: "file-chip" },
          icon("fileText", 18),
          h("span", {}, pdf.name),
          h(
            "button",
            {
              class: "icon-btn",
              attrs: { type: "button", "aria-label": "Remove PDF" },
              on: {
                click: () => {
                  pdf = null;
                  renderSource();
                },
              },
            },
            icon("x", 16),
          ),
        )
      : h("label", { class: "btn btn-secondary btn-sm", attrs: { for: "plan-pdf" } }, icon("upload", 16), h("span", {}, "Upload a PDF (max 4 MB)"));

    setChildren(body, 
      h(
        "p",
        { class: "muted" },
        coach.configured
          ? "Paste your syllabus or course outline, or upload it as a PDF. Coach breaks it into modules with time estimates, then you choose when to study."
          : "Add the course's modules and choose when to study. (Coach isn't connected in this build, so it can't read syllabi.)",
      ),
      !course &&
        h("div", { class: "field" }, h("label", { class: "field-label", attrs: { for: "plan-name" } }, "Course name (optional)"), nameHint),
      coach.configured && [
        h("div", { class: "field" }, h("label", { class: "field-label", attrs: { for: "plan-text" } }, "Syllabus"), pdf ? null : text),
        h("div", { class: "plan-or" }, pdf ? null : h("span", { class: "muted" }, "or"), fileInput, pdfChip),
      ],
      message,
    );

    const outlineBtn = h(
      "button",
      { class: "btn btn-primary", attrs: { type: "button" }, on: { click: onOutline } },
      icon("sparkles", 17),
      h("span", {}, "Create outline"),
    );
    setChildren(foot, 
      h(
        "button",
        {
          class: "btn btn-ghost",
          attrs: { type: "button" },
          on: {
            click: () => {
              modules = [{ title: "", summary: "", hours: 2, done: false }];
              useOutline(null, nameHint.value.trim());
            },
          },
        },
        "Add modules myself",
      ),
      h("span", { class: "spacer" }),
      coach.configured && h("span", { class: "muted plan-cost" }, "Uses 1 Coach message"),
      coach.configured && outlineBtn,
    );

    async function onOutline() {
      const pasted = text.value.trim();
      if (!pdf && pasted.length < 40) {
        message.textContent = "Paste the full syllabus or course outline (at least a few lines), or upload a PDF.";
        text.focus();
        return;
      }
      busy = true;
      renderLoading();
      try {
        const outline = await coach.outline(
          pdf ? { pdfBase64: await readFileAsBase64(pdf), nameHint: course?.name ?? nameHint.value.trim() } : { text: pasted, nameHint: course?.name ?? nameHint.value.trim() },
        );
        if (outline.modules.length === 0) throw new Error("Coach couldn't find a course structure in that material. Try pasting the syllabus or table of contents.");
        modules = outline.modules.map((m) => ({ ...m, done: false }));
        busy = false;
        useOutline(outline, nameHint.value.trim());
      } catch (err) {
        busy = false;
        renderSource(errorMessage(err));
      }
    }
  }

  function renderLoading() {
    setChildren(body, 
      h(
        "div",
        { class: "plan-loading", attrs: { role: "status" } },
        h("span", { class: "dots", attrs: { "aria-hidden": "true" } }, h("span"), h("span"), h("span")),
        h("p", {}, "Coach is reading your syllabus…"),
      ),
    );
    setChildren(foot, );
  }

  // ------------------------------------------------------------ step 2

  let draftName = "";
  let draftDescription = "";

  function useOutline(outline: SyllabusOutline | null, hint: string) {
    draftName = course?.name ?? (hint || outline?.course_name || "");
    draftDescription = course?.description ?? outline?.description ?? "";
    opts.startDate = defaultStartDate();
    opts.targetDate = course?.target_date ?? addDays(opts.startDate, Math.max(1, outline?.suggested_weeks ?? 8) * 7);
    if (course?.plan) {
      // Rebuilding: keep the learner's schedule choices
      opts.days = [...course.plan.days];
      opts.sessionMinutes = course.plan.session_minutes;
      opts.startTime = course.plan.start_time;
      // ...and progress, for modules with the same title
      const done = new Set(course.plan.modules.filter((m) => m.done).map((m) => m.title.toLowerCase()));
      modules = modules.map((m) => ({ ...m, done: done.has(m.title.toLowerCase()) }));
    }
    if (!course) {
      // New course: default to a target the default schedule actually meets
      const end = finishDate({ sessions: schedule(modules, { startDate: opts.startDate, days: opts.days, sessionMinutes: opts.sessionMinutes }) });
      if (end && end > opts.targetDate) opts.targetDate = end;
    }
    renderReview();
  }

  function renderReview(error = "") {
    title.textContent = course ? `Study plan for “${course.name}”` : "Review your study plan";
    const summary = h("div", { class: "plan-summary", attrs: { "aria-live": "polite" } });
    const message = h("p", { class: "field-error", attrs: { role: "alert" } }, error);

    // Course fields (new course only)
    const nameInput = h("input", {
      class: "input",
      attrs: { id: "plan-course-name", maxlength: LIMITS.name, value: draftName },
      on: { input: () => (draftName = nameInput.value) },
    });
    const descInput = h("textarea", {
      class: "input textarea",
      attrs: { id: "plan-course-desc", rows: 2, maxlength: LIMITS.description },
      on: { input: () => (draftDescription = descInput.value) },
    });
    descInput.value = draftDescription;

    // Modules
    const list = h("ol", { class: "plan-modules" });
    const renderModules = () => {
      list.replaceChildren(
        ...modules.map((m, i) => {
          const titleInput = h("input", {
            class: "input",
            attrs: { "aria-label": `Module ${i + 1} title`, maxlength: 80, value: m.title, placeholder: `Module ${i + 1}` },
            on: { input: () => ((m.title = titleInput.value), update()) },
          });
          const hoursInput = h("input", {
            class: "input plan-hours",
            attrs: { type: "number", min: 0.25, max: PLAN_LIMITS.hours, step: 0.25, value: m.hours, "aria-label": `Module ${i + 1} hours` },
            on: {
              input: () => {
                const n = Number(hoursInput.value);
                if (n > 0) m.hours = Math.min(PLAN_LIMITS.hours, n);
                update();
              },
            },
          });
          return h(
            "li",
            { class: cx("plan-module", m.done && "is-done") },
            h("span", { class: "plan-module-num", attrs: { "aria-hidden": "true" } }, String(i + 1)),
            titleInput,
            h("label", { class: "plan-hours-wrap" }, hoursInput, h("span", { class: "muted" }, "h")),
            h(
              "button",
              {
                class: "icon-btn icon-btn-danger",
                attrs: { type: "button", "aria-label": `Remove module ${i + 1}`, disabled: modules.length <= 1 },
                on: {
                  click: () => {
                    modules.splice(i, 1);
                    renderModules();
                    update();
                  },
                },
              },
              icon("x", 16),
            ),
          );
        }),
      );
    };
    renderModules();
    const addModule = h(
      "button",
      {
        class: "btn btn-secondary btn-sm",
        attrs: { type: "button" },
        on: {
          click: () => {
            if (modules.length >= PLAN_LIMITS.modules) return;
            modules.push({ title: "", summary: "", hours: 2, done: false });
            renderModules();
            update();
            (list.lastElementChild?.querySelector("input") as HTMLInputElement | null)?.focus();
          },
        },
      },
      icon("plus", 16),
      h("span", {}, "Add module"),
    );

    // Schedule
    const dayButtons = WEEKDAYS.map((label, day) =>
      h(
        "button",
        {
          class: "day-chip",
          attrs: { type: "button", "aria-pressed": opts.days.includes(day) },
          on: {
            click: (event) => {
              opts.days = opts.days.includes(day) ? opts.days.filter((d) => d !== day) : [...opts.days, day].sort();
              (event.currentTarget as HTMLElement).setAttribute("aria-pressed", String(opts.days.includes(day)));
              update();
            },
          },
        },
        label,
      ),
    );
    const startInput = h("input", {
      class: "input",
      attrs: { type: "date", id: "plan-start", value: opts.startDate, min: todayISO() },
      on: { input: () => (isValidDate(startInput.value) ? ((opts.startDate = startInput.value), update()) : undefined) },
    });
    const lengthSelect = h(
      "select",
      { class: "input select", attrs: { id: "plan-length" }, on: { change: () => ((opts.sessionMinutes = Number(lengthSelect.value)), update()) } },
      SESSION_LENGTHS.map((n) => h("option", { attrs: { value: n, selected: n === opts.sessionMinutes } }, n < 60 ? `${n} min` : n === 60 ? "1 hour" : `${n / 60} hours`)),
    );
    const timeInput = h("input", {
      class: "input",
      attrs: { type: "time", id: "plan-time", value: opts.startTime },
      on: { input: () => /^\d{2}:\d{2}$/.test(timeInput.value) && (opts.startTime = timeInput.value) },
    });
    const targetInput = h("input", {
      class: "input",
      attrs: { type: "date", id: "plan-target", value: opts.targetDate },
      on: { input: () => (isValidDate(targetInput.value) ? ((opts.targetDate = targetInput.value), update()) : undefined) },
    });

    function update() {
      const usable = modules.filter((m) => m.title.trim());
      const sessions = schedule(usable, { startDate: opts.startDate, days: opts.days, sessionMinutes: opts.sessionMinutes });
      const end = finishDate({ sessions });
      if (!usable.length || !opts.days.length || !end) {
        summary.className = "plan-summary";
        setChildren(summary, icon("calendar", 18), h("span", {}, opts.days.length ? "Add at least one module to see your schedule." : "Pick at least one study day."));
        return;
      }
      const slack = slackDays({ sessions }, opts.targetDate) ?? 0;
      const hours = totalHours(usable);
      // Other planned courses (not the one being rebuilt), to avoid double-booking
      const others = app.courses.filter((c) => c.plan && c.id !== course?.id).map((c) => ({ name: c.name, plan: c.plan! }));
      const clash = countConflicts(sessions, opts.startTime, others);
      const freeTime = clash.count ? suggestFreeTime(sessions, opts.startTime, others) : null;
      summary.className = cx("plan-summary", slack >= 0 && !clash.count ? "is-ok" : "is-late");
      setChildren(summary, 
        icon(slack >= 0 ? "checkCircle" : "alert", 18),
        h(
          "div",
          {},
          h("strong", {}, `${sessions.length} sessions · ${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours · finishes ${formatDate(end)}`),
          h(
            "span",
            {},
            slack >= 0
              ? slack === 0
                ? "Right on your target date."
                : `${slack} day${slack === 1 ? "" : "s"} before your target date.`
              : `${-slack} day${slack === -1 ? "" : "s"} after your target date. Add a study day, use longer sessions, or move the target.`,
          ),
        ),
        slack < 0 &&
          h(
            "button",
            {
              class: "btn btn-secondary btn-sm",
              attrs: { type: "button" },
              on: {
                click: () => {
                  opts.targetDate = end;
                  targetInput.value = end;
                  update();
                },
              },
            },
            `Use ${formatDate(end)}`,
          ),
        clash.count > 0 &&
          h(
            "div",
            { class: "plan-conflict" },
            h(
              "span",
              {},
              `${clash.count} session${clash.count === 1 ? " overlaps" : "s overlap"} with ${clash.names.join(" and ")} at ${formatTime(opts.startTime)}.`,
            ),
            freeTime &&
              h(
                "button",
                {
                  class: "btn btn-secondary btn-sm",
                  attrs: { type: "button" },
                  on: {
                    click: () => {
                      opts.startTime = freeTime;
                      timeInput.value = freeTime;
                      update();
                    },
                  },
                },
                `Move to ${formatTime(freeTime)}`,
              ),
          ),
      );
    }

    setChildren(body, 
      !course && [
        h("div", { class: "field" }, h("label", { class: "field-label", attrs: { for: "plan-course-name" } }, "Course name"), nameInput),
        h("div", { class: "field" }, h("label", { class: "field-label", attrs: { for: "plan-course-desc" } }, "Description"), descInput),
      ],
      h("div", { class: "plan-section-head" }, h("h3", {}, "Modules"), addModule),
      list,
      h("h3", { class: "plan-section-title" }, "When will you study?"),
      h(
        "div",
        { class: "plan-grid" },
        h("div", { class: "field" }, h("span", { class: "field-label", attrs: { id: "plan-days-label" } }, "Study days"), h("div", { class: "day-chips", attrs: { role: "group", "aria-labelledby": "plan-days-label" } }, dayButtons)),
        h("div", { class: "field" }, h("label", { class: "field-label", attrs: { for: "plan-length" } }, "Session length"), lengthSelect),
        h("div", { class: "field" }, h("label", { class: "field-label", attrs: { for: "plan-time" } }, "Time"), timeInput),
        h("div", { class: "field" }, h("label", { class: "field-label", attrs: { for: "plan-start" } }, "Start on"), startInput),
        h("div", { class: "field" }, h("label", { class: "field-label", attrs: { for: "plan-target" } }, "Target date"), targetInput),
      ),
      summary,
      message,
    );
    update();

    const saveBtn = h(
      "button",
      { class: "btn btn-primary", attrs: { type: "button" }, on: { click: onSave } },
      icon("calendarPlus", 17),
      h("span", {}, course ? "Save plan" : "Create course with plan"),
    );
    setChildren(foot, 
      h("button", { class: "btn btn-ghost", attrs: { type: "button" }, on: { click: () => renderSource() } }, "Back"),
      h("span", { class: "spacer" }),
      saveBtn,
    );

    async function onSave() {
      const usable = modules.filter((m) => m.title.trim()).map((m) => ({ ...m, title: m.title.trim() }));
      if (!course && !draftName.trim()) return renderReview("Give the course a name.");
      if (!course && !draftDescription.trim()) return renderReview("Add a short description.");
      if (!usable.length) return renderReview("Add at least one module.");
      if (!opts.days.length) return renderReview("Pick at least one study day.");

      const planModules: PlanModule[] = usable.map(({ title, summary, hours, done }) => ({ title, summary, hours, done }));
      const plan: StudyPlan = {
        version: 1,
        days: opts.days,
        session_minutes: opts.sessionMinutes,
        start_time: opts.startTime,
        start_date: opts.startDate,
        modules: planModules,
        sessions: schedule(planModules, { startDate: opts.startDate, days: opts.days, sessionMinutes: opts.sessionMinutes }),
      };

      busy = true;
      saveBtn.disabled = true;
      saveBtn.classList.add("loading");
      try {
        const saved = course
          ? await app.update(course.id, { plan, target_date: opts.targetDate })
          : await app.create({
              name: draftName.trim(),
              description: draftDescription.trim(),
              target_date: opts.targetDate,
              status: "Not Started",
              plan,
            });
        busy = false;
        dialog.close();
        // Show the result: open the Calendar on the first session
        if (plan.sessions[0]) focusCalendarOn(plan.sessions[0].date);
        location.hash = "#/calendar";
        toast(`Study plan saved: ${plan.sessions.length} sessions`, {
          tone: "success",
          action: { label: "Add to calendar", run: () => saved.plan && downloadIcs(saved, saved.plan) },
        });
      } catch (err) {
        busy = false;
        saveBtn.disabled = false;
        saveBtn.classList.remove("loading");
        renderReview(errorMessage(err));
      }
    }
  }

  function open(target?: Course) {
    if (!app.store.supportsPlans) {
      toast("Study plans are saved with demo data or an account. Switch the data source to use them.", { tone: "error" });
      return;
    }
    course = target ?? null;
    pdf = null;
    busy = false;
    modules = [];
    renderSource();
    dialog.showModal();
  }

  return { el: dialog, open };
}
