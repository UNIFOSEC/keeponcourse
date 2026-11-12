/*
 * KeepOnCourse service worker: lets the installed app open without a
 * connection, and never serves an outdated app while online.
 *
 * - Pages (navigations): network first, so every online visit gets the
 *   latest version; the last good copy is the offline fallback.
 * - /assets/*: cache first. Their file names contain a content hash, so a
 *   cached file is never stale; new versions use new names.
 * - Other files from this site (icons, manifest, theme script): served from
 *   the cache and refreshed in the background.
 * - Everything else (Coach, accounts, other sites), sw.js and version.json:
 *   not touched, straight to the network.
 *
 * Bump VERSION only when this file's caching rules change.
 */
const VERSION = "v1";
const SHELL = `koc-shell-${VERSION}`;
const ASSETS = `koc-assets-${VERSION}`;
const MAX_ASSETS = 80;
const scope = new URL(self.registration.scope);
const SHELL_URL = new URL("./", scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // The app shell, plus the scripts and styles it names, for opening offline
      const response = await fetch(SHELL_URL, { cache: "reload" });
      if (!response.ok) return;
      const html = await response.clone().text();
      const shell = await caches.open(SHELL);
      await shell.put(SHELL_URL, response);
      const statics = ["theme-init.js", "favicon.svg", "manifest.webmanifest", "icon-192.png", "apple-touch-icon.png"].map((file) => new URL(file, scope).href);
      await Promise.all(statics.map((url) => shell.add(url).catch(() => {})));
      const assets = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => new URL(m[1], scope).href);
      const cache = await caches.open(ASSETS);
      await Promise.all(assets.map((url) => cache.add(url).catch(() => {})));
    })(),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, ASSETS]);
      for (const name of await caches.keys()) if (name.startsWith("koc-") && !keep.has(name)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin) return;
  const path = url.pathname.slice(scope.pathname.length);
  if (path === "sw.js" || path === "version.json") return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
  } else if (path.startsWith("assets/")) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirst(request) {
  const shell = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    // Every page of this app is the same shell (routes are #/ hashes), so one copy covers them all
    if (response.ok && response.type === "basic" && !new URL(request.url).search) await shell.put(SHELL_URL, response.clone());
    return response;
  } catch {
    const cached = await shell.match(SHELL_URL);
    return cached ?? new Response("You're offline, and KeepOnCourse hasn't been saved on this device yet.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  // ignoreVary: hashed file names never change, whatever the request's headers (e.g. Origin on module scripts)
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    // Keep the cache small: drop the oldest entries (old versions' files)
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(key);
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached ?? Response.error());
  return cached ?? refresh;
}
