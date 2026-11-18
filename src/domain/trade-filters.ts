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
  surfaceAverage: number | null; surfaceProjection: number | null;
}
type Range = { minimum: number | null; maximum: number | null };
export interface TradeFilters {
  yourGain: Range; theirGain: number; ownWeek: Range; otherWeek: Range;
  receiveStarts: boolean; giveStarts: boolean; gradeGoals: PositionalGradeImpactRule[];
  mustGet: string[]; mustGetRequired: string[]; mustGive: string[]; mustGiveRequired: string[]; exclude: string[];
  giveOnly: boolean; getOnly: boolean; mustGiveStarts: boolean; mustGetStarts: boolean; looksBetter: boolean;
  getPositions: NonNullable<IncomingFilter["positions"]>; givePositions: string[];
  labels: NonNullable<IncomingFilter["signals"]>; teams: string[] | null;
  teamGrade: { position: string; ceiling: string } | null;
  giveSize: Range; getSize: Range;
}
// Fresh defaults avoid sharing mutable filter arrays between screens or saved settings.
// Show all and Reset to defaults keep search-input fields (mustGive, mustGet, exclude, teams, required).
export function defaultTradeFilters(current?: TradeFilters): TradeFilters {
  return {
    yourGain: { minimum: 0, maximum: null },
    theirGain: -2,
    ownWeek: { minimum: null, maximum: null },
    otherWeek: { minimum: null, maximum: null },
    receiveStarts: false,
    giveStarts: false,
    gradeGoals: [],
    mustGet: current ? [...current.mustGet] : [],
    mustGetRequired: current ? [...current.mustGetRequired] : [],
    mustGive: current ? [...current.mustGive] : [],
    mustGiveRequired: current ? [...current.mustGiveRequired] : [],
    giveOnly: current ? current.giveOnly : false,
    getOnly: current ? current.getOnly : false,
    mustGiveStarts: false,
    mustGetStarts: false,
    looksBetter: false,
    exclude: current ? [...current.exclude] : [],
    getPositions: [],
    givePositions: [],
    labels: [],
    teams: current ? (current.teams ? [...current.teams] : null) : null,
    teamGrade: null,
    giveSize: { minimum: 1, maximum: 3 },
    getSize: { minimum: 1, maximum: 3 },
  };
}
// Clearing filters restores the approved gain defaults instead of removing them.
export function clearTradeFilters(current?: TradeFilters): TradeFilters { return defaultTradeFilters(current); }

// Show every trade retained by the asymmetric search floor.
export function showAllTradeFilters(current?: TradeFilters): TradeFilters {
  return { ...defaultTradeFilters(current), yourGain: { minimum: null, maximum: null }, theirGain: -2 };
}

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
export function tradeFilterReasons(
  row: FilterableTrade,
  f: TradeFilters,
  protectedIds: string[] = [],
): string[] {
  const checks: [string, boolean][] = [
    ["yourGain", inRange(row.ownGain, f.yourGain)],
    ["theirGain", inRange(row.otherGain, { minimum: f.theirGain, maximum: null })],
    ["ownWeek", inRange(row.ownWeekGain, f.ownWeek)], ["otherWeek", inRange(row.otherWeekGain, f.otherWeek)],
    ["receiveStarts", !f.receiveStarts || row.get.every((id) => row.ownStarters.includes(id))],
    ["giveStarts", !f.giveStarts || row.give.every((id) => row.otherStarters.includes(id))],
    ["gradeGoals", !f.gradeGoals.length || (!!row.positionImpact && gradeImpactFailures(row.positionImpact, f.gradeGoals).length === 0)],
    ["getPositions", matchesIncoming(row.incomingPlayers, { positions: f.getPositions })],
    ["givePositions", !f.givePositions.length || row.givePositions.some((pos) => f.givePositions.includes(pos))],
    ["labels", matchesIncoming(row.incomingPlayers, { positions: f.getPositions, signals: f.labels })],
    ["teamGrade", !f.teamGrade || gradeAtOrBelow(row.opponentGrades[f.teamGrade.position] ?? "", f.teamGrade.ceiling)],
    ["giveSize", inRange(row.give.length, f.giveSize)], ["getSize", inRange(row.get.length, f.getSize)],
    [
      "mustGive",
      (!f.mustGive.length || row.give.some((id) => f.mustGive.includes(id))) &&
        f.mustGiveRequired.every((id) => row.give.includes(id)) &&
        (!f.giveOnly || row.give.every((id) => f.mustGive.includes(id))),
    ],
    [
      "mustGet",
      (!f.mustGet.length || row.get.some((id) => f.mustGet.includes(id))) &&
        f.mustGetRequired.every((id) => row.get.includes(id)) &&
        (!f.getOnly || row.get.every((id) => f.mustGet.includes(id))),
    ],
    ["exclude", !row.give.some((id) => f.exclude.includes(id)) && !row.get.some((id) => f.exclude.includes(id))],
    ["teams", f.teams === null || f.teams.includes(row.team)],
    ["never", !row.give.some((id) => protectedIds.includes(id))],
    [
      "mustGiveStarts",
      !f.mustGiveStarts ||
        !f.mustGiveRequired.length ||
        f.mustGiveRequired.every((id) => row.otherStarters.includes(id)),
    ],
    [
      "mustGetStarts",
      !f.mustGetStarts ||
        !f.mustGetRequired.length ||
        f.mustGetRequired.every((id) => row.ownStarters.includes(id)),
    ],
    ["looksBetter", !f.looksBetter || (row.surfaceAverage !== null && row.surfaceAverage > 0)],
  ];
  return checks.filter(([, passes]) => !passes).map(([key]) => key);
}

// `counts` has every failing filter of every hidden trade, for explaining a hidden row. `only` counts the trades that one filter
// alone hides: relaxing that filter brings back exactly that many, which is the number shown beside each filter as "hides N".
export function filterTradeRows<T extends FilterableTrade>(
  rows: T[],
  filters: TradeFilters,
  protectedIds: string[] = [],
) {
  const visible: T[] = [], hidden: { row: T; reasons: string[] }[] = [];
  const counts: Record<string, number> = {}, only: Record<string, number> = {};
  for (const row of rows) {
    const reasons = tradeFilterReasons(row, filters, protectedIds);
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
export function sortTradeRows<T extends FilterableTrade>(
  rows: T[],
  sort: "own" | "other" | "week" | "both" | "balance" | "acceptance" | "surface",
): T[] {
  if (sort === "surface") {
    return [...rows].sort((a, b) => {
      const avgA = a.surfaceAverage;
      const avgB = b.surfaceAverage;
      const validA = avgA !== null && Number.isFinite(avgA);
      const validB = avgB !== null && Number.isFinite(avgB);
      if (!validA && !validB) return a.key.localeCompare(b.key);
      if (!validA) return 1;
      if (!validB) return -1;
      if (avgB! !== avgA!) return avgB! - avgA!;

      const projA = a.surfaceProjection;
      const projB = b.surfaceProjection;
      const pValidA = projA !== null && Number.isFinite(projA);
      const pValidB = projB !== null && Number.isFinite(projB);
      if (!pValidA && !pValidB) return a.key.localeCompare(b.key);
      if (!pValidA) return 1;
      if (!pValidB) return -1;
      return projB! - projA! || a.key.localeCompare(b.key);
    });
  }

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

