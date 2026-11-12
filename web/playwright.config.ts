import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests of the built app (demo mode, no account), served by `vite preview`
 * with the same Content Security Policy as production.
 *
 *   npx playwright install chromium   # once
 *   npm run test:e2e
 *
 * PW_CHANNEL=msedge (or chrome) runs them in an installed browser instead.
 */
const channel = process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    timezoneId: "America/New_York",
    // The service worker would bypass page.route (used to block live services);
    // the installable-app test turns it back on
    serviceWorkers: "block",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel } },
  ],
  webServer: {
    command: "npm run build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
