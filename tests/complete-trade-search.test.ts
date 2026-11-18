import { describe, it, expect } from "vitest";
import { bigLeagueFixture } from "./big-league-fixture";
import { evaluate } from "../src/domain/valuation";
import { forHypotheticalScoring } from "../src/domain/lineups";
import {
  runCompleteTradeSearch,
  type CompleteTrade,
} from "../src/domain/complete-trade-search";

describe("complete trade search (T2)", () => {
  it(
    "completeness and streaming on bigLeagueFixture(4)",
    async () => {
      const rawFixture = await bigLeagueFixture(4);
      const m = forHypotheticalScoring(
        evaluate(rawFixture, rawFixture.settings),
      );
      const ownTeam = "1";
      const teams = [...new Set(m.players.map((p) => p.owner))].filter(
        (t) => t !== "0" && t !== ownTeam,
      );
      const manager = { version: 1 as const, profiles: {} };

      const streamedTeams: string[] = [];
      const collectedTrades: CompleteTrade[] = [];

      const t0 = performance.now();
      const coverage = await runCompleteTradeSearch(
        m,
        ownTeam,
        undefined,
        manager,
        teams,
        (event) => {
          if (event.done) {
            streamedTeams.push(event.team);
            collectedTrades.push(...event.rows);
          }
        },
      );
      const searchElapsed = performance.now() - t0;
      console.log(
        `Search on bigLeagueFixture(4) finished in ${searchElapsed.toFixed(1)}ms. Kept: ${collectedTrades.length}`,
      );

      // Verify streaming occurred in order of opponents
      expect(streamedTeams).toEqual(teams);
      expect(coverage.opponents).toBe(teams.length);
      expect(coverage.kept).toBe(collectedTrades.length);
      expect(coverage.possible).toBeGreaterThan(0);
      expect(coverage.scored).toBeGreaterThanOrEqual(coverage.kept);

      // Verify each kept trade satisfies R1
      for (const trade of collectedTrades) {
        expect(trade.own).toBeGreaterThan(1e-9);
        expect(trade.other).toBeGreaterThanOrEqual(-2 - 1e-9);
        expect(trade.give.length).toBeGreaterThanOrEqual(1);
        expect(trade.give.length).toBeLessThanOrEqual(3);
        expect(trade.get.length).toBeGreaterThanOrEqual(1);
        expect(trade.get.length).toBeLessThanOrEqual(3);
        expect(trade.filterEvidence).toBeDefined();
        expect(trade.filterEvidence.key).toBe(trade.key);
      }
    },
    60000,
  );
});
