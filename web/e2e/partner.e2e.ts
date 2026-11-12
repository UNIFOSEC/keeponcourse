import { expect, test, type Page } from "./fixtures";

/**
 * The page a study partner opens from a learner's private link. The database
 * is mocked: partner_view returns a learner's shared progress, send_cheer
 * records cheers. Everything else on Coach/Supabase is blocked.
 */

const TOKEN = "c3".repeat(32);
const ZONE = "America/New_York"; // the browser's zone in playwright.config.ts

const day = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};

function progress() {
  return {
    display_name: "Alex",
    show_names: false,
    timezone: ZONE,
    cheers_today: 0,
    courses: [
      {
        name: null,
        target_date: day(60),
        status: "In Progress",
        modules: [{ title: null, done: false }],
        sessions: [
          { date: day(-21), minutes: 60, module: 0, status: "done" },
          { date: day(-14), minutes: 60, module: 0, status: "done" },
          { date: day(-7), minutes: 60, module: 0, status: "done", actual_minutes: 50 },
          { date: day(-1), minutes: 60, module: 0 },
          { date: day(0), minutes: 60, module: 0, status: "done", actual_minutes: 70 },
          { date: day(3), minutes: 60, module: 0 },
        ],
      },
    ],
  };
}

async function mockDatabase(page: Page, view: unknown) {
  const cheers: unknown[] = [];
  await page.route(/workers\.dev|supabase\.co/, (route) => route.abort());
  // Routes added later win: answer the two partner functions
  await page.route(/supabase\.co\/rest\/v1\/rpc\/(partner_view|send_cheer)/, async (route) => {
    const body = route.request().postDataJSON();
    if (route.request().url().endsWith("send_cheer")) {
      cheers.push(body);
      return route.fulfill({ json: true });
    }
    expect(body).toEqual({ token: TOKEN });
    return route.fulfill({ json: view });
  });
  return cheers;
}

test("a partner sees the learner's progress without signing in, and can cheer", async ({ page }) => {
  const cheers = await mockDatabase(page, progress());
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`./#/p/${TOKEN}`);
  await expect(page.getByRole("heading", { name: "Alex's study progress", level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/^Alex's study progress/);
  await expect(page.getByText("Last studied today.")).toBeVisible();
  // No app menu, no sign-in needed
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();

  const week = page.getByRole("region", { name: "This week" });
  await expect(week.getByText("Time studied")).toBeVisible();
  await expect(week.getByText("weeks in a row")).toBeVisible();
  // Course names are hidden unless the learner shares them
  const plans = page.getByRole("region", { name: "Study plans" });
  await expect(plans.getByText("Course 1")).toBeVisible();
  await expect(plans.getByText("1 missed session")).toBeVisible();

  const cheerBox = page.getByRole("region", { name: "Cheer Alex on" });
  await cheerBox.getByRole("button", { name: /Proud of you/ }).click();
  await expect(cheerBox.getByText(/Sent! Alex will see/)).toBeVisible();
  expect(cheers).toEqual([{ token: TOKEN, kind: "proud" }]);

  // No sideways scrolling, on phones too
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("a stopped link says so, and a partner's first visit to the app still gets the landing page", async ({ page }) => {
  await mockDatabase(page, null);
  await page.goto(`./#/p/${TOKEN}`);
  await expect(page.getByRole("heading", { name: "This link isn't active", level: 1 })).toBeVisible();

  await page.getByRole("link", { name: "What is KeepOnCourse?" }).click();
  await expect(page).toHaveURL(/#\/welcome$/);
  await page.goto("./");
  await expect(page).toHaveURL(/#\/welcome$/); // opening a partner link isn't a visit to the app
});

test("cheering stops at the daily limit", async ({ page }) => {
  await mockDatabase(page, { ...progress(), cheers_today: 5 });
  await page.goto(`./#/p/${TOKEN}`);
  const cheerBox = page.getByRole("region", { name: "Cheer Alex on" });
  await expect(cheerBox.getByRole("button", { name: /Keep going/ })).toBeDisabled();
  await expect(cheerBox.getByText(/plenty of cheering for today/)).toBeVisible();
});
