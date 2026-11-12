import { expect, test } from "@playwright/test";

/** The installed-app basics: a valid manifest with icons, a service worker, and opening offline. */
test.use({ serviceWorkers: "allow" });

test("is installable and opens offline", async ({ page, context }) => {
  // Live services stay out of this test without page.route: Coach and accounts are simply offline later
  await page.goto("./");

  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifestUrl = new URL(href!, page.url()).href;
  const manifest = await (await page.request.get(manifestUrl)).json();
  expect(manifest).toMatchObject({ name: "KeepOnCourse", display: "standalone" });
  expect(manifest.icons.some((i: { sizes: string; purpose: string }) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
  for (const icon of manifest.icons) {
    const response = await page.request.get(new URL(icon.src, manifestUrl).href);
    expect(response.status(), icon.src).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
  }

  const version = await (await page.request.get(new URL("version.json", page.url()).href)).json();
  expect(version.build).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);

  // The service worker takes control of the page
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15_000 });

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("main h1").first()).toBeVisible();
  await expect(page).toHaveTitle(/KeepOnCourse/);
  await page.goto("./#/calendar");
  await expect(page.getByRole("heading", { name: "Calendar", level: 1 })).toBeVisible();
  await context.setOffline(false);
});
