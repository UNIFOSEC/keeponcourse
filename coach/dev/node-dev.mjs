/**
 * Runs the Coach Worker under plain Node, for machines where `wrangler dev`
 * can't start the Workers runtime (on Windows, workerd needs the Microsoft
 * Visual C++ Redistributable). Same code as production: src/index.ts is bundled
 * with esbuild and its fetch() handler is served on http://localhost:8787.
 *
 *   npm run dev:node
 *
 * Reads ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / COACH_MODEL from .dev.vars.
 * The Cloudflare rate limiter is replaced by an in-memory one (10/min per IP).
 */
import { build } from "esbuild";
import { readFileSync, existsSync } from "node:fs";
import http from "node:http";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.PORT ?? 8787);
const OUT = ".wrangler/node-dev/worker.mjs";

await build({ entryPoints: ["src/index.ts"], bundle: true, format: "esm", platform: "node", outfile: OUT, logLevel: "warning" });
const worker = (await import(pathToFileURL(OUT).href + `?t=${Date.now()}`)).default;

function readDevVars() {
  if (!existsSync(".dev.vars")) return {};
  const vars = {};
  for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) vars[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
  }
  return vars;
}

const hits = new Map();
const kv = new Map();
const env = {
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:4173",
  USER_DAILY_LIMIT: process.env.USER_DAILY_LIMIT ?? "60",
  ANON_DAILY_LIMIT: process.env.ANON_DAILY_LIMIT ?? "15",
  ...readDevVars(),
  // In-memory stand-in for the COACH_USAGE KV namespace (resets on restart)
  COACH_USAGE: {
    async get(key, type) {
      const value = kv.get(key)?.value ?? null;
      return type === "json" && value !== null ? JSON.parse(value) : value;
    },
    async getWithMetadata(key) {
      const entry = kv.get(key);
      return { value: entry?.value ?? null, metadata: entry?.metadata ?? null };
    },
    async put(key, value, options = {}) {
      kv.set(key, { value, metadata: options.metadata ?? null });
    },
    async list({ prefix = "" } = {}) {
      const keys = [...kv.entries()].filter(([name]) => name.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.metadata }));
      return { keys, list_complete: true };
    },
  },
  CHAT_LIMITER: {
    async limit({ key }) {
      const now = Date.now();
      const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
      recent.push(now);
      hits.set(key, recent);
      return { success: recent.length <= 10 };
    },
  },
};

http
  .createServer(async (req, res) => {
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    const request = new Request(`http://localhost:${PORT}${req.url}`, {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]])),
      body: req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS" ? undefined : Readable.toWeb(req),
      duplex: "half",
      signal: controller.signal,
    });
    request.headers.set("CF-Connecting-IP", req.socket.remoteAddress ?? "local");

    const pending = [];
    const response = await worker.fetch(request, env, { waitUntil: (p) => pending.push(p), passThroughOnException() {} });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body);
      nodeStream.on("error", () => res.end());
      nodeStream.pipe(res);
    } else {
      res.end();
    }
    await Promise.allSettled(pending);
  })
  .listen(PORT, () => {
    console.log(`Coach (Node runner) on http://localhost:${PORT}  model=${env.COACH_MODEL || "default"}  upstream=${env.ANTHROPIC_BASE_URL || "api.anthropic.com"}`);
  });
