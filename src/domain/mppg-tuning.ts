import { z } from "zod";
import { num, str } from "./contracts";
import type { Model } from "./valuation";
import { playedHistory } from "./opportunity";
import { computeDefenseStats } from "./matchups";

export const mppgSnapshotsKey = "mppg_weekly_snapshots";

export const mppgSnapshotItemSchema = z.object({
  playerId: z.string(),
  week: z.number(),
  espnWeekly: z.number(),
  importedAt: z.string(),
});

export const mppgSnapshotsStateSchema = z.object({
  snapshots: z.array(mppgSnapshotItemSchema),
});

export type MppgSnapshotItem = z.infer<typeof mppgSnapshotItemSchema>;
export type MppgSnapshotsState = z.infer<typeof mppgSnapshotsStateSchema>;

export function readMppgSnapshots(raw: string | undefined): MppgSnapshotsState {
  if (!raw) return { snapshots: [] };
  try {
    const parsed = JSON.parse(raw);
    const valid = mppgSnapshotsStateSchema.safeParse(parsed);
    return valid.success ? valid.data : { snapshots: [] };
  } catch {
    return { snapshots: [] };
  }
}

export function writeMppgSnapshots(state: MppgSnapshotsState): string {
  return JSON.stringify(state);
}

// 4.1 Record snapshot of current week's ESPN weekly projections on import
export function recordMppgSnapshot(
  m: Model,
  rawExisting: string | undefined,
): string {
  const existing = readMppgSnapshots(rawExisting);
  const week = m.current;
  const importedAt = m.dataset.sourceUTC ?? new Date().toISOString();

  // Filter out any existing snapshot for the current week to replace it with fresh data
  const kept = existing.snapshots.filter((s) => s.week !== week);

  for (const p of m.players) {
    if (p.weekly !== null && Number.isFinite(p.weekly)) {
      kept.push({
        playerId: p.id,
        week,
        espnWeekly: p.weekly,
        importedAt,
      });
    }
  }

  return writeMppgSnapshots({ snapshots: kept });
}

export interface WeightComparisonResult {
  completedWeeksCount: number;
  ready: boolean;
  message: string;
  results?: {
    weight: number;
    label: string;
    meanAbsoluteError: number;
    pairPickAccuracy: number | null;
  }[];
  suggestedWeight?: number;
}

// 4.2 Weekly check comparing snapshots with actual points for completed weeks
export function evaluateMppgWeights(
  m: Model,
  rawSnapshots: string | undefined,
): WeightComparisonResult {
  const { snapshots } = readMppgSnapshots(rawSnapshots);
  const distinctWeeks = Array.from(new Set(snapshots.map((s) => s.week))).filter(
    (w) => w < m.current, // Only completed past weeks
  );

  if (distinctWeeks.length < 4) {
    return {
      completedWeeksCount: distinctWeeks.length,
      ready: false,
      message: `At least 4 completed weeks with snapshots are required (currently ${distinctWeeks.length}).`,
    };
  }

  // Compare actual played points from history
  const history = m.dataset.tables.ModelHistory;
  const actuals = new Map<string, number>(); // `${playerId}/${week}` -> actual points
  for (const h of history) {
    actuals.set(`${str(h.PlayerID)}/${num(h.Week)}`, num(h.Points));
  }

  const weights = [0, 0.25, 0.5, 0.75];
  const stats = weights.map((w) => {
    let errorSum = 0;
    let count = 0;
    const pairs: PairForecast[] = [];

    for (const snap of snapshots) {
      if (snap.week >= m.current) continue;
      const actual = actuals.get(`${snap.playerId}/${snap.week}`);
      if (actual === undefined) continue;

      const p = m.byId.get(snap.playerId);
      const eppg = p?.blendedExpected ?? snap.espnWeekly;
      const season = p?.projected ?? snap.espnWeekly;
      const mppgVal = Math.max(0, snap.espnWeekly + w * (eppg - season));

      errorSum += Math.abs(mppgVal - actual);
      count++;
      if (p) pairs.push({ week: snap.week, position: p.pos, predicted: mppgVal, actual });
    }

    const mae = count > 0 ? Math.round((errorSum / count) * 100) / 100 : 0;
    return {
      weight: w,
      label: w === 0 ? "ESPN weekly alone (0.0)" : `Weight ${w}`,
      meanAbsoluteError: mae,
      pairPickAccuracy: pairAccuracy(pairs),
    };
  });

  // Suggest lowest MAE weight
  const best = [...stats].sort(
    (a, b) => a.meanAbsoluteError - b.meanAbsoluteError,
  )[0];

  return {
    completedWeeksCount: distinctWeeks.length,
    ready: true,
    message: `Comparison across ${distinctWeeks.length} completed weeks. Suggested weight: ${best.weight}.`,
    results: stats,
    suggestedWeight: best.weight,
  };
}

export interface PairForecast { week: number; position: string; predicted: number; actual: number }

// Score only comparable same-week, same-position pairs with distinct predictions and outcomes.
export function pairAccuracy(rows: PairForecast[]): number | null {
  let correct = 0, count = 0;
  const groups = new Map<string, PairForecast[]>();
  for (const row of rows) { const key = `${row.week}/${row.position}`; const group = groups.get(key) ?? []; group.push(row); groups.set(key, group); }
  for (const group of groups.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const a = group[i], b = group[j];
    if (a.predicted === b.predicted || a.actual === b.actual) continue;
    count++; if ((a.predicted - b.predicted) * (a.actual - b.actual) > 0) correct++;
  }
  return count ? correct / count : null;
}

export interface MatchupBacktest {
  ready: boolean; message: string; weeks: number; playerWeeks: number;
  results: { label: string; averageMiss: number; hitRate: number | null; best: boolean }[];
}

// Backtest each historical week using only earlier scoring and earlier defense records.
export function backtestMatchup(m: Model): MatchupBacktest {
  const histories = playedHistory(m.dataset);
  const records: { week: number; pos: string; actual: number; baseline: number; raw: number | null; games: number }[] = [];
  const weeks = new Set<number>();
  for (let week = 4; week < m.current; week++) {
    const stats = computeDefenseStats(m, week);
    for (const player of m.players) {
      const history = histories.get(player.id) ?? [];
      const before = history.filter((h) => num(h.Week) < week);
      const actual = history.find((h) => num(h.Week) === week);
      if (!actual || before.length < 2) continue;
      const schedule = m.dataset.tables.ModelSchedule.find((s) => num(s.Week) === week && (str(s.ProTeamID) === player.nflId || str(s.NFLTeam) === player.nfl));
      const opponent = schedule ? str(schedule.Opponent || schedule.OpponentID || "") : "";
      const defense = stats.get(`${opponent}/${player.pos}`);
      const raw = defense && defense.gamesPlayed > 0 && defense.leagueAverageRaw > 0 ? defense.allowedPerGameRaw / defense.leagueAverageRaw - 1 : null;
      records.push({ week, pos: player.pos, actual: num(actual.Points), baseline: before.reduce((sum, h) => sum + num(h.Points), 0) / before.length, raw, games: defense?.gamesPlayed ?? 0 });
      weeks.add(week);
    }
  }
  if (weeks.size < 3) return { ready: false, message: `At least 3 qualifying weeks are required (currently ${weeks.size}).`, weeks: weeks.size, playerWeeks: records.length, results: [] };
  const variants = ["No matchup", "Approved", "Cautious", "Uncapped", "Half strength"];
  const results = variants.map((label) => {
    const forecasts = records.map((r): PairForecast => {
      const reliability = r.games <= 3 ? 0.5 : 1;
      const raw = r.raw ?? 0;
      const adjusted = label === "No matchup" ? 0 : label === "Cautious" ? Math.max(-0.25, Math.min(0.25, raw * r.games / (r.games + 8))) : label === "Uncapped" ? raw * reliability : Math.max(-0.5, Math.min(0.5, raw * reliability)) * (label === "Half strength" ? 0.5 : 1);
      return { week: r.week, position: r.pos, predicted: Math.max(0, Math.round(r.baseline * (1 + adjusted) * 10) / 10), actual: r.actual };
    });
    return { label, averageMiss: forecasts.reduce((sum, f) => sum + Math.abs(f.predicted - f.actual), 0) / forecasts.length, hitRate: pairAccuracy(forecasts), best: false };
  });
  const best = Math.min(...results.map((result) => result.averageMiss));
  for (const result of results) result.best = result.averageMiss === best;
  return { ready: true, message: "", weeks: weeks.size, playerWeeks: records.length, results };
}
