import { num, str } from "./contracts";
import type { Model, Player } from "./valuation";
import { nextRefreshDefaults } from "./next-refresh";
import { computeDefenseStats, type DefensePositionStat } from "./matchups";

export const MPPG_EARLY_GAMES = 3;
export const MPPG_EARLY_RELIABILITY = 0.5;
export const MPPG_CAP = 0.5;
export const MPPG_METHOD_NOTE = "MPPG is your Expected PPG adjusted for this week's opponent: how many more or fewer points that defence has allowed to this position than the league average, as a percentage. A defence's record counts in full from its 4th game (half before that), and the change is capped at 50%. It exists only for the imported week and only picks weekly starters; trades and grades use Expected PPG.";

export interface MppgResult {
  value: number | null; spread: number | null; floor: number | null; ceiling: number | null;
  eppg: number | null; source: "matchup" | "eppg-only" | "unavailable";
  reason: string; importedAt: string | null; buildLine: string;
  matchupPct: number | null; rawMatchupPct: number | null; opponent: string | null;
  defenseGames: number | null; capped: boolean;
}

// Compute the approved current-week multiplier from unrounded defense rates.
export function calculateMppg(m: Model, p: Player, targetWeek = m.current, defenseStats?: Map<string, DefensePositionStat>): MppgResult {
  const eppg = p.blendedExpected ?? null;
  const importedAt = m.dataset.sourceUTC ?? null;
  const empty = (reason: string): MppgResult => ({ value: null, spread: null, floor: null, ceiling: null, eppg, source: "unavailable", reason, importedAt, buildLine: "", matchupPct: null, rawMatchupPct: null, opponent: null, defenseGames: null, capped: false });
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
  const value = Math.max(0, Math.round(eppg * (1 + applied) * 10) / 10);
  const refresh = nextRefreshDefaults(m, p);
  const spread = refresh.spread === null ? null : Math.round(refresh.spread * 10) / 10;
  const floor = spread === null ? null : Math.max(0, Math.round((value - spread) * 10) / 10);
  const ceiling = spread === null ? null : Math.round((value + spread) * 10) / 10;
  const words: Record<string, string> = { QB: "QBs", RB: "RBs", WR: "WRs", TE: "TEs", K: "kickers", "D/ST": "defences" };
  const sign = applied < 0 ? "−" : "+";
  const pct = Math.round(Math.abs(applied) * 100);
  const rawPct = raw === null ? 0 : Math.round(Math.abs(raw) * 100);
  const count = usable ? `${stat.gamesPlayed} ${stat.gamesPlayed === 1 ? "game" : "games"}${reliability < 1 ? ", counted at 50%" : ""}` : "";
  const buildLine = raw === null ? `EPPG ${eppg.toFixed(1)} · matchup data unavailable` : `EPPG ${eppg.toFixed(1)} × (1 ${sign} ${pct}%${capped ? ", capped" : ""}) · ${opponent} allows ${rawPct}% ${raw < 0 ? "fewer" : "more"} points to ${words[p.pos] ?? p.pos} than average (${count})`;
  return { value, spread, floor, ceiling, eppg, source: usable ? "matchup" : "eppg-only", reason: usable ? "" : "Matchup data unavailable", importedAt, buildLine, matchupPct: usable ? applied : null, rawMatchupPct: raw, opponent: opponent || null, defenseGames: usable ? stat.gamesPlayed : null, capped };
}
