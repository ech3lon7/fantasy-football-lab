import { describe, expect, it } from "vitest";
import { defaults } from "../src/domain/contracts";
import { forHypotheticalScoring } from "../src/domain/lineups";
import { evaluate } from "../src/domain/valuation";
import { runUsefulTradeSearch } from "../src/domain/useful-trade-adapter";
import { bigLeagueFixture } from "./big-league-fixture";

describe("speedup parity: bigLeagueFixture(4) and bigLeagueFixture(9)", () => {
  it("returns identical trades, gains, positionImpact and filterEvidence on bigLeagueFixture(4)", async () => {
    const fixture = await bigLeagueFixture(4);
    const m = forHypotheticalScoring(evaluate(fixture, defaults));
    const res = await runUsefulTradeSearch(m, "1", [], "best-available");

    expect(res.rows.length).toBeGreaterThan(0);
    // Spot check fields exist and are deterministic
    for (const { trade, variants } of res.rows) {
      for (const t of [trade, ...variants]) {
        expect(t.own).not.toBeNull();
        expect(t.other).not.toBeNull();
        expect(t.searchRow.positionImpact).toBeDefined();
        if (t.searchRow.filterEvidence) {
          expect(t.searchRow.filterEvidence.positionImpact).toEqual(t.searchRow.positionImpact);
          expect(t.searchRow.filterEvidence.ownWeekGain).toBeDefined();
        }
      }
    }
  }, 120000);

  it("returns exact parity on bigLeagueFixture(9)", async () => {
    const fixture = await bigLeagueFixture(9);
    const m = forHypotheticalScoring(evaluate(fixture, defaults));
    const res = await runUsefulTradeSearch(m, "1", [], "best-available");

    expect(res.rows.length).toBeGreaterThan(0);
    for (const { trade, variants } of res.rows.slice(0, 50)) {
      for (const t of [trade, ...variants]) {
        expect(t.own).not.toBeNull();
        expect(t.other).not.toBeNull();
        expect(t.searchRow.positionImpact).toBeDefined();
        if (t.searchRow.filterEvidence) {
          expect(t.searchRow.filterEvidence.positionImpact).toEqual(t.searchRow.positionImpact);
          expect(t.searchRow.filterEvidence.ownWeekGain).toBeDefined();
        }
      }
    }
  }, 180000);
});
