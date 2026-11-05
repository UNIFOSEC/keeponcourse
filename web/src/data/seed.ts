import { addDays, timestamp, todayISO } from "../dates";
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
  }));
}
