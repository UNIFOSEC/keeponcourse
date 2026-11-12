import { errorMessage, type App } from "../app";
import { todayISO } from "../dates";
import { setSessionStatus, type PlanSession, type SessionStatus, type StudyPlan } from "../plan";
import type { Course } from "../types";
import { cx, h } from "./dom";
import { startFocus } from "./focusTimer";
import { icon } from "./icons";
import { toast } from "./toast";

/**
 * Checking in a study session (done or skipped), shared by the Calendar, the
 * course panel and the Overview. Every check-in saves right away and can be
 * undone from the toast.
 */
export async function checkIn(app: App, course: Course, index: number, status: SessionStatus | null, actualMinutes?: number): Promise<void> {
  const before = course.plan;
  if (!before) return;
  const { plan, finishedModule } = setSessionStatus(before, index, status, actualMinutes);
  const studied = actualMinutes !== undefined ? ` You studied ${plan.sessions[index]?.actual_minutes ?? Math.round(actualMinutes)} min.` : "";
  const undo = { label: "Undo", run: () => void app.update(course.id, { plan: before }).catch((e) => toast(errorMessage(e), { tone: "error" })) };
  try {
    await app.update(course.id, { plan });
    if (finishedModule !== null) {
      const allDone = plan.modules.every((m) => m.done);
      toast((allDone ? `Every module of "${course.name}" is done!` : `Module done: ${plan.modules[finishedModule].title}.`) + studied, { tone: "success", action: undo });
    } else if (status === "done") {
      toast(`Session done. Nice work!${studied}`, { tone: "success", action: undo });
    } else if (status === "skipped") {
      toast("Session skipped. Catch up any time from the plan.", { action: undo });
    }
  } catch (error) {
    toast(errorMessage(error), { tone: "error" });
  }
}

/**
 * Check-in controls for one session: Done / Skip when it's today or past and
 * still open, or its status with an Undo when it's checked in. Nothing for
 * future sessions or sessions of finished modules.
 */
export function checkInControls(app: App, course: Course, plan: StudyPlan, session: PlanSession, today = todayISO()): HTMLElement | null {
  const index = plan.sessions.indexOf(session);
  if (index < 0) return null;
  if (session.status) {
    return h(
      "span",
      { class: cx("checkin", `checkin-${session.status}`) },
      h("span", { class: "checkin-status" }, icon(session.status === "done" ? "check" : "x", 14), session.status === "done" ? "Done" : "Skipped"),
      h(
        "button",
        { class: "checkin-btn", attrs: { type: "button", "aria-label": `Undo check-in for ${plan.modules[session.module]?.title ?? "this session"}` }, on: { click: () => void checkIn(app, course, index, null) } },
        "Undo",
      ),
    );
  }
  if (session.date > today || plan.modules[session.module]?.done) return null;
  const title = plan.modules[session.module]?.title ?? "session";
  return h(
    "span",
    { class: "checkin" },
    h(
      "button",
      { class: "checkin-btn checkin-start", attrs: { type: "button", "aria-label": `Start a focus timer for "${title}"` }, on: { click: () => startFocus(course, session) } },
      icon("play", 14),
      "Start",
    ),
    h(
      "button",
      { class: "checkin-btn checkin-done", attrs: { type: "button", "aria-label": `Mark "${title}" session done` }, on: { click: () => void checkIn(app, course, index, "done") } },
      icon("check", 14),
      "Done",
    ),
    h(
      "button",
      { class: "checkin-btn", attrs: { type: "button", "aria-label": `Skip "${title}" session` }, on: { click: () => void checkIn(app, course, index, "skipped") } },
      "Skip",
    ),
  );
}
