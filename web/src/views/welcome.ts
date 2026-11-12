import { writeString } from "../data/storage";
import type { Ctx, View } from "../ui/components";
import { h, type Child } from "../ui/dom";
import { icon, logo, type IconName } from "../ui/icons";

/** Set once someone has gone past the landing page, so it's shown to first-time visitors only. */
export const VISITED_KEY = "koc.visited";

/**
 * The landing page (#/welcome): what KeepOnCourse is for, for first-time
 * visitors. Returning visitors and signed-in users go straight to the app.
 */
export function createWelcome(ctx: Ctx): View {
  const enter = () => writeString(VISITED_KEY, "1");
  const tryDemo = (label = "Try it now: no sign-up") =>
    h("a", { class: "btn btn-primary landing-cta", attrs: { href: "#/" }, on: { click: enter } }, h("span", {}, label), icon("arrowRight", 17));
  const signIn = (cls = "btn btn-secondary landing-cta") =>
    h("button", { class: cls, attrs: { type: "button" }, on: { click: () => (enter(), ctx.openAccount()) } }, h("span", {}, "Sign in"));

  const el = h(
    "div",
    { class: "landing" },
    h(
      "header",
      { class: "landing-bar" },
      h("a", { class: "brand", attrs: { href: "#/", "aria-label": "KeepOnCourse: open the app" }, on: { click: enter } }, logo(30), h("span", { class: "brand-name" }, "KeepOnCourse")),
      signIn("btn btn-ghost btn-sm"),
    ),

    h(
      "section",
      { class: "landing-hero" },
      h(
        "div",
        { class: "landing-hero-text" },
        h("p", { class: "landing-kicker" }, icon("sparkles", 15), "Free AI study coach"),
        h("h1", {}, "Finish the courses you start."),
        h(
          "p",
          { class: "landing-lead" },
          "KeepOnCourse turns any syllabus into a study plan, checks in with you every week, and gets you back on track when life gets in the way.",
        ),
        h("div", { class: "landing-actions" }, tryDemo(), signIn()),
        h("p", { class: "landing-note" }, "The demo runs in your browser with sample courses. Sign in any time to keep your own, synced across devices."),
      ),
      shot("screens/overview.jpg", "The KeepOnCourse overview: this week's study progress, today's session with Done and Skip buttons, and a course that's a session behind with a Catch up button.", "landing-hero-shot"),
    ),

    h(
      "section",
      { class: "landing-steps", attrs: { "aria-labelledby": "landing-how" } },
      h("h2", { attrs: { id: "landing-how" } }, "How it keeps you on course"),
      h(
        "ol",
        {},
        step("upload", "Plan from your syllabus", "Paste it or upload the PDF. Coach breaks it into modules with time estimates, and you choose your study days and times."),
        step("checkCircle", "Check in as you study", "Mark each session done or skipped. See this week's progress and build a streak."),
        step("refresh", "Catch up in one click", "Missed a few sessions? Reschedule what's left from today, and see the new finish date against your deadline."),
      ),
    ),

    h(
      "section",
      { class: "landing-split" },
      shot("screens/calendar.jpg", "The study calendar: a month view with sessions on Monday, Wednesday and Friday evenings, and a list of upcoming sessions.", "landing-split-shot"),
      h(
        "div",
        {},
        h("h2", {}, "Everything in one place"),
        h(
          "ul",
          { class: "landing-features" },
          feature("calendar", "Your calendar, in sync", "Subscribe once in Google Calendar, Outlook or Apple Calendar; new plans show up on their own."),
          feature("sparkles", "Coach, your AI study coach", "Ask what to focus on, get a topic explained, or have it adjust your plan."),
          feature("mail", "A weekly check-in email", "Every Monday: your study week, anything to catch up on, and your streak. Optional."),
          feature("download", "An app on your phone", "Install it from the browser, with no app store. It opens even offline."),
          feature("shield", "Private by default", "No ads and no tracking. Your courses are yours: export or delete them any time."),
        ),
      ),
    ),

    h(
      "section",
      { class: "landing-final" },
      h("h2", {}, "Online classes, university modules, certifications, languages: if you can study it, you can finish it."),
      h("div", { class: "landing-actions" }, tryDemo("Start with the demo"), signIn()),
    ),

    h(
      "footer",
      { class: "landing-foot" },
      h("span", {}, "KeepOnCourse"),
      h("a", { attrs: { href: "#/about" }, on: { click: enter } }, "About"),
      h("a", { attrs: { href: "#/privacy" }, on: { click: enter } }, "Privacy"),
      h("a", { attrs: { href: "#/terms" }, on: { click: enter } }, "Terms"),
    ),
  );

  // Signing in from here goes straight to the app
  const unsubscribe = ctx.app.account.subscribe(() => {
    if (ctx.app.account.signedIn) {
      enter();
      location.hash = "#/";
    }
  });

  return { el, update() {}, destroy: () => void unsubscribe() };
}

function shot(src: string, alt: string, cls: string): HTMLElement {
  return h("figure", { class: `landing-shot ${cls}` }, h("img", { attrs: { src, alt, width: 1280, height: 800, loading: cls === "landing-hero-shot" ? "eager" : "lazy", decoding: "async" } }));
}

function step(iconName: IconName, title: string, text: string): Child {
  return h("li", { class: "landing-step" }, h("span", { class: "landing-step-icon" }, icon(iconName, 20)), h("h3", {}, title), h("p", {}, text));
}

function feature(iconName: IconName, title: string, text: string): Child {
  return h("li", {}, h("span", { class: "landing-feature-icon" }, icon(iconName, 18)), h("span", {}, h("strong", {}, title), h("span", { class: "muted" }, text)));
}
