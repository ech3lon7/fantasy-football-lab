import type { TradeResult } from "./trades";

// Persist the analysis preference separately from forecasts and the live/hypothetical availability policy.
export const lineupBasisKey = "tradeLineupBasis";
export const lineupBases = ["best-available", "marked-starters"] as const;
export type LineupBasis = (typeof lineupBases)[number];
export const lineupScoringVersion = "lineup-basis-1";
export const readLineupBasis = (raw?: string): LineupBasis =>
  raw === "marked-starters" ? raw : "best-available";
export const lineupBasisLabel = (basis?: LineupBasis) =>
  basis === "marked-starters" ? "Marked starters" : "Best available lineup";

// Select existing evaluator outputs only; the same summary supplies filters, primary cards, diagnostics and saved trades.
export function tradeImpact(result: TradeResult, basis?: LineupBasis) {
  if (!result.valid) return null;
  const selected = readLineupBasis(basis);
  const side = (impact: typeof result.directA) => {
    const usable =
      !impact.errors.length &&
      impact.weekly.length > 0 &&
      impact.weekly.every(
        (w) =>
          w.beforeExpected !== null &&
          w.afterExpected !== null &&
          Number.isFinite(w.beforeExpected) &&
          Number.isFinite(w.afterExpected),
      );
    const average = (key: "beforeExpected" | "afterExpected") =>
      usable
        ? impact.weekly.reduce((total, week) => total + week[key]!, 0) /
          impact.weekly.length
        : null;
    return {
      ...impact,
      beforePerWeek: average("beforeExpected"),
      afterPerWeek: average("afterExpected"),
      expectedPerWeek: usable ? impact.expectedPerWeek : null,
      expected: usable ? impact.expected : null,
    };
  };
  return {
    basis: selected,
    own: side(
      selected === "marked-starters" ? result.directA : result.potentialA,
    ),
    other: side(
      selected === "marked-starters" ? result.directB : result.potentialB,
    ),
  };
}
