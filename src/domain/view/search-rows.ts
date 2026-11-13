import type { Model } from "../valuation";
import type { Draft } from "../contracts";
import { str } from "../contracts";
import { evaluateTrade } from "../trades";
import { tradeImpact, type LineupBasis } from "../trade-impact";
import type { SearchRow } from "../trade-search";
import {
  gradeStepChips,
  lineupGainSpread,
  type GainSpread,
  type GradeChip,
} from "./trade-room";

// Price status of a search result: every price test passed, a price warning, or a result found only after widening the limits.
export type PriceStatusKind = "pass" | "warning" | "widened";

export interface PriceStatus {
  kind: PriceStatusKind;
  label: string;
  // The reason in words: which test warned, or which limit moved and by how much.
  detail: string;
}

export const priceStatusLabels: Record<PriceStatusKind, string> = {
  pass: "Passes every price test",
  warning: "Price warning",
  widened: "Widened search",
};

// Rank used to order results: passes first, then warnings, then widened. Price tests never hide a result.
export const priceStatusRank: Record<PriceStatusKind, number> = {
  pass: 0,
  warning: 1,
  widened: 2,
};

// Classify one row from its recorded surplus and points tests; a widened round overrides, naming what moved.
export function priceStatus(
  row: Pick<SearchRow, "surplus" | "points">,
  widened: string[] = [],
): PriceStatus {
  if (widened.length)
    return {
      kind: "widened",
      label: priceStatusLabels.widened,
      detail: widened.join("; "),
    };
  const failed = [
    row.surplus === "PASS" ? null : `Surplus test: ${row.surplus}`,
    row.points === "PASS" ? null : `Points test: ${row.points}`,
  ].filter((x): x is string => !!x);
  return failed.length
    ? { kind: "warning", label: priceStatusLabels.warning, detail: failed.join("; ") }
    : { kind: "pass", label: priceStatusLabels.pass, detail: "" };
}

export interface ResultRowView {
  key: string;
  give: string[];
  get: string[];
  teamName: string;
  // Grade-step chips for the positions this trade moves; nothing for unaffected or ungraded positions.
  ownChips: GradeChip[];
  otherChips: GradeChip[];
  // Your lineup gain per week with its range; null parts stay null and are never shown as zero.
  gain: GainSpread;
  // The deal grade the evaluator already produced for this package.
  surplus: string;
  status: PriceStatus;
  legal: boolean | null;
}

const noGain = (reason: string): GainSpread => ({
  gain: null,
  spread: null,
  floor: null,
  ceiling: null,
  players: [],
  sharesNflTeam: false,
  reason,
});

// Build the view of one search row with the same domain functions the Manual analyzer uses, so the numbers agree everywhere.
export function resultRowView(
  m: Model,
  row: SearchRow,
  context: { teamA: string; give: string[]; basis: LineupBasis; lineupsRaw?: string },
  widened: string[] = [],
): ResultRowView {
  const give = row.give ?? context.give;
  const draft: Draft = { teamA: context.teamA, teamB: row.teamB, give, get: row.get };
  const teamName =
    str(m.dataset.tables.ModelTeams.find((t) => str(t.TeamID) === row.teamB)?.TeamName) ||
    row.teamB;
  const base = {
    key: row.key,
    give,
    get: row.get,
    teamName,
    surplus: row.grade,
    status: priceStatus(row, widened),
    legal: row.legal,
  };
  const result = evaluateTrade(m, draft, true, context.lineupsRaw);
  if (!result.valid)
    return {
      ...base,
      ownChips: [],
      otherChips: [],
      gain: noGain(result.errors.join(" ")),
    };
  const impact = tradeImpact(result, context.basis);
  const chips = gradeStepChips(m, draft, result);
  return {
    ...base,
    ownChips: chips.own,
    otherChips: chips.other,
    gain: impact
      ? lineupGainSpread(m, impact.own, impact.own.expectedPerWeek)
      : noGain("The lineup gain cannot be scored."),
  };
}

// Order rows by price status, then by your lineup gain (unscored gains last); stable for equal keys.
export function orderResultRows(rows: ResultRowView[]): ResultRowView[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        priceStatusRank[a.r.status.kind] - priceStatusRank[b.r.status.kind] ||
        (b.r.gain.gain ?? -Infinity) - (a.r.gain.gain ?? -Infinity) ||
        a.i - b.i,
    )
    .map((x) => x.r);
}

// "24 trades meet every goal · 96 combinations examined across 3 teams"; only real counts are used.
export function resultSummary(
  shown: number,
  stats: { checked: number; teams: number } | undefined,
): string {
  const trades = `${shown} ${shown === 1 ? "trade meets" : "trades meet"} every goal`;
  return stats
    ? `${trades} · ${stats.checked.toLocaleString()} combinations examined across ${stats.teams} ${stats.teams === 1 ? "team" : "teams"}`
    : trades;
}
