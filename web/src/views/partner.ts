import { errorMessage } from "../app";
import { addDays, daysUntil, formatDate } from "../dates";
import { formatMinutes, weekStart } from "../plan";
import { CHEERS, CHEERS_PER_DAY, loadShared, sendCheer, summarize, tokenFromHash, type CheerKind, type CourseSummary, type DayState, type ProgressSummary, type SharedProgress } from "../partner";
import type { Ctx, View } from "../ui/components";
import { cx, h, setChildren, type Child } from "../ui/dom";
import { icon, logo } from "../ui/icons";

/**
 * The page a study partner opens from a learner's private link (#/p/<token>).
 * No sign-in: the link is the credential. Read-only progress, plus one-tap
 * cheers that show up in the learner's app.
 */
export function createPartnerPage(ctx: Ctx): View {
  const token = tokenFromHash(location.hash);
  const content = h("div", { class: "partner-content", attrs: { "aria-live": "polite", "aria-busy": "true" } });
  const el = h(
    "div",
    { class: "landing partner-page" },
    h(
      "header",
      { class: "landing-bar" },
      h("a", { class: "brand", attrs: { href: "#/welcome", "aria-label": "KeepOnCourse: what it is" } }, logo(30), h("span", { class: "brand-name" }, "KeepOnCourse")),
      h("a", { class: "btn btn-ghost btn-sm", attrs: { href: "#/welcome" } }, "What is this?"),
    ),
    content,
  );

  let shared: SharedProgress | null = null;
  let cheersLeft = CHEERS_PER_DAY;
  let destroyed = false;

  async function load() {
    content.setAttribute("aria-busy", "true");
    setChildren(content, h("div", { class: "partner-skeleton" }, h("div", { class: "skeleton kpi-skeleton" }), h("div", { class: "skeleton card-skeleton" })));
    if (!token) return render(null);
    try {
      shared = await loadShared(ctx.app, token);
      if (destroyed) return;
      cheersLeft = Math.max(0, CHEERS_PER_DAY - (shared?.cheers_today ?? 0));
      render(shared);
    } catch (error) {
      if (destroyed) return;
      content.setAttribute("aria-busy", "false");
      setChildren(
        content,
        h(
          "section",
          { class: "partner-empty" },
          h("h1", {}, "Couldn't load this page"),
          h("p", { class: "muted" }, errorMessage(error)),
          h("button", { class: "btn btn-primary", attrs: { type: "button" }, on: { click: () => void load() } }, icon("refresh", 16), h("span", {}, "Try again")),
        ),
      );
    }
  }

  function render(data: SharedProgress | null) {
    content.setAttribute("aria-busy", "false");
    if (!data) {
      document.title = "Link not active · KeepOnCourse";
      setChildren(
        content,
        h(
          "section",
          { class: "partner-empty" },
          h("span", { class: "partner-empty-icon" }, icon("users", 26)),
          h("h1", {}, "This link isn't active"),
          h("p", { class: "muted" }, "The person who shared it may have stopped sharing, or the link was copied incompletely. Ask them for a new one."),
          h("a", { class: "btn btn-secondary", attrs: { href: "#/welcome" } }, h("span", {}, "What is KeepOnCourse?"), icon("arrowRight", 16)),
        ),
      );
      return;
    }
    const name = data.display_name;
    const summary = summarize(data);
    document.title = `${name}'s study progress · KeepOnCourse`;
    setChildren(
      content,
      h(
        "section",
        { class: "partner-hero" },
        h("p", { class: "landing-kicker" }, icon("users", 15), "Shared with you"),
        h("h1", {}, `${name}'s study progress`),
        h("p", { class: "partner-lead" }, lastStudiedText(summary)),
      ),
      kpis(summary),
      weekStrip(summary),
      courseList(summary),
      cheerBox(name),
      h(
        "footer",
        { class: "partner-foot" },
        h("p", { class: "muted" }, icon("shield", 15), `${name} shared this page privately with you. Only people with this link can see it, and ${name} can stop sharing at any time.`),
        h(
          "div",
          { class: "partner-cta" },
          h("div", {}, h("strong", {}, "Want someone in your corner too?"), h("span", { class: "muted" }, "KeepOnCourse turns any course into a study plan and keeps you on track. Free.")),
          h("a", { class: "btn btn-primary", attrs: { href: "#/welcome" } }, h("span", {}, "Try KeepOnCourse"), icon("arrowRight", 16)),
        ),
      ),
    );
  }

  function cheerBox(name: string): HTMLElement {
    const status = h("p", { class: "partner-cheer-status", attrs: { role: "status" } });
    const buttons = (Object.keys(CHEERS) as CheerKind[]).map((kind) =>
      h(
        "button",
        { class: "partner-cheer", attrs: { type: "button" }, on: { click: () => void cheer(kind) } },
        h("span", { class: "partner-cheer-emoji", attrs: { "aria-hidden": "true" } }, CHEERS[kind].emoji),
        CHEERS[kind].text,
      ),
    );
    const sync = () => {
      for (const b of buttons) b.disabled = cheersLeft <= 0;
      if (cheersLeft <= 0 && !status.textContent) status.textContent = "That's plenty of cheering for today. Thank you! Come back tomorrow.";
    };

    async function cheer(kind: CheerKind) {
      if (!token || cheersLeft <= 0) return;
      for (const b of buttons) b.disabled = true;
      status.classList.remove("is-error");
      try {
        const ok = await sendCheer(ctx.app, token, kind);
        if (!ok) {
          shared = null;
          return render(null);
        }
        cheersLeft--;
        status.textContent = `Sent! ${name} will see "${CHEERS[kind].emoji} ${CHEERS[kind].text}" in the app.`;
      } catch (error) {
        status.textContent = errorMessage(error);
        status.classList.add("is-error");
        if (/plenty of cheering/.test(status.textContent)) cheersLeft = 0;
      }
      sync();
    }

    sync();
    return h(
      "section",
      { class: "card partner-cheers", attrs: { "aria-labelledby": "partner-cheer-title" } },
      h("h2", { attrs: { id: "partner-cheer-title" } }, `Cheer ${name} on`),
      h("p", { class: "muted" }, `One tap sends a cheer to ${name}'s app.`),
      h("div", { class: "partner-cheer-row" }, buttons),
      status,
    );
  }

  void load();
  return {
    el,
    update() {},
    destroy() {
      destroyed = true;
    },
  };
}

function lastStudiedText(s: ProgressSummary): string {
  if (!s.lastStudied) return "No study sessions checked in yet.";
  const ago = -daysUntil(s.lastStudied, s.today);
  return `Last studied ${ago === 0 ? "today" : ago === 1 ? "yesterday" : ago < 7 ? `${ago} days ago` : `on ${formatDate(s.lastStudied)}`}.`;
}

function kpis(s: ProgressSummary): HTMLElement {
  const pct = s.week.total ? Math.round((s.week.done / s.week.total) * 100) : 0;
  const fill = h("span", {});
  fill.style.width = `${pct}%`; // CSSOM, allowed by the strict CSP
  return h(
    "section",
    { class: "partner-kpis", attrs: { "aria-label": "This week" } },
    h(
      "div",
      { class: "kpi" },
      h("span", { class: "kpi-label" }, "This week"),
      h("div", { class: "kpi-value" }, s.week.total ? `${s.week.done} of ${s.week.total}` : "–"),
      h("span", { class: "kpi-hint" }, s.week.total ? `session${s.week.total === 1 ? "" : "s"} done` : "No sessions planned"),
      s.week.total > 0 && h("div", { class: "progress-bar", attrs: { role: "progressbar", "aria-label": "Sessions done this week", "aria-valuemin": 0, "aria-valuemax": s.week.total, "aria-valuenow": s.week.done } }, fill),
    ),
    h("div", { class: "kpi" }, h("span", { class: "kpi-label" }, "Time studied"), h("div", { class: "kpi-value" }, s.week.minutes ? formatMinutes(s.week.minutes) : "0m"), h("span", { class: "kpi-hint" }, "this week")),
    h(
      "div",
      { class: cx("kpi", s.streak >= 2 && "kpi-streak") },
      h("span", { class: "kpi-label" }, "Streak"),
      h("div", { class: "kpi-value" }, s.streak >= 2 ? `🔥 ${s.streak}` : String(s.streak)),
      h("span", { class: "kpi-hint" }, `week${s.streak === 1 ? "" : "s"} in a row`),
    ),
  );
}

const DAY_LABEL: Record<DayState, string> = { done: "done", skipped: "skipped", missed: "missed", today: "today", upcoming: "planned" };
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const shortFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const local = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const weekday = (iso: string) => weekdayFormat.format(local(iso));
/** "Fri, Nov 13" */
const shortDate = (iso: string) => shortFormat.format(local(iso));

/** Monday to Sunday, with a mark for each planned session. */
function weekStrip(s: ProgressSummary): Child {
  if (!s.days.length) return null;
  const monday = weekStart(s.today);
  const cells = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const marks = s.days.filter((d) => d.date === date);
    const label = marks.length ? `${weekday(date)}: ${marks.map((m) => DAY_LABEL[m.state]).join(", ")}` : `${weekday(date)}: no session`;
    return h(
      "li",
      { class: cx("partner-day", date === s.today && "is-today"), attrs: { "aria-label": label } },
      h("span", { class: "partner-day-name", attrs: { "aria-hidden": "true" } }, weekday(date)),
      h(
        "span",
        { class: "partner-day-marks", attrs: { "aria-hidden": "true" } },
        marks.map((m) => h("span", { class: `partner-mark mark-${m.state}` }, m.state === "done" ? icon("check", 13) : m.state === "missed" ? "!" : m.state === "skipped" ? "–" : "")),
      ),
    );
  });
  return h(
    "section",
    { class: "card partner-week", attrs: { "aria-labelledby": "partner-week-title" } },
    h("h2", { attrs: { id: "partner-week-title" } }, "This week's sessions"),
    h("ol", { class: "partner-days" }, cells),
    h(
      "p",
      { class: "partner-legend muted", attrs: { "aria-hidden": "true" } },
      h("span", {}, h("span", { class: "partner-mark mark-done" }, icon("check", 11)), "Done"),
      h("span", {}, h("span", { class: "partner-mark mark-missed" }, "!"), "Missed"),
      h("span", {}, h("span", { class: "partner-mark mark-upcoming" }), "Planned"),
    ),
  );
}

function courseList(s: ProgressSummary): HTMLElement {
  return h(
    "section",
    { class: "card partner-courses", attrs: { "aria-labelledby": "partner-courses-title" } },
    h("h2", { attrs: { id: "partner-courses-title" } }, "Study plans"),
    s.courses.length === 0
      ? h("p", { class: "muted" }, "No study plans yet.")
      : h("ul", { class: "partner-course-list" }, s.courses.map((c) => courseItem(c, s.today))),
  );
}

function courseItem(c: CourseSummary, today: string): HTMLElement {
  const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
  const fill = h("span", {});
  fill.style.width = `${pct}%`;
  return h(
    "li",
    { class: "partner-course" },
    h("div", { class: "partner-course-head" }, h("strong", {}, c.name), h("span", { class: `partner-chip tone-${c.tone}` }, chipText(c))),
    h("div", { class: "progress-bar", attrs: { role: "progressbar", "aria-label": `${c.name}: sessions done`, "aria-valuemin": 0, "aria-valuemax": c.total, "aria-valuenow": c.done } }, fill),
    h(
      "p",
      { class: "muted partner-course-meta" },
      `${c.done} of ${c.total} sessions done · target ${formatDate(c.target_date)}`,
      c.next && ` · next ${c.next.date === today ? "today" : shortDate(c.next.date)}${c.next.module ? `: ${c.next.module}` : ""}`,
    ),
  );
}

function chipText(c: CourseSummary): string {
  if (c.tone === "done") return "Completed 🎉";
  if (c.tone === "behind") return `${c.missed} missed session${c.missed === 1 ? "" : "s"}`;
  if (c.tone === "late" && c.slack !== null) return `Finishing ${-c.slack} day${c.slack === -1 ? "" : "s"} late`;
  return "On track";
}
