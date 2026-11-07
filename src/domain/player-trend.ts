import { num, type Row } from "./contracts";

// Represents a single week's data point containing actual scoring and dual moving averages
export interface PlayerTrendPoint {
  week: number;
  points: number;
  fastMA: number;
  slowMA: number;
  volume: number;
}

// Directional state of the player trend relative to moving average baseline
export type TrendStatus = "bullish" | "bearish" | "neutral";
export type TrendTone = "good" | "bad" | "orange" | "neutral";

// Summary assessment of the player's momentum and volume confirmation
export interface PlayerTrendSummary {
  series: PlayerTrendPoint[];
  latest: {
    week: number;
    points: number;
    fastMA: number;
    slowMA: number;
    spread: number;
    status: TrendStatus;
    confirmed: boolean;
    tone: TrendTone;
    label: string;
    badge: string;
    goldenCross: boolean;
    deathCross: boolean;
  } | null;
}

// Check whether a player's trend exhibits a newly formed golden cross (fast MA crossed above slow MA in latest game)
export function isGoldenCross(
  trend: PlayerTrendSummary | null | undefined,
): boolean {
  return trend?.latest?.goldenCross ?? false;
}

// Check whether a player's trend exhibits a newly formed death cross (fast MA crossed below slow MA in latest game)
export function isDeathCross(
  trend: PlayerTrendSummary | null | undefined,
): boolean {
  return trend?.latest?.deathCross ?? false;
}

// Calculates dual weighted moving averages (2-game Fast WMA vs 5-game Slow WMA) and trend momentum
export function calculatePlayerTrend(
  history: Row[],
  pos: string,
  projectedPPG?: number | null,
): PlayerTrendSummary {
  // Filter history to valid played games with recorded scores, ordered chronologically by week
  const validGames = history
    .filter(
      (r) =>
        r.HistoryStatus === "Valid" &&
        num(r.Games) > 0 &&
        r.Points !== null &&
        r.Points !== undefined,
    )
    .sort((a, b) => num(a.Week) - num(b.Week));

  if (validGames.length === 0) {
    return { series: [], latest: null };
  }

  const series: PlayerTrendPoint[] = [];

  // Iterate chronologically through played games to calculate Fast (2-game) and Slow (5-game) WMAs
  for (let i = 0; i < validGames.length; i++) {
    const row = validGames[i];
    const week = num(row.Week);
    const points = num(row.Points);

    // Measure opportunities: pass attempts for QBs; carries plus targets for skill positions
    const volume =
      pos === "QB"
        ? num(row.PassAttempts)
        : num(row.RushAttempts) + num(row.Targets);

    // Fast 2-game WMA: weights [1, 2] giving 66.7% weight to the latest game
    let fastMA = points;
    if (i >= 1) {
      const prevPoints = num(validGames[i - 1].Points);
      fastMA = (1 * prevPoints + 2 * points) / 3;
    }

    // Slow 5-game WMA: weights [1, 2, 3, 4, 5] across trailing games, anchored by projection if early
    const availablePoints: number[] = [];
    const count = Math.min(i + 1, 5);
    for (let k = 0; k < count; k++) {
      availablePoints.unshift(num(validGames[i - k].Points));
    }

    let slowMA: number;
    if (count === 5) {
      // Full 5-game window
      const weightedSum =
        1 * availablePoints[0] +
        2 * availablePoints[1] +
        3 * availablePoints[2] +
        4 * availablePoints[3] +
        5 * availablePoints[4];
      slowMA = weightedSum / 15;
    } else if (
      projectedPPG !== null &&
      projectedPPG !== undefined &&
      Number.isFinite(projectedPPG)
    ) {
      // Early-season anchoring: pad missing games with the baseline projected PPG
      const missingCount = 5 - count;
      const fullPoints: number[] = [
        ...Array(missingCount).fill(projectedPPG),
        ...availablePoints,
      ];
      const weightedSum =
        1 * fullPoints[0] +
        2 * fullPoints[1] +
        3 * fullPoints[2] +
        4 * fullPoints[3] +
        5 * fullPoints[4];
      slowMA = weightedSum / 15;
    } else {
      // Standard linear weighting over available games when projection is absent
      let weightedSum = 0;
      let totalWeight = 0;
      for (let j = 0; j < count; j++) {
        const weight = j + 1;
        weightedSum += weight * availablePoints[j];
        totalWeight += weight;
      }
      slowMA = totalWeight > 0 ? weightedSum / totalWeight : points;
    }

    // Round values cleanly to two decimal places
    series.push({
      week,
      points: Math.round(points * 100) / 100,
      fastMA: Math.round(fastMA * 100) / 100,
      slowMA: Math.round(slowMA * 100) / 100,
      volume: Math.round(volume * 100) / 100,
    });
  }

  // Derive latest momentum assessment from the most recent game
  const latestPoint = series[series.length - 1];
  const spread = Math.round((latestPoint.fastMA - latestPoint.slowMA) * 100) / 100;

  // Determine baseline volume benchmark by position to confirm true breakout roles vs flukes
  const volumeBaseline =
    pos === "QB" ? 25 : pos === "RB" ? 10 : pos === "WR" || pos === "TE" ? 5 : 5;
  const isVolumeConfirmed = latestPoint.volume >= volumeBaseline;

  let status: TrendStatus = "neutral";
  let tone: TrendTone = "neutral";
  let label = `Consolidating (${spread >= 0 ? "+" : ""}${spread.toFixed(2)} MA)`;
  let badge = `⚖️ ${spread >= 0 ? "+" : ""}${spread.toFixed(1)} MA`;

  if (spread >= 1.5) {
    status = "bullish";
    if (isVolumeConfirmed) {
      tone = "good";
      label = `Bullish (+${spread.toFixed(2)} MA) · Volume Confirmed`;
      badge = `📈 +${spread.toFixed(1)} MA`;
    } else {
      tone = "orange";
      label = `Efficiency Spike (+${spread.toFixed(2)} MA · Low Volume)`;
      badge = `⚡ +${spread.toFixed(1)} MA`;
    }
  } else if (spread <= -1.5) {
    status = "bearish";
    tone = "bad";
    label = `Bearish (${spread.toFixed(2)} MA)`;
    badge = `📉 ${spread.toFixed(1)} MA`;
  }

  // Detect newly formed bullish MA crossover (golden cross):
  // Fast MA was <= Slow MA in the prior game and crossed above (> Slow MA) in the latest game
  let goldenCross = false;
  let deathCross = false;
  if (series.length >= 2) {
    const prevPoint = series[series.length - 2];
    goldenCross =
      prevPoint.fastMA <= prevPoint.slowMA &&
      latestPoint.fastMA > latestPoint.slowMA;
    deathCross =
      prevPoint.fastMA >= prevPoint.slowMA &&
      latestPoint.fastMA < latestPoint.slowMA;
  }

  return {
    series,
    latest: {
      week: latestPoint.week,
      points: latestPoint.points,
      fastMA: latestPoint.fastMA,
      slowMA: latestPoint.slowMA,
      spread,
      status,
      confirmed: isVolumeConfirmed,
      tone,
      label,
      badge,
      goldenCross,
      deathCross,
    },
  };
}

// Standard positional league average weekly opportunities
export const DEFAULT_LEAGUE_AVG_VOLUME: Record<string, number> = {
  QB: 32.5, // Pass attempts
  RB: 14.0, // Touches (carries + targets)
  WR: 6.8,  // Targets
  TE: 4.6,  // Targets
  K: 0,
  "D/ST": 0,
};

// Calculates league average opportunities for a given position from historical games
export function calculateLeagueAverageVolume(
  history: Row[],
  players: Row[],
  pos: string,
): number {
  const positionPlayers = new Set(
    players
      .filter((p) => String(p.Position) === pos)
      .map((p) => String(p.PlayerID)),
  );
  if (positionPlayers.size === 0) {
    return DEFAULT_LEAGUE_AVG_VOLUME[pos] ?? 5.0;
  }
  let total = 0;
  let games = 0;
  for (const h of history) {
    if (
      h.HistoryStatus === "Valid" &&
      num(h.Games) > 0 &&
      positionPlayers.has(String(h.PlayerID))
    ) {
      const vol =
        pos === "QB"
          ? num(h.PassAttempts)
          : num(h.RushAttempts) + num(h.Targets);
      if (vol > 0) {
        total += vol;
        games++;
      }
    }
  }
  if (games >= 5) {
    return Math.round((total / games) * 10) / 10;
  }
  return DEFAULT_LEAGUE_AVG_VOLUME[pos] ?? 5.0;
}

// Benchmark target volume threshold and display label by position
export interface VolumeBenchmark {
  value: number;
  label: string;
}

export const TARGET_VOLUME_BENCHMARKS: Record<string, VolumeBenchmark> = {
  RB: { value: 18, label: "18 Touches" },
  WR: { value: 7, label: "7 Targets" },
  TE: { value: 6, label: "6 Targets" },
  QB: { value: 35, label: "35 Pass Att." },
};

// Returns the position-specific target volume benchmark or null if not applicable
export function getTargetVolumeBenchmark(pos: string): VolumeBenchmark | null {
  return TARGET_VOLUME_BENCHMARKS[pos] ?? null;
}

