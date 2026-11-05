import { defineConfig, loadEnv, type Plugin } from "vite";

/** The origin of a configured URL, or "" when unset. A malformed URL fails the build. */
function originOf(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  return value ? new URL(value).origin : "";
}

/**
 * Content Security Policy for the production build.
 * GitHub Pages can't send response headers, so the policy ships as a <meta> tag.
 * - Scripts, styles and fonts come only from this site (the font is self-hosted).
 * - Network calls may go only to localhost (the optional "Local API" data source),
 *   the Coach proxy (VITE_COACH_URL) and the accounts backend (VITE_SUPABASE_URL).
 * It's added at build time only, because Vite's dev server injects inline styles.
 */
function contentSecurityPolicy(connectOrigins: string[]): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self' data:",
    "img-src 'self' data:",
    ["connect-src 'self' http://localhost:* http://127.0.0.1:*", ...connectOrigins.filter(Boolean)].join(" "),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  return {
    name: "keeponcourse-csp",
    apply: "build",
    transformIndexHtml: () => [
      { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: csp }, injectTo: "head-prepend" },
    ],
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  return {
    // Relative asset paths, so the build works from any GitHub Pages sub-path
    base: "./",
    plugins: [contentSecurityPolicy([originOf(env.VITE_COACH_URL), originOf(env.VITE_SUPABASE_URL)])],
    build: { outDir: "dist", sourcemap: true },
  };
});
