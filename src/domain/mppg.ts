import { num, str } from "./contracts";
import type { Model, Player } from "./valuation";
import { nextRefreshDefaults } from "./next-refresh";

export const MPPG_EDGE_WEIGHT = 0.5;

export const MPPG_METHOD_NOTE =
  "MPPG starts from ESPN's projection for this week, which already reflects the opponent, injuries and game lines, and adds half of the difference between your Expected PPG and ESPN's season projection. It exists only for the imported week and only picks weekly starters; trades and grades use season Expected PPG. The matchup chip is shown for context and does not change the number.";

export interface MppgResult {
  value: number | null;
  spread: number | null;
  floor: number | null;
  ceiling: number | null;
  espnWeek: number | null;
  edge: number | null;
  eppg: number | null;
  espnSeason: number | null;
  source: "blend" | "espn-only" | "unavailable";
  reason: string;
  importedAt: string | null;
  buildLine: string;
}

// Compute MPPG for player p in the current imported week of model m.
export function calculateMppg(
  m: Model,
  p: Player,
  targetWeek: number = m.current,
): MppgResult {
  const importedAt = m.dataset.sourceUTC ?? null;

  // 1. Future or past weeks outside the current imported week: null
  if (targetWeek !== m.current) {
    return {
      value: null,
      spread: null,
      floor: null,
      ceiling: null,
      espnWeek: null,
      edge: null,
      eppg: p.blendedExpected ?? null,
      espnSeason: p.projected ?? null,
      source: "unavailable",
      reason: `MPPG is available only for the imported week (Week ${m.current})`,
      importedAt,
      buildLine: "",
    };
  }

  // 2. Availability: Bye week check
  const scheduled = m.dataset.tables.ModelSchedule.find(
    (r) => str(r.ProTeamID) === p.nflId && num(r.Week) === targetWeek,
  );
  const isBye =
    p.bye === targetWeek ||
    (scheduled !== undefined &&
      (num(scheduled.HasGame) === 0 || num(scheduled.ByeWeek) === 1));

  if (isBye) {
    return {
      value: null,
      spread: null,
      floor: null,
      ceiling: null,
      espnWeek: null,
      edge: null,
      eppg: p.blendedExpected ?? null,
      espnSeason: p.projected ?? null,
      source: "unavailable",
      reason: "Bye week",
      importedAt,
      buildLine: "",
    };
  }

  // Availability: Injury OUT / IR / Suspension check
  const injuryUpper = (p.injury || "").toUpperCase();
  const isOut =
    p.out ||
    [
      "OUT",
      "INJURY_RESERVE",
      "IR",
      "SUSPENSION",
      "SUSPENDED",
      "SSPD",
      "SUSP",
    ].includes(injuryUpper);

  if (isOut) {
    return {
      value: null,
      spread: null,
      floor: null,
      ceiling: null,
      espnWeek: null,
      edge: null,
      eppg: p.blendedExpected ?? null,
      espnSeason: p.projected ?? null,
      source: "unavailable",
      reason: "Out",
      importedAt,
      buildLine: "",
    };
  }

  // 3. ESPN weekly projection check
  const espnWeekly = p.weekly;
  if (
    espnWeekly === null ||
    espnWeekly === undefined ||
    !Number.isFinite(espnWeekly)
  ) {
    return {
      value: null,
      spread: null,
      floor: null,
      ceiling: null,
      espnWeek: null,
      edge: null,
      eppg: p.blendedExpected ?? null,
      espnSeason: p.projected ?? null,
      source: "unavailable",
      reason: "No ESPN weekly projection",
      importedAt,
      buildLine: "",
    };
  }

  // 4. Model edge calculation
  const eppg = p.blendedExpected;
  const espnSeason = p.projected;

  let edge: number | null = null;
  let source: "blend" | "espn-only" = "blend";
  let reason = "";

  if (
    eppg === null ||
    eppg === undefined ||
    !Number.isFinite(eppg) ||
    espnSeason === null ||
    espnSeason === undefined ||
    !Number.isFinite(espnSeason)
  ) {
    source = "espn-only";
    reason = "ESPN weekly alone (EPPG or season projection unavailable)";
  } else {
    edge = MPPG_EDGE_WEIGHT * (eppg - espnSeason);
  }

  const rawMppg = edge !== null ? espnWeekly + edge : espnWeekly;
  const value = Math.max(0, Math.round(rawMppg * 10) / 10);

  // 5. Spread from nextRefreshDefaults (blended empirical/prior spread)
  const refreshDefaults = nextRefreshDefaults(m, p);
  const spread =
    refreshDefaults.spread !== null
      ? Math.round(refreshDefaults.spread * 10) / 10
      : null;
  const floor = spread !== null ? Math.max(0, Math.round((value - spread) * 10) / 10) : null;
  const ceiling = spread !== null ? Math.round((value + spread) * 10) / 10 : null;

  // 6. Build line explanation string
  // Format: "ESPN week 11.4 − ½ × 0.3 (EPPG 8.7 vs ESPN season 9.0)"
  let buildLine = `ESPN week ${espnWeekly.toFixed(1)}`;
  if (source === "blend" && eppg !== null && espnSeason !== null && edge !== null) {
    const gap = Math.abs(eppg - espnSeason);
    const sign = edge >= 0 ? "+" : "−";
    buildLine = `ESPN week ${espnWeekly.toFixed(1)} ${sign} ½ × ${gap.toFixed(1)} (EPPG ${eppg.toFixed(1)} vs ESPN season ${espnSeason.toFixed(1)})`;
  }

  return {
    value,
    spread,
    floor,
    ceiling,
    espnWeek: espnWeekly,
    edge,
    eppg: eppg ?? null,
    espnSeason: espnSeason ?? null,
    source,
    reason,
    importedAt,
    buildLine,
  };
}
