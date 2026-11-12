import type Anthropic from "@anthropic-ai/sdk";
import { errorMessage, type App } from "../app";
import { catchUp, finishDate, SESSION_LENGTHS } from "../plan";
import { isStatus, type Course, type CourseInput } from "../types";
import { hasErrors, validateCourse } from "../validation";

/** A change Coach made, shown as a card in the chat with an Undo button. */
export type CoachAction =
  | { kind: "added"; course: Course }
  | { kind: "updated"; before: Course; after: Course }
  | { kind: "removed"; course: Course }
  | { kind: "replanned"; before: Course; after: Course };

export interface ToolOutcome {
  result: Anthropic.Beta.BetaToolResultBlockParam;
  action?: CoachAction;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : undefined);

/** What Claude gets back about a course: enough to confirm the change, nothing more. */
const brief = ({ id, name, target_date, status }: Course) => ({ id, name, target_date, status });

/**
 * Runs one of Coach's tool calls against the current data source.
 * Tool input is model output, so it's treated as untrusted: only known fields
 * are read, and everything goes through the same validation as the course form.
 */
export async function runTool(app: App, block: Anthropic.Beta.BetaToolUseBlock): Promise<ToolOutcome> {
  const fail = (error: string): ToolOutcome => ({
    result: { type: "tool_result", tool_use_id: block.id, content: JSON.stringify({ ok: false, error }), is_error: true },
  });
  const ok = (course: Course, action: CoachAction, extra: Record<string, unknown> = {}): ToolOutcome => ({
    result: { type: "tool_result", tool_use_id: block.id, content: JSON.stringify({ ok: true, course: brief(course), ...extra }) },
    action,
  });

  const input = (typeof block.input === "object" && block.input !== null ? block.input : {}) as Record<string, unknown>;
  const find = (id: unknown) => (Number.isInteger(id) ? app.courses.find((c) => c.id === id) : undefined);

  try {
    switch (block.name) {
      case "add_course": {
        if (input.status !== undefined && !isStatus(input.status)) return fail("Status must be Not Started, In Progress or Completed.");
        const data: CourseInput = {
          name: text(input.name) ?? "",
          description: text(input.description) ?? "",
          target_date: text(input.target_date) ?? "",
          status: isStatus(input.status) ? input.status : "Not Started",
        };
        const errors = validateCourse(data);
        if (hasErrors(errors)) return fail(Object.values(errors).join(" "));
        const course = await app.create(data);
        return ok(course, { kind: "added", course });
      }

      case "update_course": {
        const before = find(input.id);
        if (!before) return fail(`There is no course with ID ${String(input.id)}.`);
        const patch: Partial<CourseInput> = {};
        if (input.name !== undefined) patch.name = text(input.name) ?? "";
        if (input.description !== undefined) patch.description = text(input.description) ?? "";
        if (input.target_date !== undefined) patch.target_date = text(input.target_date) ?? "";
        if (input.status !== undefined) {
          if (!isStatus(input.status)) return fail("Status must be Not Started, In Progress or Completed.");
          patch.status = input.status;
        }
        if (Object.keys(patch).length === 0) return fail("Nothing to change: send at least one field.");
        const errors = validateCourse(patch, true);
        if (hasErrors(errors)) return fail(Object.values(errors).join(" "));
        const after = await app.update(before.id, patch);
        return ok(after, { kind: "updated", before, after });
      }

      case "reschedule_plan": {
        const before = find(input.id);
        if (!before) return fail(`There is no course with ID ${String(input.id)}.`);
        if (!before.plan) return fail("That course has no study plan. The user can create one from the course or by importing a syllabus.");
        let days = before.plan.days;
        if (input.days !== undefined) {
          if (!Array.isArray(input.days) || !input.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return fail("days must be weekday numbers from 0 (Sunday) to 6 (Saturday).");
          days = [...new Set(input.days as number[])].sort();
          if (!days.length) return fail("Pick at least one study day.");
        }
        let sessionMinutes = before.plan.session_minutes;
        if (input.session_minutes !== undefined) {
          if (!(SESSION_LENGTHS as readonly number[]).includes(input.session_minutes as number)) return fail(`session_minutes must be one of ${SESSION_LENGTHS.join(", ")}.`);
          sessionMinutes = input.session_minutes as number;
        }
        const plan = catchUp(before.plan, { days, sessionMinutes });
        const left = plan.sessions.filter((s) => !s.status).length;
        if (left === 0) return fail("There's nothing left to schedule: every module is done.");
        const end = finishDate(plan)!;
        const move = input.move_target_date === true && end > before.target_date;
        const after = await app.update(before.id, { plan, ...(move ? { target_date: end } : {}) });
        return ok(
          after,
          { kind: "replanned", before, after },
          { sessions_left: left, planned_finish: end, target_date: after.target_date, finishes_after_target: end > after.target_date },
        );
      }

      case "remove_course": {
        const course = find(input.id);
        if (!course) return fail(`There is no course with ID ${String(input.id)}.`);
        await app.remove(course);
        return ok(course, { kind: "removed", course });
      }

      default:
        return fail(`Unknown tool "${block.name}".`);
    }
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function undoAction(app: App, action: CoachAction): Promise<void> {
  switch (action.kind) {
    case "added": {
      const current = app.courses.find((c) => c.id === action.course.id);
      if (current) await app.remove(current);
      return;
    }
    case "updated": {
      const { name, description, target_date, status } = action.before;
      await app.update(action.before.id, { name, description, target_date, status });
      return;
    }
    case "removed":
      await app.restore(action.course);
      return;
    case "replanned":
      await app.update(action.before.id, { plan: action.before.plan ?? null, target_date: action.before.target_date });
      return;
  }
}
