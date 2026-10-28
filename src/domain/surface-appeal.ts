import { sum, type Draft } from "./contracts";
import { available, forHypotheticalScoring, irAssignments } from "./lineups";
import {
  directStarterImpact,
  rosterPotentialImpact,
  starterSlotCounts,
} from "./starter-lineups";
import { readLineupBasis, type LineupBasis } from "./trade-impact";
import type { Model, Player } from "./valuation";
import type { TradeResult } from "./trades";
import type { SearchRow } from "./trade-search";

// Surface preferences are optional discovery criteria, never a new player valuation or an acceptance probability.
export interface SurfaceFilter {
  metric: "average" | "projection" | "both";
  minimum: number;
  requireValueTests: boolean;
}
export interface SurfaceComparison {
  before: number | null;
  after: number | null;
  gain: number | null;
  slots: string[];
  beforeIds: (string | null)[];
  afterIds: (string | null)[];
  missing: string[];
  issues: string[];
}
export interface SurfaceEvidence {
  filter: SurfaceFilter;
  basis: LineupBasis;
  week: number;
  sourceUTC: string | null;
  average: SurfaceComparison;
  projection: SurfaceComparison;
}
const cache = new WeakMap<
  Model,
  Partial<Record<"average" | "projection", Model>>
>();
const source = (p: Player, metric: "average" | "projection") =>
  metric === "average" ? (p.historyComplete ? p.actual : null) : p.weekly;

// Fork only scoring inputs: no model player, replacement pool, raw ESPN field, or saved roster is mutated.
function surfaceModel(m: Model, metric: "average" | "projection") {
  let views = cache.get(m);
  if (!views) {
    views = {};
    cache.set(m, views);
  }
  if (views[metric]) return views[metric]!;
  const view: Model = {
    ...(metric === "average"
      ? forHypotheticalScoring(m)
      : { ...m, ignoreByeWeeks: false, ignoreTemporaryAbsences: false }),
    weeks: [m.current],
    // Missing eligible values are rejected below before scoring; known absences contribute no lineup points, not an invented player projection.
    players: m.players.map((p) => ({
      ...p,
      expected: source(p, metric) ?? 0,
      value: source(p, metric) ?? 0,
    })),
  };
  view.byId = new Map(view.players.map((p) => [p.id, p]));
  views[metric] = view;
  return view;
}

// Score the same legal before/after roster with one source at a time, preserving zero/negative observations and distinct positional slots.
function comparison(
  m: Model,
  draft: Draft,
  before: string[],
  after: string[],
  metric: "average" | "projection",
  basis: LineupBasis,
  lineupsRaw?: string,
): SurfaceComparison {
  const view = surfaceModel(m, metric);
  const counts = starterSlotCounts(view);
  const contributes = (p: Player) =>
    counts[p.pos] > 0 ||
    (counts.FLEX > 0 && ["RB", "WR", "TE"].includes(p.pos));
  const relevant = (ids: string[]) =>
    ids.filter((id) => contributes(view.byId.get(id)!));
  const missing = new Set<string>();
  for (const ids of [relevant(before), relevant(after)]) {
    const ir = new Set(irAssignments(view, ids));
    for (const id of ids) {
      const p = m.byId.get(id)!;
      if (
        available(view, p, m.current) &&
        !ir.has(id) &&
        source(p, metric) === null
      )
        missing.add(id);
    }
  }
  if (missing.size)
    return {
      before: null,
      after: null,
      gain: null,
      slots: [],
      beforeIds: [],
      afterIds: [],
      missing: [...missing],
      issues: [
        `${metric === "average" ? "Usable actual season PPG" : `ESPN Week ${m.current} projection`} unavailable for eligible roster players.`,
      ],
    };
  const impact =
    basis === "marked-starters"
      ? directStarterImpact(view, draft.teamB, after, draft.give, lineupsRaw)
      : rosterPotentialImpact(
          view,
          relevant(before),
          relevant(after),
          draft.give,
        );
  const week = impact.weekly[0];
  const usable =
    !impact.errors.length &&
    !!week &&
    week.beforeExpected !== null &&
    week.afterExpected !== null;
  return {
    before: usable ? week.beforeExpected : null,
    after: usable ? week.afterExpected : null,
    gain: usable ? sum([week.afterExpected!, -week.beforeExpected!]) : null,
    slots: week?.slots ?? [],
    beforeIds: week?.beforeIds ?? [],
    afterIds: week?.ids ?? [],
    missing: [],
    issues: [...impact.errors, ...impact.warnings],
  };
}

// Keep season-average rate appeal separate from the imported week's projection; hypothetical availability never fabricates ESPN matchup forecasts.
export function surfaceAppeal(
  m: Model,
  draft: Draft,
  result: TradeResult,
  filter: SurfaceFilter,
  basis?: LineupBasis,
  lineupsRaw?: string,
): SurfaceEvidence | undefined {
  if (!result.valid) return undefined;
  const selected = readLineupBasis(basis);
  return {
    filter: { ...filter },
    basis: selected,
    week: m.current,
    sourceUTC: m.dataset.sourceUTC,
    average: comparison(
      m,
      draft,
      result.initialB,
      result.legalB,
      "average",
      selected,
      lineupsRaw,
    ),
    projection: comparison(
      m,
      draft,
      result.initialB,
      result.legalB,
      "projection",
      selected,
      lineupsRaw,
    ),
  };
}

// A surface match still needs a legal trade and a positive gain for you; optional model price gates remain explicit and independent.
export function surfaceFailures(
  row: SearchRow,
  filter?: SurfaceFilter,
): string[] {
  if (!filter) return [];
  const reasons: string[] = [];
  if (row.legal !== true)
    reasons.push("Surface appeal requires legal modeled rosters.");
  if (row.own === null || row.own <= 0)
    reasons.push(
      "Surface appeal requires a positive modeled lineup gain for you.",
    );
  if (
    filter.requireValueTests &&
    (row.surplus !== "PASS" || row.points !== "PASS")
  )
    reasons.push("Surface appeal requires both model value tests to pass.");
  for (const metric of ["average", "projection"] as const) {
    if (filter.metric !== "both" && filter.metric !== metric) continue;
    const gain = row.surface?.[metric].gain;
    const label =
      metric === "average"
        ? "Their season-average lineup gain"
        : "Their ESPN weekly-projection lineup gain";
    if (gain == null) reasons.push(`${label} is unavailable.`);
    else if (gain <= 0 || gain < filter.minimum)
      reasons.push(
        `${label} is ${gain.toFixed(2)}; requires a positive gain of at least ${filter.minimum.toFixed(2)}.`,
      );
  }
  return reasons;
}
