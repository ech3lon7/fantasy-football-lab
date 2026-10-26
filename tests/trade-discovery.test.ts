import { expect, it } from "vitest";
import { starterFixture, tradeSearchFixture } from "./fixtures";
import { evaluate } from "../src/domain/valuation";
import { evaluateTrade } from "../src/domain/trades";
import { initialState } from "../src/domain/contracts";
import {
  readSavedTrades,
  saveTrade,
  summaryFromSearch,
} from "../src/domain/saved-trades";
import {
  compareSearchRows,
  findTradeMatches,
  scoreTradeMatch,
  tradeSearchBounds,
  tradeSearchContext,
  type SearchRow,
  type TradeSearchQuery,
} from "../src/domain/trade-search";
import {
  compareDiscoveryRows,
  discoveryFailures,
  findDiscoveryMatches,
  opponentIncentive,
  outgoingPackages,
  retainSuggestion,
  violatesProtection,
} from "../src/domain/trade-discovery";

// Real synthetic models verify discovery against the authoritative evaluator rather than duplicate its formulas.
async function sample() {
  const d = await starterFixture();
  d.tables.ModelContext[0].BenchSlots = 20;
  const m = evaluate(d, d.settings);
  const q: TradeSearchQuery = {
    teamA: "1",
    give: ["101"],
    count: 1,
    below: 1000,
    above: 1000,
  };
  return { m, q };
}

// Disabled discovery is identical to the existing fixed-package enumerator, including its stats and ordering.
it("preserves fixed search behavior and default ranking", async () => {
  const { m, q } = await sample();
  expect(findDiscoveryMatches(m, q)).toEqual(findTradeMatches(m, q));
  const rows = findDiscoveryMatches(m, q).matches.map((match) =>
    scoreTradeMatch(m, q, match),
  );
  expect([...rows].sort(compareDiscoveryRows)).toEqual(
    [...rows].sort(compareSearchRows),
  );
});

// Incoming ranges must include every requested size, preserve authoritative scoring and round-trip the actual saved trade.
it("combines singles and packages with flexible offers, targets and saved ranges", async () => {
  const d = await tradeSearchFixture();
  d.tables.ModelContext[0].BenchSlots = 20;
  const m = evaluate(d, d.settings);
  const q: TradeSearchQuery = {
    teamA: "1",
    give: ["101"],
    count: 3,
    below: 1000,
    above: 1000,
    discovery: {
      receive: { minimum: 1, maximum: 3 },
      flexible: { pool: ["100", "101"], minimum: 1, maximum: 2 },
      target: "200",
    },
  };
  const before = JSON.stringify(m.players);
  const found = findDiscoveryMatches(m, q).matches;
  expect(new Set(found.map((r) => r.get.length))).toEqual(new Set([1, 2, 3]));
  expect(new Set(found.map((r) => r.give!.join(",")))).toEqual(
    new Set(["100", "100,101", "101"]),
  );
  expect(new Set(found.map((r) => r.key)).size).toBe(found.length);
  for (const count of [1, 2, 3]) {
    const match = found.find((r) => r.get.length === count)!;
    expect(match.get).toContain("200");
    expect(new Set(match.get.map((id) => m.byId.get(id)!.owner))).toEqual(
      new Set(["2"]),
    );
    const row = scoreTradeMatch(m, q, match);
    expect(discoveryFailures(row, q)).toEqual([]);
    const draft = {
      teamA: "1",
      teamB: match.teamB,
      give: match.give!,
      get: match.get,
    };
    const manual = evaluateTrade(m, draft);
    expect(manual.valid).toBe(true);
    if (!manual.valid) continue;
    expect(row.own).toBe(manual.potentialA.expectedPerWeek);
    expect(row.other).toBe(manual.potentialB.expectedPerWeek);
    const saved = readSavedTrades(
      saveTrade(initialState(d), m, draft, summaryFromSearch(row), q),
    );
    expect(saved.issue).toBe("");
    expect(saved.trades[0].draft.get).toHaveLength(count);
    expect(saved.trades[0].query?.discovery?.receive).toEqual({
      minimum: 1,
      maximum: 3,
    });
  }
  expect(JSON.stringify(m.players)).toBe(before);
  // Incoming label/position minimums exclude undersized subsets without blocking the valid larger sizes.
  const filtered = {
    ...q,
    incoming: { positions: ["WR"] as const, minimumPositions: 2 },
  };
  const matches = findDiscoveryMatches(m, {
    ...filtered,
    incoming: { ...filtered.incoming, positions: ["WR"] },
  }).matches;
  expect(matches.length).toBeGreaterThan(0);
  expect(matches.every((r) => r.get.length === 3)).toBe(true);
});

// Bounds reject malformed sizes, invalidate old results and keep just-outside sizes in the near-miss list.
it("validates incoming ranges and distinguishes exact sizes from near-miss adjustments", async () => {
  const { m, q } = await sample();
  for (const receive of [
    { minimum: 0, maximum: 3 },
    { minimum: 3, maximum: 2 },
    { minimum: 1, maximum: 6 },
    { minimum: 1.5, maximum: 3 },
  ])
    expect(
      tradeSearchBounds(m, { ...q, discovery: { receive } }).errors.join(" "),
    ).toContain("incoming-player range");
  const ranged = { ...q, discovery: { receive: { minimum: 1, maximum: 3 } } };
  expect(tradeSearchContext(m, ranged)).not.toBe(tradeSearchContext(m, q));
  const base = scoreTradeMatch(m, q, findTradeMatches(m, q).matches[0]);
  expect(discoveryFailures({ ...base, get: ["a", "b"] }, ranged)).toEqual([]);
  expect(
    discoveryFailures({ ...base, get: ["a", "b", "c", "d"] }, ranged),
  ).toContain("Adjustment: receive 4 players instead of 1–3.");
  const near = {
    ...q,
    discovery: {
      target: "200",
      receive: { minimum: 2, maximum: 2 },
      nearMisses: true,
    },
  };
  const found = findDiscoveryMatches(m, near).matches;
  expect(found.some((r) => r.get.length === 1)).toBe(true);
  expect(found.some((r) => r.get.length === 2)).toBe(true);
  for (const match of found) {
    const row = scoreTradeMatch(m, near, match);
    expect(
      discoveryFailures(row, near).some((r) => r.startsWith("Adjustment:")),
    ).toBe(match.get.length !== 2);
  }
});

// Every combination uses only selected candidates, has a unique identity, and scores/saves the actual subset.
it("enumerates tradable subsets, protects unselected starters and round-trips saved searches", async () => {
  const { m, q } = await sample();
  q.discovery = {
    flexible: { pool: ["100", "101"], minimum: 1, maximum: 2 },
    target: "200",
    ranking: "balanced",
  };
  expect(outgoingPackages(q)).toEqual([["100"], ["100", "101"], ["101"]]);
  const matches = findDiscoveryMatches(m, q).matches;
  expect(matches).toHaveLength(3);
  expect(new Set(matches.map((row) => row.key)).size).toBe(3);
  const state = initialState(m.dataset),
    before = JSON.stringify(m.players);
  for (const match of matches) {
    expect(match.give).not.toContain("1");
    expect(match.get).toEqual(["200"]);
    const row = scoreTradeMatch(m, q, match);
    const draft = { teamA: "1", teamB: "2", give: match.give!, get: match.get };
    const expected = evaluateTrade(m, draft);
    expect(expected.valid).toBe(true);
    if (!expected.valid) continue;
    expect(row.own).toBe(expected.potentialA.expectedPerWeek);
    expect(row.other).toBe(expected.potentialB.expectedPerWeek);
    const saved = readSavedTrades(
      saveTrade(state, m, draft, summaryFromSearch(row), q),
    );
    expect(saved.issue).toBe("");
    expect(saved.trades[0].draft.give).toEqual(match.give);
    expect(saved.trades[0].query?.discovery).toEqual(q.discovery);
  }
  expect(JSON.stringify(m.players)).toBe(before);
  // Protected incumbents may not be silently removed by automatic roster repair, including in near-miss searches.
  const row = scoreTradeMatch(m, q, matches[0]);
  expect(violatesProtection({ ...row, dropsA: ["1"] }, q)).toBe(true);
  expect(violatesProtection({ ...row, dropsA: ["100"] }, q)).toBe(false);
  expect(violatesProtection({ ...row, dropsA: [...row.get] }, q)).toBe(false);
});

// Invalid pools, targets, ownership and size limits fail before worker enumeration; changes invalidate stale results.
it("validates discovery and keeps target and ranking changes in search identity", async () => {
  const { m, q } = await sample();
  for (const flexible of [
    { pool: ["200"], minimum: 1, maximum: 1 },
    { pool: ["100", "100"], minimum: 1, maximum: 2 },
    { pool: ["100"], minimum: 2, maximum: 2 },
    { pool: ["100"], minimum: 1, maximum: 6 },
  ])
    expect(
      tradeSearchBounds(m, { ...q, discovery: { flexible } }).errors.length,
    ).toBeGreaterThan(0);
  for (const target of ["100", "102", "missing"])
    expect(
      tradeSearchBounds(m, { ...q, discovery: { target } }).errors.length,
    ).toBeGreaterThan(0);
  for (const discovery of [
    { target: "200" },
    { ranking: "balanced" as const },
    { nearMisses: true },
  ])
    expect(tradeSearchContext(m, { ...q, discovery })).not.toBe(
      tradeSearchContext(m, q),
    );
});

// Ranking compares team point gains separately from value exchange, and missing scoring remains unavailable.
it("ranks mutually beneficial packages and opponent gains with stable fallback ties", async () => {
  const { m, q } = await sample();
  const base = scoreTradeMatch(m, q, findTradeMatches(m, q).matches[0]);
  const win = { ...base, own: 2, other: 2, legal: true },
    loss = { ...base, own: 20, other: -1, legal: true };
  expect(compareDiscoveryRows(win, loss, "balanced")).toBeLessThan(0);
  expect(compareDiscoveryRows(win, loss, "other")).toBeLessThan(0);
  expect(
    compareDiscoveryRows(win, { ...win, other: null }, "balanced"),
  ).toBeLessThan(0);
  expect(compareDiscoveryRows(win, loss, "own")).toBe(
    compareSearchRows(win, loss),
  );
});

// Alternatives are genuine evaluated packages; count/index/PPG shortfalls stay visible and never satisfy exact filters silently.
it("separates nearby package adjustments and retains five explained legal alternatives", async () => {
  const { m, q } = await sample();
  q.discovery = { target: "200", nearMisses: true };
  const found = findDiscoveryMatches(m, q);
  expect(found.matches.some((row) => row.get.length === 2)).toBe(true);
  const suggestions: SearchRow[] = [];
  for (const match of found.matches) {
    const row = scoreTradeMatch(m, q, match),
      reasons = discoveryFailures(row, q);
    if (match.get.length !== 1)
      expect(reasons.join(" ")).toContain("Adjustment:");
    retainSuggestion(suggestions, row, reasons);
  }
  expect(suggestions.length).toBeGreaterThan(0);
  expect(suggestions.length).toBeLessThanOrEqual(5);
  const base = suggestions[0];
  const failures = discoveryFailures(
    { ...base, incoming: base.outgoing + 7, own: 1, other: -2 },
    {
      ...q,
      below: 0,
      above: 0,
      weekly: {
        own: { minimum: 3, maximum: null },
        other: { minimum: 0, maximum: null },
      },
    },
  );
  expect(failures.join(" ")).toContain("7.00 above");
  expect(failures.join(" ")).toContain("2.00 points/week below");
});

// Opponent explanations expose gains, losses, original grades and value context without changing values or promising acceptance.
it("explains recipient incentives on demand without mutating the snapshot", async () => {
  const { m, q } = await sample();
  const row = scoreTradeMatch(m, q, findTradeMatches(m, q).matches[0]);
  const before = JSON.stringify(m.players),
    details = opponentIncentive(m, q, row);
  expect(details.notes.join(" ")).toContain(
    "Their weekly gain (Best available lineup)",
  );
  expect(details.notes.join(" ")).toContain("not a market price");
  expect(details.positions.length).toBeGreaterThan(0);
  expect(JSON.stringify(m.players)).toBe(before);
  // Missing forecasts remain unknown in the incentive explanation instead of manufacturing a zero-value opponent.
  m.byId.get("200")!.expected = null;
  const incomplete = opponentIncentive(m, q, row);
  expect(incomplete.summary).toBe("Incomplete evidence");
  expect(
    incomplete.positions.some((position) => position.starterGain === null),
  ).toBe(true);
});
