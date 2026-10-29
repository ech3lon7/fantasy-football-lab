import { z } from "zod";
import { cmpId, type Draft } from "./contracts";
import { surfaceAppeal, type SurfaceComparison } from "./surface-appeal";
import type { Model } from "./valuation";
import type { TradeResult } from "./trades";

// Version these provisional operating assumptions independently from player values and app releases.
export const managerRulesVersion = "surface-manager-1";
export const managerPresetNames = [
  "Heavy own-player premium",
  "Modest premium",
  "League baseline",
  "Modest discount",
  "Heavy discount",
] as const;
export const managerProfileSchema = z
  .object({
    preset: z.number().int().min(0).max(4),
    cornerstones: z.array(z.string().max(100)).max(100).default([]),
  })
  .strict();
export type ManagerProfile = z.infer<typeof managerProfileSchema>;
export const managerSettingsSchema = z
  .object({
    version: z.literal(1),
    override: z.number().int().min(0).max(4).optional(),
    profiles: z.record(z.string().max(100), managerProfileSchema).default({}),
  })
  .strict();
export type ManagerSettings = z.infer<typeof managerSettingsSchema>;
export const managerPresets = [
  { ratio: 1, rank: 1, positional: 4, overall: 6, preferred: 4 },
  { ratio: 0.95, rank: 2, positional: 3, overall: 5, preferred: 3 },
  { ratio: 0.9, rank: 3, positional: 2, overall: 4, preferred: 2 },
  { ratio: 0.85, rank: 5, positional: 1, overall: 3, preferred: 0 },
  { ratio: 0.8, rank: 8, positional: 0, overall: 2, preferred: -2 },
] as const;
export interface MainReturn {
  outgoing: string;
  incoming: string;
  tier: string;
  samePosition: boolean;
  required: number;
  actual: number;
  stronger: boolean;
  comfortable: boolean;
  compensation?: {
    incoming: string;
    incumbent: string;
    gain: number;
    required: number;
  };
}
export interface ManagerAssessment {
  version: typeof managerRulesVersion;
  status: "eligible" | "conditional" | "safeguard-failed" | "unavailable";
  preset: number;
  sourceUTC: string | null;
  datasetHash: string;
  season: string;
  week: number;
  average?: SurfaceComparison;
  projection?: SurfaceComparison;
  matches: MainReturn[];
  checks?: {
    outgoing: string;
    incoming: string;
    samePosition: boolean;
    required: number;
    actual: number | null;
    qualifies: boolean;
    compensation: number;
  }[];
  population?: {
    imported: number;
    completeActual: number;
    positionalSample: number;
  };
  band?: number;
  range?: [number, number];
  baseBand?: number;
  comfort?: number;
  caution?: number;
  preferred: number;
  margin?: number;
  reasons: string[];
  warnings: string[];
  evidence: {
    id: string;
    actual: number | null;
    games: number;
    rank: number | null;
    totalRank: number | null;
    weekly?: number | null;
    pos?: string;
    injury?: string;
    bye?: number;
    slot?: number;
  }[];
}

// Rank the same complete source population for every hypothetical owner; membership and offers never redefine elite tiers.
const rankCache = new WeakMap<
  Model,
  { positional: Map<string, number>; total: Map<string, number> }
>();
export function surfaceRanks(m: Model) {
  const cached = rankCache.get(m);
  if (cached) return cached;
  const usable = m.players.filter(
    (p) =>
      ["QB", "RB", "WR", "TE"].includes(p.pos) &&
      p.historyComplete &&
      p.actual !== null &&
      p.games > 0,
  );
  const positional = new Map<string, number>(),
    total = new Map<string, number>();
  [...usable]
    .sort(
      (a, b) => b.actual! * b.games - a.actual! * a.games || cmpId(a.id, b.id),
    )
    .forEach((p, i) => total.set(p.id, i + 1));
  for (const pos of ["QB", "RB", "WR", "TE"])
    usable
      .filter((p) => p.pos === pos && p.games >= 3)
      .sort((a, b) => b.actual! - a.actual! || cmpId(a.id, b.id))
      .forEach((p, i) => positional.set(p.id, i + 1));
  const ranks = { positional, total };
  rankCache.set(m, ranks);
  return ranks;
}

// Keep exact boundary conventions testable without depending on any imported league or historical outcomes.
export function acceptanceBand(margin: number) {
  return margin <= -6
    ? -2
    : margin < -2
      ? -1
      : margin < 2
        ? 0
        : margin < 6
          ? 1
          : 2;
}
export const acceptanceRanges: [number, number][] = [
  [5, 20],
  [10, 30],
  [15, 45],
  [30, 65],
  [45, 80],
];
export const acceptanceLabels = [
  "Poor",
  "Weak",
  "Uncertain",
  "Promising",
  "Strong",
];

// Relabel equal-position slots to retain incumbents wherever possible, without changing selected players or totals.
function stableComparison(m: Model, c: SurfaceComparison): SurfaceComparison {
  const remaining = c.afterIds.filter((id): id is string => !!id),
    assigned: (string | null)[] = c.slots.map(() => null);
  const eligible = (id: string, slot: string) =>
    slot === "FLEX"
      ? ["RB", "WR", "TE"].includes(m.byId.get(id)!.pos)
      : m.byId.get(id)!.pos === slot;
  // Enumerate only the selected lineup; memoized assignment minimizes role churn while respecting FLEX capacity.
  const memo = new Map<string, { score: number; ids: (string | null)[] }>();
  const visit = (
    i: number,
    used: Set<string>,
  ): { score: number; ids: (string | null)[] } | null => {
    if (i === c.slots.length)
      return used.size === remaining.length ? { score: 0, ids: [] } : null;
    const key = `${i}:${[...used].sort(cmpId).join(",")}`;
    if (memo.has(key)) return memo.get(key)!;
    let best: { score: number; ids: (string | null)[] } | null = null;
    const choices: (string | null)[] = remaining
      .filter((id) => !used.has(id) && eligible(id, c.slots[i]))
      .sort(cmpId);
    if (c.slots.length - i > remaining.length - used.size) choices.push(null);
    for (const id of choices) {
      const next = new Set(used);
      if (id) next.add(id);
      const child = visit(i + 1, next);
      if (!child) continue;
      const score = child.score + (id && id === c.beforeIds[i] ? 1 : 0);
      if (!best || score > best.score)
        best = { score, ids: [id, ...child.ids] };
    }
    if (best) memo.set(key, best);
    return best;
  };
  const result = visit(0, new Set());
  return { ...c, afterIds: result?.ids ?? (assigned.length ? c.afterIds : []) };
}

const comparisonCache = new WeakMap<
  Model,
  Map<string, ReturnType<typeof surfaceAppeal>>
>();

// Evaluate visible scoring and distinct elite returns only; private EPPG, tags, indices and package premiums never enter this model.
export function managerAssessment(
  m: Model,
  draft: Draft,
  trade: TradeResult,
  settings: ManagerSettings,
): ManagerAssessment {
  const profile = settings.profiles[draft.teamB] ?? {
      preset: 2,
      cornerstones: [],
    },
    preset = settings.override ?? profile.preset;
  const policy = managerPresets[preset],
    ranks = surfaceRanks(m);
  const result: ManagerAssessment = {
    version: managerRulesVersion,
    status: "unavailable",
    preset,
    sourceUTC: m.dataset.sourceUTC,
    datasetHash: m.dataset.hash,
    season: String(m.dataset.tables.ModelContext[0].Season ?? ""),
    week: m.current,
    matches: [],
    preferred: policy.preferred,
    reasons: [],
    warnings: [
      "Provisional operating estimate; historical calibration is limited.",
    ],
    evidence: [...new Set([...draft.give, ...draft.get])].map((id) => {
      const p = m.byId.get(id);
      return {
        id,
        actual: p?.actual ?? null,
        games: p?.games ?? 0,
        rank: ranks.positional.get(id) ?? null,
        totalRank: ranks.total.get(id) ?? null,
      };
    }),
  };
  if (!trade.valid || !trade.legality) {
    result.reasons.push("A legal modeled trade is required.");
    return result;
  }
  const selected = [...draft.give, ...draft.get].map((id) => m.byId.get(id)!);
  if (
    selected.some(
      (p) =>
        !p.historyComplete ||
        p.actual === null ||
        (["QB", "RB", "WR", "TE"].includes(p.pos) && p.games < 3),
    )
  ) {
    result.reasons.push(
      "Complete actual averages and at least three played games are required for offensive player classification.",
    );
    return result;
  }
  let cache = comparisonCache.get(m);
  if (!cache) {
    cache = new Map();
    comparisonCache.set(m, cache);
  }
  const comparisonKey = JSON.stringify([
    draft.teamB,
    trade.initialB,
    trade.legalB,
  ]);
  const surface =
    cache.get(comparisonKey) ??
    surfaceAppeal(
      m,
      draft,
      trade,
      { metric: "average", minimum: 0, requireValueTests: false },
      "best-available",
    );
  if (surface && !cache.has(comparisonKey)) {
    if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
    cache.set(comparisonKey, surface);
  }
  if (!surface || surface.average.gain === null) {
    result.reasons.push(
      ...(surface?.average.issues ?? []),
      "Their season-average lineup is unavailable; missing roster data is not zero.",
    );
    return result;
  }
  result.average = stableComparison(m, surface.average);
  result.projection = surface.projection;
  result.evidence = [
    ...new Set([
      ...draft.give,
      ...draft.get,
      ...trade.initialB,
      ...trade.legalB,
    ]),
  ].map((id) => {
    const p = m.byId.get(id)!;
    return {
      id,
      actual: p.actual,
      games: p.games,
      rank: ranks.positional.get(id) ?? null,
      totalRank: ranks.total.get(id) ?? null,
      weekly: p.weekly,
      pos: p.pos,
      injury: p.injury,
      bye: p.bye,
      slot: p.slot,
    };
  });
  const elite = draft.get.flatMap((id) => {
    const p = m.byId.get(id)!;
    const tier =
      (ranks.total.get(id) ?? Infinity) <= 5
        ? "Overall elite"
        : (ranks.positional.get(id) ?? Infinity) <= 3 ||
            profile.cornerstones.includes(id)
          ? "Positional elite / cornerstone"
          : null;
    return tier
      ? [
          {
            p,
            tier,
            compensation:
              tier === "Overall elite" ? policy.overall : policy.positional,
          },
        ]
      : [];
  });
  const incoming = [...draft.give]
    .sort(cmpId)
    .map((id) => m.byId.get(id)!)
    .filter((p) => trade.legalB.includes(p.id));
  result.checks = [];
  result.population = {
    imported: m.players.length,
    completeActual: ranks.total.size,
    positionalSample: ranks.positional.size,
  };
  const candidates = elite.map(({ p, tier, compensation }) =>
    incoming.flatMap((main) => {
      const same = main.pos === p.pos,
        rank = ranks.positional.get(main.id),
        oldRank = ranks.positional.get(p.id);
      const required = same
        ? policy.ratio * Math.max(0, p.actual!)
        : policy.rank;
      const usable = same
        ? main.actual! >= required
        : rank !== undefined && rank <= required;
      // Preserve failed numerical comparisons too; a generic exclusion must not hide which main/compensation threshold failed.
      result.checks!.push({
        outgoing: p.id,
        incoming: main.id,
        samePosition: same,
        required,
        actual: same ? main.actual : (rank ?? null),
        qualifies: usable,
        compensation,
      });
      if (!usable) return [];
      const stronger = same
        ? main.actual! > p.actual!
        : rank !== undefined && oldRank !== undefined && rank < oldRank;
      const comfortable = same
        ? main.actual! >= (policy.ratio + 0.1) * Math.max(0, p.actual!)
        : rank !== undefined && rank <= policy.rank - 2;
      return [
        {
          outgoing: p.id,
          incoming: main.id,
          tier,
          samePosition: same,
          required,
          actual: same ? main.actual! : rank!,
          stronger,
          comfortable,
        } satisfies MainReturn,
      ];
    }),
  );
  // Compensation must replace a genuinely occupied original role in the final lineup, never an outgoing star's manufactured vacancy.
  const upgrades = result.average.afterIds.flatMap((id, i) => {
    const old = result.average!.beforeIds[i];
    if (
      !id ||
      !old ||
      id === old ||
      !draft.give.includes(id) ||
      draft.get.includes(old)
    )
      return [];
    const gain = m.byId.get(id)!.actual! - m.byId.get(old)!.actual!;
    return gain > 0 ? [{ incoming: id, incumbent: old, gain }] : [];
  });
  let best: MainReturn[] | undefined,
    bestComfort = -1;
  const assignCompensation = (
    mains: MainReturn[],
    i: number,
    used: Set<string>,
    chosen: MainReturn[],
  ) => {
    if (i === mains.length) {
      const comfort = Number(
        mains.length > 0 && mains.every((x) => x.comfortable),
      );
      if (comfort > bestComfort) {
        best = chosen;
        bestComfort = comfort;
      }
      return;
    }
    const main = mains[i],
      needed = elite[i].compensation;
    if (main.stronger || needed === 0) {
      assignCompensation(mains, i + 1, used, [...chosen, main]);
      return;
    }
    for (const upgrade of upgrades)
      if (
        upgrade.incoming !== main.incoming &&
        !used.has(upgrade.incoming) &&
        upgrade.gain >= needed
      ) {
        assignCompensation(mains, i + 1, new Set([...used, upgrade.incoming]), [
          ...chosen,
          { ...main, compensation: { ...upgrade, required: needed } },
        ]);
      }
  };
  const assignMains = (i: number, used: Set<string>, chosen: MainReturn[]) => {
    if (i === elite.length) {
      assignCompensation(chosen, 0, new Set(), []);
      return;
    }
    for (const main of candidates[i])
      if (!used.has(main.incoming))
        assignMains(i + 1, new Set([...used, main.incoming]), [
          ...chosen,
          main,
        ]);
  };
  assignMains(0, new Set(), []);
  if (!best) {
    result.status = "safeguard-failed";
    result.reasons.push(
      candidates.some((c) => c.length === 0)
        ? "An outgoing elite lacks a main return meeting this manager's PPG/rank requirement."
        : "Distinct main returns and compensating starter upgrades cannot satisfy every elite departure.",
    );
    return result;
  }
  result.matches = best;
  result.margin = result.average.gain! - policy.preferred;
  result.baseBand = acceptanceBand(result.margin);
  result.comfort = bestComfort;
  // A real bye or unverified availability must not turn an imported weekly projection into a long-term rejection signal.
  const relevant = [
    ...new Set([
      ...draft.give,
      ...draft.get,
      ...surface.projection.beforeIds,
      ...surface.projection.afterIds,
    ]),
  ]
    .filter((id): id is string => !!id)
    .map((id) => m.byId.get(id)!);
  const normal = relevant.every(
    (p) =>
      p.injury === "ACTIVE" && p.bye !== m.current && !p.out && !p.uncertain,
  );
  result.caution = Number(
    normal && surface.projection.gain !== null && surface.projection.gain <= -2,
  );
  if (!normal || surface.projection.gain === null)
    result.warnings.push(
      "Weekly projection caution not applied: complete normal-availability evidence is unavailable.",
    );
  const conditional = selected.some(
    (p) => (p.out && p.injury !== "OUT") || p.opportunity.returnWeek !== null,
  );
  result.status = conditional ? "conditional" : "eligible";
  result.band = Math.max(
    -2,
    Math.min(2, result.baseBand + result.comfort - result.caution),
  );
  if (!conditional) result.range = acceptanceRanges[result.band + 2];
  else
    result.reasons.push(
      "Resolve long-term availability before assigning an unconditional acceptance range.",
    );
  if (elite.some((e, i) => best![i] && !best![i].samePosition))
    result.warnings.push(
      "Cross-position rank is a provisional quality proxy; QB rank and WR rank are not interchangeable market prices.",
    );
  return result;
}

// An absent optional filter does not introduce any new exclusions or calculations.
export function managerFailures(
  assessment?: ManagerAssessment,
  enabled?: ManagerSettings,
) {
  return !enabled
    ? []
    : !assessment
      ? ["Manager assessment unavailable."]
      : ["safeguard-failed", "unavailable"].includes(assessment.status)
        ? assessment.reasons
        : [];
}
