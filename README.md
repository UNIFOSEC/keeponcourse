# KeepOnCourse

**Your AI coach for finishing any course.**

[![CI](https://github.com/UNIFOSEC/keeponcourse/actions/workflows/ci.yml/badge.svg)](https://github.com/UNIFOSEC/keeponcourse/actions/workflows/ci.yml) [![CodeQL](https://github.com/UNIFOSEC/keeponcourse/actions/workflows/codeql.yml/badge.svg)](https://github.com/UNIFOSEC/keeponcourse/actions/workflows/codeql.yml)

**Live:** https://keeponcourse.com · part of [Jose Ernest's portfolio](https://unifosec.github.io/#projects)

KeepOnCourse helps anyone finish the courses they start, whether online classes, university modules, certifications, languages or creative skills. You track courses on a board, see what's due and what's slipping, and chat with **Coach** (Claude) to plan your study time, understand topics, and update your course list.

The project started as **CodeCraftHub**, the final project of an AI-assisted development course. Those course deliverables are kept in this repository:

1. **Backend**: a REST API (Node.js + Express) with full CRUD for course listings. Data is stored in a JSON file, so you don't need a database.
2. **Frontend**: a single-file dashboard (`dashboard.html`) that calls the API from your browser.

The current product lives in [`web/`](web/README.md) (the app) and [`coach/`](coach/README.md) (the AI proxy).

## Project files

| File | What it is |
| --- | --- |
| `app.js` | The Express API server |
| `courses.json` | The data file. The API reads and writes it. |
| `dashboard.html` | The CRUD dashboard UI (HTML, CSS and JS in one file). This is the version submitted for the course. |
| `web/` | **KeepOnCourse**, the web app (TypeScript + Vite). It has its own [README](web/README.md). |
| `coach/` | The **Coach** proxy, a Cloudflare Worker that connects the web app's AI assistant to Claude. It has its own [README](coach/README.md). |
| `supabase/schema.sql` | The accounts database: courses table, row-level security, grants, and account deletion. See the [web README](web/README.md). |
| `test/` | Automated tests for the API (`npm test`) |
| `.github/` | CI, CodeQL and Dependabot (see [Tests and CI](#tests-and-ci)) |
| `BOLT_PROMPT.md` | The prompt that generates the dashboard in Bolt.new / Bolt.diy |
| `package.json` | Dependencies and npm scripts |

## Prerequisites

- [Node.js](https://nodejs.org/) 14 or newer (`node --version`)
- npm, which comes with Node (`npm --version`)
- curl, for testing (`curl --version`)

## Run it

```bash
npm install
npm start
```

You should see:

```
KeepOnCourse API is starting...
API will be available at: http://localhost:5000
```

For auto-restart while you edit, run `npm run dev` (uses Node's built-in `--watch`). To use a different port, set `PORT` before starting. On macOS/Linux that's `PORT=3000 npm start`; in PowerShell it's `$env:PORT=3000; npm start`.

Then open `dashboard.html` in your browser by double-clicking it. The dashboard expects the API at `http://localhost:5000/api/courses`. If you changed the port, edit `API_BASE_URL` at the top of the dashboard's `<script>`.

## The course model

| Field | Type | Rules |
| --- | --- | --- |
| `id` | number | Assigned by the server |
| `name` | string | Required, 1–100 characters |
| `description` | string | Required, 1–1000 characters |
| `target_date` | string | Required, a real date in `YYYY-MM-DD` format |
| `status` | string | Required. One of `Not Started`, `In Progress`, `Completed` |
| `created_at` | string | Set by the server, `YYYY-MM-DD HH:MM:SS` (UTC) |
| `updated_at` | string | Set by the server on every update |

## Endpoints

Base URL: `http://localhost:5000`

| Method | Path | What it does | Success |
| --- | --- | --- | --- |
| GET | `/` | API info and endpoint list | 200 |
| GET | `/api/courses` | List all courses. Optional `?status=In%20Progress` filter. | 200 |
| GET | `/api/courses/:id` | Get one course | 200 |
| POST | `/api/courses` | Create a course (all four fields required) | 201 |
| PUT | `/api/courses/:id` | Update a course (send only the fields you want to change) | 200 |
| DELETE | `/api/courses/:id` | Delete a course | 200 |
| GET | `/api/courses/stats` | Count of courses per status | 200 |
| GET | `/api/courses/search?q=term` | Search name and description | 200 |

Every response is JSON and has a `success` field.

```json
{ "success": true, "count": 3, "courses": [ ... ] }
{ "success": false, "error": "Course with ID 99 not found" }
```

When more than one field is invalid, the error response also has a `details` array listing each problem.

### Status codes

| Code | Meaning |
| --- | --- |
| 200 | OK |
| 201 | Course created |
| 400 | Bad input: missing or invalid fields, malformed JSON, non-numeric ID, unknown status |
| 404 | No course with that ID, or no such endpoint |
| 500 | Server problem, such as an unreadable or corrupted `courses.json` |

## Test with curl

These examples work in bash, Git Bash and macOS/Linux terminals. For Windows PowerShell, use `curl.exe` instead of `curl` and see the troubleshooting section for quoting.

```bash
# List all courses
curl http://localhost:5000/api/courses

# Create a course (201)
curl -X POST http://localhost:5000/api/courses \
  -H "Content-Type: application/json" \
  -d '{"name":"Node.js APIs","description":"Build REST APIs with Express","target_date":"2026-12-31","status":"Not Started"}'

# Get one course
curl http://localhost:5000/api/courses/4

# Update just the status
curl -X PUT http://localhost:5000/api/courses/4 \
  -H "Content-Type: application/json" \
  -d '{"status":"In Progress"}'

# Delete it
curl -X DELETE http://localhost:5000/api/courses/4

# Bonus endpoints
curl http://localhost:5000/api/courses/stats
curl "http://localhost:5000/api/courses/search?q=python"

# See the status code too
curl -i http://localhost:5000/api/courses/999          # 404
curl -i -X POST http://localhost:5000/api/courses \
  -H "Content-Type: application/json" -d '{"name":"x"}' # 400
```

## Tests and CI

```bash
npm test
```

This runs the API tests (`test/api.test.js`, Node's built-in test runner) against a temporary copy of the data, so `courses.json` is never changed. They cover every endpoint, validation errors, malformed JSON, CORS, and that a corrupted data file is never overwritten.

Every push and pull request runs the whole suite on GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

| Job | What it checks |
| --- | --- |
| Course API | `npm test` in the root |
| Web app | Type-check, unit tests (Vitest), production build |
| Coach Worker | Type-check, tests of validation, allowances, the planner, the calendar feed and the request handler (against a scripted stand-in for Claude, so no API key or cost) |
| Browser tests | Playwright on desktop and phone sizes, against the production build: add, edit, remove and undo a course, build a study plan, every page, no sideways scrolling, and no script errors or security-policy violations |
| Dependency audit | `npm audit` fails on high or critical advisories |

**CodeQL** scans the code for security problems on every push and weekly, and **Dependabot** opens weekly grouped dependency updates, which CI tests before they can merge.

### Deploys

Deploys run from CI only, after every check passes, so a change that breaks something never reaches keeponcourse.com. Each push to `main` runs the checks, then the deploy job publishes the Coach Worker and the web app with Wrangler and confirms that both answer. To redeploy without a new commit, choose **Actions → CI → Run workflow** on `main`.

How it's set up:

- GitHub repository secrets `CLOUDFLARE_API_TOKEN` (a Cloudflare API token that can edit both Workers, `codecrafthub-coach` and `keeponcourse-web`) and `CLOUDFLARE_ACCOUNT_ID`. Without them, the deploy job only leaves a notice.
- Cloudflare's own Git builds (Workers Builds) are disconnected, so nothing deploys around the tests. The web build still runs the unit tests first (`web/wrangler.jsonc`), including for a manual `npm run deploy`.
- The job uses the `production` environment, so you can require an approval there (Settings → Environments).

## CORS

The API uses the [`cors`](https://www.npmjs.com/package/cors) middleware with default settings, which allows requests from any origin. That's why the dashboard works when you open it from a `file://` path or from a Bolt preview. To check it:

```bash
curl -i -X OPTIONS http://localhost:5000/api/courses -H "Origin: http://example.com" -H "Access-Control-Request-Method: POST"
```

The response should include `Access-Control-Allow-Origin: *`. For a real deployment, restrict it, for example `cors({ origin: "https://your-site.example" })`.

## Generating the dashboard with Bolt

1. Start the backend (`npm start`) and confirm `curl http://localhost:5000/api/courses` works.
2. Open Bolt.new or Bolt.diy and paste the prompt from `BOLT_PROMPT.md`. Check that the base URL in it matches your server first.
3. Preview the result in Bolt, then copy or export the generated `index.html` into this folder.
4. Open it in your browser with the backend running, and test create, edit, delete, search and filter.

> **Note:** Bolt's hosted preview runs on HTTPS, and some browsers block HTTPS pages from calling `http://localhost`. If the preview can't load data, that's expected. Test the exported file locally instead.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Error: Cannot find module 'express'` or `'cors'` | Run `npm install` in the project folder |
| `EADDRINUSE: address already in use :::5000` | Another process is on port 5000. On macOS this is often AirPlay Receiver. Stop that process or run on another port (`PORT=3000 npm start`) and update `API_BASE_URL` in the dashboard. |
| Dashboard shows "API unreachable" | Start the server, check the port, then click **Refresh** |
| Browser console shows a CORS error | Make sure you're running this `app.js` (it calls `app.use(cors())`) and restart the server after edits |
| `400 Malformed JSON in request body` | Check your JSON. In PowerShell, single-quoted JSON gets mangled, so use `curl.exe` with a file: `curl.exe -X POST http://localhost:5000/api/courses -H "Content-Type: application/json" --data "@course.json"` |
| `400 Request body must be a JSON object` | Add the `-H "Content-Type: application/json"` header |
| `500 ... Unexpected token` on every request | `courses.json` is corrupted. Fix the JSON or replace its contents with `[]`. The server deliberately won't overwrite a corrupted file. |

## License

MIT
