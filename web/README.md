# KeepOnCourse web app

KeepOnCourse helps anyone finish the courses they start. You track courses from **Not Started** to **Completed** on a drag-and-drop board, see your progress and upcoming deadlines at a glance, and chat with Coach, an AI study coach, to plan and catch up.

It's a TypeScript app built with Vite, with no UI framework. It builds to a static site that can be hosted anywhere, including GitHub Pages, and it can also use the course API in the parent folder.

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
- **Accounts with sync:** sign in with a one-time email link (no password) and your courses are stored in your account and synced across devices. You can export your data or delete your account any time, and a new account is offered a copy of your demo courses.
- **Signed out, two data sources switchable at runtime:**
  - **Demo data** (default): sample courses in the visitor's own browser storage. Nothing is sent anywhere, so a public demo needs no server.
  - **Local API:** the Express API from this project (`npm start` in the parent folder).
- **Built for everyone:** light and dark themes (follows the system, or set it manually), keyboard shortcuts (`N` adds a course, `/` searches), full keyboard support, visible focus states, reduced-motion support, and colour contrast of at least 4.5:1 for text.
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

To use **Coach**, start its proxy too (see [coach/README.md](../coach/README.md)). In development, the app expects it at `http://localhost:8787` (`.env.development`). For the published site, set `VITE_COACH_URL` in `.env.production` to your deployed Worker URL. If it's empty, the site still works, and the Coach page explains that it isn't connected.

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

## Security notes

- **Strict Content Security Policy** in the production build. Only this site's own scripts, styles and fonts load: no inline scripts, no CDNs, and the Inter font is self-hosted. Network calls are limited to the app itself, `localhost`, the Coach proxy and the Supabase project, whose origins are added from `VITE_COACH_URL` and `VITE_SUPABASE_URL` at build time.
- **Accounts are isolated by the database.** Row-level security means a signed-in user can only read and change their own courses; anonymous requests are refused outright. Column grants stop the app from writing ids, owners or timestamps, and the database repeats the app's validation, plus a 500-course cap. Sign-in links use the PKCE flow, so no tokens appear in the URL.
- **Coach output is untrusted.** Tool calls are validated with the course form's rules before they're applied, and every change can be undone. Replies go through a Markdown renderer that builds DOM nodes and allows only `http(s)` links. The Coach proxy's own protections are listed in [coach/README.md](../coach/README.md#security).
- **No `innerHTML`.** Every element is built with `document.createElement`, and all user text goes in as text nodes. That rules out stored XSS by design, not by remembering to escape.
- **Validation on both sides.** The browser validates for instant feedback, and the API validates again with the same rules.
- **API URL restricted to localhost**, so the app can't be pointed at an outside server.
- **Untrusted storage is sanitized.** Demo data read from localStorage is checked field by field, and anything malformed is dropped.

## Roadmap

- Automated tests (API and proxy with `node:test`, browser with Playwright) and continuous deployment to GitHub Pages.
