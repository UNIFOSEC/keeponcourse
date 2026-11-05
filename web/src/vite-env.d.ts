/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Coach proxy (coach/), e.g. https://<worker-name>.<you>.workers.dev */
  readonly VITE_COACH_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
