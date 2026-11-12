import { CoachError } from "../coach/session";
import { button, emptyState, pageHeader, type Ctx, type View } from "../ui/components";
import { h, setChildren, type Child } from "../ui/dom";
import { icon, type IconName } from "../ui/icons";

/**
 * Private usage statistics (#/stats, not in the menu). Shows the two signals
 * for a Pro tier: weekly active accounts (goal 300) and monthly AI cost
 * (goal $50). Only accounts listed in the database's stats_viewers table get
 * data; everyone else sees a short explanation.
 */

const GOAL_WEEKLY_USERS = 300;
const GOAL_MONTHLY_COST = 50;

interface CoachDay {
  day: string;
  messages: number;
  people: number;
  limit_hits: number;
}
interface AnonDay {
  day: string;
  messages: number;
  visitors: number;
  limit_hits: number;
}
export interface Stats {
  model: string;
  limits: { user: number; anon: number };
  accounts: {
    accounts: number;
    signups_7d: number;
    signups_30d: number;
    active_7d: number;
    active_30d: number;
    weekly_active: { week_end: string; active: number }[];
    retention_4w: { cohort: number; active: number };
    courses: number;
    courses_with_plan: number;
    calendar_feeds: number;
    /** Added with the weekly email; missing until the database schema is re-run */
    weekly_email_subscribers?: number;
    sessions_done_7d?: number;
    checkin_accounts_7d?: number;
    coach_daily: CoachDay[];
  };
  anonymous: AnonDay[];
  cost: { per_message: number | null; measured_messages: number; messages_30d: number; estimate_30d: number | null };
}

type State = { kind: "loading" } | { kind: "ready"; stats: Stats } | { kind: "error"; message: string; code: string };

const num = (n: number) => n.toLocaleString("en-US");
const money = (n: number) => (n < 0.1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const sum = <T>(items: T[], pick: (item: T) => number) => items.reduce((total, item) => total + (Number(pick(item)) || 0), 0);

export function createStats(ctx: Ctx): View {
  const body = h("div", { class: "stats-body" });
  const refresh = button("Refresh", () => void load(), { iconName: "refresh" });
  const el = h(
    "div",
    { class: "page stats" },
    pageHeader("Stats", "Private usage numbers for KeepOnCourse, for deciding when a Pro tier makes sense.", refresh),
    body,
  );

  let state: State = { kind: "loading" };
  // The signed-in account's id, null when signed out, undefined while the sign-in is still loading
  const currentUser = () => {
    const account = ctx.app.account.state;
    return account.status === "signed-in" ? account.userId : account.status === "loading" ? undefined : null;
  };
  let lastUser = currentUser();

  async function load() {
    if (!ctx.app.account.signedIn) return render();
    state = { kind: "loading" };
    render();
    try {
      state = { kind: "ready", stats: await ctx.coach.stats<Stats>() };
    } catch (error) {
      state = { kind: "error", message: error instanceof Error ? error.message : String(error), code: error instanceof CoachError ? error.code : "error" };
    }
    render();
  }

  function render() {
    refresh.hidden = !ctx.app.account.signedIn || state.kind === "loading";
    if (!ctx.coach.configured) {
      return setChildren(body, emptyState("dashboard", "Statistics need Coach", "Statistics come from the Coach proxy, which isn't connected in this build."));
    }
    if (ctx.app.account.state.status === "loading") return setChildren(body, h("p", { class: "muted stats-loading", attrs: { role: "status" } }, "Loading…"));
    if (!ctx.app.account.signedIn) {
      return setChildren(
        body,
        emptyState("shield", "Sign in to see statistics", "These numbers are only shown to the site owner's account.", button("Sign in", () => ctx.openAccount(), { variant: "primary", iconName: "user" })),
      );
    }
    if (state.kind === "loading") return setChildren(body, h("p", { class: "muted stats-loading", attrs: { role: "status" } }, "Loading statistics…"));
    if (state.kind === "error") {
      return setChildren(
        body,
        state.code === "forbidden"
          ? emptyState("shield", "Only for the site owner", "This account isn't on the list of accounts that can see statistics.")
          : emptyState("alert", "Couldn't load statistics", state.message, button("Try again", () => void load(), { iconName: "refresh" })),
      );
    }
    setChildren(body, ...dashboard(state.stats));
  }

  // Reload when the signed-in account changes
  const unsubscribe = ctx.app.account.subscribe(() => {
    const user = currentUser();
    if (user === lastUser) return;
    lastUser = user;
    void load();
  });
  void load();

  return { el, update() {}, destroy: () => void unsubscribe() };
}

/** The dashboard for loaded statistics (exported for tests and previews). */
export function dashboard(stats: Stats): Child[] {
  const a = stats.accounts;
  const coachDays = a.coach_daily ?? [];
  const anon = stats.anonymous ?? [];
  const signedInMessages = sum(coachDays, (d) => d.messages);
  const anonMessages = sum(anon, (d) => d.messages);
  const limitHits = sum(coachDays, (d) => d.limit_hits) + sum(anon, (d) => d.limit_hits);
  const cost = stats.cost.estimate_30d;
  const retention = a.retention_4w.cohort > 0 ? Math.round((a.retention_4w.active / a.retention_4w.cohort) * 100) : null;

  return [
    h(
      "section",
      { class: "kpis", attrs: { "aria-label": "Summary" } },
      kpi("Weekly active accounts", num(a.active_7d), "user", `${num(a.active_30d)} in the last 30 days`),
      kpi("Accounts", num(a.accounts), "shield", `${num(a.signups_7d)} new this week · ${num(a.signups_30d)} this month`),
      kpi("Coach messages, 30 days", num(signedInMessages + anonMessages), "sparkles", `${num(signedInMessages)} signed in · ${num(anonMessages)} anonymous`),
      kpi("AI cost, 30 days", cost === null ? "-" : money(cost), "cloud", stats.cost.per_message === null ? "No token data yet" : `About ${money(stats.cost.per_message)} a message`),
    ),

    card(
      "Toward a Pro tier",
      "Either signal reaching its goal is the cue to consider a paid tier.",
      h(
        "div",
        { class: "meters" },
        meter("Weekly active accounts", a.active_7d, GOAL_WEEKLY_USERS, num),
        meter("AI cost per month (estimated)", cost ?? 0, GOAL_MONTHLY_COST, (n) => `$${n.toFixed(2)}`),
      ),
    ),

    h(
      "div",
      { class: "stats-grid" },
      card(
        "Weekly active accounts",
        "Accounts that used Coach or changed a course, per week (last 8 weeks).",
        barChart({
          label: "Weekly active accounts, last 8 weeks",
          series: [{ name: "Active accounts", cls: "s1" }],
          columns: a.weekly_active.map((w) => ({ label: `Week to ${shortDate(w.week_end)}`, tick: shortDate(w.week_end), values: [w.active] })),
        }),
      ),
      card(
        "Coach messages per day",
        "Last 30 days, signed-in and anonymous.",
        barChart({
          label: "Coach messages per day, last 30 days",
          series: [
            { name: "Signed in", cls: "s1" },
            { name: "Anonymous", cls: "s2" },
          ],
          columns: coachDays.map((d, i) => ({
            label: shortDate(d.day),
            // One label a week, counting back from today
            tick: (coachDays.length - 1 - i) % 7 === 0 ? shortDate(d.day) : "",
            values: [d.messages, anon.find((x) => x.day === d.day)?.messages ?? 0],
          })),
        }),
      ),
    ),

    card(
      "Other signals",
      null,
      h(
        "dl",
        { class: "signals" },
        signal("Come back after 4 weeks", retention === null ? "No accounts old enough yet" : `${retention}% (${a.retention_4w.active} of ${a.retention_4w.cohort})`, "Accounts that signed up 4 to 8 weeks ago and were active this week."),
        signal("Hit the daily Coach limit", `${num(limitHits)} times in 30 days`, `People who used all ${stats.limits.user} (signed in) or ${stats.limits.anon} (anonymous) messages in a day: the clearest sign of demand for a bigger allowance.`),
        signal("Courses", `${num(a.courses)} · ${num(a.courses_with_plan)} with a study plan`, "Across all accounts. Demo-mode courses stay in visitors' browsers and aren't counted."),
        signal("Calendar subscriptions", num(a.calendar_feeds), "Accounts that created a calendar subscription link."),
        signal(
          "Sessions checked in, 7 days",
          a.sessions_done_7d === undefined ? "-" : `${num(a.sessions_done_7d)} by ${num(a.checkin_accounts_7d ?? 0)} account${a.checkin_accounts_7d === 1 ? "" : "s"}`,
          "Study sessions marked done: people actually following their plans.",
        ),
        signal("Weekly check-in email", a.weekly_email_subscribers === undefined ? "-" : `${num(a.weekly_email_subscribers)} subscribed`, "Accounts that turned on the Monday email."),
      ),
    ),

    h(
      "p",
      { class: "muted stats-note" },
      `Costs are estimates for ${stats.model}, from the tokens measured on ${num(stats.cost.measured_messages)} signed-in messages, applied to all messages. The exact charges are in the Anthropic Console. Anonymous visitors are counted per day only, so they aren't in the weekly totals.`,
    ),
  ];
}

function kpi(label: string, value: string, iconName: IconName, hint: string): HTMLElement {
  return h(
    "div",
    { class: "kpi kpi-neutral" },
    h("div", { class: "kpi-top" }, h("span", { class: "kpi-label" }, label), h("span", { class: "kpi-icon" }, icon(iconName, 18))),
    h("div", { class: "kpi-value" }, value),
    h("div", { class: "kpi-hint" }, hint),
  );
}

function card(title: string, subtitle: string | null, ...children: Child[]): HTMLElement {
  return h("section", { class: "card stats-card" }, h("div", { class: "stats-card-head" }, h("h2", {}, title), subtitle && h("p", { class: "muted" }, subtitle)), ...children);
}

function meter(label: string, value: number, goal: number, format: (n: number) => string): HTMLElement {
  const pct = Math.min(100, Math.max(0, (value / goal) * 100));
  const fill = h("div", { class: "meter-fill" });
  fill.style.width = `${pct}%`; // CSSOM, allowed by the strict CSP
  return h(
    "div",
    { class: "meter" },
    h("div", { class: "meter-top" }, h("span", { class: "meter-label" }, label), h("span", { class: "meter-value" }, `${format(value)} of ${format(goal)}`)),
    h(
      "div",
      { class: "meter-track", attrs: { role: "progressbar", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": goal, "aria-valuenow": Number(value.toFixed(2)), "aria-valuetext": `${format(value)} of ${format(goal)} (${Math.round(pct)}%)` } },
      fill,
    ),
  );
}

function signal(term: string, value: string, help: string): HTMLElement {
  return h("div", { class: "signal" }, h("dt", {}, term), h("dd", {}, h("strong", {}, value), h("span", { class: "muted" }, help)));
}

interface ChartSpec {
  label: string;
  series: { name: string; cls: string }[];
  columns: { label: string; tick: string; values: number[] }[];
}

/**
 * Bar chart (stacked when there are several series) built from plain
 * elements; bar heights are set through the CSSOM, which the strict CSP
 * allows. Every column shows a tooltip on hover or keyboard focus, and the
 * same numbers are available as a table.
 */
function barChart(spec: ChartSpec): HTMLElement {
  const totals = spec.columns.map((c) => sum(c.values, (v) => v));
  const max = Math.max(1, ...totals);
  const top = niceMax(max);
  const tooltip = h("div", { class: "chart-tip", attrs: { role: "status", "aria-live": "polite" } });
  tooltip.hidden = true;

  const plot = h("div", { class: "chart-plot" });
  spec.columns.forEach((column, i) => {
    const stack = h("div", { class: "chart-stack" });
    column.values.forEach((value, s) => {
      if (value <= 0) return;
      const seg = h("div", { class: `chart-seg ${spec.series[s].cls}` });
      seg.style.height = `${(value / top) * 100}%`;
      stack.append(seg);
    });
    const describe = spec.series.length > 1 ? spec.series.map((s, k) => `${s.name}: ${num(column.values[k])}`).join(" · ") : num(column.values[0]);
    const col = h(
      "div",
      {
        class: "chart-col",
        attrs: { tabindex: 0, "aria-label": `${column.label}: ${describe}` },
        on: {
          pointerenter: () => show(),
          focus: () => show(),
          pointerleave: () => (tooltip.hidden = true),
          blur: () => (tooltip.hidden = true),
        },
      },
      stack,
    );
    function show() {
      setChildren(tooltip, h("strong", {}, column.label), h("span", {}, describe));
      tooltip.hidden = false;
      const left = ((i + 0.5) / spec.columns.length) * 100;
      tooltip.style.left = `${Math.min(85, Math.max(15, left))}%`;
    }
    plot.append(col);
  });

  const axis = h("div", { class: "chart-ticks", attrs: { "aria-hidden": "true" } }, spec.columns.map((c) => h("span", {}, c.tick)));
  const grid = h("div", { class: "chart-grid", attrs: { "aria-hidden": "true" } }, h("span", {}, num(top)), h("span", {}, num(top / 2)), h("span", {}, "0"));

  const legend =
    spec.series.length > 1
      ? h("ul", { class: "chart-legend" }, spec.series.map((s) => h("li", {}, h("span", { class: `chart-key ${s.cls}`, attrs: { "aria-hidden": "true" } }), s.name)))
      : null;

  const table = h(
    "details",
    { class: "chart-table" },
    h("summary", {}, "Show as table"),
    h(
      "table",
      {},
      h("thead", {}, h("tr", {}, h("th", { attrs: { scope: "col" } }, "Period"), spec.series.map((s) => h("th", { attrs: { scope: "col" } }, s.name)))),
      h("tbody", {}, spec.columns.map((c) => h("tr", {}, h("th", { attrs: { scope: "row" } }, c.label), c.values.map((v) => h("td", {}, num(v)))))),
    ),
  );

  return h(
    "figure",
    { class: "chart", attrs: { "aria-label": spec.label } },
    legend,
    h("div", { class: "chart-area" }, grid, h("div", { class: "chart-main" }, plot, tooltip), axis),
    table,
  );
}

/** A round axis maximum just above the data (1, 2, 5 × 10^n). */
function niceMax(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}
