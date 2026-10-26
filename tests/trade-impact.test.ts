import { expect, it } from "vitest";
import { starterFixture } from "./fixtures";
import { evaluate } from "../src/domain/valuation";
import { withoutByeWeeks } from "../src/domain/lineups";
import { evaluateTrade } from "../src/domain/trades";
import { tradeImpact, lineupBasisKey } from "../src/domain/trade-impact";
import { initialState } from "../src/domain/contracts";
import {
  scoreTradeMatch,
  searchLineupDetails,
  tradeSearchContext,
  matchesWeekly,
} from "../src/domain/trade-search";
import {
  summaryFromTrade,
  summaryFromSearch,
  saveTrade,
  readSavedTrades,
  savedLineupBasis,
  originalLineupBasis,
} from "../src/domain/saved-trades";
import { diagnoseTradeCandidate } from "../src/domain/trade-tools";
import { guidedQuery } from "../src/domain/trade-guidance";

// A benched top QB has real optimized opportunity cost but zero marked-starter cost; the selected basis must travel through every consumer.
it("shares selected scoring, baseline arithmetic, filters and candidate explanations without changing valuations", async () => {
  const d = await starterFixture(),
    m = withoutByeWeeks(evaluate(d, d.settings));
  const original = structuredClone(d);
  const draft = { teamA: "1", teamB: "2", give: ["101"], get: ["200"] };
  const result = evaluateTrade(m, draft, false);
  if (!result.valid) throw Error(result.errors.join());
  const best = tradeImpact(result)!,
    marked = tradeImpact(result, "marked-starters")!;
  expect(best.own.expectedPerWeek).toBe(-10);
  expect(marked.own.expectedPerWeek).toBe(0);
  expect(best.own.beforePerWeek! - marked.own.beforePerWeek!).toBe(10);
  expect(best.own.afterPerWeek).toBe(marked.own.afterPerWeek);
  for (const basis of ["best-available", "marked-starters"] as const) {
    const q = {
      ...draft,
      count: 1,
      below: 0,
      above: 0,
      indexMode: "automatic" as const,
      lineupBasis: basis,
    };
    const match = {
      key: "test",
      teamB: "2",
      get: ["200"],
      outgoing: 0,
      incoming: 0,
      difference: 0,
    };
    const row = scoreTradeMatch(m, q, match),
      summary = tradeImpact(result, basis)!;
    expect(row.own).toBe(summary.own.expectedPerWeek);
    expect(row.other).toBe(summary.other.expectedPerWeek);
    expect(row.ownAfter! - row.ownBefore!).toBeCloseTo(row.own!, 12);
    const detail = searchLineupDetails(m, q, row);
    expect(detail.own.expectedPerWeek).toBe(row.own);
    expect(summaryFromSearch(row)).toMatchObject(
      summaryFromTrade(result, basis),
    );
    expect(matchesWeekly(row, { own: { minimum: 0, maximum: null } })).toBe(
      basis === "marked-starters",
    );
    const diagnostic = diagnoseTradeCandidate(
      m,
      { ...q, weekly: { own: { minimum: 0, maximum: null } } },
      draft,
    );
    expect(diagnostic).toHaveProperty("lineupBasis", basis);
    expect(diagnostic).toHaveProperty("alternative");
    expect(guidedQuery(q, "improve").lineupBasis).toBe(basis);
  }
  const q = { teamA: "1", give: ["101"], count: 1, below: 0, above: 0 };
  expect(tradeSearchContext(m, q)).toBe(
    tradeSearchContext(m, { ...q, lineupBasis: "best-available" }),
  );
  expect(tradeSearchContext(m, q)).not.toBe(
    tradeSearchContext(m, { ...q, lineupBasis: "marked-starters" }),
  );
  expect(d).toEqual(original);
});

// Stored analysis stays on its own basis, while legacy originals remain identifiable and immutable after a duplicate save.
it("round trips manual and search saves and retains original basis and legacy meaning", async () => {
  const d = await starterFixture(),
    m = withoutByeWeeks(evaluate(d, d.settings));
  const state = initialState(d),
    draft = { teamA: "1", teamB: "2", give: ["101"], get: ["200"] };
  const result = evaluateTrade(m, draft, false);
  const marked = summaryFromTrade(result, "marked-starters");
  const raw = saveTrade(state, m, draft, marked);
  const first = readSavedTrades(raw).trades[0];
  expect(savedLineupBasis(first)).toBe("marked-starters");
  expect(first.original).toMatchObject({
    lineupBasis: "marked-starters",
    own: 0,
  });
  const best = summaryFromTrade(result);
  const updated = saveTrade(
    {
      ...state,
      filters: {
        ...state.filters,
        savedTrades: raw,
        [lineupBasisKey]: "marked-starters",
      },
    },
    m,
    draft,
    best,
  );
  const second = readSavedTrades(updated).trades[0];
  expect(second.original).toEqual(first.original);
  expect(savedLineupBasis(second)).toBe("best-available");
  expect(originalLineupBasis({ ...best, lineupBasis: undefined })).toBe(
    "best-available",
  );
  expect(
    originalLineupBasis({
      ...best,
      lineupBasis: undefined,
      impactVersion: undefined,
    }),
  ).toBeUndefined();
  const q = {
    teamA: "1",
    give: ["101"],
    count: 1,
    below: 0,
    above: 0,
    lineupBasis: "marked-starters" as const,
  };
  const saved = readSavedTrades(saveTrade(state, m, draft, marked, q))
    .trades[0];
  expect(saved.query?.lineupBasis).toBe("marked-starters");
});

// Unavailable weeks must invalidate the complete horizon average rather than disappear or become zero.
it("preserves unavailable scoring instead of averaging a partial horizon", async () => {
  const d = await starterFixture(),
    m = withoutByeWeeks(evaluate(d, d.settings));
  const result = evaluateTrade(
    m,
    { teamA: "1", teamB: "2", give: ["101"], get: ["200"] },
    false,
  );
  if (!result.valid) throw Error(result.errors.join());
  result.directA.weekly[0].beforeExpected = null;
  const summary = tradeImpact(result, "marked-starters")!;
  expect(summary.own.beforePerWeek).toBeNull();
  expect(summary.own.afterPerWeek).toBeNull();
  expect(summary.own.expectedPerWeek).toBeNull();
  expect(tradeImpact(result)!.own.expectedPerWeek).toBe(-10);
});
