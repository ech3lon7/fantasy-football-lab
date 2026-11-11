import { roster, lineup } from "../lineups";
import { nextRefreshDefaults } from "../next-refresh";
import type { Model, Player } from "../valuation";
import { combineSpreads, outscoreProbability } from "./odds";

export interface PowerRow {
  teamId: string;
  name: string;
  mine: boolean;
  // Total starter Expected PPG for the week; null when no lineup can be scored.
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

// Every team's starting lineup total for the current week with a combined spread, ranked by expected points.
export function leaguePower(m: Model, mine: string): PowerRow[] {
  const rows = m.dataset.tables.ModelTeams.map((t) => {
    const teamId = String(t.TeamID);
    const week = lineup(m, roster(m, teamId), m.current);
    const starters = week.ids
      .map((id) => (id ? m.byId.get(id) : undefined))
      .filter((p): p is Player => !!p);
    const spreads = starters.map((p) => nextRefreshDefaults(m, p).spread);
    const scorable = starters.length > 0;
    const known = spreads.every((s): s is number => s !== null);
    const spread =
      scorable && known ? combineSpreads(spreads as number[]) : null;
    const expected = scorable ? week.expected : null;
    return {
      teamId,
      name: String(t.TeamName),
      mine: teamId === mine,
      expected,
      spread,
      floor: expected !== null && spread !== null ? expected - spread : null,
      ceiling: expected !== null && spread !== null ? expected + spread : null,
      chance: null as number | null,
      reason: !scorable
        ? "No scorable lineup this week."
        : known
          ? ""
          : "A starter's spread is unavailable.",
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
