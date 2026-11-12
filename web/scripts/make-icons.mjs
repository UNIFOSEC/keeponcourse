/**
 * Renders the app icons (PNG) from the compass logo, using the browser that
 * Playwright drives. Run after changing the logo:
 *
 *   npm run icons                  # Playwright's Chromium
 *   PW_CHANNEL=msedge npm run icons  # or an installed browser
 *
 * - icon-192.png, icon-512.png: the logo with rounded corners (purpose "any")
 * - icon-maskable-512.png: full-bleed background, logo inside the 80% safe
 *   zone, so Android can crop it to any shape (purpose "maskable")
 * - apple-touch-icon.png (180): full-bleed; iOS rounds the corners itself
 */
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const GRADIENT = `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#6366f1"/></linearGradient>`;
const COMPASS = `<circle cx="16" cy="16" r="9.5" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M20.6 11.4 18.2 18.2 11.4 20.6 13.8 13.8Z" fill="#fff"/><circle cx="16" cy="16" r="1.4" fill="url(#g)"/>`;

/** The logo as in the app: rounded square, compass filling it. */
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs>${GRADIENT}</defs><rect width="32" height="32" rx="8" fill="url(#g)"/>${COMPASS}</svg>`;

/** Full-bleed square; the compass is scaled into the central safe zone. */
const fullBleed = (scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs>${GRADIENT}</defs><rect width="32" height="32" fill="url(#g)"/><g transform="translate(16 16) scale(${scale}) translate(-16 -16)">${COMPASS}</g></svg>`;

const icons = [
  { file: "icon-192.png", size: 192, svg: rounded },
  { file: "icon-512.png", size: 512, svg: rounded },
  { file: "icon-maskable-512.png", size: 512, svg: fullBleed(0.72) },
  { file: "apple-touch-icon.png", size: 180, svg: fullBleed(0.85) },
];

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const page = await browser.newPage();
for (const { file, size, svg } of icons) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.locator("svg").screenshot({ path: path.join(out, file), omitBackground: true });
  console.log("wrote", file);
}
await browser.close();
