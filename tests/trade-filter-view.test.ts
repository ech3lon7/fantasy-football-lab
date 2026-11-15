import { expect, it } from "vitest";
import { defaultTradeFilters, type FilterableTrade } from "../src/domain/trade-filters";
import { tradeFilterView } from "../src/domain/trade-filter-view";

// Both trades meet your default gain; only one misses the recipient's default minimum.
it("changes filters and sorting without rerunning trades, and explains hidden results", () => {
  const row = (key: string, otherGain: number): FilterableTrade => ({ key, team: "2", give: ["a"], get: ["b"],
    ownGain: 2, otherGain, ownWeekGain: null, otherWeekGain: null, ownStarters: [], otherStarters: [],
    givePositions: [], incomingPlayers: [], opponentGrades: {} });
  const all = [row("one", 1), row("two", 0)], filters = defaultTradeFilters();
  const before = tradeFilterView(all, filters, "own", true);
  expect(before.visible).toHaveLength(1);
  expect(before.counts.theirGain).toBe(1);
  expect(before.hidden[0].reasons).toEqual(["theirGain"]);
  const after = tradeFilterView(all, { ...filters, theirGain: 0 }, "other", false);
  expect(after.visible.length - before.visible.length).toBe(before.counts.theirGain);
  expect(after.hidden).toEqual([]);
  expect(tradeFilterView(all, { ...filters, theirGain: 0 }, "own", false).visible).toHaveLength(after.visible.length);
});


