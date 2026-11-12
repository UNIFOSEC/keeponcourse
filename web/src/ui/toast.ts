import { h } from "./dom";
import { icon } from "./icons";

type Tone = "success" | "error" | "info";

interface ToastOptions {
  tone?: Tone;
  action?: { label: string; run: () => void };
  /** Stays until dismissed or acted on (e.g. "a new version is ready") */
  sticky?: boolean;
}

let region: HTMLElement | null = null;

export function initToasts(parent: HTMLElement): void {
  region = h("div", { class: "toasts", attrs: { role: "status", "aria-live": "polite" } });
  parent.appendChild(region);
}

export function toast(message: string, { tone = "info", action, sticky = false }: ToastOptions = {}): void {
  if (!region) return;

  const dismiss = () => {
    clearTimeout(timer);
    el.classList.add("leaving");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    // Fallback if animations are disabled
    setTimeout(() => el.remove(), 300);
  };

  const el = h(
    "div",
    { class: `toast toast-${tone}` },
    icon(tone === "error" ? "alert" : tone === "success" ? "checkCircle" : "info", 18),
    h("span", { class: "toast-text" }, message),
    action &&
      h(
        "button",
        {
          class: "toast-action",
          attrs: { type: "button" },
          on: {
            click: () => {
              dismiss();
              action.run();
            },
          },
        },
        action.label,
      ),
    h(
      "button",
      { class: "toast-close", attrs: { type: "button", "aria-label": "Dismiss" }, on: { click: dismiss } },
      icon("x", 16),
    ),
  );

  // Errors and undo offers stay longer, so they can be read and acted on
  const timer = sticky ? undefined : setTimeout(dismiss, action || tone === "error" ? 7000 : 3500);
  region.appendChild(el);
  while (region.children.length > 3) region.firstElementChild?.remove();
}
