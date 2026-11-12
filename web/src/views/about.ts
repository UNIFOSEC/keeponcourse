import { pageHeader, type Ctx, type View } from "../ui/components";
import { h, type Child } from "../ui/dom";
import { icon, type IconName } from "../ui/icons";
import { SUPPORT_URL } from "../support";

/**
 * About KeepOnCourse, for learners: what it does, how to install it, and how
 * their data is handled, in plain words. Technical details (architecture and
 * security internals) live in the repository's READMEs, not on the site.
 */
export function createAbout(ctx: Ctx): View {
  const sourceLine = h("p", { class: "muted" });

  const el = h(
    "div",
    { class: "page about" },
    pageHeader(
      "About KeepOnCourse",
      "An AI coach that helps anyone finish the courses they start, from online classes to university modules to certifications.",
    ),

    section(
      "flag",
      "What it does",
      h(
        "ul",
        { class: "checklist" },
        item("Track courses from Not Started to Completed on a board or in a list, and see what's due and what's slipping."),
        item("Import a syllabus (paste it or upload a PDF) and get a study plan with sessions on the days and times you choose."),
        item("Check in each study session, or run a focus timer that checks you in when you finish. Catch up in one click when you fall behind."),
        item("Invite a study partner with a private link: they follow your progress and cheer you on, with no account needed."),
        item("See your sessions on a calendar, and sync them to Google Calendar, Outlook or Apple Calendar."),
        item("Chat with Coach, an AI study coach that plans your time, explains topics, and can update your courses for you."),
        item("Get an optional weekly check-in email with your study week and your streak."),
      ),
    ),

    section(
      "download",
      "Install the app",
      h("p", { class: "muted" }, "KeepOnCourse can live on your home screen or desktop and open in its own window, like any app. Nothing to download from an app store."),
      h(
        "ul",
        { class: "checklist" },
        item("iPhone and iPad: open keeponcourse.com in Safari, tap the Share button, then Add to Home Screen.", "monitor"),
        item("Android: in Chrome, open the ⋮ menu and choose Install app (or Add to Home screen).", "monitor"),
        item("Computer: in Chrome or Edge, click Install app in the sidebar, or the install icon in the address bar.", "monitor"),
      ),
      h(
        "p",
        { class: "muted" },
        "Once installed, it opens even without a connection. Demo courses work offline; courses in an account need a connection to load and save. Updates arrive on their own.",
      ),
    ),

    section(
      "shield",
      "Your data",
      h(
        "ul",
        { class: "checklist" },
        item("Without an account, your courses stay in this browser on your device."),
        item("With an account, your courses are private to you and sync across your devices. Sign-in uses a one-time email link or code, so there's no password."),
        item("Export your data or delete your account, with all of its courses, at any time."),
        item("When you chat with Coach, your message and course list are sent to the AI to answer you. Chats aren't stored on our servers."),
        item("No ads, no selling of data, and no tracking across other sites."),
      ),
      h("p", {}, h("a", { class: "link", attrs: { href: "#/privacy" } }, "Read the privacy policy"), " for the details."),
    ),

    SUPPORT_URL &&
      section(
        "heart",
        "Support KeepOnCourse",
        h("p", {}, "KeepOnCourse is free, with no ads or tracking. If it helps you finish a course, you can chip in to cover the AI and hosting costs."),
        h(
          "div",
          {},
          h("a", { class: "btn btn-primary btn-sm", attrs: { href: SUPPORT_URL, target: "_blank", rel: "noopener noreferrer" } }, icon("heart", 16), h("span", {}, "Support the project")),
        ),
      ),
    sourceLine,
    h("p", { class: "muted about-legal" }, h("a", { class: "link", attrs: { href: "#/privacy" } }, "Privacy policy"), " · ", h("a", { class: "link", attrs: { href: "#/terms" } }, "Terms of use")),
  );

  function update() {
    const kind = ctx.app.store.kind;
    sourceLine.textContent =
      kind === "account"
        ? "You're signed in: your courses are stored in your account and synced across devices."
        : kind === "demo"
          ? "You're using demo data stored in this browser. Sign in to keep your courses in sync across devices."
          : "You're connected to a local development server.";
  }

  update();
  return { el, update };
}

function section(iconName: IconName, title: string, ...children: Child[]): HTMLElement {
  return h(
    "section",
    { class: "card about-section" },
    h("header", { class: "card-head" }, h("span", { class: "about-icon" }, icon(iconName, 18)), h("h2", {}, title)),
    ...children,
  );
}

function item(text: string, iconName: IconName = "check"): HTMLElement {
  return h("li", {}, icon(iconName, 17), h("span", {}, text));
}
