import { todayISO } from "./dates";
import type { StudyPlan } from "./plan";
import type { Course } from "./types";

/**
 * Calendar export (RFC 5545 .ics) for a study plan: one event per upcoming
 * session of an unfinished module, at the learner's chosen local time, with a
 * 10-minute reminder. Works with Google Calendar, Outlook and Apple Calendar.
 */

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets are folded with CRLF + space (byte-aware, so UTF-8 stays intact). */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const compactDate = (iso: string) => iso.replace(/-/g, "");
const utcStamp = (date = new Date()) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function buildIcs(course: Course, plan: StudyPlan, today = todayISO()): { text: string; count: number } {
  const time = plan.start_time.replace(":", "") + "00";
  const stamp = utcStamp();
  const upcoming = plan.sessions
    .map((session, index) => ({ session, index }))
    .filter(({ session }) => session.date >= today && !plan.modules[session.module]?.done);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//KeepOnCourse//Study plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(`${course.name} · study plan`)}`,
  ];

  for (const { session, index } of upcoming) {
    const module = plan.modules[session.module];
    const position = `Module ${session.module + 1} of ${plan.modules.length}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:koc-${course.id}-${index}-${compactDate(session.date)}@keeponcourse`,
      `DTSTAMP:${stamp}`,
      // Floating local time: the session happens at the chosen time wherever the learner is
      `DTSTART:${compactDate(session.date)}T${time}`,
      `DURATION:PT${session.minutes}M`,
      `SUMMARY:${escapeText(`Study: ${course.name} · ${module.title}`)}`,
      `DESCRIPTION:${escapeText(`${position}: ${module.title}\n${module.summary}\n\nPlanned with KeepOnCourse.`)}`,
      "BEGIN:VALARM",
      "TRIGGER:-PT10M",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(`Study session: ${module.title}`)}`,
      "END:VALARM",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return { text: lines.map(fold).join("\r\n") + "\r\n", count: upcoming.length };
}

/** Saves the plan as an .ics file the user can open or import into their calendar. */
export function downloadIcs(course: Course, plan: StudyPlan): number {
  const { text, count } = buildIcs(course, plan);
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${course.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "study-plan"}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return count;
}
