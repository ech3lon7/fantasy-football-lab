import { cmpId } from "./contracts";
import {
  createTeamsAssessmentCache,
  roster,
  teamsAssessment,
  withLineupMemoAsync,
} from "./lineups";
import { createFastLineups } from "./fast-lineups";
import { chainPositionImpact } from "./chain-position-impact";
import {
  managerAssessment,
  type ManagerSettings,
} from "./manager-expectations";
import { surfaceAppeal } from "./surface-appeal";
import type { FilterableTrade } from "./trade-filters";
import type { Model } from "./valuation";

export interface CompleteTrade {
  key: string; // JSON.stringify([team, giveSortedByCmpId, getSortedByCmpId])
  teamB: string;
  give: string[];
  get: string[];
  own: number;
  other: number; // per week
  seedKey: string; // JSON.stringify([team, [bestGive], [bestGet]])
  filterEvidence: FilterableTrade;
}

export interface CompleteCoverage {
  possible: number;
  scored: number;
  kept: number;
  opponents: number;
  missingTeams?: string[];
  evidenceMs?: number;
}

function subsets(a: string[], k: number): string[][] {
  if (k === 0) return [[]];
  const res: string[][] = [];
  for (let i = 0; i <= a.length - k; i++) {
    const head = a[i];
    const tailSubsets = subsets(a.slice(i + 1), k - 1);
    for (const tail of tailSubsets) {
      res.push([head, ...tail]);
    }
  }
  return res;
}

export async function runCompleteTradeSearch(
  m: Model,
  ownTeam: string,
  lineupsRaw: string | undefined,
  manager: ManagerSettings,
  opponents: string[],
  onTeam: (event: {
    team: string;
    possible: number;
    scored: number;
    kept: number;
    done: boolean;
    rows: CompleteTrade[];
  }) => void,
): Promise<CompleteCoverage> {
  return withLineupMemoAsync(async () => {
  const W = m.weeks.length;
  if (!W) {
    return { possible: 0, scored: 0, kept: 0, opponents: 0 };
  }

  const fl = createFastLineups(m);
  const F = fl.total;

  const fullS = roster(m, ownTeam);
  const S = fullS
    .filter((id) => m.byId.get(id)?.value != null)
    .sort(cmpId);
  const Gs = [1, 2, 3].flatMap((k) => subsets(S, k));

  // Precompute lossA for all G in Gs (and G=empty)
  const lossA = new Map<string, number>();
  lossA.set("", 0);
  for (const G of Gs) {
    const gSet = new Set(G);
    const remaining = fullS.filter((id) => !gSet.has(id));
    lossA.set(G.join(","), F(ownTeam, fullS) - F(ownTeam, remaining));
  }

  // Precompute single player additions to S for seedKey: addA0[r] = F(A, S U {r}) - F(A, S)
  const addA0 = new Map<string, number>();
  for (const p of m.players) {
    if (p.value !== null && p.owner !== ownTeam && p.owner !== "0") {
      addA0.set(p.id, F(ownTeam, [...fullS, p.id]) - F(ownTeam, fullS));
    }
  }

  const baseBeforeA = fl.weekly(ownTeam, fullS);
  const curWeekIdx = m.weeks.indexOf(m.current);
  const mppg = new Map(
    m.players.map((p) => [p.id, p.mppg ?? null] as const),
  );

  const computeBeforeMppg = (weekly: (string | null)[][]): number | null => {
    if (curWeekIdx < 0) return null;
    const ids = weekly[curWeekIdx];
    let sum = 0;
    for (const id of ids) {
      if (id !== null) {
        const v = mppg.get(id);
        if (v == null || !Number.isFinite(v)) return null;
        sum += v;
      }
    }
    return sum;
  };
  const beforeMppgA = computeBeforeMppg(baseBeforeA);

  const baseAssessment = teamsAssessment(m);
  const teamsCache = createTeamsAssessmentCache(m);

  let totalPossible = 0;
  let totalScored = 0;
  let totalKept = 0;
  let totalEvidenceMs = 0;
  let scoredSinceYield = 0;

  for (const opp of opponents) {
    const fullU = roster(m, opp);
    const U = fullU
      .filter((id) => m.byId.get(id)?.value != null)
      .sort(cmpId);
    const Rs = [1, 2, 3].flatMap((k) => subsets(U, k));

    const oppPossible = Gs.length * Rs.length;
    onTeam({
      team: opp,
      possible: oppPossible,
      scored: 0,
      kept: 0,
      done: false,
      rows: [],
    });

    // Precompute lossT for all R in Rs
    const lossT = new Map<string, number>();
    lossT.set("", 0);
    for (const R of Rs) {
      const rSet = new Set(R);
      const remaining = fullU.filter((id) => !rSet.has(id));
      lossT.set(R.join(","), F(opp, fullU) - F(opp, remaining));
    }

    // Precompute addA[G][r] for G in Gs and r in U
    const addA = new Map<string, Map<string, number>>();
    for (const G of Gs) {
      const gSet = new Set(G);
      const base = fullS.filter((id) => !gSet.has(id));
      const baseF = F(ownTeam, base);
      const row = new Map<string, number>();
      for (const r of U) {
        row.set(r, F(ownTeam, [...base, r]) - baseF);
      }
      addA.set(G.join(","), row);
    }

    // Precompute addT[R][g], baseT, bestGet, rData for R in Rs
    const addT = new Map<string, Map<string, number>>();
    const rData = new Map<
      string,
      {
        baseT: string[];
        bestGet: string;
        incomingVal: number;
        hasIndexR: boolean;
        incomingPlayers: FilterableTrade["incomingPlayers"];
      }
    >();
    for (const R of Rs) {
      const rKey = R.join(",");
      const rSet = new Set(R);
      const base = fullU.filter((id) => !rSet.has(id));
      const baseF = F(opp, base);
      const row = new Map<string, number>();
      for (const g of S) {
        row.set(g, F(opp, [...base, g]) - baseF);
      }
      addT.set(rKey, row);

      const bestGet = [...R].sort((a, b) => {
        const aa = addA0.get(a) ?? 0;
        const ab = addA0.get(b) ?? 0;
        return ab - aa || cmpId(a, b);
      })[0];
      const incomingVal = R.reduce(
        (s, id) => s + (m.byId.get(id)?.index ?? 0),
        0,
      );
      const hasIndexR = R.every((id) => m.byId.get(id)?.index != null);
      const incomingPlayers = R.flatMap((id) => {
        const p = m.byId.get(id);
        return p ? [{ pos: p.pos, gem: p.gem }] : [];
      });
      rData.set(rKey, {
        baseT: base,
        bestGet,
        incomingVal,
        hasIndexR,
        incomingPlayers,
      });
    }

    const baseBeforeT = fl.weekly(opp, fullU);
    const beforeMppgT = computeBeforeMppg(baseBeforeT);
    const opponentGradeMap = Object.fromEntries(
      (baseAssessment.get(opp) ?? []).map((grade) => [
        grade.position,
        grade.grade,
      ]),
    );

    let oppScored = 0;
    let oppKept = 0;
    const oppRows: CompleteTrade[] = [];

    for (const G of Gs) {
      const gKey = G.join(",");
      const lA = lossA.get(gKey)!;
      const addAG = addA.get(gKey)!;
      const gSet = new Set(G);
      const baseA = fullS.filter((id) => !gSet.has(id));

      const gMarginalLoss = G.map((g) => {
        const gSub = G.filter((x) => x !== g).join(",");
        return lA - lossA.get(gSub)!;
      });

      const bestGive = [...G].sort((a, b) => {
        const la = lossA.get(a) ?? 0;
        const lb = lossA.get(b) ?? 0;
        return lb - la || cmpId(a, b);
      })[0];
      const givePositions = G.map((id) => m.byId.get(id)?.pos ?? "");
      const outgoingVal = G.reduce(
        (s, id) => s + (m.byId.get(id)?.index ?? 0),
        0,
      );
      const hasIndexG = G.every((id) => m.byId.get(id)?.index != null);

      for (const R of Rs) {
        const rKey = R.join(",");
        const lT = lossT.get(rKey)!;
        const addTR = addT.get(rKey)!;

        // B1 (your bound): skip when sum_{r in R} addA[G][r] - lossA[G] <= 1e-9
        let sumAddA = 0;
        for (const r of R) sumAddA += addAG.get(r)!;
        if (sumAddA - lA <= 1e-9) continue;

        // N (throw-in rule): skip when there is:
        // - some g in G with lossA[G] - lossA[G \ {g}] <= 1e-9 and addT[R][g] <= 1e-9; or
        // - some r in R with addA[G][r] <= 1e-9 and lossT[R] - lossT[R \ {r}] <= 1e-9
        let throwIn = false;
        for (let i = 0; i < G.length; i++) {
          if (gMarginalLoss[i] <= 1e-9 && addTR.get(G[i])! <= 1e-9) {
            throwIn = true;
            break;
          }
        }
        if (!throwIn) {
          for (const r of R) {
            if (addAG.get(r)! <= 1e-9) {
              const rSub = R.filter((x) => x !== r).join(",");
              const rMarginalLoss = lT - lossT.get(rSub)!;
              if (rMarginalLoss <= 1e-9) {
                throwIn = true;
                break;
              }
            }
          }
        }
        if (throwIn) continue;

        // B2 (their bound): skip when (sum_{g in G} addT[R][g] - lossT[R]) / W < -2 - 1e-9
        let sumAddT = 0;
        for (const g of G) sumAddT += addTR.get(g)!;
        if ((sumAddT - lT) / W < -2 - 1e-9) continue;

        oppScored++;
        scoredSinceYield++;
        if (scoredSinceYield >= 2000) {
          scoredSinceYield = 0;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        const rd = rData.get(rKey)!;
        const baseT = rd.baseT;

        const a = fl.legal([...baseA, ...R]);
        const b = fl.legal([...baseT, ...G]);

        if (a.excess > 0 || b.excess > 0) continue;

        const ownTotal = F(ownTeam, a.ids) - F(ownTeam, fullS);
        const otherTotal = F(opp, b.ids) - F(opp, fullU);

        if (ownTotal <= 1e-9) continue;
        if (otherTotal / W < -2 - 1e-9) continue;

        const afterWeeklyA = fl.weekly(ownTeam, a.ids);
        const afterWeeklyT = fl.weekly(opp, b.ids);

        let changed = false;
        for (let w = 0; w < W; w++) {
          const bA = baseBeforeA[w];
          const aA = afterWeeklyA[w];
          if (
            bA.length !== aA.length ||
            bA.some((id, idx) => id !== aA[idx])
          ) {
            changed = true;
            break;
          }
          const bT = baseBeforeT[w];
          const aT = afterWeeklyT[w];
          if (
            bT.length !== aT.length ||
            bT.some((id, idx) => id !== aT[idx])
          ) {
            changed = true;
            break;
          }
        }

        if (!changed) continue;

        oppKept++;
        const tEv0 = performance.now();

        // Build seedKey
        const bestGet = rd.bestGet;
        const seedKey = JSON.stringify([opp, [bestGive], [bestGet]]);
        const tradeKey = JSON.stringify([opp, G, R]);

        // Build T3 evidence
        const ownGain = ownTotal / W;
        const otherGain = otherTotal / W;

        const afterMppgA = computeBeforeMppg(afterWeeklyA);
        const ownWeekGain =
          beforeMppgA === null || afterMppgA === null
            ? null
            : afterMppgA - beforeMppgA;
        const afterMppgT = computeBeforeMppg(afterWeeklyT);
        const otherWeekGain =
          beforeMppgT === null || afterMppgT === null
            ? null
            : afterMppgT - beforeMppgT;

        const ownStarters = R.filter((id) =>
          afterWeeklyA.every((wkIds) => wkIds.includes(id)),
        );
        const otherStarters = G.filter((id) =>
          afterWeeklyT.every((wkIds) => wkIds.includes(id)),
        );

        const incomingPlayers = rd.incomingPlayers;
        const hasIndex = rd.hasIndexR && hasIndexG;
        const difference = rd.incomingVal - outgoingVal;
        const valueBalance =
          hasIndex && Number.isFinite(difference)
            ? -Math.abs(difference)
            : null;

        const draft = { teamA: ownTeam, teamB: opp, give: G, get: R };
        const minimalResult = {
          valid: true,
          legality: true,
          initialB: fullU,
          legalB: b.ids,
        };

        const ma = managerAssessment(m, draft, minimalResult, manager);
        const acceptance =
          (ma.status === "eligible" || ma.status === "conditional") &&
          ma.band !== undefined
            ? ma.band
            : null;

        const sa = surfaceAppeal(
          m,
          draft,
          minimalResult,
          {},
          "best-available",
          lineupsRaw,
        );
        const surfaceAverage = sa?.average?.gain ?? null;
        const surfaceProjection = sa?.projection?.gain ?? null;

        const minimalTradeResult = {
          valid: true,
          legality: true,
          legalA: a.ids,
          legalB: b.ids,
          dropsA: a.drops,
          dropsB: b.drops,
        };
        const positionImpact = chainPositionImpact(
          m,
          draft,
          minimalTradeResult,
          ["QB", "RB", "WR", "TE", "K", "D/ST", "FLEX"],
          baseAssessment,
          teamsCache,
        );

        const filterEvidence: FilterableTrade = {
          key: tradeKey,
          team: opp,
          give: G,
          get: R,
          ownGain,
          otherGain,
          ownWeekGain,
          otherWeekGain,
          ownStarters,
          otherStarters,
          givePositions,
          incomingPlayers,
          opponentGrades: opponentGradeMap,
          positionImpact,
          valueBalance,
          acceptance,
          surfaceAverage,
          surfaceProjection,
        };

        oppRows.push({
          key: tradeKey,
          teamB: opp,
          give: G,
          get: R,
          own: ownGain,
          other: otherGain,
          seedKey,
          filterEvidence,
        });
        totalEvidenceMs += performance.now() - tEv0;
      }
    }

    totalPossible += oppPossible;
    totalScored += oppScored;
    totalKept += oppKept;

    onTeam({
      team: opp,
      possible: oppPossible,
      scored: oppScored,
      kept: oppKept,
      done: true,
      rows: oppRows,
    });
  }

  fl.clear();

  return {
    possible: totalPossible,
    scored: totalScored,
    kept: totalKept,
    opponents: opponents.length,
    evidenceMs: totalEvidenceMs,
  };
  });
}
