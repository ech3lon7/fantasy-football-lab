import { clampTheirGain, defaultTradeFilters } from "./trade-filters";
import type { TradeSearchQuery } from "./trade-search";
import type { ChainStep } from "./trade-chains";
import type { PositionalGradeImpactRule } from "./chain-position-impact";

// Preserve supported saved criteria and identify settings that no longer affect broad discovery.
export function migrateLegacyTradeQuery(query: TradeSearchQuery) {
  const filters = defaultTradeFilters(), ignored: string[] = [];
  filters.mustGive = [...query.give];
  if (query.weekly?.own) filters.yourGain = { ...query.weekly.own };
  if (query.weekly?.other?.minimum != null) filters.theirGain = clampTheirGain(query.weekly.other.minimum);
  if (query.weekly?.other?.maximum != null) ignored.push("their maximum gain");
  filters.getPositions = query.incoming?.positions ?? [];
  filters.labels = query.incoming?.signals ?? [];
  filters.gradeGoals = query.gradeImpacts ?? [];
  if (query.discovery?.teams) filters.teams = [...query.discovery.teams];
  if (query.discovery?.target) filters.mustGet = [query.discovery.target];
  if (query.indexMode === "strict") ignored.push("index window");
  if (query.goal && query.goal !== "explore") ignored.push("goal");
  if (query.manager || query.surface) ignored.push("surface trading");
  if (query.upgrade || query.usefulness || query.deficitProtection) ignored.push("old roster-fit settings");
  if (query.discovery?.ranking) ignored.push("ranking");
  return { filters, ignored };
}

// Represent each old team-specific limit as an affected-position goal with the same threshold.
export function migrateLegacyChainStep(step: ChainStep) {
  const next = { ...step }, ignored: string[] = [];
  if (next.gradeLimit) {
    const { side, maximumDrop } = next.gradeLimit;
    const sides = side === "both" ? ["own", "other"] as const : [side];
    const rules: PositionalGradeImpactRule[] = sides.map((team) => ({ id: `legacy-drop-${team}`, side: team,
      position: "AFFECTED", type: "drop_limit", steps: -maximumDrop }));
    next.gradeImpacts = [...(next.gradeImpacts ?? []), ...rules];
    delete next.gradeLimit;
  }
  if (next.manager || next.surface) ignored.push("surface trading");
  delete next.manager; delete next.surface;
  return { step: next, ignored };
}
