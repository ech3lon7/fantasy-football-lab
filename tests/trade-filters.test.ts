import { describe, expect, it } from "vitest";
import { clearTradeFilters, defaultTradeFilters, showAllTradeFilters, filterTradeRows, sortTradeRows, clampTheirGain } from "../src/domain/trade-filters";
import type { FilterableTrade } from "../src/domain/trade-filters";

// A compact, precomputed result makes every filter and its hidden count independently observable.
const row = (overrides: Partial<FilterableTrade> = {}): FilterableTrade => ({
  key: "one", team: "2", give: ["a"], get: ["b"], ownGain: 2, otherGain: 2,
  ownWeekGain: 1, otherWeekGain: 1, ownStarters: ["b"], otherStarters: ["a"],
  givePositions: ["QB"], incomingPlayers: [{ pos: "WR", gem: "Gem" }],
  opponentGrades: { QB: "C" }, positionImpact: { own: [{ position: "QB", before: "C", after: "B", drop: 0, stepDelta: 3 }], other: [] }, ...overrides,
});

describe("instant trade filters", () => {
  // Show all includes both inclusive loss-floor boundaries without activating other filters.
  it("shows all trades retained by the approved floor", () => {
    const filters = showAllTradeFilters();
    const trades = [row({ ownGain: -3, otherGain: 1 }), row({ key: "two", ownGain: 5, otherGain: -2 })];
    expect(filterTradeRows(trades, filters).visible).toHaveLength(2);
    expect(filters.yourGain).toEqual({ minimum: null, maximum: null });
    expect(filters.theirGain).toBe(-2);
  });
  it("restores both approved defaults and counts hidden rows for each active filter", () => {
    const filters = defaultTradeFilters();
    const result = filterTradeRows([row(), row({ key: "two", ownGain: -1, otherGain: 0 })], filters);
    expect(result.visible.map((r) => r.key)).toEqual(["one"]);
    expect(result.hidden[0].reasons).toEqual(["yourGain", "theirGain"]);
    expect(result.counts.yourGain).toBe(1);
    expect(result.counts.theirGain).toBe(1);
    expect(clearTradeFilters()).toEqual(filters);
  });
  it("clamps the recipient minimum to the approved range and half-point steps", () => {
    expect(clampTheirGain(-3)).toBe(-2);
    expect(clampTheirGain(2)).toBe(1);
    expect(clampTheirGain(-.6)).toBe(-.5);
    expect(clampTheirGain(Number.NaN)).toBe(1);
  });
  it("requires the same incoming player to match selected position and label", () => {
    const filters = { ...defaultTradeFilters(), getPositions: ["WR" as const], labels: ["Gem" as const] };
    const trade = row({ incomingPlayers: [{ pos: "WR", gem: "Watch" }, { pos: "RB", gem: "Gem" }] });
    expect(filterTradeRows([trade], filters).hidden[0].reasons).toContain("labels");
  });
  it("sorts without changing membership and places unknown acceptance last", () => {
    const rows = [row({ key: "unknown", acceptance: null }), row({ key: "good", acceptance: .7 }), row({ key: "fair", acceptance: .4 })];
    const sorted = sortTradeRows(rows, "acceptance");
    expect(sorted.map((item) => item.key)).toEqual(["good", "fair", "unknown"]);
    expect(rows.map((item) => item.key)).toEqual(["unknown", "good", "fair"]);
  });
  it("applies every optional category and preserves unavailable numbers as unavailable", () => {
    const filters = { ...defaultTradeFilters(), ownWeek: { minimum: 0, maximum: 2 }, otherWeek: { minimum: 0, maximum: 2 },
      receiveStarts: true, giveStarts: true, gradeGoals: [{ id: "g", side: "own" as const, position: "QB", steps: 1 }], mustGet: ["b"], mustGive: ["a"], exclude: ["z"],
      getPositions: ["WR" as const], givePositions: ["QB"], labels: ["Gem" as const], teams: ["2"],
      teamGrade: { position: "QB", ceiling: "C+" }, giveSize: { minimum: 1, maximum: 1 }, getSize: { minimum: 1, maximum: 1 } };
    expect(filterTradeRows([row()], filters).visible).toHaveLength(1);
    const failed = row({ ownWeekGain: null, otherWeekGain: 3, ownStarters: [], otherStarters: [], positionImpact: { own: [], other: [] },
      give: ["x", "z"], get: ["y", "z"], givePositions: ["RB"], incomingPlayers: [{ pos: "TE", gem: "Watch" }],
      team: "3", opponentGrades: { QB: "A" } });
    expect(filterTradeRows([failed], filters).hidden[0].reasons).toEqual([
      "ownWeek", "otherWeek", "receiveStarts", "giveStarts", "gradeGoals", "mustGet", "mustGive", "exclude",
      "getPositions", "givePositions", "labels", "teams", "teamGrade", "giveSize", "getSize",
    ]);
  });
  it("hides N is what one filter alone hides: relaxing it raises the count by exactly N (R6)", () => {
    const rows = [
      row({ key: "ok" }),
      row({ key: "theirOnly", otherGain: 0.5 }),
      row({ key: "theirOnly2", otherGain: 0 }),
      row({ key: "both", ownGain: -1, otherGain: 0 }),
    ];
    const before = filterTradeRows(rows, defaultTradeFilters());
    expect(before.visible.map((r) => r.key)).toEqual(["ok"]);
    // "both" fails two filters, so neither filter alone brings it back.
    expect(before.only.theirGain).toBe(2);
    expect(before.only.yourGain ?? 0).toBe(0);
    expect(before.counts.theirGain).toBe(3);
    const relaxed = filterTradeRows(rows, { ...defaultTradeFilters(), theirGain: 0 });
    expect(relaxed.visible.length - before.visible.length).toBe(before.only.theirGain);
  });
});
