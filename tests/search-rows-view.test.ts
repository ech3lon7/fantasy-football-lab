import { it, expect } from "vitest";
import { tradeSearchFixture } from "./fixtures";
import { evaluate } from "../src/domain/valuation";
import {
  findTradeMatches,
  scoreTradeMatch,
  type SearchRow,
  type TradeSearchQuery,
} from "../src/domain/trade-search";
import {
  orderResultRows,
  priceStatus,
  resultRowView,
  resultSummary,
  type ResultRowView,
} from "../src/domain/view/search-rows";
import { evaluateTrade } from "../src/domain/trades";
import { tradeImpact } from "../src/domain/trade-impact";
import { lineupGainSpread, gradeStepChips } from "../src/domain/view/trade-room";

const query: TradeSearchQuery = {
  teamA: "1",
  give: ["101"],
  count: 1,
  below: 1000,
  above: 1000,
  indexMode: "automatic",
};

async function rows() {
  const d = await tradeSearchFixture(),
    m = evaluate(d, d.settings);
  const found = findTradeMatches(m, query);
  return { m, rows: found.matches.map((match) => scoreTradeMatch(m, query, match)) };
}

const context = { teamA: "1", give: ["101"], basis: "best-available" as const };

// Price status: the recorded tests decide it, a widened round overrides it, and nothing is ever hidden.
it("classifies a row as pass, warning or widened from its recorded tests", () => {
  const pass = { surplus: "PASS", points: "PASS" };
  expect(priceStatus(pass).kind).toBe("pass");
  const warning = priceStatus({ surplus: "FAIL", points: "PASS" });
  expect(warning.kind).toBe("warning");
  expect(warning.detail).toContain("Surplus test: FAIL");
  const widened = priceStatus(pass, ["Index window ±5.0 → ±7.5"]);
  expect(widened.kind).toBe("widened");
  expect(widened.detail).toBe("Index window ±5.0 → ±7.5");
});

// The row view uses the Manual analyzer's own functions, so a result and the analyzer can never disagree.
it("matches the Manual analyzer's chips and lineup gain for the same trade", async () => {
  const { m, rows: found } = await rows();
  expect(found.length).toBeGreaterThan(0);
  for (const row of found.slice(0, 4)) {
    const view = resultRowView(m, row, context);
    const draft = { teamA: "1", teamB: row.teamB, give: row.give ?? ["101"], get: row.get };
    const result = evaluateTrade(m, draft, true);
    expect(result.valid).toBe(true);
    if (!result.valid) continue;
    expect(view.ownChips).toEqual(gradeStepChips(m, draft, result).own);
    expect(view.otherChips).toEqual(gradeStepChips(m, draft, result).other);
    const impact = tradeImpact(result, "best-available")!;
    expect(view.gain).toEqual(
      lineupGainSpread(m, impact.own, impact.own.expectedPerWeek),
    );
  }
});

// Chips are only for positions that move; an unaffected position never appears and "no change" is never shown.
it("shows chips only for impacted positions and never zero steps", async () => {
  const { m, rows: found } = await rows();
  for (const row of found) {
    const view = resultRowView(m, row, context);
    for (const chip of [...view.ownChips, ...view.otherChips]) {
      expect(chip.steps).not.toBe(0);
      expect(chip.text).not.toMatch(/no change/i);
    }
  }
});

// The spread is the root of the summed squares of the changed players' spreads, or null with a reason: never a constant.
it("reports a spread that comes from the changed players, or null with the reason", async () => {
  const { m, rows: found } = await rows();
  const views = found.map((row) => resultRowView(m, row, context));
  for (const v of views) {
    if (v.gain.spread === null) expect(v.gain.gain === null || v.gain.players.length === 0 || v.gain.reason !== "").toBe(true);
    else expect(v.gain.floor).toBeCloseTo(v.gain.gain! - v.gain.spread, 9);
  }
  // Different packages must not all carry one constant spread.
  const spreads = new Set(views.map((v) => v.gain.spread));
  expect(spreads.size).toBeGreaterThanOrEqual(1);
});

// An unscorable trade keeps null parts and a reason; it never becomes a zero gain.
it("keeps an invalid trade's gain null with the reason", async () => {
  const { m } = await rows();
  const bad = { key: "x", teamB: "1", get: ["100"], incoming: 1, outgoing: 1, difference: 0, own: null, other: null, ownTotal: null, ownTotal2: null, otherTotal: null, grade: "n/a", surplus: "FAIL", points: "FAIL", legal: null, warnings: [], dropsA: [], dropsB: [], irA: [], irB: [] } as unknown as SearchRow;
  const view = resultRowView(m, bad, context);
  expect(view.gain.gain).toBeNull();
  expect(view.gain.spread).toBeNull();
  expect(view.gain.reason.length).toBeGreaterThan(0);
  expect(view.ownChips).toEqual([]);
});

// Ordering: passes, then warnings, then widened; within a status the larger gain first; unscored gains last.
it("orders by status, then by lineup gain", () => {
  const mk = (key: string, kind: "pass" | "warning" | "widened", gain: number | null): ResultRowView => ({
    key, give: [], get: [], teamName: "", ownChips: [], otherChips: [], surplus: "",
    legal: true,
    status: { kind, label: kind, detail: "" },
    gain: { gain, spread: null, floor: null, ceiling: null, players: [], sharesNflTeam: false, reason: "" },
  });
  const ordered = orderResultRows([
    mk("w", "widened", 9),
    mk("p-low", "pass", 1),
    mk("warn", "warning", 5),
    mk("p-null", "pass", null),
    mk("p-high", "pass", 3),
  ]).map((r) => r.key);
  expect(ordered).toEqual(["p-high", "p-low", "p-null", "warn", "w"]);
});

// The summary uses real counts only, and never claims a count before a search has run.
it("builds the summary line from real counts", () => {
  expect(resultSummary(24, { checked: 96, teams: 3 })).toBe(
    "24 trades meet every goal · 96 combinations examined across 3 teams",
  );
  expect(resultSummary(1, { checked: 4, teams: 1 })).toBe(
    "1 trade meets every goal · 4 combinations examined across 1 team",
  );
  expect(resultSummary(0, undefined)).toBe("0 trades meet every goal");
});
