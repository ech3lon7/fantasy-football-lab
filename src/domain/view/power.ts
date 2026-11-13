import { weeklyLineup } from "../lineups";
import type { Model } from "../valuation";
import { outscoreProbability } from "./odds";

export interface PowerRow {
  teamId: string;
  name: string;
  mine: boolean;
  // Total starter MPPG for the week; null when no lineup can be scored.
  expected: number | null;
  // Combined spread of the starters; null when any starter's spread is unavailable.
  spread: number | null;
  floor: number | null;
  ceiling: number | null;
  // The chance the owner's lineup outscores this team's; null for the owner's own row or when either spread is missing.
  chance: number | null;
  // Why the range or chance is missing; empty when both exist.
  reason: string;
}

// 3.7 Every team's starting lineup total for the current week using weekly-lineup MPPG and combined spread, ranked by expected points.
export function leaguePower(m: Model, mine: string): PowerRow[] {
  const rows = m.dataset.tables.ModelTeams.map((t) => {
    const teamId = String(t.TeamID);
    const wl = weeklyLineup(m, teamId);
    const scorable = wl.starterIds.length > 0 && wl.totalMppg > 0;
    const expected = scorable ? wl.totalMppg : null;
    const spread = scorable ? wl.totalSpread : null;
    return {
      teamId,
      name: String(t.TeamName),
      mine: teamId === mine,
      expected,
      spread,
      floor: expected !== null && spread !== null ? Math.round(Math.max(0, expected - spread) * 10) / 10 : null,
      ceiling: expected !== null && spread !== null ? Math.round((expected + spread) * 10) / 10 : null,
      chance: null as number | null,
      reason: !scorable
        ? "No scorable lineup this week."
        : "",
    } satisfies PowerRow;
  });
  const own = rows.find((r) => r.mine);
  for (const r of rows)
    if (own && !r.mine)
      r.chance = outscoreProbability(
        { mean: own.expected, spread: own.spread },
        { mean: r.expected, spread: r.spread },
      );
  // Rank by expected points; teams without a lineup go last, ties break by name.
  return rows.sort(
    (a, b) =>
      (b.expected ?? -Infinity) - (a.expected ?? -Infinity) ||
      a.name.localeCompare(b.name),
  );
}
