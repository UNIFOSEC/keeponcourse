import { addDays, timestamp, todayISO } from "../dates";
import { schedule, weekStart, type StudyPlan } from "../plan";
import type { Course, Status } from "../types";

type SeedRow = [name: string, description: string, dueInDays: number, status: Status, addedDaysAgo: number];

// Dates are relative to today, so the demo never looks stale.
const ROWS: SeedRow[] = [
  ["Python for Beginners", "Variables, loops and functions, ending with three small automation projects.", -12, "Completed", 70],
  ["Digital Photography Basics", "Exposure, composition and editing, shooting one themed photo set each week.", -30, "Completed", 90],
  ["Intro to Statistics", "Probability, distributions and hypothesis testing, practiced on real data sets.", 9, "In Progress", 40],
  ["Conversational Spanish", "Everyday conversations, past tenses and 500 core words, with weekly speaking practice.", 21, "In Progress", 35],
  ["Project Management Fundamentals", "Planning, scheduling, risk and stakeholder communication, preparing for a certification exam.", -3, "Not Started", 28],
  ["Personal Finance 101", "Budgeting, saving, credit and investing basics for building lasting money habits.", 45, "Not Started", 20],
  ["UX Design Foundations", "User research, wireframes and usability testing, ending with a portfolio case study.", 60, "Not Started", 14],
  ["Public Speaking", "Structuring a talk, handling nerves and delivering with confidence, with recorded practice runs.", 90, "In Progress", 7],
];

/**
 * A sample study plan for "Conversational Spanish", so the demo shows plans,
 * check-ins, the calendar, a streak and catch-up: started two weeks ago on
 * Mon/Wed/Fri evenings, past sessions done except the latest one, which was
 * missed.
 */
function spanishPlan(today: string): StudyPlan {
  const modules = [
    { title: "Greetings and introductions", summary: "Say hello, introduce yourself and ask simple questions.", hours: 2, done: false },
    { title: "Present tense", summary: "Regular and common irregular verbs in everyday sentences.", hours: 3, done: false },
    { title: "Past tense", summary: "Talk about what you did: preterite and imperfect.", hours: 3, done: false },
    { title: "Travel conversations", summary: "Directions, restaurants, hotels and small talk.", hours: 2, done: false },
    { title: "Review and speaking test", summary: "Put it together in a recorded five-minute conversation.", hours: 2, done: false },
  ];
  const startDate = addDays(weekStart(today), -14);
  const sessions = schedule(modules, { startDate, days: [1, 3, 5], sessionMinutes: 60 });
  const past = sessions.filter((s) => s.date < today);
  past.slice(0, -1).forEach((s) => (s.status = "done")); // the latest past session was missed
  modules.forEach((m, i) => (m.done = sessions.filter((s) => s.module === i).every((s) => s.status === "done")));
  return { version: 1, days: [1, 3, 5], session_minutes: 60, start_time: "19:00", start_date: startDate, modules, sessions };
}

export function seedCourses(): Course[] {
  const today = todayISO();
  const now = Date.now();
  return ROWS.map(([name, description, dueInDays, status, addedDaysAgo], i) => ({
    id: i + 1,
    name,
    description,
    target_date: addDays(today, dueInDays),
    status,
    created_at: timestamp(new Date(now - addedDaysAgo * 86_400_000)),
    ...(name === "Conversational Spanish" ? { plan: spanishPlan(today) } : {}),
  }));
}
