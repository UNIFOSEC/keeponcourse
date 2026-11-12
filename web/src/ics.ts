import { todayISO } from "./dates";
import type { StudyPlan } from "./plan";
import type { Course } from "./types";

/**
 * Calendar export (RFC 5545 .ics): one event per upcoming session of an
 * unfinished module, with a 10-minute reminder. Times are sent as UTC
 * instants computed from the learner's local study time, which every
 * calendar app (Google, Outlook, Apple) interprets the same way.
 *
 * The subscription feed (coach/src/calendar.ts) produces the same events
 * server-side, so the two stay in step.
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

const icsStamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** A local date + "HH:MM" in this browser's time zone, as a UTC instant. */
function localToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

export function buildIcs(items: { course: Course; plan: StudyPlan }[], today = todayISO()): { text: string; count: number } {
  const stamp = icsStamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//KeepOnCourse//Study plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(items.length === 1 ? `${items[0].course.name} · study plan` : "KeepOnCourse study plan")}`,
  ];
  let count = 0;

  for (const { course, plan } of items) {
    plan.sessions.forEach((session, index) => {
      const module = plan.modules[session.module];
      if (!module || module.done || session.status || session.date < today) return;
      count++;
      lines.push(
        "BEGIN:VEVENT",
        `UID:koc-${course.id}-${index}-${session.date.replace(/-/g, "")}@keeponcourse`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${icsStamp(localToUtc(session.date, plan.start_time))}`,
        `DURATION:PT${session.minutes}M`,
        `SUMMARY:${escapeText(`Study: ${course.name} · ${module.title}`)}`,
        `DESCRIPTION:${escapeText(`Module ${session.module + 1} of ${plan.modules.length}: ${module.title}\n${module.summary}\n\nFrom your KeepOnCourse study plan.`)}`,
        "BEGIN:VALARM",
        "TRIGGER:-PT10M",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeText(`Study session: ${module.title}`)}`,
        "END:VALARM",
        "END:VEVENT",
      );
    });
  }

  lines.push("END:VCALENDAR");
  return { text: lines.map(fold).join("\r\n") + "\r\n", count };
}

function save(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (name: string) => name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "study-plan";

/** Saves one course's plan as an .ics file the user can open or import. */
export function downloadIcs(course: Course, plan: StudyPlan): number {
  const { text, count } = buildIcs([{ course, plan }]);
  save(`${slug(course.name)}.ics`, text);
  return count;
}

/** Saves every planned course as one .ics file. */
export function downloadAllIcs(courses: Course[]): number {
  const items = courses.flatMap((course) => (course.plan ? [{ course, plan: course.plan }] : []));
  const { text, count } = buildIcs(items);
  save("keeponcourse-study-plan.ics", text);
  return count;
}
