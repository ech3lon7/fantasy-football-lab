import { describe, it, expect } from "vitest";
import { bigLeagueFixture } from "./big-league-fixture";
import { evaluate } from "../src/domain/valuation";
import {
  forHypotheticalScoring,
  roster,
  lineupUncached,
  makeLegal,
} from "../src/domain/lineups";
import { evaluateTrade } from "../src/domain/trades";
import { tradeImpact } from "../src/domain/trade-impact";
import { cmpId } from "../src/domain/contracts";

describe("complete trade search facts (T0)", () => {
  it(
    "Facts 1 and 2 hold for Best available on bigLeagueFixture(4)",
    async () => {
      const rawFixture = await bigLeagueFixture(4);
      const m = forHypotheticalScoring(
        evaluate(rawFixture, rawFixture.settings),
      );
      const W = m.weeks.length;
      const ownTeam = "1";
      const S = roster(m, ownTeam);
      const teams = [...new Set(m.players.map((p) => p.owner))].filter(
        (t) => t !== "0",
      );
      const opponents = teams.filter((t) => t !== ownTeam);

      const memo = new Map<string, number>();
      function F(team: string, ids: string[]): number {
        const key = team + ":" + [...ids].sort(cmpId).join(",");
        const cached = memo.get(key);
        if (cached !== undefined) return cached;
        let total = 0;
        for (const w of m.weeks) {
          total += lineupUncached(
            m,
            ids,
            w,
            false,
            false,
            "expected",
          ).expected;
        }
        memo.set(key, total);
        return total;
      }

      const legalMemo = new Map<string, ReturnType<typeof makeLegal>>();
      function fastLegal(ids: string[]) {
        const key = [...ids].sort(cmpId).join(",");
        let cached = legalMemo.get(key);
        if (!cached) {
          cached = makeLegal(m, ids);
          legalMemo.set(key, cached);
        }
        return cached;
      }

      const subsets = (a: string[], k: number): string[][] =>
        k === 0
          ? [[]]
          : a.flatMap((x, i) =>
              subsets(a.slice(i + 1), k - 1).map((s) => [x, ...s]),
            );

      const Gs1 = subsets(S, 1);
      const Gs2 = subsets(S, 2);
      const Gs3 = subsets(S, 3);
      const GsAll = [...Gs1, ...Gs2, ...Gs3];
      const GsUpTo2 = [...Gs1, ...Gs2];

      const lossA = new Map<string, number>();
      for (const G of GsAll) {
        lossA.set(
          G.join(","),
          F(ownTeam, S) - F(ownTeam, S.filter((x) => !G.includes(x))),
        );
      }

      // Precompute per opponent
      const addA = new Map<string, Map<string, Map<string, number>>>();
      const lossT = new Map<string, Map<string, number>>();
      const addT = new Map<string, Map<string, Map<string, number>>>();
      const RsAllByOpp = new Map<string, string[][]>();
      const RsUpTo2ByOpp = new Map<string, string[][]>();
      const Rs3ByOpp = new Map<string, string[][]>();

      for (const opp of opponents) {
        const U = roster(m, opp);
        const Rs1 = subsets(U, 1);
        const Rs2 = subsets(U, 2);
        const Rs3 = subsets(U, 3);
        const RsAll = [...Rs1, ...Rs2, ...Rs3];
        RsAllByOpp.set(opp, RsAll);
        RsUpTo2ByOpp.set(opp, [...Rs1, ...Rs2]);
        Rs3ByOpp.set(opp, Rs3);

        const lt = new Map<string, number>();
        for (const R of RsAll) {
          lt.set(
            R.join(","),
            F(opp, U) - F(opp, U.filter((x) => !R.includes(x))),
          );
        }
        lossT.set(opp, lt);

        const ao = new Map<string, Map<string, number>>();
        for (const G of GsAll) {
          const base = S.filter((x) => !G.includes(x));
          const fb = F(ownTeam, base);
          const mR = new Map<string, number>();
          for (const r of U) {
            mR.set(r, F(ownTeam, [...base, r]) - fb);
          }
          ao.set(G.join(","), mR);
        }
        addA.set(opp, ao);

        const at = new Map<string, Map<string, number>>();
        for (const R of RsAll) {
          const base = U.filter((x) => !R.includes(x));
          const fb = F(opp, base);
          const mG = new Map<string, number>();
          for (const g of S) {
            mG.set(g, F(opp, [...base, g]) - fb);
          }
          at.set(R.join(","), mG);
        }
        addT.set(opp, at);
      }

      let ownViolations = 0;
      let otherViolations = 0;

      // Check all trades up to 2-for-2
      for (const opp of opponents) {
        const U = roster(m, opp);
        const RsUpTo2 = RsUpTo2ByOpp.get(opp)!;
        const ao = addA.get(opp)!;
        const at = addT.get(opp)!;
        const lt = lossT.get(opp)!;

        for (const G of GsUpTo2) {
          const gKey = G.join(",");
          const lA = lossA.get(gKey)!;
          const aoG = ao.get(gKey)!;

          for (const R of RsUpTo2) {
            const rKey = R.join(",");
            const lT = lt.get(rKey)!;
            const atR = at.get(rKey)!;

            const boundA =
              (R.reduce((sum, r) => sum + aoG.get(r)!, 0) - lA) / W;
            const boundT =
              (G.reduce((sum, g) => sum + atR.get(g)!, 0) - lT) / W;

            const a = fastLegal([
              ...S.filter((x) => !G.includes(x)),
              ...R,
            ]);
            const b = fastLegal([
              ...U.filter((x) => !R.includes(x)),
              ...G,
            ]);
            const realGainA = (F(ownTeam, a.ids) - F(ownTeam, S)) / W;
            const realGainB = (F(opp, b.ids) - F(opp, U)) / W;

            if (realGainA > boundA + 1e-9) ownViolations++;
            if (realGainB > boundT + 1e-9) otherViolations++;
          }
        }
      }

      // Seeded random sample of 20,000 trades with a 3-player side (seed 1)
      let seed = 1;
      const rand = () =>
        (seed = (seed * 16807) % 2147483647) / 2147483647;

      for (let i = 0; i < 20000; i++) {
        const opp = opponents[Math.floor(rand() * opponents.length)];
        const U = roster(m, opp);
        const RsAll = RsAllByOpp.get(opp)!;
        const Rs3 = Rs3ByOpp.get(opp)!;

        let G: string[];
        let R: string[];
        if (rand() < 0.5) {
          G = Gs3[Math.floor(rand() * Gs3.length)];
          R = RsAll[Math.floor(rand() * RsAll.length)];
        } else {
          G = GsAll[Math.floor(rand() * GsAll.length)];
          R = Rs3[Math.floor(rand() * Rs3.length)];
        }

        const gKey = G.join(",");
        const rKey = R.join(",");
        const boundA =
          (R.reduce((sum, r) => sum + addA.get(opp)!.get(gKey)!.get(r)!, 0) -
            lossA.get(gKey)!) /
          W;
        const boundT =
          (G.reduce((sum, g) => sum + addT.get(opp)!.get(rKey)!.get(g)!, 0) -
            lossT.get(opp)!.get(rKey)!) /
          W;

        const a = fastLegal([
          ...S.filter((x) => !G.includes(x)),
          ...R,
        ]);
        const b = fastLegal([
          ...U.filter((x) => !R.includes(x)),
          ...G,
        ]);
        const realGainA = (F(ownTeam, a.ids) - F(ownTeam, S)) / W;
        const realGainB = (F(opp, b.ids) - F(opp, U)) / W;

        if (realGainA > boundA + 1e-9) ownViolations++;
        if (realGainB > boundT + 1e-9) otherViolations++;
      }

      // Parity check with evaluateTrade + tradeImpact on sample trades
      for (let i = 0; i < 20; i++) {
        const opp = opponents[i % opponents.length];
        const G = GsUpTo2[i % GsUpTo2.length];
        const R = RsUpTo2ByOpp.get(opp)![i % RsUpTo2ByOpp.get(opp)!.length];
        const ev = evaluateTrade(
          m,
          { teamA: ownTeam, teamB: opp, give: G, get: R },
          false,
        );
        if (ev.valid) {
          const imp = tradeImpact(ev, "best-available")!;
          const a = fastLegal([
            ...S.filter((x) => !G.includes(x)),
            ...R,
          ]);
          const b = fastLegal([
            ...roster(m, opp).filter((x) => !R.includes(x)),
            ...G,
          ]);
          const realA = (F(ownTeam, a.ids) - F(ownTeam, S)) / W;
          const realB = (F(opp, b.ids) - F(opp, roster(m, opp))) / W;
          expect(Math.abs(imp.own.expectedPerWeek! - realA)).toBeLessThan(
            1e-9,
          );
          expect(Math.abs(imp.other.expectedPerWeek! - realB)).toBeLessThan(
            1e-9,
          );
        }
      }

      expect(ownViolations).toBe(0);
      expect(otherViolations).toBe(0);
    },
    600000,
  );
});
