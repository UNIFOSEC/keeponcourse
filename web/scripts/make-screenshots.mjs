/**
 * Screenshots for the landing page and the link preview, taken from the
 * running app with its demo data (light theme):
 *
 *   npm run dev                                  # in another terminal
 *   npm run screenshots                          # or: node scripts/make-screenshots.mjs http://localhost:5173
 *   PW_CHANNEL=msedge npm run screenshots        # use an installed browser
 *
 * Writes public/screens/overview.jpg, public/screens/calendar.jpg (1280×800)
 * and public/og.jpg (1200×630, the landing page's top, for link previews).
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.argv[2] || "http://localhost:5173").replace(/\/+$/, "");
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
fs.mkdirSync(path.join(publicDir, "screens"), { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });

async function capture(route, file, { width, height, visited = true }) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: "light", serviceWorkers: "block" });
  await context.addInitScript((visited) => {
    localStorage.setItem("cch.theme", "light");
    localStorage.setItem("cch.welcome.dismissed", "1");
    if (visited) localStorage.setItem("koc.visited", "1");
  }, visited);
  const page = await context.newPage();
  // Keep live services out of the pictures
  await page.route(/workers\.dev|supabase\.co/, (r) => r.abort());
  await page.goto(`${base}/${route}`);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400); // page-in animation
  await page.screenshot({ path: path.join(publicDir, file), type: "jpeg", quality: 82 });
  console.log("wrote", file);
  await context.close();
}

await capture("#/", "screens/overview.jpg", { width: 1280, height: 800 });
await capture("#/calendar", "screens/calendar.jpg", { width: 1280, height: 800 });
await capture("#/welcome", "og.jpg", { width: 1200, height: 630, visited: false });
await browser.close();
