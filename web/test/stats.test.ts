// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { dashboard, type Stats } from "../src/views/stats";

/** n consecutive days ending 2026-11-12 */
const days = (n: number, f: (i: number) => Record<string, unknown>) =>
  Array.from({ length: n }, (_, i) => ({ day: new Date(Date.UTC(2026, 10, 12 - (n - 1 - i))).toISOString().slice(0, 10), ...f(i) }));

function sampleStats(): Stats {
  return {
    model: "claude-haiku-5-5",
    limits: { user: 60, anon: 15 },
    accounts: {
      accounts: 42,
      signups_7d: 6,
      signups_30d: 19,
      active_7d: 27,
      active_30d: 38,
      weekly_active: Array.from({ length: 8 }, (_, i) => ({ week_end: new Date(Date.UTC(2026, 10, 12 - 7 * (7 - i))).toISOString().slice(0, 10), active: 3 + i * 3 })),
      retention_4w: { cohort: 10, active: 4 },
      courses: 130,
      courses_with_plan: 31,
      calendar_feeds: 9,
      coach_daily: days(30, (i) => ({ messages: 10 + (i % 7) * 4, people: 5, limit_hits: i === 29 ? 1 : 0 })) as Stats["accounts"]["coach_daily"],
    },
    anonymous: days(30, (i) => ({ messages: 5 + (i % 5) * 3, visitors: 4, limit_hits: i === 20 ? 2 : 0 })) as Stats["anonymous"],
    cost: { per_message: 0.0012, measured_messages: 400, messages_30d: 1200, estimate_30d: 1.44 },
  };
}

function render(stats: Stats) {
  const root = document.createElement("div");
  root.append(...(dashboard(stats).filter(Boolean) as Node[]));
  return root;
}

describe("Stats dashboard", () => {
  it("shows the headline numbers and progress toward both goals", () => {
    const root = render(sampleStats());
    const kpis = [...root.querySelectorAll(".kpi")].map((k) => k.querySelector(".kpi-value")?.textContent);
    expect(kpis).toEqual(["27", "42", expect.any(String), "$1.44"]);
    const meters = [...root.querySelectorAll('[role="progressbar"]')];
    expect(meters.map((m) => m.getAttribute("aria-valuetext"))).toEqual(["27 of 300 (9%)", "$1.44 of $50.00 (3%)"]);
  });

  it("draws both charts with a table view, and a legend only for the two-series chart", () => {
    const root = render(sampleStats());
    const charts = root.querySelectorAll("figure.chart");
    expect(charts).toHaveLength(2);
    expect(charts[0].querySelector(".chart-legend")).toBeNull();
    expect([...charts[1].querySelectorAll(".chart-legend li")].map((li) => li.textContent)).toEqual(["Signed in", "Anonymous"]);
    expect(charts[0].querySelectorAll(".chart-col")).toHaveLength(8);
    expect(charts[1].querySelectorAll(".chart-col")).toHaveLength(30);
    expect(charts[1].querySelectorAll("tbody tr")).toHaveLength(30);
    // Every bar is reachable by keyboard and describes itself
    expect(charts[1].querySelector(".chart-col")?.getAttribute("aria-label")).toMatch(/Signed in: \d+ · Anonymous: \d+/);
  });

  it("copes with a brand-new site: no activity, no token data", () => {
    const empty = sampleStats();
    empty.accounts = { ...empty.accounts, accounts: 0, active_7d: 0, retention_4w: { cohort: 0, active: 0 }, weekly_active: empty.accounts.weekly_active.map((w) => ({ ...w, active: 0 })) };
    empty.cost = { per_message: null, measured_messages: 0, messages_30d: 0, estimate_30d: null };
    const root = render(empty);
    expect(root.textContent).toContain("No token data yet");
    expect(root.textContent).toContain("No accounts old enough yet");
  });
});
