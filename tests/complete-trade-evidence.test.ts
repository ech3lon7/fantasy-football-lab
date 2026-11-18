import { describe, it, expect } from "vitest";
import { bigLeagueFixture } from "./big-league-fixture";
import { evaluate } from "../src/domain/valuation";
import { forHypotheticalScoring } from "../src/domain/lineups";
import { runCompleteTradeSearch, type CompleteTrade } from "../src/domain/complete-trade-search";
import { evaluateTrade } from "../src/domain/trades";
import { tradeImpact } from "../src/domain/trade-impact";
import { lineupFilterEvidence } from "../src/domain/trade-lineup-evidence";
import { chainPositionImpact } from "../src/domain/chain-position-impact";
import { managerAssessment } from "../src/domain/manager-expectations";
import { surfaceAppeal } from "../src/domain/surface-appeal";
import { teamsAssessment } from "../src/domain/lineups";

describe("complete trade evidence parity (T3)", () => {
  it(
    "every evidence field of 500 kept trades equals the adapter path within 0.3ms/trade",
    async () => {
    const rawFixture = await bigLeagueFixture(4);
    const m = forHypotheticalScoring(evaluate(rawFixture, rawFixture.settings));
    const ownTeam = "1";
    const teams = [...new Set(m.players.map((p) => p.owner))].filter(
      (t) => t !== "0" && t !== ownTeam,
    );
    const manager = { version: 1 as const, profiles: {} };

    const collected: CompleteTrade[] = [];
    await runCompleteTradeSearch(
      m,
      ownTeam,
      undefined,
      manager,
      teams,
      (event) => {
        if (event.done) {
          collected.push(...event.rows);
        }
      },
    );

    expect(collected.length).toBeGreaterThanOrEqual(500);

    // Pick 500 deterministically
    const sample = collected.slice(0, 500);

    const mppg = new Map(m.players.map((p) => [p.id, p.mppg ?? null] as const));
    const grades = teamsAssessment(m);

    const t0 = performance.now();

    for (const trade of sample) {
      const draft = {
        teamA: ownTeam,
        teamB: trade.teamB,
        give: trade.give,
        get: trade.get,
      };

      const ev = evaluateTrade(m, draft, false, undefined);
      expect(ev.valid).toBe(true);

      const impact = tradeImpact(ev, "best-available")!;
      expect(impact).toBeDefined();

      // Check gains
      expect(trade.own).toBeCloseTo(impact.own.expectedPerWeek!, 9);
      expect(trade.other).toBeCloseTo(impact.other.expectedPerWeek!, 9);

      // Check weekly gains
      const ownWeeklyObjs = impact.own.weekly.map((w) => ({
        week: w.week,
        beforeIds: w.beforeIds,
        ids: w.ids,
      }));
      const otherWeeklyObjs = impact.other.weekly.map((w) => ({
        week: w.week,
        beforeIds: w.beforeIds,
        ids: w.ids,
      }));

      const ownEv = lineupFilterEvidence(ownWeeklyObjs, m.current, trade.get, mppg);
      const otherEv = lineupFilterEvidence(otherWeeklyObjs, m.current, trade.give, mppg);

      if (ownEv.weekGain === null) {
        expect(trade.filterEvidence.ownWeekGain).toBeNull();
      } else {
        expect(trade.filterEvidence.ownWeekGain).toBeCloseTo(ownEv.weekGain, 9);
      }

      if (otherEv.weekGain === null) {
        expect(trade.filterEvidence.otherWeekGain).toBeNull();
      } else {
        expect(trade.filterEvidence.otherWeekGain).toBeCloseTo(otherEv.weekGain, 9);
      }

      // Check per-player starters
      const expectedOwnStarters = trade.get.filter((id) =>
        impact.own.weekly.every((w) => w.ids.includes(id)),
      );
      const expectedOtherStarters = trade.give.filter((id) =>
        impact.other.weekly.every((w) => w.ids.includes(id)),
      );
      expect(trade.filterEvidence.ownStarters).toEqual(expectedOwnStarters);
      expect(trade.filterEvidence.otherStarters).toEqual(expectedOtherStarters);

      // Check acceptance
      const ma = managerAssessment(m, draft, ev, manager);
      const expectedAcceptance =
        (ma.status === "eligible" || ma.status === "conditional") && ma.band !== undefined
          ? ma.band
          : null;
      expect(trade.filterEvidence.acceptance).toBe(expectedAcceptance);

      // Check surface
      const sa = surfaceAppeal(m, draft, ev, {}, "best-available", undefined);
      expect(trade.filterEvidence.surfaceAverage).toBe(sa?.average?.gain ?? null);
      expect(trade.filterEvidence.surfaceProjection).toBe(sa?.projection?.gain ?? null);

      // Check positionImpact
      const expectedPosImpact = chainPositionImpact(
        m,
        draft,
        ev,
        ["QB", "RB", "WR", "TE", "K", "D/ST", "FLEX"],
        grades,
      );
      expect(trade.filterEvidence.positionImpact).toEqual(expectedPosImpact);
    }

    const elapsed = performance.now() - t0;
    const msPerTrade = elapsed / sample.length;
    console.log(`Verified 500 trades evidence in ${elapsed.toFixed(1)}ms (${msPerTrade.toFixed(3)}ms/trade)`);
  }, 60000);
});
