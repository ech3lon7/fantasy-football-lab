import { num, str } from "./contracts";
import type { Model } from "./valuation";

// Display-only tiers for the player card. A tier changes no valuation, grade, lineup or trade result.
export const TIER_MIN_GAMES = 4;
export const TIER_SUPERSTAR_PER_TEAM = 1;
export const TIER_STAR_PER_TEAM = 3;
export const TIER_GOOD_PER_TEAM = 6;

export type PlayerTier = "superstar" | "star" | "good" | null;

export interface PlayerTierInfo {
  // Overall rank by points per game across every position; null when the player has too few games or no points per game.
  rank: number | null;
  // How many players are ranked in total.
  rankedCount: number;
  tier: PlayerTier;
  ppg: number | null;
  games: number;
}

// The number of fantasy teams: the league's own count, else the teams in the dataset (without the free-agent pool).
export function fantasyTeamCount(m: Model): number {
  const declared = num(m.dataset.tables.ModelContext[0]?.TeamCount);
  if (Number.isFinite(declared) && declared > 0) return declared;
  return Math.max(
    1,
    m.dataset.tables.ModelTeams.filter((t) => str(t.TeamID) !== "0").length,
  );
}

// Rank every player (rostered and free agents) across all positions by points per game this season.
// Ties share the better rank. Only players with at least TIER_MIN_GAMES games are ranked, never from zero points.
export function calculatePlayerTiers(m: Model): Map<string, PlayerTierInfo> {
  const teams = fantasyTeamCount(m);
  const superstar = TIER_SUPERSTAR_PER_TEAM * teams;
  const star = TIER_STAR_PER_TEAM * teams;
  const good = TIER_GOOD_PER_TEAM * teams;

  const ranked = m.players
    .filter(
      (p) =>
        p.games >= TIER_MIN_GAMES &&
        p.actual !== null &&
        Number.isFinite(p.actual),
    )
    .sort((a, b) => (b.actual as number) - (a.actual as number));

  const out = new Map<string, PlayerTierInfo>();
  let rank = 0;
  ranked.forEach((p, i) => {
    if (i === 0 || (p.actual as number) < (ranked[i - 1].actual as number))
      rank = i + 1;
    out.set(p.id, {
      rank,
      rankedCount: ranked.length,
      tier:
        rank <= superstar
          ? "superstar"
          : rank <= star
            ? "star"
            : rank <= good
              ? "good"
              : null,
      ppg: p.actual,
      games: p.games,
    });
  });
  for (const p of m.players)
    if (!out.has(p.id))
      out.set(p.id, {
        rank: null,
        rankedCount: ranked.length,
        tier: null,
        ppg: p.actual,
        games: p.games,
      });
  return out;
}
