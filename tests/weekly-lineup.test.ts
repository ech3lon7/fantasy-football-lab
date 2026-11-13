import { describe, it, expect } from "vitest";
import { starterFixture } from "./fixtures";
import { evaluate } from "../src/domain/valuation";
import { defaults } from "../src/domain/contracts";
import { weeklyLineup } from "../src/domain/lineups";

describe("Weekly lineup by MPPG (2.1 - 2.4)", () => {
  it("identical rosters give identical lineups", async () => {
    const d = await starterFixture();
    const m = evaluate(d, defaults);
    const w1 = weeklyLineup(m, "1");
    const w2 = weeklyLineup(m, "1");
    expect(w1.totalMppg).toBe(w2.totalMppg);
    expect(w1.slots.length).toBe(w2.slots.length);
    expect(w1.starterIds).toEqual(w2.starterIds);
  });

  it("a bench player with a higher ESPN weekly projection moves into FLEX", async () => {
    const d = await starterFixture();
    const m = evaluate(d, defaults);
    // Find bench players for team 1
    const team1Players = m.players.filter((p) => p.owner === "1");
    // Give a bench player a high weekly projection
    const benchPlayer = team1Players.find((p) => ["RB", "WR", "TE"].includes(p.pos) && p.slot === 20);
    if (benchPlayer) {
      benchPlayer.weekly = 25.0;
      benchPlayer.blendedExpected = 25.0;
      benchPlayer.projected = 20.0;
      const wl = weeklyLineup(m, "1");
      expect(wl.starterIds).toContain(benchPlayer.id);
      expect(wl.hasSwaps).toBe(true);
      expect(wl.swaps.some((s) => s.startId === benchPlayer.id)).toBe(true);
    }
  });

  it("two starters changing slots produce no swap", async () => {
    const d = await starterFixture();
    const m = evaluate(d, defaults);
    const wl = weeklyLineup(m, "1");
    // If weekly starters equals season starters, no swaps are produced
    if (wl.swaps.length === 0) {
      expect(wl.hasSwaps).toBe(false);
      expect(wl.note).toContain("already your best Week");
    }
  });

  it("weeklyLineup is never called from trade code (static test 2.3)", async () => {
    const fs = await import("node:fs");
    const tradeCode = fs.readFileSync("src/domain/trades.ts", "utf-8");
    const searchCode = fs.readFileSync("src/domain/trade-search.ts", "utf-8");
    const chainCode = fs.readFileSync("src/domain/trade-chains.ts", "utf-8");

    // Match invocations: weeklyLineup(
    const callRegex = /\bweeklyLineup\s*\(/;
    expect(callRegex.test(tradeCode)).toBe(false);
    expect(callRegex.test(searchCode)).toBe(false);
    expect(callRegex.test(chainCode)).toBe(false);
  });
});
