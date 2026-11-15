import { gradeAtOrBelow, matchesIncoming, type IncomingFilter } from "./trade-search";
import { gradeImpactFailures, type ChainPositionImpact, type PositionalGradeImpactRule } from "./chain-position-impact";
import type { Player } from "./valuation";

// Keep computed evidence separate from filtering so the worker can reuse evaluated results without a new search.
export interface FilterableTrade {
  key: string; team: string; give: string[]; get: string[];
  ownGain: number | null; otherGain: number | null;
  ownWeekGain: number | null; otherWeekGain: number | null;
  ownStarters: string[]; otherStarters: string[];
  givePositions: string[]; incomingPlayers: Pick<Player, "pos" | "gem">[];
  opponentGrades: Record<string, string>; positionImpact?: ChainPositionImpact;
  acceptance?: number | null; valueBalance?: number | null;
}
type Range = { minimum: number | null; maximum: number | null };
export interface TradeFilters {
  yourGain: Range; theirGain: number; ownWeek: Range; otherWeek: Range;
  receiveStarts: boolean; giveStarts: boolean; gradeGoals: PositionalGradeImpactRule[];
  mustGet: string[]; mustGive: string[]; exclude: string[];
  getPositions: NonNullable<IncomingFilter["positions"]>; givePositions: string[];
  labels: NonNullable<IncomingFilter["signals"]>; teams: string[] | null;
  teamGrade: { position: string; ceiling: string } | null;
  giveSize: Range; getSize: Range;
}
// Fresh defaults avoid sharing mutable filter arrays between screens or saved settings.
export function defaultTradeFilters(): TradeFilters {
  return { yourGain: { minimum: 0, maximum: null }, theirGain: 1,
    ownWeek: { minimum: null, maximum: null }, otherWeek: { minimum: null, maximum: null },
    receiveStarts: false, giveStarts: false, gradeGoals: [],
    mustGet: [], mustGive: [], exclude: [], getPositions: [], givePositions: [], labels: [], teams: null,
    teamGrade: null, giveSize: { minimum: 1, maximum: 3 }, getSize: { minimum: 1, maximum: 3 } };
}
// Clearing filters restores the approved gain defaults instead of removing them.
export function clearTradeFilters(): TradeFilters { return defaultTradeFilters(); }

// Keep typed and slider values in the same approved recipient-gain range and step size.
export function clampTheirGain(value: number) {
  return Number.isFinite(value) ? Math.max(-2, Math.min(1, Math.round(value * 2) / 2)) : 1;
}

// Bounds are inclusive; missing numeric evidence never satisfies an active bound.
function inRange(value: number | null, range: Range): boolean {
  if (range.minimum === null && range.maximum === null) return true;
  return value !== null && Number.isFinite(value) &&
    (range.minimum === null || value >= range.minimum) &&
    (range.maximum === null || value <= range.maximum);
}

// Return every failing category so hidden rows and independent hide counts remain explainable.
export function tradeFilterReasons(row: FilterableTrade, f: TradeFilters): string[] {
  const checks: [string, boolean][] = [
    ["yourGain", inRange(row.ownGain, f.yourGain)],
    ["theirGain", inRange(row.otherGain, { minimum: f.theirGain, maximum: null })],
    ["ownWeek", inRange(row.ownWeekGain, f.ownWeek)], ["otherWeek", inRange(row.otherWeekGain, f.otherWeek)],
    ["receiveStarts", !f.receiveStarts || row.get.every((id) => row.ownStarters.includes(id))],
    ["giveStarts", !f.giveStarts || row.give.every((id) => row.otherStarters.includes(id))],
    ["gradeGoals", !f.gradeGoals.length || (!!row.positionImpact && gradeImpactFailures(row.positionImpact, f.gradeGoals).length === 0)],
    ["mustGet", f.mustGet.every((id) => row.get.includes(id))], ["mustGive", f.mustGive.every((id) => row.give.includes(id))],
    ["exclude", f.exclude.every((id) => !row.give.includes(id) && !row.get.includes(id))],
    ["getPositions", matchesIncoming(row.incomingPlayers, { positions: f.getPositions })],
    ["givePositions", !f.givePositions.length || row.givePositions.some((pos) => f.givePositions.includes(pos))],
    ["labels", matchesIncoming(row.incomingPlayers, { positions: f.getPositions, signals: f.labels })],
    ["teams", f.teams === null || f.teams.includes(row.team)],
    ["teamGrade", !f.teamGrade || gradeAtOrBelow(row.opponentGrades[f.teamGrade.position] ?? "", f.teamGrade.ceiling)],
    ["giveSize", inRange(row.give.length, f.giveSize)], ["getSize", inRange(row.get.length, f.getSize)],
  ];
  return checks.filter(([, passes]) => !passes).map(([key]) => key);
}

// `counts` has every failing filter of every hidden trade, for explaining a hidden row. `only` counts the trades that one filter
// alone hides: relaxing that filter brings back exactly that many, which is the number shown beside each filter as "hides N".
export function filterTradeRows<T extends FilterableTrade>(rows: T[], filters: TradeFilters) {
  const visible: T[] = [], hidden: { row: T; reasons: string[] }[] = [];
  const counts: Record<string, number> = {}, only: Record<string, number> = {};
  for (const row of rows) {
    const reasons = tradeFilterReasons(row, filters);
    if (!reasons.length) visible.push(row);
    else {
      hidden.push({ row, reasons });
      for (const reason of reasons) counts[reason] = (counts[reason] ?? 0) + 1;
      if (reasons.length === 1) only[reasons[0]] = (only[reasons[0]] ?? 0) + 1;
    }
  }
  return { visible, hidden, counts, only };
}

// Sorting is presentation-only; missing estimates are always last and no result is removed.
export function sortTradeRows<T extends FilterableTrade>(rows: T[], sort: "own" | "other" | "week" | "both" | "balance" | "acceptance"): T[] {
  const value = (row: T): number | null | undefined => {
    if (sort === "own") return row.ownGain;
    if (sort === "other") return row.otherGain;
    if (sort === "week") return row.ownWeekGain;
    if (sort === "both") return row.ownGain === null || row.otherGain === null ? null : Math.min(row.ownGain, row.otherGain);
    if (sort === "balance") return row.valueBalance;
    return row.acceptance;
  };
  return [...rows].sort((a, b) => {
    const first = value(a), second = value(b);
    if (first == null || !Number.isFinite(first)) return second == null || !Number.isFinite(second) ? a.key.localeCompare(b.key) : 1;
    if (second == null || !Number.isFinite(second)) return -1;
    return second - first || a.key.localeCompare(b.key);
  });
}

