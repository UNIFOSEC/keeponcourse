/**
 * "Install app": Chrome, Edge and Android offer installing a web app through
 * the beforeinstallprompt event; the app keeps it and shows its own Install
 * button. Safari (iPhone, iPad, Mac) has no such event: people use the Share
 * menu's "Add to Home Screen" instead (explained on the About page).
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/** True when the app is already running as an installed app. */
export function isInstalled(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** True when the browser has offered to install the app (Chrome, Edge, Android). */
export function canInstall(): boolean {
  return deferred !== null && !isInstalled();
}

export function onInstallChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shows the browser's install dialog. Returns true if the person installed it. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  notify();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}

export function initInstall(): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // show our own button instead of the browser's mini bar
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}
