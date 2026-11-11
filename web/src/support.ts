/** Optional donation page, set at build time (web/.env: VITE_SUPPORT_URL). Only https links are used. */
export const SUPPORT_URL = (() => {
  const raw = (import.meta.env.VITE_SUPPORT_URL ?? "").trim();
  try {
    return raw && new URL(raw).protocol === "https:" ? raw : "";
  } catch {
    return "";
  }
})();
