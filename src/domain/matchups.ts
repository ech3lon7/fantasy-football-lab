import { mean, num, str } from "./contracts";
import type { Model, Player } from "./valuation";
import { playedHistory } from "./opportunity";

export type MatchupTone = "tough" | "neutral" | "soft";

export interface DefensePositionStat {
  defenseTeam: string; // NFL team or Opponent code (e.g. "NOR", "PHI", "1")
  pos: string;
  pointsAllowedTotal: number;
  gamesPlayed: number;
  pointsAllowedPerGame: number;
  leagueAverage: number;
  allowedPerGameRaw: number;
  leagueAverageRaw: number;
  diff: number; // pointsAllowedPerGame - leagueAverage (+ means soft / allows more points)
  rank: number; // 1 = allows fewest (toughest), 32 = allows most (softest)
  totalDefenses: number;
  tone: MatchupTone;
  status: "official" | "conditional" | "unavailable";
}

export interface PlayerWeeklyMatchup {
  week: number;
  opponent: string;
  opponentId: string;
  home: boolean;
  bye: boolean;
  diff: number | null;
  rank: number | null;
  tone: MatchupTone;
  text: string; // "Soft vs WR · +2.5 pts allowed vs avg · 28 of 32"
  shortText: string; // "W10 vs NOR · soft"
  status: "official" | "conditional" | "unavailable" | "bye";
}

// 2.3 Tone cuts: tough if rank is in bottom sixth (1-5 out of 32), soft if top sixth (28-32 out of 32).
export const TOUGH_PERCENTILE = 1 / 6;
export const SOFT_PERCENTILE = 5 / 6;

// Cache the current snapshot by model; historical cutoffs are deliberately computed separately.
const defenseCache = new WeakMap<Model, Map<string, DefensePositionStat>>();

// Computes points allowed per defense team and position, optionally before a historical week.
export function computeDefenseStats(m: Model, throughWeek?: number): Map<string, DefensePositionStat> {
  const cached = throughWeek === undefined ? defenseCache.get(m) : undefined;
  if (cached) return cached;
  const result = new Map<string, DefensePositionStat>();
  const dataset = m.dataset;
  const schedules = dataset.tables.ModelSchedule;

  // Map: `${teamId}/${week}` -> schedule row
  const scheduleLookup = new Map<string, any>();
  for (const s of schedules) {
    const key = `${str(s.ProTeamID)}/${num(s.Week)}`;
    scheduleLookup.set(key, s);
    if (s.NFLTeam) {
      scheduleLookup.set(`${str(s.NFLTeam)}/${num(s.Week)}`, s);
    }
  }

  // Count team games played by each defense: defenseKey -> Set of weeks
  const defenseGames = new Map<string, Set<number>>();
  // Points allowed: `${defenseKey}/${pos}` -> total points
  const pointsAllowed = new Map<string, number>();

  // Use playedHistory to only count actual played games by position
  const histories = playedHistory(dataset);

  for (const p of m.players) {
    const pHistory = histories.get(p.id) ?? [];
    for (const h of pHistory) {
      const week = num(h.Week);
      if (throughWeek !== undefined && week >= throughWeek) continue;
      // Only completed/past weeks up to current-1 or where StatsOfficial is true
      const sched =
        scheduleLookup.get(`${p.nflId}/${week}`) ??
        scheduleLookup.get(`${p.nfl}/${week}`);
      if (!sched || num(sched.HasGame) === 0 || num(sched.ByeWeek) === 1) {
        continue;
      }
      if (sched.StatsOfficial === false) {
        continue;
      }

      const opp = str(sched.Opponent || sched.OpponentID || sched.NFLOpponent);
      if (!opp || opp === "BYE" || opp === "0" || opp === "Unknown") {
        continue;
      }

      const points = num(h.Points);

      // Record defense game
      if (!defenseGames.has(opp)) {
        defenseGames.set(opp, new Set());
      }
      defenseGames.get(opp)!.add(week);

      // Add points
      const key = `${opp}/${p.pos}`;
      pointsAllowed.set(key, (pointsAllowed.get(key) ?? 0) + points);
    }
  }

  // Calculate averages per position across all defenses that played at least 1 game
  const posAverages = new Map<string, number>();
  const allPositions = ["QB", "RB", "WR", "TE", "K", "D/ST"];

  for (const pos of allPositions) {
    const defensePerGameRates: number[] = [];
    for (const [opp, weeksSet] of defenseGames.entries()) {
      const g = weeksSet.size;
      if (g > 0) {
        const pts = pointsAllowed.get(`${opp}/${pos}`) ?? 0;
        defensePerGameRates.push(pts / g);
      }
    }
    const avg = defensePerGameRates.length > 0 ? mean(defensePerGameRates) ?? 0 : 0;
    posAverages.set(pos, avg);
  }

  // Calculate per defense stats and rank them
  for (const pos of allPositions) {
    const leagueAvg = posAverages.get(pos) ?? 0;
    const defenseList: {
      opp: string;
      games: number;
      ptsAllowedPerGame: number;
      diff: number;
    }[] = [];

    for (const [opp, weeksSet] of defenseGames.entries()) {
      const games = weeksSet.size;
      const totalPts = pointsAllowed.get(`${opp}/${pos}`) ?? 0;
      const rate = games > 0 ? totalPts / games : 0;
      defenseList.push({
        opp,
        games,
        ptsAllowedPerGame: rate,
        diff: rate - leagueAvg,
      });
    }

    // Rank 1..N: 1 = allows fewest (toughest)
    defenseList.sort((a, b) => a.ptsAllowedPerGame - b.ptsAllowedPerGame);
    const totalDefenses = defenseList.length;

    defenseList.forEach((d, idx) => {
      const rank = idx + 1;
      let tone: MatchupTone = "neutral";
      if (totalDefenses >= 6) {
        if (rank <= Math.ceil(totalDefenses * TOUGH_PERCENTILE)) {
          tone = "tough";
        } else if (rank > Math.floor(totalDefenses * SOFT_PERCENTILE)) {
          tone = "soft";
        }
      } else if (totalDefenses >= 2) {
        if (rank === 1) tone = "tough";
        else if (rank === totalDefenses) tone = "soft";
      }

      let status: "official" | "conditional" | "unavailable" = "official";
      if (d.games === 0) status = "unavailable";
      else if (d.games < 3) status = "conditional";

      const stat: DefensePositionStat = {
        defenseTeam: d.opp,
        pos,
        pointsAllowedTotal: pointsAllowed.get(`${d.opp}/${pos}`) ?? 0,
        gamesPlayed: d.games,
        pointsAllowedPerGame: Math.round(d.ptsAllowedPerGame * 10) / 10,
        leagueAverage: Math.round(leagueAvg * 10) / 10,
        allowedPerGameRaw: d.ptsAllowedPerGame,
        leagueAverageRaw: leagueAvg,
        diff: Math.round(d.diff * 10) / 10,
        rank,
        totalDefenses,
        tone,
        status,
      };

      result.set(`${d.opp}/${pos}`, stat);
    });
  }

  if (throughWeek === undefined) defenseCache.set(m, result);
  return result;
}

// 2.4 Player matchups for current week to final fantasy week
export function playerMatchups(
  m: Model,
  p: Player,
  defenseStats = computeDefenseStats(m),
): PlayerWeeklyMatchup[] {
  const result: PlayerWeeklyMatchup[] = [];
  const schedules = m.dataset.tables.ModelSchedule.filter(
    (s) => str(s.ProTeamID) === p.nflId || str(s.NFLTeam) === p.nfl,
  );

  for (let w = m.current; w <= m.final; w++) {
    const s = schedules.find((row) => num(row.Week) === w);
    const isBye =
      p.bye === w ||
      !s ||
      num(s.HasGame) === 0 ||
      num(s.ByeWeek) === 1;

    if (isBye) {
      result.push({
        week: w,
        opponent: "BYE",
        opponentId: "",
        home: false,
        bye: true,
        diff: null,
        rank: null,
        tone: "neutral",
        text: `Week ${w} · Bye week`,
        shortText: `W${w} · Bye`,
        status: "bye",
      });
      continue;
    }

    const opp = str(s.Opponent || s.OpponentID || "Unknown");
    const home = Boolean(s.Home);
    const statKey = `${opp}/${p.pos}`;
    const stat = defenseStats.get(statKey);

    if (!stat || stat.status === "unavailable") {
      result.push({
        week: w,
        opponent: opp,
        opponentId: str(s.OpponentID || opp),
        home,
        bye: false,
        diff: null,
        rank: null,
        tone: "neutral",
        text: `vs ${opp} · Matchup data unavailable`,
        shortText: `W${w} vs ${opp} · neutral`,
        status: "unavailable",
      });
      continue;
    }

    const diffSigned = `${stat.diff >= 0 ? "+" : ""}${stat.diff.toFixed(1)}`;
    const toneWord =
      stat.tone === "soft"
        ? "Soft"
        : stat.tone === "tough"
          ? "Tough"
          : "Neutral";
    const text = `${toneWord} vs ${p.pos} · ${diffSigned} pts allowed vs avg · ${stat.rank} of ${stat.totalDefenses}`;
    const shortText = `W${w} vs ${opp} · ${stat.tone}`;

    result.push({
      week: w,
      opponent: opp,
      opponentId: str(s.OpponentID || opp),
      home,
      bye: false,
      diff: stat.diff,
      rank: stat.rank,
      tone: stat.tone,
      text,
      shortText,
      status: stat.status,
    });
  }

  return result;
}
