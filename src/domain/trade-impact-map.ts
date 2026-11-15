import { roster } from "./lineups";
import { directStarterImpact, rosterPotentialImpact } from "./starter-lineups";
import type { LineupBasis } from "./trade-impact";
import type { Model } from "./valuation";

// Record each rostered player's removal loss and each other player's addition gain in EPPG per week.
export function buildTradeImpactMap(m: Model, ownTeam: string, basis: LineupBasis, lineupsRaw?: string) {
  const leave = new Map<string, Map<string, number | null>>();
  const add = new Map<string, Map<string, number | null>>();
  const teams = [...new Set(m.players.map((p) => p.owner).filter((owner) => owner && owner !== "0"))];
  // Reuse the trade analyzer's selected lineup basis, schedule and injury handling.
  const change = (team: string, before: string[], after: string[], incoming: string[]) =>
    basis === "marked-starters"
      ? directStarterImpact(m, team, after, incoming, lineupsRaw).expectedPerWeek
      : rosterPotentialImpact(m, before, after, incoming).expectedPerWeek;
  for (const team of teams) {
    const before = roster(m, team), losses = new Map<string, number | null>(), gains = new Map<string, number | null>();
    for (const id of before) {
      const p = m.byId.get(id);
      const result = p?.expected == null || p.value == null ? null : change(team, before, before.filter((x) => x !== id), []);
      losses.set(id, result === null ? null : result === 0 ? 0 : -result);
    }
    for (const p of m.players) {
      if (!p.owner || p.owner === "0" || p.owner === team || (team !== ownTeam && p.owner !== ownTeam)) continue;
      gains.set(p.id, p.expected === null || p.value === null ? null : change(team, before, [...before, p.id], [p.id]));
    }
    leave.set(team, losses); add.set(team, gains);
  }
  return { leave, add };
}
