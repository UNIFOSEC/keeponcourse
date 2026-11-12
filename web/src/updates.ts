import { toast } from "./ui/toast";

/**
 * Keeping an open (or installed) app current:
 * - registers the service worker (public/sw.js), which lets the installed app
 *   open offline but always loads the newest version when online;
 * - checks version.json when the app comes back into view, and every 30
 *   minutes, and offers a reload once a newer version has been deployed.
 * Production builds only.
 */

const CHECK_EVERY_MS = 30 * 60 * 1000;

/** True when the published build differs from the one running. Network problems count as "no". */
export async function isNewerVersionAvailable(current: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl("./version.json", { cache: "no-store" });
    if (!response.ok) return false;
    const body = (await response.json()) as { build?: unknown };
    return typeof body.build === "string" && body.build !== current;
  } catch {
    return false;
  }
}

export function startUpdates(): void {
  if (!import.meta.env.PROD) return;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {
        // Not critical: the app works the same without it, just not offline
      });
    });
  }

  let offered = false;
  let last = Date.now();
  const check = async () => {
    if (offered) return;
    last = Date.now();
    if (await isNewerVersionAvailable(__BUILD_ID__)) {
      offered = true;
      toast("A new version of KeepOnCourse is ready.", { sticky: true, action: { label: "Reload", run: () => location.reload() } });
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - last > 60_000) void check();
  });
  setInterval(() => {
    if (document.visibilityState === "visible") void check();
  }, CHECK_EVERY_MS);
}
