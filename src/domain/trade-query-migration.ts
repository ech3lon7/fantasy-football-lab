import { clampTheirGain, defaultTradeFilters } from "./trade-filters";
import type { TradeSearchQuery } from "./trade-search";
import type { ChainStep } from "./trade-chains";
import type { PositionalGradeImpactRule } from "./chain-position-impact";

// Preserve supported saved criteria and identify settings that no longer affect broad discovery.
export function migrateLegacyTradeQuery(query: TradeSearchQuery) {
  const filters = defaultTradeFilters(), ignored: string[] = [], applied: string[] = [];
  // Offered players from an old query are never required by the new search.
  if (query.give.length) ignored.push("offered players");
  if (query.weekly?.own) { filters.yourGain = { ...query.weekly.own }; applied.push("your weekly gain"); }
  if (query.weekly?.other?.minimum != null) { filters.theirGain = clampTheirGain(query.weekly.other.minimum); applied.push("their weekly gain"); }
  if (query.weekly?.other?.maximum != null) ignored.push("their maximum gain");
  filters.getPositions = query.incoming?.positions ?? [];
  filters.labels = query.incoming?.signals ?? [];
  filters.gradeGoals = query.gradeImpacts ?? [];
  if (filters.getPositions.length) applied.push("incoming positions");
  if (filters.labels.length) applied.push("incoming labels");
  if (filters.gradeGoals.length) applied.push("grade goals");
  if (query.discovery?.teams) { filters.teams = [...query.discovery.teams]; applied.push("team scope"); }
  if (query.discovery?.target) { filters.mustGet = [query.discovery.target]; applied.push("incoming target"); }
  if (query.indexMode === "strict") ignored.push("index window");
  if (query.goal && query.goal !== "explore") ignored.push("goal");
  if (query.manager || query.surface) ignored.push("surface trading");
  if (query.upgrade || query.usefulness || query.deficitProtection) ignored.push("old roster-fit settings");
  if (query.discovery?.ranking) ignored.push("ranking");
  return { filters, applied, ignored };
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
