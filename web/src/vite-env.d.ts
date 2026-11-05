/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Coach proxy (coach/), e.g. https://<worker-name>.<you>.workers.dev */
  readonly VITE_COACH_URL?: string;
  /** Supabase project URL, e.g. https://<project>.supabase.co (accounts) */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable key: public by design, limited by row-level security */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
