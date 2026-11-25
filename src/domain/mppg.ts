import { num, str } from "./contracts";
import type { Model, Player } from "./valuation";
import { nextRefreshDefaults } from "./next-refresh";
import { computeDefenseStats, type DefensePositionStat } from "./matchups";

export const MPPG_EARLY_GAMES = 3;
export const MPPG_EARLY_RELIABILITY = 0.5;
export const MPPG_CAP = 0.5;
export const MPPG_METHOD_NOTE = "MPPG is this week's starter forecast. It starts from a mix of your Expected PPG and ESPN's weekly projection (the mix depends on position), trims part of any hot streak more than 2 points above the season average, and then applies this week's opponent adjustment: how many more or fewer points that defence allows to the position than the league average, counted only when it is 12% or more, weighted by position (kickers are not adjusted), scaled down for lower-scoring players, and limited to 50% either way. If ESPN projects 0, MPPG is 0. It exists only for the imported week and only picks weekly starters; trades and grades use Expected PPG.";

// Design T (docs/mppg-threshold-proposal.md), retuned by the owner on 2026-11-25 after week 11 results: kickers get no matchup
// adjustment, and the final matchup effect is limited to ±50%.
export const MPPG_ESPN_SHARE: Record<string, number> = { QB: 0.75, RB: 0.45, WR: 0.55, TE: 0, K: 1, "D/ST": 0.6 };
export const MPPG_MATCHUP_WEIGHT: Record<string, number> = { QB: 0.75, RB: 0.35, WR: 0.7, TE: 1.85, K: 0, "D/ST": 2.35 };
export const MPPG_EFFECT_CAP = 0.5;
export const MPPG_MATCHUP_THRESHOLD = 0.12;
export const MPPG_STREAK_THRESHOLD = 2;
export const MPPG_STREAK_FADE = 0.55;
export const MPPG_SCORING_LEVEL_BASE = 12;
export const MPPG_SCORING_LEVEL_POWER = 5;

export interface MppgResult {
  value: number | null; spread: number | null; floor: number | null; ceiling: number | null;
  eppg: number | null; source: "matchup" | "eppg-only" | "unavailable";
  reason: string; importedAt: string | null; buildLine: string;
  // The opponent matchup after the early-game halving and the 50% cap, before Design T's 12% threshold and position weight.
  matchupPct: number | null; rawMatchupPct: number | null; opponent: string | null;
  defenseGames: number | null; capped: boolean;
  espnWeekly: number | null;
  // The share of the base taken from ESPN's weekly projection (0 when ESPN has none).
  espnShare: number;
  // How much of a hot streak is taken off the base (never below 0).
  streakFade: number;
  // EPPG and ESPN mixed, minus the streak fade, before the matchup; unrounded.
  base: number;
  scoringLevel: number;
  // The matchup effect actually applied: 0 when ignored, unweighted for the position, or ESPN is zero; null when matchup data is
  // unavailable. Never beyond ±MPPG_EFFECT_CAP.
  matchupEffect: number | null;
  // True when the weighted effect was limited to ±MPPG_EFFECT_CAP.
  effectCapped: boolean;
  // True when the position's matchup weight is 0 (kickers), so a usable matchup is not applied.
  matchupUnweighted: boolean;
  matchupIgnored: boolean;
  espnZero: boolean;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

// Compute MPPG by Design T from unrounded defense rates.
export function calculateMppg(m: Model, p: Player, targetWeek = m.current, defenseStats?: Map<string, DefensePositionStat>): MppgResult {
  const eppg = p.blendedExpected ?? null;
  const importedAt = m.dataset.sourceUTC ?? null;
  const espn = p.weekly ?? null;
  const empty = (reason: string): MppgResult => ({ value: null, spread: null, floor: null, ceiling: null, eppg, source: "unavailable", reason, importedAt, buildLine: "", matchupPct: null, rawMatchupPct: null, opponent: null, defenseGames: null, capped: false,
    espnWeekly: espn, espnShare: 0, streakFade: 0, base: 0, scoringLevel: 0, matchupEffect: null, effectCapped: false, matchupUnweighted: false, matchupIgnored: false, espnZero: false });
  if (targetWeek !== m.current) return empty(`MPPG is available only for the imported week (Week ${m.current})`);
  const scheduled = m.dataset.tables.ModelSchedule.find((r) => (str(r.ProTeamID) === p.nflId || str(r.NFLTeam) === p.nfl) && num(r.Week) === targetWeek);
  if (p.bye === targetWeek || (scheduled && (num(scheduled.HasGame) === 0 || num(scheduled.ByeWeek) === 1))) return empty("Bye week");
  if (p.out || p.slot === 21 || ["OUT", "INJURY_RESERVE", "IR", "SUSPENSION", "SUSPENDED", "SSPD", "SUSP"].includes((p.injury || "").toUpperCase())) return empty("Out");
  if (eppg === null || !Number.isFinite(eppg)) return empty("No Expected PPG");
  const opponent = scheduled ? str(scheduled.Opponent || scheduled.OpponentID || "") : "";
  const stat = opponent ? (defenseStats ?? computeDefenseStats(m)).get(`${opponent}/${p.pos}`) : undefined;
  const usable = !!stat && stat.gamesPlayed > 0 && Number.isFinite(stat.allowedPerGameRaw) && Number.isFinite(stat.leagueAverageRaw) && stat.leagueAverageRaw > 0;
  const raw = usable ? stat.allowedPerGameRaw / stat.leagueAverageRaw - 1 : null;
  const reliability = usable && stat.gamesPlayed <= MPPG_EARLY_GAMES ? MPPG_EARLY_RELIABILITY : 1;
  const adjusted = raw === null ? 0 : raw * reliability;
  const applied = Math.max(-MPPG_CAP, Math.min(MPPG_CAP, adjusted));
  const capped = Math.abs(adjusted) > MPPG_CAP;

  // Design T. The ESPN share, the hot-streak fade and the base.
  const espnZero = espn === 0;
  const share = espn === null ? 0 : (MPPG_ESPN_SHARE[p.pos] ?? 0);
  const fade = p.recent == null || p.actual == null ? 0 : MPPG_STREAK_FADE * Math.max(0, p.recent - p.actual - MPPG_STREAK_THRESHOLD);
  const base = (1 - share) * eppg + share * (espn ?? 0) - fade;
  // The thresholded matchup and the scoring level.
  const ignored = usable && Math.abs(applied) < MPPG_MATCHUP_THRESHOLD;
  const used = usable && !ignored ? applied : 0;
  const level = eppg <= 0 ? 0 : Math.min(1, Math.pow(eppg / MPPG_SCORING_LEVEL_BASE, MPPG_SCORING_LEVEL_POWER));
  const weight = MPPG_MATCHUP_WEIGHT[p.pos] ?? 0;
  const unweighted = usable && !ignored && weight === 0;
  // A zero weight or an ignored matchup gives exactly 0, never -0.
  const weighted = weight === 0 || used === 0 ? 0 : weight * used * level;
  const effectCapped = usable && !espnZero && Math.abs(weighted) > MPPG_EFFECT_CAP;
  const effect: number | null = !usable ? null : espnZero ? 0 : Math.max(-MPPG_EFFECT_CAP, Math.min(MPPG_EFFECT_CAP, weighted));
  const value = espnZero ? 0 : Math.max(0, round1(base * (1 + (effect ?? 0))));

  const refresh = nextRefreshDefaults(m, p);
  const spread = refresh.spread === null ? null : round1(refresh.spread);
  const floor = spread === null ? null : Math.max(0, round1(value - spread));
  const ceiling = spread === null ? null : round1(value + spread);

  // The explanation, in parts joined with " · ".
  const words: Record<string, string> = { QB: "QBs", RB: "RBs", WR: "WRs", TE: "TEs", K: "kickers", "D/ST": "defences" };
  const signed = (x: number) => `${x < 0 ? "−" : "+"}${Math.round(Math.abs(x) * 100)}%`;
  let buildLine: string;
  if (espnZero) buildLine = "ESPN projects 0 this week";
  else {
    const sharePct = Math.round(share * 100);
    let basePart = `Base ${base.toFixed(1)} = `;
    if (share === 0) basePart += `EPPG ${eppg.toFixed(1)}${espn === null ? " (no ESPN projection)" : ""}`;
    else if (share === 1) basePart += `ESPN ${(espn ?? 0).toFixed(1)}`;
    else basePart += `${100 - sharePct}% EPPG ${eppg.toFixed(1)} + ${sharePct}% ESPN ${(espn ?? 0).toFixed(1)}`;
    if (fade > 0) basePart += ` − hot streak ${fade.toFixed(1)}`;
    let matchupPart: string;
    if (!usable) matchupPart = "matchup data unavailable";
    else if (ignored) matchupPart = `${opponent} matchup ${signed(applied)} ignored (under 12%)`;
    else if (unweighted) matchupPart = `matchup not used for ${words[p.pos] ?? p.pos}`;
    else {
      const count = `${stat!.gamesPlayed} ${stat!.gamesPlayed === 1 ? "game" : "games"}${reliability < 1 ? ", counted at 50%" : ""}${capped ? ", capped" : ""}`;
      matchupPart = `× (1 ${(effect ?? 0) < 0 ? "−" : "+"} ${Math.round(Math.abs(effect ?? 0) * 100)}%${effectCapped ? ", limited" : ""}) · ${opponent} allows ${Math.round(Math.abs(raw ?? 0) * 100)}% ${(raw ?? 0) < 0 ? "fewer" : "more"} points to ${words[p.pos] ?? p.pos} than average (${count})`;
    }
    buildLine = `${basePart} · ${matchupPart}`;
  }
  return { value, spread, floor, ceiling, eppg, source: usable ? "matchup" : "eppg-only", reason: usable ? "" : "Matchup data unavailable", importedAt, buildLine, matchupPct: usable ? applied : null, rawMatchupPct: raw, opponent: opponent || null, defenseGames: usable ? stat!.gamesPlayed : null, capped,
    espnWeekly: espn, espnShare: share, streakFade: fade, base, scoringLevel: level, matchupEffect: effect, effectCapped, matchupUnweighted: unweighted, matchupIgnored: ignored, espnZero };
}
