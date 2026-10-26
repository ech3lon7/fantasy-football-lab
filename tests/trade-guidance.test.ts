import { expect, it } from "vitest";
import { tradeSearchFixture } from "./fixtures";
import { evaluate } from "../src/domain/valuation";
import { initialState } from "../src/domain/contracts";
import {
  readSavedTrades,
  saveTrade,
  summaryFromSearch,
} from "../src/domain/saved-trades";
import {
  guidedQuery,
  findTradeRecoveries,
  recoveryQueries,
} from "../src/domain/trade-guidance";
import {
  discoveryFailures,
  findDiscoveryMatches,
} from "../src/domain/trade-discovery";
import {
  scoreTradeMatch,
  tradeSearchContext,
  type TradeSearchQuery,
} from "../src/domain/trade-search";

// Synthetic fixtures compare guidance against the existing exhaustive enumerator and authoritative scorer.
async function sample() {
  const d = await tradeSearchFixture();
  d.tables.ModelContext[0].BenchSlots = 20;
  const m = evaluate(d, d.settings);
  const q: TradeSearchQuery = {
    teamA: "1",
    give: ["101"],
    count: 1,
    below: 0,
    above: 0,
  };
  return { d, m, q };
}

// Automatic mode removes only the price interval: missing values, targets, positions and saved strict behavior remain intact.
it("automatic matching includes out-of-range returns without changing their scores", async () => {
  const { m, q } = await sample();
  const automatic = { ...q, indexMode: "automatic" as const };
  const strict = findDiscoveryMatches(m, q).matches;
  const broad = findDiscoveryMatches(m, {
    ...q,
    below: 10000,
    above: 10000,
  }).matches;
  const matches = findDiscoveryMatches(m, automatic).matches;
  expect(matches).toEqual(broad);
  expect(matches.length).toBeGreaterThan(strict.length);
  const outside = matches.find((r) => r.incoming !== r.outgoing)!;
  const row = scoreTradeMatch(m, automatic, outside);
  expect(row).toEqual(scoreTradeMatch(m, q, outside));
  expect(discoveryFailures(row, q)).not.toEqual([]);
  expect(discoveryFailures(row, automatic)).toEqual([]);
  expect(tradeSearchContext(m, automatic)).not.toBe(tradeSearchContext(m, q));
  const target = {
    ...automatic,
    discovery: { target: "200" },
    incoming: { positions: ["QB" as const] },
  };
  expect(
    findDiscoveryMatches(m, target).matches.every(
      (r) =>
        r.get.includes("200") &&
        r.get.every((id) => m.byId.get(id)!.pos === "QB"),
    ),
  ).toBe(true);
});

// Explicit goal presets retain protected/tradable choices; a position goal requires a real position contribution gain.
it("goal presets configure transparent scoring criteria and preserve player choices", async () => {
  const { m, q } = await sample();
  q.discovery = {
    flexible: { pool: ["100", "101"], minimum: 1, maximum: 2 },
    target: "200",
  };
  q.usefulness = { minimum: 4 };
  const goal = guidedQuery(q, "improve");
  expect(goal.discovery?.flexible).toEqual(q.discovery.flexible);
  expect(goal.discovery?.target).toBe("200");
  expect(goal.weekly).toEqual({
    own: { minimum: 1, maximum: null },
    other: { minimum: 0, maximum: null },
  });
  expect(goal.usefulness).toBeUndefined();
  expect(guidedQuery(q, "custom")).toEqual({ ...q, goal: "custom" });
  const positional = guidedQuery(
    { ...q, discovery: undefined },
    "position",
    "QB",
  );
  const rows = findDiscoveryMatches(m, positional).matches.map((match) =>
    scoreTradeMatch(m, positional, match),
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(typeof row.positionGain).toBe("number");
    if (row.positionGain! <= 0)
      expect(discoveryFailures(row, positional).join()).toContain("position");
  }
});

// Combined changes can succeed even when one change alone cannot; every displayed count equals a complete rerun.
it("recovery previews are exact, preserve hard criteria and never mutate the original query", async () => {
  const { m, q } = await sample();
  q.weekly = { own: { minimum: 1000, maximum: null } };
  q.discovery = {
    target: "200",
    flexible: { pool: ["100", "101"], minimum: 1, maximum: 2 },
  };
  const before = JSON.stringify(q);
  const options = findTradeRecoveries(m, q);
  expect(options.length).toBeGreaterThan(0);
  expect(options.some((o) => o.changes.length > 1)).toBe(true);
  for (const option of options) {
    const rows = findDiscoveryMatches(m, option.query).matches.map((match) =>
      scoreTradeMatch(m, option.query, match),
    );
    expect(option.count).toBe(
      rows.filter((row) => !discoveryFailures(row, option.query).length).length,
    );
    expect(option.query.discovery?.target).toBe("200");
    expect(option.query.discovery?.flexible).toEqual(q.discovery.flexible);
    expect(rows.every((row) => row.get.includes("200"))).toBe(true);
  }
  expect(JSON.stringify(q)).toBe(before);
  expect(
    recoveryQueries({
      ...q,
      indexMode: "automatic",
      count: 3,
      discovery: { receive: { minimum: 1, maximum: 3 } },
      weekly: undefined,
    }),
  ).toEqual([]);
});

// Guided metadata survives saved-trade parsing; a legacy query is never silently migrated to automatic mode.
it("round-trips guided searches and keeps legacy mode absent", async () => {
  const { d, m, q } = await sample();
  const automatic = guidedQuery(q, "explore");
  const match = findDiscoveryMatches(m, automatic).matches[0];
  const row = scoreTradeMatch(m, automatic, match);
  const state = initialState(d);
  const saved = saveTrade(
    state,
    m,
    { teamA: "1", teamB: match.teamB, give: q.give, get: match.get },
    summaryFromSearch(row),
    automatic,
  );
  const restored = readSavedTrades(saved).trades[0];
  expect(restored.query?.indexMode).toBe("automatic");
  expect(restored.query?.goal).toBe("explore");
  expect(q.indexMode).toBeUndefined();
});
