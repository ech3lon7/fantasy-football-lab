import { describe, it, expect } from "vitest";
import { fixture } from "./fixtures";
import { evaluate } from "../src/domain/valuation";
import { defaults } from "../src/domain/contracts";
import {
  recordMppgSnapshot,
  evaluateMppgWeights,
  readMppgSnapshots,
  backtestMatchup,
  pairAccuracy,
} from "../src/domain/mppg-tuning";

describe("MPPG snapshots & weight tuning (4.1 - 4.3)", () => {
  it("a snapshot is written once per import and week", async () => {
    const d = await fixture([20, 20]);
    d.tables.ModelPlayers[0].Current_Week_Projection = 18.5;
    const m = evaluate(d, defaults);

    const raw1 = recordMppgSnapshot(m, undefined);
    const parsed1 = readMppgSnapshots(raw1);
    expect(parsed1.snapshots.length).toBeGreaterThan(0);
    expect(parsed1.snapshots[0].week).toBe(m.current);
    expect(parsed1.snapshots[0].espnWeekly).toBe(18.5);
  });

  it("re-importing the same week replaces it with the newer timestamp", async () => {
    const d = await fixture([20, 20]);
    d.tables.ModelPlayers[0].Current_Week_Projection = 18.5;
    const m1 = evaluate(d, defaults);
    const raw1 = recordMppgSnapshot(m1, undefined);

    // Change projection and re-import
    d.tables.ModelPlayers[0].Current_Week_Projection = 21.0;
    const m2 = evaluate(d, defaults);
    const raw2 = recordMppgSnapshot(m2, raw1);
    const parsed2 = readMppgSnapshots(raw2);

    const player1Snapshots = parsed2.snapshots.filter(
      (s) => s.playerId === m2.players[0].id && s.week === m2.current,
    );
    expect(player1Snapshots.length).toBe(1);
    expect(player1Snapshots[0].espnWeekly).toBe(21.0);
  });

  it("the check refuses to run with fewer than 4 completed weeks", async () => {
    const d = await fixture([20, 20]);
    const m = evaluate(d, defaults);
    const raw = recordMppgSnapshot(m, undefined);

    const res = evaluateMppgWeights(m, raw);
    expect(res.ready).toBe(false);
    expect(res.message).toContain("At least 4 completed weeks");
  });
});

// Backtest scores use observed pairs, and historical forecasts never include the target week.
describe("matchup backtest", () => {
  it("measures pair accuracy and excludes tied or incomparable pairs", () => {
    const rows = [
      { week: 4, position: "QB", predicted: 20, actual: 25 },
      { week: 4, position: "QB", predicted: 10, actual: 15 },
      { week: 4, position: "QB", predicted: 5, actual: 30 },
    ];
    expect(pairAccuracy(rows)).toBeCloseTo(1 / 3);
    expect(pairAccuracy(rows.map((row) => ({ ...row, actual: -row.actual })))).toBeCloseTo(2 / 3);
    expect(pairAccuracy([{ ...rows[0] }])).toBeNull();
  });
  it("reports insufficient history rather than invented accuracy", async () => {
    const d = await fixture([10, 10, 10, 10, 10]);
    expect(backtestMatchup(evaluate(d, d.settings))).toMatchObject({ ready: false, weeks: 2 });
  });
  it("measures snapshot pair accuracy instead of returning a fixed number", async () => {
    const d = await fixture([10, 10, 10, 10, 10]);
    const m = evaluate(d, d.settings); m.byId.get("2")!.pos = "RB";
    const snapshots = (reverse: boolean) => JSON.stringify({ snapshots: [1, 2, 3, 4].flatMap((week) => [
      { playerId: "1", week, espnWeekly: reverse ? 30 : 1, importedAt: "2026-01-01T00:00:00Z" },
      { playerId: "2", week, espnWeekly: 2, importedAt: "2026-01-01T00:00:00Z" },
    ]) });
    expect(evaluateMppgWeights(m, snapshots(false)).results![0].pairPickAccuracy).toBe(1);
    expect(evaluateMppgWeights(m, snapshots(true)).results![0].pairPickAccuracy).toBe(0);
  });
  it("matches hand-calculated no-matchup errors using only prior games", async () => {
    const d = await fixture([10, 10, 10, 30, 10, 10]);
    const m = evaluate(d, d.settings);
    m.byId.get("2")!.pos = "RB";
    m.dataset.tables.ModelHistory = m.dataset.tables.ModelHistory.filter((h) => String(h.PlayerID) === "1");
    const template = m.dataset.tables.ModelHistory[0];
    [5, 5, 5, 10, 5, 5].forEach((points, i) => m.dataset.tables.ModelHistory.push({ ...template, PlayerID: 2, Week: i + 1, Points: points }));
    const result = backtestMatchup(m);
    expect(result).toMatchObject({ ready: true, weeks: 3, playerWeeks: 6 });
    expect(result.results.find((row) => row.label === "No matchup")!.averageMiss).toBeCloseTo(6.05);
    expect(result.results.find((row) => row.label === "No matchup")!.hitRate).toBe(1);
  });
});
