import { expect, test, type Page } from "@playwright/test";

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
  for (const route of ["", "courses", "calendar", "coach", "about", "privacy", "terms"]) {
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
