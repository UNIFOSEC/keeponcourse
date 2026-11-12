import type { App } from "../app";
import { elapsedMs, findSession, formatClock, loadFocus, pause, remainingMs, resume, saveFocus, studiedMinutes, type FocusState } from "../focus";
import type { PlanSession } from "../plan";
import type { Course } from "../types";
import { checkIn } from "./checkIn";
import { h } from "./dom";
import { icon } from "./icons";
import { toast } from "./toast";

/**
 * Focus mode: a full-screen timer for one study session. Finishing checks the
 * session in as done with the minutes actually studied. While it runs, a
 * small timer stays in the corner (and in the tab title), so the rest of the
 * app can be used; it also survives reloads.
 */

let controller: ReturnType<typeof createFocus> | null = null;

/** Sets up focus mode once, when the app starts. */
export function initFocus(app: App): void {
  controller ??= createFocus(app);
}

/** Starts the focus timer for a session (or shows the one already running). */
export function startFocus(course: Course, session: PlanSession): void {
  controller?.start(course, session);
}

const RING = 2 * Math.PI * 54;

function createFocus(app: App) {
  let state: FocusState | null = loadFocus();
  let timer: ReturnType<typeof setInterval> | undefined;
  let chimed = false;
  let wakeLock: { release(): Promise<void> } | null = null;
  let baseTitle = document.title;

  // ------------------------------------------------------------ elements
  const courseName = h("p", { class: "focus-course" });
  const moduleTitle = h("h2", { class: "focus-module", attrs: { id: "focus-title" } });
  const clock = h("div", { class: "focus-clock", attrs: { role: "timer", "aria-live": "off" } });
  const caption = h("p", { class: "focus-caption" });
  const announce = h("p", { class: "sr-only", attrs: { role: "status" } });
  const ns = "http://www.w3.org/2000/svg";
  const ring = document.createElementNS(ns, "svg");
  ring.setAttribute("viewBox", "0 0 120 120");
  ring.setAttribute("class", "focus-ring");
  ring.setAttribute("aria-hidden", "true");
  const track = document.createElementNS(ns, "circle");
  const arc = document.createElementNS(ns, "circle");
  for (const c of [track, arc]) {
    c.setAttribute("cx", "60");
    c.setAttribute("cy", "60");
    c.setAttribute("r", "54");
  }
  track.setAttribute("class", "focus-ring-track");
  arc.setAttribute("class", "focus-ring-arc");
  arc.setAttribute("stroke-dasharray", String(RING));
  ring.append(track, arc);

  const pauseBtn = h("button", { class: "btn btn-secondary focus-btn", attrs: { type: "button" }, on: { click: togglePause } });
  const finishBtn = h("button", { class: "btn btn-primary focus-btn", attrs: { type: "button" }, on: { click: () => void finish() } }, icon("check", 18), h("span", {}, "Finish and check in"));
  const discardBtn = h("button", { class: "btn btn-ghost btn-sm", attrs: { type: "button" }, on: { click: discard } }, "Discard timer");

  const dialog = h(
    "dialog",
    { class: "focus-mode", attrs: { "aria-labelledby": "focus-title" }, on: { close: () => syncPill(), cancel: () => syncPill() } },
    h(
      "div",
      { class: "focus-inner" },
      h(
        "header",
        { class: "focus-head" },
        h("span", { class: "focus-badge" }, icon("clock", 15), "Focus"),
        h("button", { class: "btn btn-ghost btn-sm", attrs: { type: "button", "aria-label": "Minimize the timer" }, on: { click: () => dialog.close() } }, "Minimize"),
      ),
      courseName,
      moduleTitle,
      h("div", { class: "focus-dial" }, ring, clock),
      caption,
      announce,
      h("div", { class: "focus-actions" }, pauseBtn, finishBtn),
      discardBtn,
    ),
  );

  const pillTime = h("span", { class: "focus-pill-time" });
  const pillName = h("span", { class: "focus-pill-name" });
  const pill = h("button", { class: "focus-pill", attrs: { type: "button", hidden: true }, on: { click: () => openDialog() } }, icon("clock", 16), pillTime, pillName);

  document.body.append(dialog, pill);

  // ------------------------------------------------------------ helpers
  const course = () => (state ? app.courses.find((c) => c.id === state!.courseId) ?? null : null);
  const moduleName = () => {
    const c = course();
    return (state && c?.plan?.modules[state.module]?.title) || "Study session";
  };

  function render() {
    if (!state) return;
    const c = course();
    const left = remainingMs(state);
    const time = formatClock(left);
    const paused = state.pausedAt !== null;
    courseName.textContent = c?.name ?? "";
    moduleTitle.textContent = moduleName();
    clock.textContent = time;
    clock.classList.toggle("is-over", left < 0);
    const done = Math.min(1, elapsedMs(state) / (state.plannedMinutes * 60_000));
    arc.setAttribute("stroke-dashoffset", String(RING * (1 - done)));
    caption.textContent = paused
      ? "Paused"
      : left < 0
        ? `Time's up. Finish when you're ready: ${studiedMinutes(state)} min so far.`
        : `${state.plannedMinutes} min planned · ${Math.floor(elapsedMs(state) / 60_000)} min in`;
    pauseBtn.replaceChildren(icon(paused ? "play" : "pause", 18), h("span", {}, paused ? "Resume" : "Pause"));
    pillTime.textContent = paused ? `${time} · paused` : time;
    pillName.textContent = c?.name ?? "";
    // The tab title shows the time too, for when the app is in the background
    if (!document.title.startsWith("⏱")) baseTitle = document.title;
    document.title = `⏱ ${time} · ${baseTitle}`;

    if (left <= 0 && !chimed && !paused) {
      chimed = true;
      chime();
      announce.textContent = "Time's up for this study session.";
    }
  }

  function syncPill() {
    pill.hidden = !state || dialog.open;
  }

  function tick() {
    if (!state) return;
    render();
  }

  function startTicking() {
    clearInterval(timer);
    timer = setInterval(tick, 1000);
    tick();
  }

  function stop() {
    clearInterval(timer);
    timer = undefined;
    state = null;
    saveFocus(null);
    chimed = false;
    void releaseWakeLock();
    if (document.title.startsWith("⏱")) document.title = baseTitle;
    if (dialog.open) dialog.close();
    syncPill();
  }

  async function keepScreenOn() {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
      if (nav.wakeLock && !wakeLock && state?.pausedAt === null) wakeLock = await nav.wakeLock.request("screen");
    } catch {
      // Not supported, or not allowed right now
    }
  }

  async function releaseWakeLock() {
    const lock = wakeLock;
    wakeLock = null;
    await lock?.release().catch(() => {});
  }

  /** A soft two-note chime, made with Web Audio (no sound files). */
  function chime() {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const audio = new Ctx();
      [660, 880].forEach((freq, i) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.frequency.value = freq;
        osc.type = "sine";
        const t = audio.currentTime + i * 0.35;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        osc.connect(gain).connect(audio.destination);
        osc.start(t);
        osc.stop(t + 0.65);
      });
      setTimeout(() => void audio.close(), 1500);
    } catch {
      // No sound available
    }
    navigator.vibrate?.([200, 100, 200]);
  }

  function openDialog() {
    if (!state) return;
    render();
    if (!dialog.open) dialog.showModal();
    syncPill();
    void keepScreenOn();
  }

  // ------------------------------------------------------------ actions
  function start(target: Course, session: PlanSession) {
    if (state) {
      const running = course();
      if (running?.id !== target.id || state.date !== session.date || state.module !== session.module) {
        toast("A focus timer is already running. Finish or discard it first.");
      }
      openDialog();
      return;
    }
    state = { courseId: target.id, date: session.date, module: session.module, plannedMinutes: session.minutes, startedAt: Date.now(), pausedAt: null, pausedMs: 0 };
    chimed = false;
    saveFocus(state);
    startTicking();
    openDialog();
  }

  function togglePause() {
    if (!state) return;
    state = state.pausedAt === null ? pause(state) : resume(state);
    saveFocus(state);
    if (state.pausedAt === null) void keepScreenOn();
    else void releaseWakeLock();
    render();
  }

  async function finish() {
    if (!state) return;
    const c = course();
    const index = findSession(c?.plan, state);
    const minutes = studiedMinutes(state);
    if (!c || index < 0) {
      stop();
      toast("That session was changed or already checked in, so the timer was stopped.", { tone: "error" });
      return;
    }
    finishBtn.disabled = true;
    stop();
    finishBtn.disabled = false;
    await checkIn(app, c, index, "done", minutes);
  }

  function discard() {
    stop();
    toast("Timer discarded. The session wasn't checked in.");
  }

  // Keep the screen on again when coming back to the app
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && dialog.open) void keepScreenOn();
  });
  // The course list loads after start-up; refresh names then
  app.subscribe(() => state && render());

  // A timer saved from an earlier visit keeps running, minimized
  if (state) startTicking();
  syncPill();

  return { start };
}
