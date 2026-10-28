import { sum, type Draft } from "./contracts";
import type { Model } from "./valuation";
import type { TradeResult } from "./trades";
import { tradeImpact, type LineupBasis } from "./trade-impact";
import type { SurfaceEvidence } from "./surface-appeal";

// Chain-only preferences never import or inherit settings from the ordinary trade finder.
export interface ChainDependencySettings {
  route: "either" | "retrade" | "retain";
  minimumAcquiredShare: number;
  minimumInteractionGain: number;
}
export const defaultChainDependency: ChainDependencySettings = {
  route: "either",
  minimumAcquiredShare: 0.25,
  minimumInteractionGain: 2,
};
export interface ChainIndexWindow {
  below: number;
  above: number;
}
export interface ChainSurfaceFilter {
  metric: "average" | "projection" | "both";
  minimumGain: number;
}
export interface ChainIndexEvidence {
  outgoing: number | null;
  incoming: number | null;
  minimum: number | null;
  maximum: number | null;
  difference: number | null;
  passed: boolean;
}
export interface RetradeEvidence {
  acquired: string[];
  numerator: number | null;
  denominator: number | null;
  metric: "index" | "points" | "unavailable";
  share: number | null;
  required: number;
  passed: boolean;
}
export interface CoverageRole {
  acquired: string;
  outgoing: string;
  week: number;
  slot: string;
}
export interface RetainedEvidence {
  coverage: CoverageRole[];
  actualSecondGain: number | null;
  standaloneSecondGain: number | null;
  interactionGain: number | null;
  retainedLift: number | null;
  required: number;
  passed: boolean;
  issue: string;
}
export interface ChainDependencyEvidence {
  route: "retrade" | "retain" | null;
  retrade: RetradeEvidence;
  retained: RetainedEvidence;
}
const finite = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n);

// Index windows use raw sums only; package premiums and recipient concession gates remain separate calculations.
export function chainIndexEvidence(
  m: Model,
  d: Draft,
  window: ChainIndexWindow,
): ChainIndexEvidence {
  const total = (ids: string[]) =>
    ids.every((id) => finite(m.byId.get(id)?.index))
      ? sum(ids.map((id) => m.byId.get(id)!.index!))
      : null;
  const outgoing = total(d.give),
    incoming = total(d.get);
  const minimum =
    outgoing === null ? null : Math.max(0, outgoing - window.below);
  const maximum = outgoing === null ? null : outgoing + window.above;
  return {
    outgoing,
    incoming,
    minimum,
    maximum,
    difference:
      outgoing === null || incoming === null ? null : incoming - outgoing,
    passed:
      incoming !== null &&
      minimum !== null &&
      maximum !== null &&
      incoming >= minimum &&
      incoming <= maximum,
  };
}

// Compare only the selected recipient source metrics; speculative first legs never inherit ordinary search's positive-own-gain rule.
export function chainSurfaceFailures(
  evidence: SurfaceEvidence | undefined,
  filter: ChainSurfaceFilter,
) {
  const failures: string[] = [];
  for (const metric of ["average", "projection"] as const) {
    if (filter.metric !== "both" && filter.metric !== metric) continue;
    const value = evidence?.[metric].gain;
    const label =
      metric === "average"
        ? "Recipient season-average lineup gain"
        : "Recipient ESPN weekly-projection lineup gain";
    if (!finite(value)) failures.push(`${label} is unavailable.`);
    else if (value <= 0 || value < filter.minimumGain)
      failures.push(
        `${label} is ${value.toFixed(2)}; requires a positive gain of at least ${filter.minimumGain.toFixed(2)}.`,
      );
  }
  return failures;
}

// An acquired card must fund a material share of trade two, not merely appear as a token throw-in.
export function chainRetradeEvidence(
  m: Model,
  first: Draft,
  second: Draft,
  policy: ChainDependencySettings,
): RetradeEvidence {
  const acquired = second.give.filter(
    (id) => first.get.includes(id) && m.byId.get(id)?.owner === second.teamA,
  );
  let metric: RetradeEvidence["metric"] = "index",
    numerator: number | null = null,
    denominator: number | null = null;
  if (second.give.every((id) => finite(m.byId.get(id)?.index))) {
    denominator = sum(second.give.map((id) => m.byId.get(id)!.index!));
    numerator = sum(acquired.map((id) => m.byId.get(id)!.index!));
    // Only a wholly zero-index package uses a separately labeled, positive remaining-points weight.
    if (denominator === 0) {
      metric = "points";
      const weight = (id: string) => {
        const p = m.byId.get(id);
        return p && finite(p.value) && finite(p.available)
          ? Math.max(0, p.value * p.available)
          : null;
      };
      if (second.give.every((id) => weight(id) !== null)) {
        denominator = sum(second.give.map((id) => weight(id)!));
        numerator = sum(acquired.map((id) => weight(id)!));
      } else {
        numerator = null;
        denominator = null;
      }
    }
  }
  const share =
    numerator !== null && denominator !== null && denominator > 0
      ? numerator / denominator
      : null;
  if (share === null) metric = "unavailable";
  return {
    acquired,
    numerator,
    denominator,
    metric,
    share,
    required: policy.minimumAcquiredShare,
    passed:
      acquired.length > 0 &&
      share !== null &&
      share >= policy.minimumAcquiredShare,
  };
}

// Named coverage uses the actual final scoring lineup and original outgoing positions, including legal FLEX compatibility.
export function retainedCoverage(
  original: Model,
  first: Draft,
  second: Draft,
  result: TradeResult,
  basis: LineupBasis,
): CoverageRole[] {
  if (!result.valid) return [];
  const impact = tradeImpact(result, basis);
  if (!impact) return [];
  const kept = first.get.filter(
    (id) => !second.give.includes(id) && result.legalA.includes(id),
  );
  const outgoing = second.give.filter(
    (id) => original.byId.get(id)?.owner === second.teamA,
  );
  return impact.own.weekly.flatMap((week) =>
    week.ids.flatMap((id, i) => {
      if (!id || !kept.includes(id)) return [];
      const pos = original.byId.get(id)!.pos,
        slot = week.slots[i];
      return outgoing
        .filter((other) => {
          const otherPos = original.byId.get(other)!.pos;
          return (
            pos === otherPos ||
            (slot === "FLEX" && ["RB", "WR", "TE"].includes(otherPos))
          );
        })
        .map((other) => ({
          acquired: id,
          outgoing: other,
          week: week.week,
          slot,
        }));
    }),
  );
}

// Interaction, rather than retained lift alone, distinguishes coverage that enables trade two from two unrelated upgrades.
export function chainRetainedEvidence(
  policy: ChainDependencySettings,
  coverage: CoverageRole[],
  before: number,
  intermediate: number,
  after: number,
  standalone?: { before: number; after: number },
  issue = "",
): RetainedEvidence {
  const usable =
    standalone &&
    [before, intermediate, after, standalone.before, standalone.after].every(
      finite,
    );
  const actualSecondGain =
    finite(after) && finite(intermediate) ? after - intermediate : null;
  const standaloneSecondGain = usable
    ? standalone.after - standalone.before
    : null;
  const interactionGain =
    actualSecondGain !== null && standaloneSecondGain !== null
      ? actualSecondGain - standaloneSecondGain
      : null;
  const retainedLift = usable ? after - standalone.after : null;
  return {
    coverage,
    actualSecondGain,
    standaloneSecondGain,
    interactionGain,
    retainedLift,
    required: policy.minimumInteractionGain,
    passed:
      coverage.length > 0 &&
      interactionGain !== null &&
      interactionGain >= policy.minimumInteractionGain,
    issue:
      issue ||
      (!coverage.length
        ? "No retained acquisition supplies relevant scoring-lineup coverage."
        : !usable
          ? "Standalone trade 2 is not evaluable."
          : ""),
  };
}

// Route selection cannot turn unavailable evidence or a disconnected pair into a qualifying chain.
export function chainDependencyEvidence(
  policy: ChainDependencySettings,
  retrade: RetradeEvidence,
  retained: RetainedEvidence,
): ChainDependencyEvidence {
  const route =
    policy.route !== "retain" && retrade.passed
      ? "retrade"
      : policy.route !== "retrade" && retained.passed
        ? "retain"
        : null;
  return { route, retrade, retained };
}
