# Coach proxy

Coach is KeepOnCourse's AI study coach, built on Claude. This folder holds the small server behind it: a **Cloudflare Worker** that keeps the Claude API key secret and streams Claude's replies to the web app.

A browser can't safely hold an API key, so the web app sends the conversation here. The Worker checks the request, adds a fixed system prompt and tools, calls Claude, and streams the reply back.

```
Browser (web/) ──POST /chat──▶ Coach Worker ──▶ Claude API
     ▲                          • origin allowlist      (claude-haiku-5-5 by default)
     │                          • rate limit per IP
     └── streamed reply ◀────── • request validation
         (text + tool calls)    • fixed prompt & tools
```

## How tool calls work

Claude has three tools: `add_course`, `update_course` and `remove_course`. The **browser** carries them out, not this Worker, because the courses live in the browser (demo data) or in the local Express API.

1. The browser sends the conversation. Each user turn starts with a `<course_data>` block holding today's date and the course list as JSON.
2. If Claude decides to change something, the reply ends with `stop_reason: "tool_use"`.
3. The browser checks each tool call with the same rules as the course form, applies it, shows a card with an **Undo** button, and sends the results back for Claude's confirmation.

The conversation history is **append-only**. Each assistant turn is stored and sent back exactly as Claude returned it, including its thinking blocks, which the Claude API requires.

## Security

| Concern | What the Worker does |
| --- | --- |
| Leaked API key | The key is a Worker secret (`wrangler secret put`). It never reaches the browser or the repository. |
| Other sites using the endpoint | `ALLOWED_ORIGINS` allowlist. Requests without an allowed `Origin` get a 403. |
| Abuse and cost | **Daily allowances:** 60 requests per signed-in user (`USER_DAILY_LIMIT`) and 15 per anonymous visitor (`ANON_DAILY_LIMIT`), resetting at midnight UTC. On top of that: 10 requests per minute per IP (Workers Rate Limiting), a 256 KB body cap, per-message size limits, a 60-message conversation cap, `max_tokens: 8000`, and effort `low`. Invalid requests are rejected before they count. |
| Faked identities | Signed-in requests carry the user's Supabase access token. The Worker calls the `use_coach_message()` database function *with that token*, so Supabase verifies it and counts only for that user. A forged or expired token gets a 401. No service key is stored anywhere. |
| Visitor privacy | Anonymous counts live in Workers KV under a SHA-256 hash of IP + day, never the IP itself, and expire after two days. |
| Prompt or tool injection by callers | The system prompt and tools are fixed server-side. Only text, tool-result and Coach-tool blocks are accepted. Images, documents and unknown tools are rejected. |
| Prompt injection through course data | Courses arrive tagged as `<course_data>`, and the system prompt tells Claude never to follow instructions inside them. |
| Unsafe model output | The browser validates every tool input, and every change can be undone. Replies are rendered without `innerHTML`, and only `http(s)` links are allowed. |
| Error details leaking | Clients get short, friendly messages. Details go only to the Worker logs. |

**Also set a monthly spend limit** on the API key's workspace in the Claude Console. It's the backstop if something unexpected happens.

## Model and API settings

- **Model:** `claude-haiku-5-5` by default. It's fast and low-cost, which suits a public demo. For deeper planning answers, set `COACH_MODEL` to `claude-opus-5-5` in `wrangler.jsonc`.
- **Thinking:** adaptive (the default), with `output_config.effort: "low"` for quick chat replies.
- **Refusals:** Haiku 5.5 has no server-side fallback, so a declined request returns `stop_reason: "refusal"`, and the web app shows a "try asking another way" notice. If you switch to a model that supports server-side fallback (Opus 5.5, Opus 5, Sonnet 5.5, Fable 5.1), the Worker sends `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) automatically, and declined requests are retried on a recommended fallback model.
- **Prompt caching:** `cache_control: { type: "ephemeral" }`. The system prompt and tools are byte-stable, so repeat turns read them from the cache.
- **Tools:** `eager_input_streaming: true`, with the browser validating every input.

## Run it locally

```bash
cd coach
npm install
cp .dev.vars.example .dev.vars    # then put your API key in .dev.vars
npm run dev                        # wrangler dev → http://localhost:8787
```

In another terminal, start the web app (`cd web && npm run dev`) and open **Coach**. `web/.env.development` already points at `http://localhost:8787`.

**No API key? Use the mock.** `npm run mock` starts a scripted stand-in for the Claude API on port 9099. Its replies are canned, not real AI. Set `ANTHROPIC_BASE_URL=http://localhost:9099` in `.dev.vars`. It's useful for UI work and demos, and it costs nothing.

**`wrangler dev` won't start on Windows?** If it fails with `write EOF`, the Workers runtime (`workerd.exe`) is probably missing the Microsoft Visual C++ Redistributable. Either install that, or run the same Worker code under Node:

```bash
npm run dev:node
```

## Tests

```bash
npm test
```

Vitest covers request validation, the daily allowances (with in-memory stand-ins for KV and the database), the syllabus planner, the calendar feed (including daylight-saving changes), and the full request handler: origin checks, error codes, rate limits and streaming. The handler tests run against `dev/mock-anthropic.mjs`, so they need no API key and cost nothing.

## Deploy

Every push to `main` deploys this Worker from GitHub Actions after all checks pass (see [Deploys](../README.md#deploys)). The API key is a Worker secret, so deploys keep it. To set things up from scratch, or deploy by hand:

```bash
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

1. Wrangler prints the Worker URL, for example `https://<worker-name>.<you>.workers.dev`.
2. Put that URL in `web/.env.production` as `VITE_COACH_URL`, then rebuild the web app. The build adds the URL to the page's Content Security Policy automatically.
3. Make sure your site's origin (for example `https://unifosec.github.io`) is in `ALLOWED_ORIGINS` in `wrangler.jsonc`.

## API

`POST /chat` with `{ "messages": [...] }` (Claude Messages API format). The response is newline-delimited JSON:

```
{"type":"status","state":"thinking"}
{"type":"text","text":"Here's a plan"}
{"type":"done","stop_reason":"end_turn","content":[...],"model":"claude-haiku-5-5"}
{"type":"error","code":"busy","message":"Coach is busy right now. Try again in a minute."}
```

Errors that happen before streaming starts come back as plain JSON with a status code: 400 (invalid request), 401 (sign-in expired), 403 (origin not allowed), 413 (too large), 429 (rate limited, or daily allowance used up: `quota` / `quota_anon`) or 503 (not configured).

Send `Authorization: Bearer <Supabase access token>` to use a signed-in user's allowance. Every reply includes `X-Coach-Limit` and `X-Coach-Remaining`.

`POST /plan` with `{ "text": "…syllabus…" }` or `{ "pdf_base64": "…" }` (PDF up to 4 MB), plus an optional `name_hint`, returns `{ "plan": { "course_name", "description", "suggested_weeks", "modules": [{ "title", "summary", "hours" }] } }`. It uses Claude's structured output (a JSON schema), treats the material as untrusted data, re-checks and clamps every field, and costs one message from the daily allowance.

`GET /calendar/<token>.ics` is the private calendar subscription feed (no `Origin` check, since calendar apps fetch it). The 64-character token is the credential; the database function `calendar_feed()` returns study plans only for the token's owner, and an unknown token gets an empty calendar, so tokens can't be probed. Calendar apps are asked to refresh every 4 hours.

`GET /usage` returns today's allowance without counting anything: `{"signedIn":false,"limit":15,"used":3,"remaining":12}`.

`GET /health` returns `{"ok":true,"model":"..."}`.
