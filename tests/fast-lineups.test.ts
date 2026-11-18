import { describe, it, expect } from "vitest";
import { bigLeagueFixture } from "./big-league-fixture";
import { evaluate } from "../src/domain/valuation";
import {
  forHypotheticalScoring,
  roster,
  lineupUncached,
  makeLegal,
} from "../src/domain/lineups";
import { createFastLineups } from "../src/domain/fast-lineups";

describe("exact fast scorer parity (T1)", () => {
  for (const teamCount of [4, 9] as const) {
    it(`exact parity on bigLeagueFixture(${teamCount})`, async () => {
      const rawFixture = await bigLeagueFixture(teamCount);
      const m = forHypotheticalScoring(
        evaluate(rawFixture, rawFixture.settings),
      );
      const fast = createFastLineups(m);
      const allPlayers = m.players.filter((p) => p.value !== null);

      let seed = 42 + teamCount;
      const rand = () =>
        (seed = (seed * 16807) % 2147483647) / 2147483647;

      // 1. total vs real function on 2,000 seeded random rosters
      for (let i = 0; i < 2000; i++) {
        const size = 10 + Math.floor(rand() * 12); // 10 to 21 players
        const sample: string[] = [];
        const copy = [...allPlayers];
        for (let j = 0; j < size && copy.length > 0; j++) {
          const idx = Math.floor(rand() * copy.length);
          sample.push(copy[idx].id);
          copy.splice(idx, 1);
        }

        const fastTotal = fast.total("1", sample);

        let realTotal = 0;
        for (const w of m.weeks) {
          realTotal += lineupUncached(
            m,
            sample,
            w,
            false,
            false,
            "expected",
          ).expected;
        }

        expect(Math.abs(fastTotal - realTotal)).toBeLessThan(1e-9);

        // Check weekly lineup ids parity on a subset
        if (i < 100) {
          const fastWeekly = fast.weekly("1", sample);
          for (let wi = 0; wi < m.weeks.length; wi++) {
            const realLineup = lineupUncached(
              m,
              sample,
              m.weeks[wi],
              false,
              false,
              "expected",
            );
            expect(fastWeekly[wi]).toEqual(realLineup.ids);
          }
        }
      }

      // 2. legal vs makeLegal on 2,000 seeded over-full rosters
      for (let i = 0; i < 2000; i++) {
        // Build an over-full roster (e.g. 17 to 24 players)
        const teamId = String(1 + Math.floor(rand() * teamCount));
        const base = roster(m, teamId);
        const extrasCount = 1 + Math.floor(rand() * 6);
        const otherPlayers = allPlayers.filter((p) => !base.includes(p.id));
        const sample = [...base];
        for (let j = 0; j < extrasCount && otherPlayers.length > 0; j++) {
          const idx = Math.floor(rand() * otherPlayers.length);
          sample.push(otherPlayers[idx].id);
          otherPlayers.splice(idx, 1);
        }

        const fastResult = fast.legal(sample);
        const realResult = makeLegal(m, sample);

        expect(fastResult.ids).toEqual(realResult.ids);
        expect(fastResult.drops).toEqual(realResult.drops);
        expect(fastResult.excess).toBe(realResult.excess);
      }
    }, 60000);
  }
});
