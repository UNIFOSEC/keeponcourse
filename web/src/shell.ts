import { accountsEnabled, mightBeSignedIn } from "./account";
import { readString, writeString } from "./data/storage";
import { canInstall, onInstallChange, promptInstall } from "./install";
import { SUPPORT_URL } from "./support";
import type { App } from "./app";
import { CoachSession } from "./coach/session";
import { createAccountDialog } from "./ui/accountDialog";
import type { Ctx, View } from "./ui/components";
import { createCoursePanel } from "./ui/coursePanel";
import { h, isTypingTarget } from "./ui/dom";
import { icon, logo, type IconName } from "./ui/icons";
import { createImportDialog } from "./ui/importDialog";
import { createCatchUpDialog } from "./ui/catchUpDialog";
import { createFeedbackDialog } from "./ui/feedbackDialog";
import { createPlanWizard } from "./ui/planWizard";
import { createSettingsDialog } from "./ui/settingsDialog";
import { themeToggle } from "./ui/theme";
import { initToasts, toast } from "./ui/toast";
import { createAbout } from "./views/about";
import { createCalendar } from "./views/calendar";
import { createCoach } from "./views/coach";
import { createPrivacy, createTerms } from "./views/legal";
import { createStats } from "./views/stats";
import { createWelcome, VISITED_KEY } from "./views/welcome";
import { createCourses } from "./views/courses";
import { createOverview } from "./views/overview";

type Route = "overview" | "courses" | "calendar" | "coach" | "about" | "privacy" | "terms" | "stats" | "welcome";

const ROUTES: Record<string, Route> = {
  "": "overview",
  "#/": "overview",
  "#/courses": "courses",
  "#/calendar": "calendar",
  "#/coach": "coach",
  "#/about": "about",
  "#/privacy": "privacy",
  "#/terms": "terms",
  // Private, not in the menu: usage statistics for the site owner
  "#/stats": "stats",
  // Landing page, shown to first-time visitors (see navigate)
  "#/welcome": "welcome",
};
const TITLES: Record<Route, string> = { overview: "Overview", courses: "Courses", calendar: "Calendar", coach: "Coach", about: "About", privacy: "Privacy", terms: "Terms", stats: "Stats", welcome: "Finish the courses you start" };
const HREFS: Record<Route, string> = { overview: "#/", courses: "#/courses", calendar: "#/calendar", coach: "#/coach", about: "#/about", privacy: "#/privacy", terms: "#/terms", stats: "#/stats", welcome: "#/welcome" };
const VIEWS: Record<Route, (ctx: Ctx) => View> = {
  overview: createOverview,
  courses: createCourses,
  calendar: createCalendar,
  coach: createCoach,
  about: createAbout,
  privacy: createPrivacy,
  terms: createTerms,
  stats: createStats,
  welcome: createWelcome,
};

export function mountShell(root: HTMLElement, app: App): void {
  const coach = new CoachSession(app);
  const planWizard = createPlanWizard(app, coach);
  const catchUpDialog = createCatchUpDialog(app);
  const panel = createCoursePanel(app, (course) => planWizard.open(course), (course) => catchUpDialog.open(course));
  const settings = createSettingsDialog(app);
  const accountDialog = createAccountDialog(app, app.account, () => coach.reset(), coach.configured ? () => coach.sendSampleDigest() : undefined);
  const importDialog = createImportDialog(app);
  const ctx: Ctx = {
    app,
    coach,
    openCourse: (course) => panel.open(course),
    openSettings: () => settings.open(),
    openAccount: () => accountDialog.open(),
    openPlanWizard: (course) => planWizard.open(course),
    openCatchUp: (course) => catchUpDialog.open(course),
  };

  const main = h("main", { class: "main", attrs: { id: "main", tabindex: -1 } });

  const navLinks = new Map<Route, HTMLAnchorElement>();
  const navLink = (route: Route, iconName: IconName) => {
    const link = h("a", { class: "nav-link", attrs: { href: HREFS[route] } }, icon(iconName, 19), h("span", { class: "label" }, TITLES[route]));
    navLinks.set(route, link);
    return link;
  };

  const sourceBtn = h("button", { class: "sidebar-btn source-btn", attrs: { type: "button" }, on: { click: () => settings.open() } });
  const accountBtn = h("button", { class: "sidebar-btn account-btn", attrs: { type: "button" }, on: { click: () => accountDialog.open() } });
  // Feedback to the developer (signed-in users); a dot marks unread replies
  const feedbackDot = h("span", { class: "feedback-dot", attrs: { hidden: true } });
  let replyToastShown = false;
  const feedbackDialog = createFeedbackDialog(app, (unread) => {
    feedbackDot.hidden = unread === 0;
    feedbackBtn.setAttribute("aria-label", unread ? `Feedback: ${unread} new repl${unread === 1 ? "y" : "ies"} from the developer` : "Send feedback to the developer");
    feedbackBtn.title = feedbackBtn.getAttribute("aria-label") ?? "";
    if (unread && !replyToastShown) {
      replyToastShown = true;
      toast("💬 The developer replied to your feedback.", { action: { label: "Read", run: () => feedbackDialog.open() } });
    }
  });
  const feedbackBtn = h(
    "button",
    { class: "sidebar-btn feedback-btn", attrs: { type: "button", "aria-label": "Send feedback to the developer", title: "Send feedback to the developer" }, on: { click: () => feedbackDialog.open() } },
    h("span", { class: "feedback-icon" }, icon("compose", 18), feedbackDot),
    h("span", { class: "label" }, "Feedback"),
  );
  feedbackBtn.hidden = true;

  // Shown only when the browser offers installing (Chrome, Edge, Android)
  const installBtn = h(
    "button",
    {
      class: "sidebar-btn install-btn",
      attrs: { type: "button", "aria-label": "Install KeepOnCourse as an app", title: "Install KeepOnCourse as an app" },
      on: {
        click: async () => {
          if (await promptInstall()) toast("Installed! Open KeepOnCourse from your home screen or app list.", { tone: "success" });
        },
      },
    },
    icon("download", 19),
    h("span", { class: "label" }, "Install app"),
  );
  installBtn.hidden = !canInstall();
  onInstallChange(() => (installBtn.hidden = !canInstall()));

  const sidebar = h(
    "aside",
    { class: "sidebar" },
    h("a", { class: "brand", attrs: { href: "#/", "aria-label": "KeepOnCourse home" } }, logo(30), h("span", { class: "brand-name" }, "KeepOnCourse")),
    h(
      "nav",
      { class: "nav", attrs: { "aria-label": "Main" } },
      navLink("overview", "dashboard"),
      navLink("courses", "book"),
      navLink("calendar", "calendar"),
      navLink("coach", "sparkles"),
      navLink("about", "info"),
    ),
    h("div", { class: "sidebar-footer" }, installBtn, feedbackBtn, accountsEnabled && accountBtn, sourceBtn, themeToggle()),
    h(
      "nav",
      { class: "sidebar-legal", attrs: { "aria-label": "Legal" } },
      SUPPORT_URL && h("a", { class: "support-link", attrs: { href: SUPPORT_URL, target: "_blank", rel: "noopener noreferrer" } }, "♥ Support"),
      h("a", { attrs: { href: "#/privacy" } }, "Privacy"),
      h("a", { attrs: { href: "#/terms" } }, "Terms"),
    ),
  );

  const skipLink = h("button", { class: "skip-link", attrs: { type: "button" }, on: { click: () => main.focus() } }, "Skip to content");

  const appEl = h("div", { class: "app" }, sidebar, main);
  root.replaceChildren(skipLink, appEl, panel.el, settings.el, accountDialog.el, importDialog.el, planWizard.el, catchUpDialog.el, feedbackDialog.el);
  initToasts(document.body);

  function renderSource() {
    const kind = app.store.kind;
    const meta = {
      account: { icon: "cloud", text: "Your account · synced", label: "your account, synced" },
      demo: { icon: "database", text: "Demo · this browser", label: "demo data in this browser" },
      api: { icon: "server", text: "Local API", label: "local API" },
    } as const;
    sourceBtn.replaceChildren(
      icon(meta[kind].icon, 18),
      h("span", { class: "label source-label" }, h("span", { class: "source-kicker" }, "Data source"), h("span", {}, meta[kind].text)),
    );
    sourceBtn.setAttribute("aria-label", `Data source: ${meta[kind].label}. Click to change.`);
    sourceBtn.title = "Change data source";
  }

  let feedbackUser: string | null = null;
  function renderAccount() {
    const state = app.account.state;
    // Feedback is for signed-in users; check for unread replies once per sign-in
    feedbackBtn.hidden = state.status !== "signed-in";
    const userId = state.status === "signed-in" ? state.userId : null;
    if (userId !== feedbackUser) {
      feedbackUser = userId;
      replyToastShown = false;
      if (userId) void feedbackDialog.refreshUnread();
      else feedbackDot.hidden = true;
    }
    if (state.status === "signed-in") {
      accountBtn.replaceChildren(
        h("span", { class: "account-avatar account-avatar-sm" }, (state.email[0] ?? "?").toUpperCase()),
        h("span", { class: "label account-label" }, state.email),
      );
      accountBtn.setAttribute("aria-label", `Signed in as ${state.email}. Open account.`);
    } else {
      accountBtn.replaceChildren(icon("user", 18), h("span", { class: "label" }, state.status === "loading" ? "Signing in…" : "Sign in · sync courses"));
      accountBtn.setAttribute("aria-label", "Sign in to sync your courses");
    }
    accountBtn.title = accountBtn.getAttribute("aria-label") ?? "";
  }

  // A different person (or no one) is signed in: start a fresh Coach chat,
  // and offer to bring demo courses into a new, empty account
  let lastUser: string | null | undefined;
  app.account.subscribe(() => {
    const state = app.account.state;
    if (state.status === "loading") return;
    const user = state.status === "signed-in" ? state.userId : null;
    if (lastUser !== undefined && user !== lastUser) coach.reset();
    lastUser = user;
    if (state.status === "signed-out" && state.error) {
      toast(state.error, { tone: "error" });
    }
    renderAccount();
  });
  app.subscribe(() => importDialog.maybeOffer());

  let view: View | null = null;
  let route: Route | null = null;

  /** First-time visitors (never been past the landing page, not signed in, not finishing a sign-in) */
  const firstVisit = () => !readString(VISITED_KEY) && !mightBeSignedIn() && !new URLSearchParams(location.search).has("code");

  function navigate() {
    let next = ROUTES[location.hash] ?? "overview";
    // Opening the bare address for the first time shows the landing page
    if (route === null && location.hash === "" && firstVisit()) {
      history.replaceState(null, "", "#/welcome");
      next = "welcome";
    }
    if (next !== "welcome") writeString(VISITED_KEY, "1");
    appEl.classList.toggle("is-landing", next === "welcome");
    if (next === route) return;
    route = next;
    view?.destroy?.();
    view = VIEWS[next](ctx);
    main.replaceChildren(view.el);
    for (const [r, link] of navLinks) {
      if (r === next) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    document.title = next === "welcome" ? "KeepOnCourse · Finish the courses you start" : `${TITLES[next]} · KeepOnCourse`;
    window.scrollTo(0, 0);
  }

  window.addEventListener("hashchange", () => {
    navigate();
    main.focus({ preventScroll: true });
  });
  app.subscribe(() => {
    view?.update();
    renderSource();
  });

  // Shortcuts: N = new course, / = search courses
  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    if (document.querySelector("dialog[open]") || isTypingTarget(event.target)) return;
    if (event.key === "n" || event.key === "N") {
      event.preventDefault();
      panel.open();
    } else if (event.key === "/") {
      event.preventDefault();
      if (route !== "courses") location.hash = HREFS.courses;
      navigate();
      view?.focusSearch?.();
    }
  });

  renderSource();
  renderAccount();
  navigate();
}
