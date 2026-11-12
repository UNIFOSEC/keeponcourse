/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Coach proxy (coach/), e.g. https://<worker-name>.<you>.workers.dev */
  readonly VITE_COACH_URL?: string;
  /** Supabase project URL, e.g. https://<project>.supabase.co (accounts) */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable key: public by design, limited by row-level security */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Optional donation page (Ko-fi, GitHub Sponsors…). Shown as "Support KeepOnCourse" when set. */
  readonly VITE_SUPPORT_URL?: string;
  /** Optional Cloudflare Web Analytics site token: cookie-free visitor counts (see vite.config.ts) */
  readonly VITE_CF_ANALYTICS_TOKEN?: string;
}

/** Set at build time (vite.config.ts); "dev" in development */
declare const __BUILD_ID__: string;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
