/**
 * Tests for the course API (app.js), using Node's built-in test runner.
 * Each run uses a temporary copy of the data, so courses.json is never touched.
 *
 *   npm test
 */
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "koc-api-"));
const DATA_FILE = path.join(dir, "courses.json");
process.env.COURSES_FILE = DATA_FILE;
const app = require("../app");

const SEED = [
  { id: 1, name: "Python Basics", description: "Variables and loops", target_date: "2026-12-01", status: "In Progress", created_at: "2026-01-01 00:00:00" },
  { id: 2, name: "Web Design", description: "HTML and CSS layout", target_date: "2027-01-15", status: "Not Started", created_at: "2026-01-02 00:00:00" },
  { id: 5, name: "Statistics", description: "Probability and Python notebooks", target_date: "2026-10-01", status: "Completed", created_at: "2026-01-03 00:00:00" },
];
const valid = { name: "Rust", description: "Ownership and borrowing", target_date: "2027-03-01", status: "Not Started" };

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => fs.writeFileSync(DATA_FILE, JSON.stringify(SEED)));

async function api(method, url, body, rawBody) {
  const response = await fetch(base + url, {
    method,
    headers: body !== undefined || rawBody !== undefined ? { "Content-Type": "application/json" } : {},
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

const saved = () => JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

test("GET / describes the API", async () => {
  const { status, body } = await api("GET", "/");
  assert.equal(status, 200);
  assert.deepEqual(body.valid_statuses, ["Not Started", "In Progress", "Completed"]);
});

test("GET /api/courses lists courses, optionally by status", async () => {
  let res = await api("GET", "/api/courses");
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 3);

  res = await api("GET", "/api/courses?status=Completed");
  assert.deepEqual(res.body.courses.map((c) => c.id), [5]);

  res = await api("GET", "/api/courses?status=Done");
  assert.equal(res.status, 400);
});

test("CORS is enabled for browser dashboards", async () => {
  const { headers } = await api("GET", "/api/courses");
  assert.equal(headers.get("access-control-allow-origin"), "*");
});

test("GET /api/courses/:id finds one course", async () => {
  assert.equal((await api("GET", "/api/courses/2")).body.course.name, "Web Design");
  assert.equal((await api("GET", "/api/courses/99")).status, 404);
  for (const bad of ["abc", "0", "-1", "1.5"]) {
    assert.equal((await api("GET", `/api/courses/${bad}`)).status, 400, bad);
  }
});

test("POST /api/courses adds a course with the next id", async () => {
  const { status, body } = await api("POST", "/api/courses", { ...valid, name: "  Rust  " });
  assert.equal(status, 201);
  assert.equal(body.course.id, 6);
  assert.equal(body.course.name, "Rust");
  assert.match(body.course.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(saved().length, 4);
});

test("POST /api/courses validates every field", async () => {
  const cases = [
    [{}, "No data provided"],
    [{ name: "Only a name" }, /Missing required fields: description, target_date, status/],
    [{ ...valid, status: "Done" }, /status must be one of/],
    [{ ...valid, target_date: "2026-02-30" }, /target_date/],
    [{ ...valid, target_date: "03/01/2027" }, /target_date/],
    [{ ...valid, name: "   " }, /name/],
    [{ ...valid, name: 42 }, /name/],
    [{ ...valid, name: "x".repeat(101) }, /100 characters/],
  ];
  for (const [input, message] of cases) {
    const { status, body } = await api("POST", "/api/courses", input);
    assert.equal(status, 400, JSON.stringify(input));
    assert.equal(body.success, false);
    assert.match(body.error, message instanceof RegExp ? message : new RegExp(message));
  }
  assert.equal(saved().length, 3);
});

test("malformed JSON gets a clear 400", async () => {
  const { status, body } = await api("POST", "/api/courses", undefined, "{not json");
  assert.equal(status, 400);
  assert.equal(body.error, "Malformed JSON in request body");
});

test("PUT /api/courses/:id updates only the fields sent", async () => {
  const { status, body } = await api("PUT", "/api/courses/1", { status: "Completed" });
  assert.equal(status, 200);
  assert.equal(body.course.status, "Completed");
  assert.equal(body.course.name, "Python Basics");
  assert.ok(body.course.updated_at);
  assert.equal(saved()[0].status, "Completed");
});

test("PUT /api/courses/:id rejects bad updates", async () => {
  assert.equal((await api("PUT", "/api/courses/99", { status: "Completed" })).status, 404);
  assert.equal((await api("PUT", "/api/courses/1", { owner: "someone" })).status, 400);
  assert.equal((await api("PUT", "/api/courses/1", { target_date: "tomorrow" })).status, 400);
  assert.equal((await api("PUT", "/api/courses/1", [])).status, 400);
  assert.equal(saved()[0].status, "In Progress");
});

test("DELETE /api/courses/:id removes the course", async () => {
  const { status, body } = await api("DELETE", "/api/courses/2");
  assert.equal(status, 200);
  assert.equal(body.deleted_course.name, "Web Design");
  assert.deepEqual(saved().map((c) => c.id), [1, 5]);
  assert.equal((await api("DELETE", "/api/courses/2")).status, 404);
});

test("GET /api/courses/stats counts by status", async () => {
  const { body } = await api("GET", "/api/courses/stats");
  assert.deepEqual(body.statistics, { total_courses: 3, not_started: 1, in_progress: 1, completed: 1 });
});

test("GET /api/courses/search matches name or description", async () => {
  assert.deepEqual((await api("GET", "/api/courses/search?q=python")).body.courses.map((c) => c.id), [1, 5]);
  assert.equal((await api("GET", "/api/courses/search?q=")).status, 400);
});

test("unknown endpoints return JSON 404s", async () => {
  const { status, body } = await api("GET", "/api/nope");
  assert.equal(status, 404);
  assert.match(body.error, /Endpoint not found/);
});

test("a missing data file is created; a corrupted one is never overwritten", async () => {
  fs.rmSync(DATA_FILE);
  assert.equal((await api("GET", "/api/courses")).body.count, 0);
  assert.deepEqual(saved(), []);

  fs.writeFileSync(DATA_FILE, "{ broken");
  assert.equal((await api("POST", "/api/courses", valid)).status, 500);
  assert.equal(fs.readFileSync(DATA_FILE, "utf8"), "{ broken");
});
