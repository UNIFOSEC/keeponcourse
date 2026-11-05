import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * Content Security Policy for the production build.
 * GitHub Pages can't send response headers, so the policy ships as a <meta> tag.
 * - Scripts, styles and fonts come only from this site (the font is self-hosted).
 * - Network calls may go only to localhost (the optional "Local API" data source)
 *   and to the Coach proxy named in VITE_COACH_URL.
 * It's added at build time only, because Vite's dev server injects inline styles.
 */
function contentSecurityPolicy(coachUrl: string): Plugin {
  let coachOrigin = "";
  if (coachUrl) {
    const url = new URL(coachUrl); // throws on a malformed VITE_COACH_URL, failing the build
    coachOrigin = url.origin;
  }

  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self' data:",
    "img-src 'self' data:",
    `connect-src 'self' http://localhost:* http://127.0.0.1:*${coachOrigin ? ` ${coachOrigin}` : ""}`,
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
    plugins: [contentSecurityPolicy((env.VITE_COACH_URL ?? "").trim())],
    build: { outDir: "dist", sourcemap: true },
  };
});
