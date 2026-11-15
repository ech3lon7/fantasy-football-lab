import { describe, expect, it } from "vitest";
import { evaluate } from "../src/domain/valuation";
import { runUsefulTradeSearch } from "../src/domain/useful-trade-adapter";
import { lineup, withLineupMemo } from "../src/domain/lineups";
import { mergeCoverage, partition, poolSize, MAX_POOL } from "../src/workers/trade-search-pool";
import { fairChainFixture } from "./chain-fixture";

describe("search pool sizing and partitioning", () => {
  it("uses one helper per core but one, at most four, never more than the opponents", () => {
    expect(poolSize(11, 8, true)).toBe(MAX_POOL);
    expect(poolSize(11, 4, true)).toBe(3);
    expect(poolSize(2, 8, true)).toBe(2);
    expect(poolSize(11, 1, true)).toBe(1);
    expect(poolSize(11, undefined, true)).toBe(1);
  });

  it("uses no pool where nested workers are unavailable", () => {
    expect(poolSize(11, 8, false)).toBe(1);
  });

  it("deals every opponent to exactly one slice, evenly", () => {
    const slices = partition(["a", "b", "c", "d", "e", "f", "g"], 3);
    expect(slices).toEqual([["a", "d", "g"], ["b", "e"], ["c", "f"]]);
    expect(slices.flat().sort()).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(partition(["a"], 4)).toEqual([["a"]]);
  });

  it("adds coverage counts and keeps each team's beam cut-offs", () => {
    const merged = mergeCoverage([
      { singles: 10, extensions: 5, opponents: 2, beamCutoffs: 3, beamCutoffsByTeam: { "2": { "1:2": 3 } } },
      { singles: 7, extensions: 1, opponents: 1, beamCutoffs: 0, beamCutoffsByTeam: {} },
    ]);
    expect(merged).toEqual({ singles: 17, extensions: 6, opponents: 3, beamCutoffs: 3, beamCutoffsByTeam: { "2": { "1:2": 3 } } });
  });
});

describe("a pooled search equals the single-threaded search", () => {
  it("gives the same trades and the same numbers when opponents are searched in separate slices", async () => {
    const raw = await fairChainFixture();
    const m = evaluate(raw, raw.settings);
    const opponents = [...new Set(m.players.map((p) => p.owner))].filter((o) => o && o !== "0" && o !== "1");
    expect(opponents.length).toBeGreaterThanOrEqual(2);
    const summarize = (rows: Awaited<ReturnType<typeof runUsefulTradeSearch>>["rows"]) =>
      rows
        .flatMap(({ trade, variants }) => [trade, ...variants])
        .map((t) => `${t.searchRow.key}|${t.own?.toFixed(6)}|${t.other?.toFixed(6)}`)
        .sort();
    const whole = await runUsefulTradeSearch(m, "1", [], "best-available");
    const slices = await Promise.all(opponents.map((o) => runUsefulTradeSearch(m, "1", [], "best-available", undefined, undefined, undefined, [o])));
    expect(summarize(slices.flatMap((s) => s.rows))).toEqual(summarize(whole.rows));
    expect(slices.reduce((n, s) => n + s.coverage.singles, 0)).toBe(whole.coverage.singles);
    expect(slices.reduce((n, s) => n + s.coverage.extensions, 0)).toBe(whole.coverage.extensions);
  });
});

describe("the lineup memo", () => {
  it("returns exactly what a fresh call returns, and only while enabled", async () => {
    const raw = await fairChainFixture();
    const m = evaluate(raw, raw.settings);
    const ids = m.players.filter((p) => p.owner === "1").map((p) => p.id);
    const fresh = lineup(m, ids, m.current, false, false, "expected");
    withLineupMemo(() => {
      const first = lineup(m, ids, m.current, false, false, "expected");
      expect(first).toEqual(fresh);
      expect(lineup(m, ids, m.current, false, false, "expected")).toBe(first);
    });
    // Outside the memo every call builds a new object, so no caller ever shares one.
    expect(lineup(m, ids, m.current, false, false, "expected")).not.toBe(lineup(m, ids, m.current, false, false, "expected"));
  });
});
