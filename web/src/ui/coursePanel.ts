import { errorMessage, type App } from "../app";
import { addDays, todayISO } from "../dates";
import { StoreError } from "../data/store";
import { STATUSES, STATUS_KEY, type Course, type CourseInput, type Status } from "../types";
import { LIMITS, hasErrors, validateCourse, type FieldErrors } from "../validation";
import { removeWithUndo } from "./components";
import { createPlanSection } from "./planSection";
import { h } from "./dom";
import { icon } from "./icons";
import { toast } from "./toast";

type Field = keyof CourseInput;

/** Slide-over panel for adding and editing a course. One instance, reused. */
export function createCoursePanel(app: App, openPlanWizard: (course?: Course) => void, openCatchUp: (course: Course) => void) {
  let editing: Course | null = null;
  let busy = false;

  const title = h("h2", { class: "sheet-title", attrs: { id: "course-panel-title" } });
  const subtitle = h("p", { class: "sheet-subtitle" });
  const formError = h("div", { class: "form-error", attrs: { role: "alert", hidden: true } });

  const name = h("input", {
    class: "input",
    attrs: { id: "f-name", name: "name", maxlength: LIMITS.name, autocomplete: "off", placeholder: "e.g. Intro to Statistics" },
  });
  const description = h("textarea", {
    class: "input textarea",
    attrs: { id: "f-description", name: "description", maxlength: LIMITS.description, rows: 4, placeholder: "What will you learn, and why does it matter to you?" },
    on: { input: () => updateCounter() },
  });
  const counter = h("span", { class: "field-counter", attrs: { "aria-live": "off" } });
  const targetDate = h("input", { class: "input", attrs: { id: "f-target_date", name: "target_date", type: "date" } });

  const statusInputs = STATUSES.map((status) =>
    h("input", { attrs: { type: "radio", name: "status", value: status } }),
  );
  const statusGroup = h(
    "div",
    { class: "status-options" },
    STATUSES.map((status, i) =>
      h("label", { class: "status-option" }, statusInputs[i], h("span", {}, h("span", { class: `dot dot-${STATUS_KEY[status]}` }), status)),
    ),
  );

  const errorEls = {} as Record<Field, HTMLElement>;
  const controls: Record<Field, HTMLElement> = { name, description, target_date: targetDate, status: statusInputs[0] };

  function field(key: Field, label: string, control: HTMLElement, extra?: HTMLElement) {
    errorEls[key] = h("p", { class: "field-error", attrs: { id: `f-${key}-error` } });
    control.setAttribute("aria-describedby", `f-${key}-error`);
    return h(
      "div",
      { class: "field", dataset: { field: key } },
      h("div", { class: "field-label-row" }, h("label", { class: "field-label", attrs: { for: `f-${key}` } }, label), extra),
      control,
      errorEls[key],
    );
  }

  const planSection = createPlanSection(app, {
    planCourse: (course) => {
      dialog.close();
      openPlanWizard(course);
    },
    catchUp: (course) => {
      dialog.close();
      openCatchUp(course);
    },
  });

  const deleteBtn = h(
    "button",
    { class: "btn btn-ghost-danger", attrs: { type: "button" }, on: { click: onDelete } },
    icon("trash", 17),
    h("span", {}, "Remove"),
  );
  const cancelBtn = h("button", { class: "btn btn-secondary", attrs: { type: "button" }, on: { click: () => close() } }, "Cancel");
  const saveLabel = h("span", {});
  const saveBtn = h("button", { class: "btn btn-primary", attrs: { type: "submit" } }, saveLabel);

  const form = h(
    "form",
    { class: "sheet-form", attrs: { novalidate: true }, on: { submit: onSubmit } },
    h(
      "header",
      { class: "sheet-head" },
      h("div", {}, title, subtitle),
      h("button", { class: "icon-btn", attrs: { type: "button", "aria-label": "Close" }, on: { click: () => close() } }, icon("x", 18)),
    ),
    h(
      "div",
      { class: "sheet-body" },
      formError,
      field("name", "Course name", name),
      field("description", "Description", description, counter),
      field("target_date", "Target date", targetDate),
      h(
        "fieldset",
        { class: "field", dataset: { field: "status" } },
        h("legend", { class: "field-label" }, "Status"),
        statusGroup,
        (errorEls.status = h("p", { class: "field-error" })),
      ),
      planSection.el,
    ),
    h("footer", { class: "sheet-foot" }, deleteBtn, h("span", { class: "spacer" }), cancelBtn, saveBtn),
  );

  const dialog = h("dialog", {
    class: "sheet",
    attrs: { "aria-labelledby": "course-panel-title" },
    on: {
      // Clicking the dimmed backdrop closes the panel
      click: (event) => {
        if (event.target === dialog) close();
      },
    },
  }, form);

  function updateCounter() {
    counter.textContent = `${description.value.length} / ${LIMITS.description}`;
  }

  function readForm(): CourseInput {
    const checked = statusInputs.find((input) => input.checked);
    return {
      name: name.value.trim(),
      description: description.value.trim(),
      target_date: targetDate.value,
      status: (checked?.value ?? "") as Status,
    };
  }

  function showErrors(errors: FieldErrors) {
    for (const key of Object.keys(errorEls) as Field[]) {
      const message = errors[key] ?? "";
      errorEls[key].textContent = message;
      errorEls[key].closest(".field")?.classList.toggle("invalid", Boolean(message));
      if (key !== "status") controls[key].setAttribute("aria-invalid", String(Boolean(message)));
    }
  }

  function setBusy(value: boolean) {
    busy = value;
    for (const btn of [saveBtn, cancelBtn, deleteBtn]) btn.disabled = value;
    saveBtn.classList.toggle("loading", value);
  }

  function open(course?: Course) {
    editing = course ?? null;
    title.textContent = editing ? "Edit course" : "New course";
    subtitle.textContent = editing ? `#${editing.id} · added ${editing.created_at.slice(0, 10)}` : "Add something you want to learn.";
    saveLabel.textContent = editing ? "Save changes" : "Add course";
    deleteBtn.hidden = !editing;
    planSection.show(editing);

    name.value = editing?.name ?? "";
    description.value = editing?.description ?? "";
    targetDate.value = editing?.target_date ?? addDays(todayISO(), 30);
    const status = editing?.status ?? "Not Started";
    for (const input of statusInputs) input.checked = input.value === status;

    updateCounter();
    showErrors({});
    formError.hidden = true;
    setBusy(false);
    dialog.showModal();
    name.focus();
  }

  function close() {
    if (!busy) dialog.close();
  }

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    const input = readForm();
    const errors = validateCourse(input);
    showErrors(errors);
    formError.hidden = true;
    if (hasErrors(errors)) {
      const first = (Object.keys(errors) as Field[])[0];
      (first === "status" ? statusInputs[0] : controls[first]).focus();
      return;
    }

    setBusy(true);
    try {
      if (editing) {
        await app.update(editing.id, input);
        toast("Changes saved", { tone: "success" });
      } else {
        await app.create(input);
        toast(`Added "${input.name}"`, { tone: "success" });
      }
      setBusy(false);
      dialog.close();
    } catch (error) {
      setBusy(false);
      if (error instanceof StoreError && error.status === 404) {
        // Removed elsewhere (another tab, or directly in the API)
        dialog.close();
        toast("That course no longer exists. The list has been refreshed.", { tone: "error" });
        void app.load();
        return;
      }
      formError.replaceChildren(icon("alert", 18), h("span", {}, errorMessage(error)));
      formError.hidden = false;
    }
  }

  function onDelete() {
    if (!editing || busy) return;
    const course = editing;
    dialog.close();
    void removeWithUndo(app, course);
  }

  return { el: dialog, open };
}
