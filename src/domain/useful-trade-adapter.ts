import { roster, teamsAssessment, withLineupMemoAsync } from "./lineups";
import { tradeImpact, type LineupBasis } from "./trade-impact";
import { evaluateTrade } from "./trades";
import { scoreTradeMatch, type SearchRow, type TradeSearchQuery } from "./trade-search";
import { buildTradeImpactMap } from "./trade-impact-map";
import { buildUsefulMoves, FLOOR_MAX_LOSS_OWN, FLOOR_MAX_LOSS_OTHER, type TeamProgress, type UsefulEvaluation } from "./useful-move-search";
import { chainPositionImpact } from "./chain-position-impact";
import { lineupFilterEvidence } from "./trade-lineup-evidence";
import type { FilterableTrade } from "./trade-filters";
import type { Model } from "./valuation";

// Adapt the real lineup impact map and existing trade evaluator to the package-generation engine.
export function runUsefulTradeSearch(m: Model, ownTeam: string, protectedIds: string[], basis: LineupBasis,
  lineupsRaw?: string, onSingles?: (rows: UsefulScoredTrade[]) => void, beam?: number, only?: string[], onTeam?: (event: TeamProgress) => void) {
  const original = buildTradeImpactMap(m, ownTeam, basis, lineupsRaw);
  const add = new Map(original.add), leave = new Map(original.leave);
  // Cache model-wide input values once; scoring still comes from the existing evaluator.
  const grades = teamsAssessment(m);
  const mppg = new Map(m.players.map((p) => [p.id, p.mppg ?? null]));
  add.set("own", original.add.get(ownTeam) ?? new Map()); leave.set("own", original.leave.get(ownTeam) ?? new Map());
  const opponents: Record<string, string[]> = {};
  for (const team of original.leave.keys()) if (team !== ownTeam && (!only || only.includes(team))) opponents[team] = roster(m, team);
  // Every lineup is scored once per distinct roster and week; the same lineups recur across thousands of candidates.
  return withLineupMemoAsync(() => buildUsefulMoves({ own: roster(m, ownTeam), opponents }, { add, leave }, protectedIds, (offer): UsefulScoredTrade => {
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
      const own = lineupFilterEvidence(impact.own.weekly, m.current, offer.get, mppg);
      const other = lineupFilterEvidence(impact.other.weekly, m.current, offer.give, mppg);
      const evidence: FilterableTrade = {
        key: searchRow.key, team: offer.team, give: offer.give, get: offer.get,
        ownGain: searchRow.own, otherGain: searchRow.other, ownWeekGain: own.weekGain, otherWeekGain: other.weekGain,
        ownStarters: own.startsEveryWeek ? offer.get : [], otherStarters: other.startsEveryWeek ? offer.give : [],
        givePositions: offer.give.map((id) => m.byId.get(id)?.pos ?? ""),
        incomingPlayers: offer.get.flatMap((id) => { const p = m.byId.get(id); return p ? [{ pos: p.pos, gem: p.gem }] : []; }),
        opponentGrades: Object.fromEntries((grades.get(offer.team) ?? []).map((grade) => [grade.position, grade.grade])),
        positionImpact: chainPositionImpact(m, draft, evaluated, ["QB", "RB", "WR", "TE", "K", "D/ST", "FLEX"]),
        valueBalance: hasIndex && Number.isFinite(searchRow.difference) ? -Math.abs(searchRow.difference) : null,
      };
      searchRow.filterEvidence = evidence;
      searchRow.positionImpact = evidence.positionImpact;
    }
    return { ...offer, legal: searchRow.legal, changed, own: searchRow.own, other: searchRow.other, searchRow };
  }, onSingles, beam, onTeam));
}
export interface UsefulScoredTrade extends UsefulEvaluation { searchRow: SearchRow }
