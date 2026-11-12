import { expect, test, type Page } from "./fixtures";

/**
 * The main demo-mode flows, in a real browser, against the production build.
 * Coach and Supabase are blocked, so the tests never reach live services.
 */

const problems = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const found: string[] = [];
  problems.set(page, found);
  await page.route(/workers\.dev|supabase\.co/, (route) => route.abort());
  page.on("pageerror", (error) => found.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    // Blocked requests to Coach/Supabase are expected here; anything else is a problem
    if (message.type() === "error" && !/ERR_FAILED|Failed to fetch|Failed to load resource/.test(message.text())) {
      found.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(() => {
    // A returning visitor, so the bare address opens the app (landing.e2e.ts covers first visits)
    localStorage.setItem("koc.visited", "1");
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
});

test.afterEach(async ({ page }) => {
  expect(problems.get(page), "no script errors or CSP violations").toEqual([]);
});

async function openNav(page: Page, name: string) {
  await page.goto(`./#/${name === "Overview" ? "" : name.toLowerCase()}`);
}

test("the overview loads with the sample courses", async ({ page }) => {
  await page.goto("./");
  await expect(page).toHaveTitle(/KeepOnCourse/);
  await expect(page.getByRole("region", { name: "Summary" })).toBeVisible();
  await expect(page.locator('a[href="#/privacy"]').first()).toBeAttached();
});

test("every page opens without errors", async ({ page }) => {
  for (const route of ["", "courses", "calendar", "coach", "about", "privacy", "terms", "stats"]) {
    await page.goto(`./#/${route}`);
    await expect(page.locator("main h1").first()).toBeVisible();
  }
});

test("add a course, find it after a reload, then remove it and undo", async ({ page }) => {
  await openNav(page, "Courses");
  await page.getByRole("button", { name: "New course" }).first().click();

  const panel = page.getByRole("dialog", { name: "New course" });
  // The form checks fields before saving
  await panel.getByRole("button", { name: "Add course" }).click();
  await expect(panel.getByText("Give the course a name.")).toBeVisible();

  await panel.getByLabel("Course name").fill("Watercolor painting");
  await panel.getByLabel("Description").fill("Washes, layering and color mixing");
  await panel.getByRole("button", { name: "Add course" }).click();
  await expect(panel).toBeHidden();
  const card = page.locator("article.course-card", { hasText: "Watercolor painting" });
  await expect(card).toBeVisible();

  await page.reload();
  await expect(card).toBeVisible();

  await card.getByText("Watercolor painting").click();
  const edit = page.getByRole("dialog", { name: "Edit course" });
  page.once("dialog", (dialog) => dialog.accept());
  await edit.getByRole("button", { name: "Remove" }).click();
  await expect(card).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(card).toBeVisible();
});

test("search narrows the course list", async ({ page }) => {
  await openNav(page, "Courses");
  const search = page.getByRole("searchbox", { name: "Search courses" }).or(page.getByLabel("Search courses"));
  await search.fill("zzzz-no-such-course");
  await expect(page.getByText(/no courses match|nothing matches|no matches/i).first()).toBeVisible();
});

test("build a study plan by hand and see it on the calendar", async ({ page }) => {
  await openNav(page, "Courses");
  await page.getByRole("button", { name: "Import syllabus" }).first().click();
  const wizard = page.getByRole("dialog");
  await wizard.getByRole("button", { name: "Add modules myself" }).click();

  await wizard.getByLabel("Course name").fill("Guitar fundamentals");
  await wizard.getByLabel("Description").fill("Chords, rhythm and first songs");
  await wizard.getByLabel("Module 1 title").fill("Open chords");
  await wizard.getByRole("button", { name: "Add module" }).click();
  await wizard.getByLabel("Module 2 title").fill("Strumming patterns");

  await wizard.getByRole("button", { name: "Create course with plan" }).click();
  await expect(wizard).toBeHidden();
  await expect(page).toHaveURL(/#\/calendar$/);
  await expect(page.getByText(/Study plan saved: \d+ sessions/)).toBeVisible();
  await expect(page.getByText(/Open chords/).first()).toBeVisible();
});

test("the layout never scrolls sideways", async ({ page }) => {
  for (const route of ["", "courses", "calendar", "coach"]) {
    await page.goto(`./#/${route}`);
    await expect(page.locator("main h1").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `#/${route}`).toBeLessThanOrEqual(0);
  }
});

test("the private Stats page asks visitors to sign in and shows no numbers", async ({ page }) => {
  await page.goto("./#/stats");
  await expect(page.getByRole("heading", { name: "Stats", level: 1 })).toBeVisible();
  await expect(page.getByText("Sign in to see statistics")).toBeVisible();
  await expect(page.locator(".kpi")).toHaveCount(0);
  // Not linked from the menu
  await expect(page.locator('nav a[href="#/stats"]')).toHaveCount(0);
});

test("check in a study session and catch up after missed ones", async ({ page }) => {
  // A plan that started two weeks ago on every day, with nothing checked in
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    const iso = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    };
    const modules = ["Warm-up", "Scales", "Songs"].map((title) => ({ title, summary: "", hours: 5, done: false }));
    const sessions = Array.from({ length: 15 }, (_, i) => ({ date: iso(i - 14), minutes: 60, module: Math.floor(i / 5) }));
    const course = {
      id: 1000,
      name: "Piano basics",
      description: "Learn to play simple songs",
      target_date: iso(30),
      status: "In Progress",
      created_at: "2026-01-01 00:00:00",
      plan: { version: 1, days: [0, 1, 2, 3, 4, 5, 6], session_minutes: 60, start_time: "19:00", start_date: iso(-14), modules, sessions },
    };
    localStorage.setItem("cch.demo.courses.v2", JSON.stringify([course]));
  });
  await page.goto("./");

  const today = page.getByRole("region", { name: "Today's study" });
  await expect(today.getByText("14 missed sessions")).toBeVisible();
  await today.getByRole("button", { name: /Mark "Songs" session done/ }).click();
  await expect(page.getByText("Session done. Nice work!")).toBeVisible();

  await today.getByRole("button", { name: "Catch up" }).click();
  const dialog = page.getByRole("dialog", { name: /Catch up on/ });
  await expect(dialog.getByText("You missed 14 sessions")).toBeVisible();
  await dialog.getByRole("button", { name: "Reschedule" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Plan rescheduled: finishing/)).toBeVisible();
  await expect(today.getByText(/missed session/)).toHaveCount(0);
});

test("run a focus session: the timer counts, minimizes, survives a reload, and checks the session in with the minutes", async ({ page }) => {
  await page.clock.install();
  // A course with a one-hour session today (the demo's plan runs Mon/Wed/Fri)
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    const d = new Date();
    const today = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const plan = { version: 1, days: [0, 1, 2, 3, 4, 5, 6], session_minutes: 60, start_time: "19:00", start_date: today, modules: [{ title: "Scales", summary: "", hours: 2, done: false }], sessions: [{ date: today, minutes: 60, module: 0 }, { date: today.slice(0, 8) + "28", minutes: 60, module: 0 }] };
    localStorage.setItem("cch.demo.courses.v2", JSON.stringify([{ id: 1, name: "Piano", description: "d", target_date: "2099-01-01", status: "In Progress", created_at: "2026-01-01 00:00:00", plan }]));
  });
  await page.goto("./#/");
  const today = page.getByRole("region", { name: "Today's study" });
  await today.getByRole("button", { name: /Start a focus timer/ }).first().click();

  const focus = page.getByRole("dialog", { name: /.+/ }).filter({ has: page.getByRole("timer") });
  await expect(focus).toBeVisible();
  await expect(focus.getByRole("timer")).toHaveText(/^(60:00|59:5\d)$/);

  await page.clock.fastForward("25:00");
  await expect(focus.getByRole("timer")).toHaveText(/^3[45]:\d\d$/);

  // Minimize, then reload: the timer keeps going in the corner
  await focus.getByRole("button", { name: "Minimize the timer" }).click();
  await expect(focus).toBeHidden();
  const pill = page.locator(".focus-pill");
  await expect(pill).toBeVisible();
  await page.reload();
  await expect(pill).toBeVisible();
  await expect(page).toHaveTitle(/^⏱ /);

  await page.clock.fastForward("40:00"); // past the planned hour
  await pill.click();
  await expect(focus.getByRole("timer")).toHaveText(/^\+\d+:\d\d$/);
  await focus.getByRole("button", { name: "Finish and check in" }).click();
  await expect(page.getByText(/You studied 6\d min\./)).toBeVisible();
  await expect(pill).toBeHidden();
  await expect(page).not.toHaveTitle(/^⏱ /);
  await expect(today.getByText(/This week: 1 of 1 session done · 1h \d+m/)).toBeVisible();
});
