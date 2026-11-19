import { describe, it, expect, beforeAll } from "vitest";
import { bigLeagueFixture } from "./big-league-fixture";
import { evaluate, type Model } from "../src/domain/valuation";
import {
  forHypotheticalScoring,
  roster,
  lineupUncached,
  makeLegal,
} from "../src/domain/lineups";
import { evaluateTrade } from "../src/domain/trades";
import { tradeImpact } from "../src/domain/trade-impact";
import { cmpId } from "../src/domain/contracts";

// The league is built once for the whole file; its team ids give each opponent its own test.
const rawFixture = await bigLeagueFixture(4);
const ownTeam = "1";
const opponentIds = rawFixture.tables.ModelTeams.map((t) => String(t.TeamID)).filter((t) => t !== ownTeam);

describe("complete trade search facts (T0)", () => {
  let m: Model;
  let W: number;
  let S: string[];
  let opponents: string[];
  let F: (team: string, ids: string[]) => number;
  let fastLegal: (ids: string[]) => ReturnType<typeof makeLegal>;
  let lossA: (G: string[]) => number;
  let addA: (opp: string, G: string[], r: string) => number;
  let lossT: (opp: string, R: string[]) => number;
  let addT: (opp: string, R: string[], g: string) => number;
  let Gs3: string[][];
  let GsAll: string[][];
  let GsUpTo2: string[][];
  let RsAllByOpp: Map<string, string[][]>;
  let RsUpTo2ByOpp: Map<string, string[][]>;
  let Rs3ByOpp: Map<string, string[][]>;

  beforeAll(() => {
    m = forHypotheticalScoring(evaluate(rawFixture, rawFixture.settings));
    W = m.weeks.length;
    S = roster(m, ownTeam);
    const teams = [...new Set(m.players.map((p) => p.owner))].filter(
      (t) => t !== "0",
    );
    opponents = teams.filter((t) => t !== ownTeam);

    const memo = new Map<string, number>();
    F = (team, ids) => {
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
    };

    const legalMemo = new Map<string, ReturnType<typeof makeLegal>>();
    fastLegal = (ids) => {
      const key = [...ids].sort(cmpId).join(",");
      let cached = legalMemo.get(key);
      if (!cached) {
        cached = makeLegal(m, ids);
        legalMemo.set(key, cached);
      }
      return cached;
    };

    const subsets = (a: string[], k: number): string[][] =>
      k === 0
        ? [[]]
        : a.flatMap((x, i) =>
            subsets(a.slice(i + 1), k - 1).map((s) => [x, ...s]),
          );

    const Gs1 = subsets(S, 1);
    const Gs2 = subsets(S, 2);
    Gs3 = subsets(S, 3);
    GsAll = [...Gs1, ...Gs2, ...Gs3];
    GsUpTo2 = [...Gs1, ...Gs2];

    // The four bounds are computed the first time a give or get set is checked, then cached, so only the sets the tests visit are
    // ever scored.
    const lossACache = new Map<string, number>();
    lossA = (G) => {
      const key = G.join(",");
      let v = lossACache.get(key);
      if (v === undefined) {
        v = F(ownTeam, S) - F(ownTeam, S.filter((x) => !G.includes(x)));
        lossACache.set(key, v);
      }
      return v;
    };
    const baseACache = new Map<string, { base: string[]; fb: number }>();
    const addACache = new Map<string, number>();
    addA = (opp, G, r) => {
      const gKey = G.join(",");
      const key = opp + "|" + gKey + "|" + r;
      let v = addACache.get(key);
      if (v === undefined) {
        let b = baseACache.get(gKey);
        if (!b) {
          const base = S.filter((x) => !G.includes(x));
          b = { base, fb: F(ownTeam, base) };
          baseACache.set(gKey, b);
        }
        v = F(ownTeam, [...b.base, r]) - b.fb;
        addACache.set(key, v);
      }
      return v;
    };
    const lossTCache = new Map<string, number>();
    lossT = (opp, R) => {
      const key = opp + "|" + R.join(",");
      let v = lossTCache.get(key);
      if (v === undefined) {
        const U = roster(m, opp);
        v = F(opp, U) - F(opp, U.filter((x) => !R.includes(x)));
        lossTCache.set(key, v);
      }
      return v;
    };
    const baseTCache = new Map<string, { base: string[]; fb: number }>();
    const addTCache = new Map<string, number>();
    addT = (opp, R, g) => {
      const rKey = R.join(",");
      const key = opp + "|" + rKey + "|" + g;
      let v = addTCache.get(key);
      if (v === undefined) {
        const bKey = opp + "|" + rKey;
        let b = baseTCache.get(bKey);
        if (!b) {
          const base = roster(m, opp).filter((x) => !R.includes(x));
          b = { base, fb: F(opp, base) };
          baseTCache.set(bKey, b);
        }
        v = F(opp, [...b.base, g]) - b.fb;
        addTCache.set(key, v);
      }
      return v;
    };

    RsAllByOpp = new Map<string, string[][]>();
    RsUpTo2ByOpp = new Map<string, string[][]>();
    Rs3ByOpp = new Map<string, string[][]>();
    for (const opp of opponents) {
      const U = roster(m, opp);
      const Rs1 = subsets(U, 1);
      const Rs2 = subsets(U, 2);
      const Rs3 = subsets(U, 3);
      RsAllByOpp.set(opp, [...Rs1, ...Rs2, ...Rs3]);
      RsUpTo2ByOpp.set(opp, [...Rs1, ...Rs2]);
      Rs3ByOpp.set(opp, Rs3);
    }
  }, 600000);

  // Check all trades up to 2-for-2 against one opponent.
  it.each(opponentIds)(
    "Facts 1 and 2 hold up to 2-for-2 vs team %s",
    (opp) => {
      expect(opponents).toContain(opp);
      let ownViolations = 0;
      let otherViolations = 0;
      const U = roster(m, opp);
      const RsUpTo2 = RsUpTo2ByOpp.get(opp)!;

      for (const G of GsUpTo2) {
        const lA = lossA(G);

        for (const R of RsUpTo2) {
          const lT = lossT(opp, R);

          const boundA =
            (R.reduce((sum, r) => sum + addA(opp, G, r), 0) - lA) / W;
          const boundT =
            (G.reduce((sum, g) => sum + addT(opp, R, g), 0) - lT) / W;

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

      expect(ownViolations).toBe(0);
      expect(otherViolations).toBe(0);
    },
    600000,
  );

  it(
    "Facts 1 and 2 hold on a seeded sample of 5,000 trades with a 3-player side",
    () => {
      let ownViolations = 0;
      let otherViolations = 0;

      // Seeded random sample of 5,000 trades with a 3-player side (seed 1)
      let seed = 1;
      const rand = () =>
        (seed = (seed * 16807) % 2147483647) / 2147483647;

      for (let i = 0; i < 5000; i++) {
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

        const boundA =
          (R.reduce((sum, r) => sum + addA(opp, G, r), 0) - lossA(G)) / W;
        const boundT =
          (G.reduce((sum, g) => sum + addT(opp, R, g), 0) - lossT(opp, R)) /
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

      expect(ownViolations).toBe(0);
      expect(otherViolations).toBe(0);
    },
    600000,
  );

  // Parity check with evaluateTrade + tradeImpact on sample trades
  it(
    "Fast scoring matches evaluateTrade on 20 trades",
    () => {
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
    },
    600000,
  );
});
