import { defineConfig, loadEnv, type Plugin } from "vite";

/** The origin of a configured URL, or "" when unset. A malformed URL fails the build. */
function originOf(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  return value ? new URL(value).origin : "";
}

/**
 * Security policy for the production build, delivered two ways:
 * - a <meta> Content Security Policy in index.html, which works on any host;
 * - a Cloudflare `_headers` file with the same policy as real HTTP headers,
 *   plus what a <meta> tag can't do: frame-ancestors (clickjacking), HSTS,
 *   a permissions policy, and long caching for fingerprinted assets.
 * Scripts, styles and fonts come only from this site (the font is
 * self-hosted). Network calls may go only to localhost (the optional "Local
 * API" data source), the Coach proxy (VITE_COACH_URL) and the accounts
 * backend (VITE_SUPABASE_URL). Build-only, because Vite's dev server injects
 * inline styles.
 */
function securityPolicy(connectOrigins: string[], analyticsToken: string): Plugin {
  // Optional Cloudflare Web Analytics (cookie-free visitor counts): its beacon
  // script and endpoint are allowed only when a site token is configured
  const analytics = Boolean(analyticsToken);
  const csp = [
    "default-src 'self'",
    analytics ? "script-src 'self' https://static.cloudflareinsights.com" : "script-src 'self'",
    "style-src 'self'",
    "font-src 'self' data:",
    "img-src 'self' data:",
    ["connect-src 'self' http://localhost:* http://127.0.0.1:*", ...connectOrigins.filter(Boolean), ...(analytics ? ["https://cloudflareinsights.com"] : [])].join(" "),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  const headers = `/*
  Content-Security-Policy: ${csp}; frame-ancestors 'none'
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;

  return {
    name: "keeponcourse-security",
    apply: "build",
    transformIndexHtml: () => [
      { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: csp }, injectTo: "head-prepend" },
      ...(analytics
        ? [
            {
              tag: "script",
              attrs: { defer: true, src: "https://static.cloudflareinsights.com/beacon.min.js", "data-cf-beacon": JSON.stringify({ token: analyticsToken }) },
              injectTo: "body" as const,
            },
          ]
        : []),
    ],
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "_headers", source: headers });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  const analyticsToken = (env.VITE_CF_ANALYTICS_TOKEN ?? "").trim();
  if (analyticsToken && !/^[0-9a-f]{32}$/.test(analyticsToken)) {
    throw new Error("VITE_CF_ANALYTICS_TOKEN must be the 32-character site token from Cloudflare Web Analytics.");
  }
  return {
    // Relative asset paths, so the build works at a domain root or any sub-path
    base: "./",
    plugins: [securityPolicy([originOf(env.VITE_COACH_URL), originOf(env.VITE_SUPABASE_URL)], analyticsToken)],
    build: { outDir: "dist", sourcemap: true },
  };
});
