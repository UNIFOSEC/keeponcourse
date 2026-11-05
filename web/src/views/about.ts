import { pageHeader, type Ctx, type View } from "../ui/components";
import { h, type Child } from "../ui/dom";
import { icon, type IconName } from "../ui/icons";

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
        item("Track courses from Not Started to Completed on a drag-and-drop board or in a list."),
        item("See progress at a glance: completion rate, what's due next, and what's overdue."),
        item("Add, edit, and remove courses, with instant validation and one-click Undo."),
        item("Chat with Coach, an AI assistant (Claude) that plans your study time and can add or update courses for you."),
        item("Switch between in-browser demo data and the project's own REST API."),
      ),
    ),

    section(
      "code",
      "How it's built",
      h(
        "div",
        { class: "arch", attrs: { role: "img", "aria-label": "The browser app reads and writes courses through either the demo store in localStorage or the Express REST API, which saves to a JSON file." } },
        node("monitor", "Web app", "TypeScript · Vite · no framework"),
        h("div", { class: "arch-arrow", attrs: { "aria-hidden": "true" } }, icon("arrowRight", 20)),
        h(
          "div",
          { class: "arch-stack" },
          node("database", "Demo store", "localStorage, per visitor"),
          h("span", { class: "arch-or" }, "or"),
          node("server", "REST API", "Node.js · Express · JSON file"),
          h("span", { class: "arch-or" }, "and for chat"),
          node("sparkles", "Coach proxy", "Cloudflare Worker → Claude API"),
        ),
      ),
      h(
        "p",
        {},
        "Both data sources implement the same interface, so the UI doesn't know or care which one it's talking to. Validation rules are shared: the browser checks input instantly and the API checks it again.",
      ),
      h(
        "p",
        {},
        "Coach streams replies from Claude through a small proxy that holds the API key. When Claude decides to change a course, the browser carries out the change, since that's where the data lives, and shows it as a card you can undo.",
      ),
      h(
        "div",
        { class: "tags" },
        ["TypeScript", "Vite", "Node.js", "Express", "REST", "Claude API", "Tool use", "Streaming", "Cloudflare Workers", "Accessibility"].map((t) =>
          h("span", { class: "tag" }, t),
        ),
      ),
    ),

    section(
      "shield",
      "Security by design",
      h(
        "ul",
        { class: "checklist" },
        item("Strict Content Security Policy: no inline scripts, no third-party requests. The font is self-hosted."),
        item("No innerHTML. All user text is inserted as text nodes, which rules out stored XSS by construction."),
        item("Input validated on both sides, with the same limits and a real calendar-date check."),
        item("The API URL is restricted to localhost, so the app can't be pointed at an outside server."),
        item("Demo data stays in the browser unless you chat with Coach, and tampered localStorage is sanitized on load."),
      ),
    ),

    section(
      "user",
      "Accounts, privately",
      h(
        "ul",
        { class: "checklist" },
        item("Passwordless sign-in with one-time email links (PKCE flow), so there are no passwords to steal or reuse."),
        item("Postgres row-level security: the database itself guarantees each person can only see and change their own courses."),
        item("Least-privilege grants: the app can write only the editable fields; ids, owners and timestamps are set by the database."),
        item("The database enforces the same limits as the app, plus a per-account cap, so a modified client can't bypass them."),
        item("Export your data any time, and delete your account and all of its courses yourself."),
      ),
    ),

    section(
      "sparkles",
      "Coach, safely",
      h(
        "ul",
        { class: "checklist" },
        item("The Claude API key lives only in the proxy, never in the browser."),
        item("The proxy accepts requests only from this site's origin, rate-limits each visitor, and caps message size and conversation length."),
        item("The system prompt and tools are fixed server-side, and the proxy accepts only text and Coach's own tool blocks. Callers can't add tools, images or instructions."),
        item("Course names and descriptions reach Claude tagged as data, and Claude is told not to follow instructions inside them (prompt-injection defense)."),
        item("Claude's tool calls are treated as untrusted input: the browser validates each one with the course form's rules before applying it, and every change can be undone."),
        item("Replies are rendered by a small Markdown renderer that builds DOM nodes and allows only http(s) links."),
      ),
    ),

    section(
      "flag",
      "What's next",
      h(
        "ul",
        { class: "checklist roadmap" },
        item("Automated tests (API, proxy and browser) and continuous deployment to GitHub Pages.", "clock"),
      ),
    ),
    sourceLine,
  );

  function update() {
    const kind = ctx.app.store.kind;
    sourceLine.textContent =
      kind === "account"
        ? "You're signed in: your courses are stored in your account and synced across devices."
        : kind === "demo"
          ? "You're currently using demo data stored in this browser."
          : `You're currently connected to ${ctx.app.settings.apiUrl}.`;
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

function node(iconName: IconName, title: string, text: string): HTMLElement {
  return h("div", { class: "arch-node" }, icon(iconName, 20), h("div", {}, h("strong", {}, title), h("span", { class: "muted" }, text)));
}
