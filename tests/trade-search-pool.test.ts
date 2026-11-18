import { describe, expect, it } from "vitest";
import { evaluate } from "../src/domain/valuation";
import { lineup, withLineupMemo } from "../src/domain/lineups";
import {
  mergeCoverage,
  partition,
  poolSize,
  runPooled,
  MAX_POOL,
} from "../src/workers/trade-search-pool";
import { fairChainFixture } from "./chain-fixture";
import {
  runCompleteTradeSearch,
  type CompleteTrade,
} from "../src/domain/complete-trade-search";

describe("search pool sizing and partitioning", () => {
  // A failed helper retries only its slice and still contributes to measured coverage.
  it("retries a failed helper without losing an opponent", async () => {
    let index = 0;
    const retried: string[][] = [];
    const coverage = { possible: 10, scored: 5, kept: 2, opponents: 1 };
    const spawn = () => {
      const fail = index++ === 1;
      const worker = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        onerror: null as (() => void) | null,
        terminate: () => undefined,
        postMessage: () =>
          queueMicrotask(() =>
            fail
              ? worker.onerror?.()
              : worker.onmessage?.({
                  data: { type: "done", rows: [], coverage },
                }),
          ),
      };
      return worker as unknown as Worker;
    };
    const result = await runPooled(
      {} as never,
      [["a"], ["b"]],
      spawn,
      () => undefined,
      async (slice) => {
        retried.push(slice);
        return { rows: [], coverage };
      },
    );
    expect(retried).toEqual([["b"]]);
    expect(result.coverage.opponents).toBe(2);
    expect(result.coverage.possible).toBe(20);
    expect(result.coverage.scored).toBe(10);
    expect(result.coverage.kept).toBe(4);
    expect(result.missing).toEqual([]);
  });

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

  it("adds coverage counts", () => {
    const merged = mergeCoverage([
      { possible: 100, scored: 50, kept: 10, opponents: 2 },
      { possible: 70, scored: 30, kept: 5, opponents: 1 },
    ]);
    expect(merged).toEqual({
      possible: 170,
      scored: 80,
      kept: 15,
      opponents: 3,
    });
  });
});

describe("a pooled search equals the single-threaded search", () => {
  it("gives the same trades and the same numbers when opponents are searched in separate slices", async () => {
    const raw = await fairChainFixture();
    const m = evaluate(raw, raw.settings);
    const opponents = [...new Set(m.players.map((p) => p.owner))].filter(
      (o) => o && o !== "0" && o !== "1",
    );
    expect(opponents.length).toBeGreaterThanOrEqual(2);
    const manager = { version: 1 as const, profiles: {} };

    const wholeRows: CompleteTrade[] = [];
    const wholeCov = await runCompleteTradeSearch(
      m,
      "1",
      undefined,
      manager,
      opponents,
      (ev) => {
        if (ev.done) wholeRows.push(...ev.rows);
      },
    );

    const sliceRows: CompleteTrade[] = [];
    let slicePossible = 0;
    let sliceScored = 0;
    let sliceKept = 0;

    for (const opp of opponents) {
      const cov = await runCompleteTradeSearch(
        m,
        "1",
        undefined,
        manager,
        [opp],
        (ev) => {
          if (ev.done) sliceRows.push(...ev.rows);
        },
      );
      slicePossible += cov.possible;
      sliceScored += cov.scored;
      sliceKept += cov.kept;
    }

    const summarize = (rows: CompleteTrade[]) =>
      rows
        .map((t) => `${t.key}|${t.own.toFixed(6)}|${t.other.toFixed(6)}`)
        .sort();

    expect(summarize(sliceRows)).toEqual(summarize(wholeRows));
    expect(slicePossible).toBe(wholeCov.possible);
    expect(sliceScored).toBe(wholeCov.scored);
    expect(sliceKept).toBe(wholeCov.kept);
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
    expect(lineup(m, ids, m.current, false, false, "expected")).not.toBe(
      lineup(m, ids, m.current, false, false, "expected"),
    );
  });
});
