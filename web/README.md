# KeepOnCourse web app

KeepOnCourse helps anyone finish the courses they start. You track courses from **Not Started** to **Completed** on a drag-and-drop board, see your progress and upcoming deadlines at a glance, and chat with Coach, an AI study coach, to plan and catch up.

It's a TypeScript app built with Vite, with no UI framework. It builds to a static site, deployed to Cloudflare at **https://keeponcourse.com**, and it can also use the course API in the parent folder.

## Features

- **Overview:** a greeting, summary tiles (total, in progress, completed, overdue), a completion ring, a status breakdown, and the next five deadlines.
- **Board:** three status columns. Drag a card to another column to change its status. If the save fails, the move is rolled back.
- **List:** a sortable table view with a status filter, plus edit and remove actions on each row.
- **Side panel:** add or edit a course, with instant validation, a character counter and a status picker.
- **Undo instead of "are you sure?":** removing a course takes effect immediately, and a toast offers **Undo**.
- **Coach, an AI learning assistant (Claude):**
  - Replies stream in, rendered as Markdown.
  - It sees your course list, so it can answer "what should I focus on this week?" or "which courses are overdue?" with specifics.
  - It can add, update and remove courses from chat. Each change appears as a card with **Undo** and **Open**.
  - You can stop a reply midway, the chat survives page reloads, and there are suggested prompts to start with.
  - A daily allowance keeps costs predictable: 60 messages for signed-in users, 15 for anonymous visitors. The composer shows how many are left, and invites anonymous visitors to sign in for more.
  - It runs through the proxy in [`../coach`](../coach/README.md).
- **Study plans:** import a syllabus (paste it or upload a PDF) and Coach breaks it into modules with hour estimates, or add modules yourself. Pick your study days, session length, time and target date; a live summary shows when you'll finish. Plans export to any calendar as an `.ics` file (one event per session, with reminders), and each course gets a module checklist and progress bar. Scheduling runs in the browser and is deterministic; Claude only proposes the modules.
- **Check-ins and catch-up:** mark each study session **Done** or **Skip** (from the Calendar, the course, or the Overview's **Today's study** card; every check-in can be undone). Finishing a module's last session ticks the module. When sessions are missed, the course and the Overview say so, and **Catch up** reschedules the remaining work from today: done sessions stay, missed ones are kept as skipped, and you can add study days or change the session length while a live summary compares the new finish date with your target (and offers to move the target if it's later). Coach can do the same from chat ("I was sick this week, fix my Spanish plan"), with Undo. Skipped sessions drop out of calendar exports and the subscription feed.
- **Calendar:** a colour-coded month view of every study session, with a day list and an Upcoming list. Signed-in users can **subscribe once** in Google Calendar, Outlook or Apple Calendar; new and updated plans then appear there automatically. The feed is a private 64-character link that can be reset at any time, and times are sent as UTC from the user's time zone (DST-correct). The plan wizard warns about sessions that overlap another plan and suggests a free time.
- **Weekly check-in email (opt-in):** signed-in users can turn on a Monday-morning email in their account, with the week's study sessions, anything to catch up on, and how each plan is tracking against its target. **Send me a sample** shows what it looks like. Every email has a one-click unsubscribe. Sent by the Coach Worker; setup in [coach/README.md](../coach/README.md#weekly-check-in-email).
- **Accounts with sync:** sign in with a one-time email link or code (no password; the code works on any device, the link in the browser that asked for it) and your courses are stored in your account and synced across devices. You can export your data or delete your account any time, and a new account is offered a copy of your demo courses.
- **Signed out, two data sources switchable at runtime:**
  - **Demo data** (default): sample courses in the visitor's own browser storage. Nothing is sent anywhere, so a public demo needs no server.
  - **Local API:** the Express API from this project (`npm start` in the parent folder).
- **Built for everyone:** light and dark themes (follows the system, or set it manually), keyboard shortcuts (`N` adds a course, `/` searches), full keyboard support, visible focus states, reduced-motion support, and colour contrast of at least 4.5:1 for text.
- **Usage statistics (private):** `#/stats`, not in the menu, shows the site owner weekly active accounts, sign-ups, Coach messages per day (signed in and anonymous), how often people hit the daily limit, 4-week retention, and an AI cost estimate, with progress toward the two Pro-tier signals (300 weekly active accounts, $50 a month). See [Usage statistics](#usage-statistics).
- **Responsive:** a sidebar on desktop, a bottom tab bar on phones, and a board you can swipe sideways.

## Run it

```bash
cd web
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173). The app starts in demo mode.

To use the real API instead, start the server in the parent folder:

```bash
npm start
```

Then click **Data source** in the sidebar, choose **Local API**, and click **Test connection**.

**Accounts** use Supabase (Postgres + Auth). To set up your own project:

1. Create a Supabase project. In **SQL Editor**, run [`supabase/schema.sql`](../supabase/schema.sql) from the repository root.
2. In **Authentication → URL Configuration**, set **Site URL** to your site's address, and add it plus `http://localhost:5173/**` under **Redirect URLs**.
3. Put the project's URL and **publishable** key in `web/.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`). Both are public by design. Never use the service_role/secret key in the web app.

Without these values, the app simply runs without accounts.

**Sign-in emails** for keeponcourse.com are sent through Resend (custom SMTP in Supabase) from `hello@keeponcourse.com`, signed with DKIM and covered by DMARC. The branded template is in [`supabase/email-templates/magic-link.html`](../supabase/email-templates/magic-link.html); paste it into Supabase's **Magic Link** and **Confirm signup** templates. It contains both the link (`{{ .ConfirmationURL }}`, PKCE, so it only works in the browser that asked for it) and the one-time code (`{{ .Token }}`), which the sign-in dialog accepts on any device.

To use **Coach**, start its proxy too (see [coach/README.md](../coach/README.md)). In development, the app expects it at `http://localhost:8787` (`.env.development`). For the published site, set `VITE_COACH_URL` in `.env.production` to your deployed Worker URL. If it's empty, the site still works, and the Coach page explains that it isn't connected.

## Deploy

The site runs on Cloudflare as a static-assets Worker (`wrangler.jsonc`), on the custom domains `keeponcourse.com` and `www.keeponcourse.com`; Cloudflare manages their DNS records and HTTPS certificates. The build also writes `dist/_headers`, so the security policy is sent as real HTTP headers (CSP with `frame-ancestors`, HSTS, permissions policy) and fingerprinted assets are cached for a year.

```bash
npm run deploy   # build + wrangler deploy
```

Normally you don't deploy by hand: every push to `main` deploys from GitHub Actions once all checks pass, browser tests included (see [Deploys](../README.md#deploys)). `npm run deploy` also runs the unit tests before building. The old GitHub Pages address redirects here.

## Tests

```bash
npm test                          # unit tests (Vitest): validation, dates, study plans, .ics export, Markdown, demo storage, Coach's tools
npx playwright install chromium   # once, for the browser tests
npm run test:e2e                  # browser tests (Playwright) against the production build
```

The browser tests run on desktop and phone sizes with Coach and Supabase blocked, so they never touch live services. They fail on any script error or Content Security Policy violation. To use an installed browser instead of Playwright's, set `PW_CHANNEL=msedge` or `PW_CHANNEL=chrome`.

## Build

```bash
npm run build     # type-check + production build into dist/
npm run preview   # serve dist/ locally to check it
```

`dist/` is a static site that uses relative paths, so it works from any sub-path, such as `https://<user>.github.io/keeponcourse/`.

## How it's built

```
src/
  main.ts              entry point
  shell.ts             sidebar, routing (#/, #/courses, #/about), keyboard shortcuts
  app.ts               app state + actions (load, create, update, move, remove, restore)
  types.ts             Course model, shared with the API's JSON shape
  validation.ts        same rules as the API (lengths, real dates, status values)
  dates.ts             "Due in 5 days" / "3 days overdue" wording, local dates
  account.ts           email-link sign-in (Supabase Auth, PKCE), loads the library on demand
  coach/
    session.ts         conversation state, streaming client, request → tool → request loop
    tools.ts           runs Coach's tool calls against the data source; Undo
    markdown.ts        safe Markdown → DOM renderer for replies
  data/
    store.ts           CourseStore interface, settings, localhost-only URL check
    demoStore.ts       localStorage implementation, seeded and sanitized
    apiStore.ts        fetch implementation for the Express API
    accountStore.ts    Supabase implementation for signed-in users
    seed.ts            sample courses, dated relative to today
  ui/                  DOM helper, icons, toasts, panel, dialogs, theme
  views/               overview, courses (board + list), coach, about
  styles.css           design tokens + components, light and dark
  coach.css            chat UI
```

All three data sources (demo, local API, account) implement the same `CourseStore` interface, so the UI never needs to know which one it's using.

## Usage statistics

The Stats page (`https://keeponcourse.com/#/stats`) shows totals only, never names, emails, course content or chats, and only to accounts listed in the database:

1. Re-run [`supabase/schema.sql`](../supabase/schema.sql) in the Supabase **SQL Editor** (it adds the statistics functions and token columns).
2. Sign in to KeepOnCourse once with your own email, then add your account as a viewer in the SQL Editor:

   ```sql
   insert into public.stats_viewers (user_id)
   select id from auth.users where email = 'you@example.com'
   on conflict do nothing;
   ```

Where the numbers come from:

- **Accounts:** the database function `app_stats()`. "Active" means the account used Coach, or added or changed a course, that day. Demo-mode visitors keep everything in their browser, so they aren't counted.
- **Anonymous Coach use:** per-visitor counters in Workers KV (a hash, kept two days), added up into daily totals by a daily cron job in the Coach Worker.
- **AI cost:** the Coach Worker records the tokens of each signed-in reply; the page prices them for the configured model and applies the average to all messages. The exact charges are in the Anthropic Console, where you can also set a monthly spend limit.
- **Visitors (optional):** set `VITE_CF_ANALYTICS_TOKEN` to a [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/) site token to count page visits without cookies. The build then adds Cloudflare's beacon and allows it in the security policy, and the privacy policy mentions it. When it's empty, nothing is added.

## Security notes

- **Strict Content Security Policy** in the production build. Only this site's own scripts, styles and fonts load: no inline scripts, no CDNs, and the Inter font is self-hosted. The one optional exception is Cloudflare's Web Analytics beacon, allowed only when `VITE_CF_ANALYTICS_TOKEN` is set. Network calls are limited to the app itself, `localhost`, the Coach proxy and the Supabase project, whose origins are added from `VITE_COACH_URL` and `VITE_SUPABASE_URL` at build time.
- **Accounts are isolated by the database.** Row-level security means a signed-in user can only read and change their own courses; anonymous requests are refused outright. Column grants stop the app from writing ids, owners or timestamps, and the database repeats the app's validation, plus a 500-course cap. Sign-in links use the PKCE flow, so no tokens appear in the URL.
- **Coach output is untrusted.** Tool calls are validated with the course form's rules before they're applied, and every change can be undone. Replies go through a Markdown renderer that builds DOM nodes and allows only `http(s)` links. The Coach proxy's own protections are listed in [coach/README.md](../coach/README.md#security).
- **No `innerHTML`.** Every element is built with `document.createElement`, and all user text goes in as text nodes. That rules out stored XSS by design, not by remembering to escape.
- **Validation on both sides.** The browser validates for instant feedback, and the API validates again with the same rules.
- **API URL restricted to localhost**, so the app can't be pointed at an outside server.
- **Untrusted storage is sanitized.** Demo data read from localStorage is checked field by field, and anything malformed is dropped.

