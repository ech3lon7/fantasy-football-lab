import { lineupUncached, roster, teamsAssessment, withLineupMemoAsync } from "./lineups";
import { tradeImpact, type LineupBasis } from "./trade-impact";
import { evaluateTrade } from "./trades";
import { scoreTradeMatch, type SearchRow, type TradeSearchQuery } from "./trade-search";
import { buildTradeImpactMap } from "./trade-impact-map";
import { buildUsefulMoves, FLOOR_MAX_LOSS_OWN, FLOOR_MAX_LOSS_OTHER, type SearchInputs, type TeamProgress, type UsefulEvaluation, type UsefulOffer } from "./useful-move-search";
import { chainPositionImpact } from "./chain-position-impact";
import { lineupFilterEvidence } from "./trade-lineup-evidence";
import type { FilterableTrade } from "./trade-filters";
import type { Model } from "./valuation";

// Adapt the real lineup impact map and existing trade evaluator to the package-generation engine.
export function runUsefulTradeSearch(m: Model, ownTeam: string, inputsOrProtected: SearchInputs | string[], basis: LineupBasis,
  lineupsRaw?: string, onSingles?: (rows: UsefulScoredTrade[]) => void, beam?: number, only?: string[], onTeam?: (event: TeamProgress) => void) {
  const original = buildTradeImpactMap(m, ownTeam, basis, lineupsRaw);
  const add = new Map(original.add), leave = new Map(original.leave);
  // Cache model-wide input values once; scoring still comes from the existing evaluator.
  const grades = teamsAssessment(m);
  const mppg = new Map(m.players.map((p) => [p.id, p.mppg ?? null]));
  const beforeMppgCache = new Map<string, number | null>();
  const getBeforeMppg = (weekly: { week: number; beforeIds: (string | null)[] }[], team: string): number | null => {
    let cached = beforeMppgCache.get(team);
    if (cached === undefined) {
      const current = weekly.find((w) => w.week === m.current);
      if (!current) cached = null;
      else {
        let sum = 0;
        let valid = true;
        for (const id of current.beforeIds) {
          if (id !== null) {
            const v = mppg.get(id);
            if (v == null || !Number.isFinite(v)) { valid = false; break; }
            sum += v;
          }
        }
        cached = valid ? sum : null;
      }
      beforeMppgCache.set(team, cached);
    }
    return cached;
  };
  add.set("own", original.add.get(ownTeam) ?? new Map()); leave.set("own", original.leave.get(ownTeam) ?? new Map());
  const opponents: Record<string, string[]> = {};
  for (const team of original.leave.keys()) if (team !== ownTeam && (!only || only.includes(team))) opponents[team] = roster(m, team);

  const week0 = m.weeks[0] ?? m.current;
  const beforeScoreCache = new Map<string, number>();
  const rosterCache = new Map<string, string[]>();
  const getRoster = (team: string): string[] => {
    let r = rosterCache.get(team);
    if (!r) {
      r = roster(m, team);
      rosterCache.set(team, r);
    }
    return r;
  };
  const getBeforeScore = (team: string): number => {
    let s = beforeScoreCache.get(team);
    if (s === undefined) {
      s = lineupUncached(m, getRoster(team), week0, false, false, "expected").expected;
      beforeScoreCache.set(team, s);
    }
    return s;
  };

  const estimate = (offer: UsefulOffer): { own: number | null; other: number | null } => {
    for (const id of offer.give) {
      if (m.byId.get(id)?.expected == null) return { own: null, other: null };
    }
    for (const id of offer.get) {
      if (m.byId.get(id)?.expected == null) return { own: null, other: null };
    }
    const ownBefore = getBeforeScore(ownTeam);
    const otherBefore = getBeforeScore(offer.team);
    const ownAfter = getRoster(ownTeam).filter((id) => !offer.give.includes(id)).concat(offer.get);
    const otherAfter = getRoster(offer.team).filter((id) => !offer.get.includes(id)).concat(offer.give);
    const ownScore = lineupUncached(m, ownAfter, week0, false, false, "expected").expected;
    const otherScore = lineupUncached(m, otherAfter, week0, false, false, "expected").expected;
    return {
      own: ownScore - ownBefore,
      other: otherScore - otherBefore,
    };
  };

  // Every lineup is scored once per distinct roster and week; the same lineups recur across thousands of candidates.
  return withLineupMemoAsync(() => buildUsefulMoves({ own: getRoster(ownTeam), opponents }, { add, leave }, inputsOrProtected, estimate, (offer): UsefulScoredTrade => {
    const query: TradeSearchQuery = { teamA: ownTeam, give: offer.give, count: offer.get.length, below: 0, above: 0, lineupBasis: basis };
    // Missing index data must not become a zero-valued balance estimate.
    const hasIndex = [...offer.get, ...offer.give].every((id) => m.byId.get(id)?.index != null);
    const incoming = offer.get.reduce((s, id) => s + (m.byId.get(id)?.index ?? 0), 0);
    const outgoing = offer.give.reduce((s, id) => s + (m.byId.get(id)?.index ?? 0), 0);
    const draft = { teamA: ownTeam, teamB: offer.team, give: offer.give, get: offer.get };
    const evaluated = evaluateTrade(m, draft, false, lineupsRaw);
    const searchRow = scoreTradeMatch(m, query, { key: JSON.stringify([offer.team, offer.give, offer.get]), teamB: offer.team,
      give: offer.give, get: offer.get, incoming, outgoing, difference: incoming - outgoing }, lineupsRaw, evaluated);
    // Group packages by the most consequential departure and incoming addition, with stable ID ties.
    const best = (ids: string[], values: Map<string, number | null> | undefined) => [...ids].sort((a, b) =>
      (values?.get(b) ?? -Infinity) - (values?.get(a) ?? -Infinity) || a.localeCompare(b))[0];
    searchRow.coreSwap = JSON.stringify([offer.team, best(offer.give, leave.get("own")), best(offer.get, add.get("own"))]);
    const impact = tradeImpact(evaluated, basis);
    // Compare actual weekly lineup membership rather than assuming zero points means no lineup changed.
    const changed = !!impact && [impact.own, impact.other].some((side) => side.weekly.some((week) =>
      JSON.stringify(week.beforeIds) !== JSON.stringify(week.ids)));
    // Capture filter data while the original evaluated lineups are available.
    if (impact && searchRow.legal === true && changed && searchRow.own !== null && searchRow.other !== null &&
        searchRow.own >= -FLOOR_MAX_LOSS_OWN && searchRow.other >= -FLOOR_MAX_LOSS_OTHER) {
      const own = lineupFilterEvidence(impact.own.weekly, m.current, offer.get, mppg, getBeforeMppg(impact.own.weekly, ownTeam));
      const other = lineupFilterEvidence(impact.other.weekly, m.current, offer.give, mppg, getBeforeMppg(impact.other.weekly, offer.team));
      const evidence: FilterableTrade = {
        key: searchRow.key, team: offer.team, give: offer.give, get: offer.get,
        ownGain: searchRow.own, otherGain: searchRow.other, ownWeekGain: own.weekGain, otherWeekGain: other.weekGain,
        ownStarters: own.startsEveryWeek ? offer.get : [], otherStarters: other.startsEveryWeek ? offer.give : [],
        givePositions: offer.give.map((id) => m.byId.get(id)?.pos ?? ""),
        incomingPlayers: offer.get.flatMap((id) => { const p = m.byId.get(id); return p ? [{ pos: p.pos, gem: p.gem }] : []; }),
        opponentGrades: Object.fromEntries((grades.get(offer.team) ?? []).map((grade) => [grade.position, grade.grade])),
        positionImpact: chainPositionImpact(m, draft, evaluated, ["QB", "RB", "WR", "TE", "K", "D/ST", "FLEX"], grades),
        valueBalance: hasIndex && Number.isFinite(searchRow.difference) ? -Math.abs(searchRow.difference) : null,
      };
      searchRow.filterEvidence = evidence;
      searchRow.positionImpact = evidence.positionImpact;
    }
    return { ...offer, legal: searchRow.legal, changed, own: searchRow.own, other: searchRow.other, searchRow };
  }, onSingles, beam, onTeam));
}
export interface UsefulScoredTrade extends UsefulEvaluation { searchRow: SearchRow }
