import { expect, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.route(/workers\.dev|supabase\.co/, (route) => route.abort());
});

test("a first visit shows the landing page; trying the demo opens the app, and it remembers", async ({ page }) => {
  await page.goto("./");
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(page.getByRole("heading", { name: "Finish the courses you start.", level: 1 })).toBeVisible();
  await expect(page.getByRole("img", { name: /KeepOnCourse overview/ })).toBeVisible();
  // The app's menu is hidden on the landing page
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();

  await page.getByRole("link", { name: /Try it now/ }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("region", { name: "Today's study" })).toBeVisible(); // the demo's sample plan
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();

  // Next time, the bare address opens the app directly
  await page.goto("./");
  await expect(page).not.toHaveURL(/welcome/);
});

test("links straight into the app skip the landing page", async ({ page }) => {
  await page.goto("./#/calendar");
  await expect(page.getByRole("heading", { name: "Calendar", level: 1 })).toBeVisible();
});

test("sign in from the landing page opens the sign-in dialog", async ({ page }) => {
  await page.goto("./");
  await page.locator(".landing-hero").getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("dialog", { name: "Sign in to KeepOnCourse" })).toBeVisible();
});

test("the link preview image and tags are in place", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://keeponcourse.com/og.jpg");
  const image = await page.request.get("og.jpg");
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toContain("image/jpeg");
});
