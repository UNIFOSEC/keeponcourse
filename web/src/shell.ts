import type { App } from "./app";
import { CoachSession } from "./coach/session";
import type { Ctx, View } from "./ui/components";
import { createCoursePanel } from "./ui/coursePanel";
import { h, isTypingTarget } from "./ui/dom";
import { icon, logo, type IconName } from "./ui/icons";
import { createSettingsDialog } from "./ui/settingsDialog";
import { themeToggle } from "./ui/theme";
import { initToasts } from "./ui/toast";
import { createAbout } from "./views/about";
import { createCoach } from "./views/coach";
import { createCourses } from "./views/courses";
import { createOverview } from "./views/overview";

type Route = "overview" | "courses" | "coach" | "about";

const ROUTES: Record<string, Route> = {
  "": "overview",
  "#/": "overview",
  "#/courses": "courses",
  "#/coach": "coach",
  "#/about": "about",
};
const TITLES: Record<Route, string> = { overview: "Overview", courses: "Courses", coach: "Coach", about: "About" };
const HREFS: Record<Route, string> = { overview: "#/", courses: "#/courses", coach: "#/coach", about: "#/about" };
const VIEWS: Record<Route, (ctx: Ctx) => View> = {
  overview: createOverview,
  courses: createCourses,
  coach: createCoach,
  about: createAbout,
};

export function mountShell(root: HTMLElement, app: App): void {
  const panel = createCoursePanel(app);
  const settings = createSettingsDialog(app);
  const coach = new CoachSession(app);
  const ctx: Ctx = { app, coach, openCourse: (course) => panel.open(course), openSettings: () => settings.open() };

  const main = h("main", { class: "main", attrs: { id: "main", tabindex: -1 } });

  const navLinks = new Map<Route, HTMLAnchorElement>();
  const navLink = (route: Route, iconName: IconName) => {
    const link = h("a", { class: "nav-link", attrs: { href: HREFS[route] } }, icon(iconName, 19), h("span", { class: "label" }, TITLES[route]));
    navLinks.set(route, link);
    return link;
  };

  const sourceBtn = h("button", { class: "sidebar-btn source-btn", attrs: { type: "button" }, on: { click: () => settings.open() } });

  const sidebar = h(
    "aside",
    { class: "sidebar" },
    h("a", { class: "brand", attrs: { href: "#/", "aria-label": "KeepOnCourse home" } }, logo(30), h("span", { class: "brand-name" }, "KeepOnCourse")),
    h(
      "nav",
      { class: "nav", attrs: { "aria-label": "Main" } },
      navLink("overview", "dashboard"),
      navLink("courses", "book"),
      navLink("coach", "sparkles"),
      navLink("about", "info"),
    ),
    h("div", { class: "sidebar-footer" }, sourceBtn, themeToggle()),
  );

  const skipLink = h("button", { class: "skip-link", attrs: { type: "button" }, on: { click: () => main.focus() } }, "Skip to content");

  root.replaceChildren(skipLink, h("div", { class: "app" }, sidebar, main), panel.el, settings.el);
  initToasts(document.body);

  function renderSource() {
    const demo = app.settings.source === "demo";
    sourceBtn.replaceChildren(
      icon(demo ? "database" : "server", 18),
      h(
        "span",
        { class: "label source-label" },
        h("span", { class: "source-kicker" }, "Data source"),
        h("span", {}, demo ? "Demo · this browser" : "Local API"),
      ),
    );
    sourceBtn.setAttribute("aria-label", `Data source: ${demo ? "demo data in this browser" : "local API"}. Click to change.`);
    sourceBtn.title = "Change data source";
  }

  let view: View | null = null;
  let route: Route | null = null;

  function navigate() {
    const next = ROUTES[location.hash] ?? "overview";
    if (next === route) return;
    route = next;
    view?.destroy?.();
    view = VIEWS[next](ctx);
    main.replaceChildren(view.el);
    for (const [r, link] of navLinks) {
      if (r === next) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    document.title = `${TITLES[next]} · KeepOnCourse`;
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
  navigate();
}
