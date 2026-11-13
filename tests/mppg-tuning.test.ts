import { describe, it, expect } from "vitest";
import { fixture } from "./fixtures";
import { evaluate } from "../src/domain/valuation";
import { defaults } from "../src/domain/contracts";
import {
  recordMppgSnapshot,
  evaluateMppgWeights,
  readMppgSnapshots,
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
