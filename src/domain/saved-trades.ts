import { z } from "zod";
import {
  cmpId,
  draftSchema,
  num,
  positions,
  str,
  type AppState,
  type Dataset,
  type Draft,
  type Workspace,
} from "./contracts";
import type { Model } from "./valuation";
import type { TradeResult } from "./trades";
import {
  lineupBases,
  tradeImpact,
  readLineupBasis,
  type LineupBasis,
} from "./trade-impact";
import type { SearchRow, TradeSearchQuery } from "./trade-search";
import { tradeSearchBounds } from "./trade-search";
import { tradeImpactVersion } from "./starter-lineups";
import { rosterScenarioSchema } from "./roster-scenarios";

// Reuse the existing account-scoped string filters, so saved trades need no new database table or migration.
export const savedTradesKey = "savedTrades";
const finite = z.number().finite();
const count = z.number().int().min(0).max(5);
const range = z
  .object({ minimum: finite.nullable(), maximum: finite.nullable() })
  .strict();
const querySchema = z
  .object({
    // Optional guided-search metadata keeps old saved queries strictly bounded.
    lineupBasis: z.enum(lineupBases).optional(),
    indexMode: z.enum(["automatic", "strict"]).optional(),
    goal: z.enum(["explore", "improve", "position", "custom"]).optional(),
    teamA: z.string(),
    give: z.array(z.string()).max(5),
    count: count.min(1),
    below: finite.nonnegative(),
    above: finite.nonnegative(),
    // Preserve the optional usefulness setting when a saved trade restores its search controls.
    usefulness: z.object({ minimum: finite.nonnegative() }).strict().optional(),
    // Optional discovery settings use the existing saved-search/sync contract; old saved trades need no migration.
    discovery: z
      .object({
        // Persist incoming size ranges while older entries retain their original exact count.
        receive: z
          .object({ minimum: count.min(1), maximum: count.min(1) })
          .strict()
          .refine((r) => r.minimum <= r.maximum)
          .optional(),
        flexible: z
          .object({
            pool: z.array(z.string()).min(1).max(12),
            minimum: count.min(1),
            maximum: count.min(1),
          })
          .strict()
          .optional(),
        target: z.string().optional(),
        ranking: z.enum(["own", "other", "balanced"]).optional(),
        nearMisses: z.boolean().optional(),
      })
      .strict()
      .optional(),
    upgrade: z
      .object({
        mode: z.enum(["starter", "depth", "either", "best"]),
        minimum: finite.nonnegative(),
        requiredStarters: count.optional(),
        requiredBench: count.optional(),
        requiredBest: count.optional(),
      })
      .strict()
      .optional(),
    weekly: z
      .object({ own: range.optional(), other: range.optional() })
      .strict()
      .optional(),
    deficit: z
      .object({ position: z.enum(positions), ceiling: z.string().max(3) })
      .strict()
      .optional(),
    incoming: z
      .object({
        signals: z
          .array(z.enum(["Gem", "Watch"]))
          .max(2)
          .optional(),
        minimumSignals: count.min(1).optional(),
        positions: z.array(z.enum(positions)).max(6).optional(),
        minimumPositions: count.min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// Store compact summaries rather than historical datasets or large weekly lineup objects.
const summarySchema = z
  .object({
    // Old original summaries remain readable and explicitly identifiable as using the previous scoring method.
    impactVersion: z.string().max(60).optional(),
    lineupBasis: z.enum(lineupBases).optional(),
    ownBefore: finite.nullable().optional(),
    ownAfter: finite.nullable().optional(),
    otherBefore: finite.nullable().optional(),
    otherAfter: finite.nullable().optional(),
    own: finite.nullable(),
    other: finite.nullable(),
    ownTotal: finite.nullable(),
    otherTotal: finite.nullable(),
    grade: z.string().max(160),
    surplus: z.string().max(160),
    points: z.string().max(160),
    legal: z.boolean().nullable(),
    conditional: z.boolean(),
  })
  .strict();
const savedSchema = z
  .object({
    id: z.string().min(1).max(100),
    season: z.number().int(),
    name: z.string().min(1).max(120),
    notes: z.string().max(2000),
    draft: draftSchema,
    query: querySchema.optional(),
    // Current evaluation preference is separate from the immutable original summary.
    lineupBasis: z.enum(lineupBases).optional(),
    // Preserve a private immutable recipe with each hypothetical trade, never a pointer to mutable named scenarios.
    scenario: rosterScenarioSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    original: summarySchema
      .extend({
        datasetHash: z.string().max(100),
        sourceUTC: z.string().nullable(),
      })
      .strict(),
  })
  .strict();
const collectionSchema = z
  .object({ version: z.literal(1), trades: z.array(savedSchema).max(100) })
  .strict();
export type SavedTrade = z.infer<typeof savedSchema>;
export type SavedTradeSummary = z.infer<typeof summarySchema>;
// Only a known historical version identifies an original summary's basis; older unknown numbers stay explicitly unspecified.
export const originalLineupBasis = (
  summary: SavedTradeSummary,
): LineupBasis | undefined =>
  summary.lineupBasis ??
  (["roster-potential-primary-2", tradeImpactVersion].includes(
    summary.impactVersion ?? "",
  )
    ? "best-available"
    : undefined);
export const savedLineupBasis = (trade: SavedTrade): LineupBasis =>
  readLineupBasis(
    trade.lineupBasis ??
      trade.query?.lineupBasis ??
      originalLineupBasis(trade.original),
  );

// Corrupt/future-format saved state stays intact and produces a recoverable message instead of breaking app startup.
export function readSavedTrades(raw?: string): {
  trades: SavedTrade[];
  issue: string;
} {
  if (!raw) return { trades: [], issue: "" };
  try {
    const parsed = collectionSchema.parse(JSON.parse(raw));
    if (new Set(parsed.trades.map((t) => t.id)).size !== parsed.trades.length)
      throw Error();
    return { trades: parsed.trades, issue: "" };
  } catch {
    return {
      trades: [],
      issue:
        "Saved trades could not be read. Their stored data is intact; clear it explicitly to start again.",
    };
  }
}

// Canonical package identity ignores selection order but keeps direction, teams and season distinct.
export function savedTradeIdentity(season: number, draft: Draft) {
  return JSON.stringify([
    season,
    draft.teamA,
    draft.teamB,
    [...draft.give].sort(cmpId),
    [...draft.get].sort(cmpId),
  ]);
}
export function ownsSavedDraft(dataset: Dataset, draft: Draft) {
  const teams = new Set(dataset.tables.ModelTeams.map((t) => str(t.TeamID)));
  return (
    teams.has(draft.teamA) &&
    teams.has(draft.teamB) &&
    draft.teamA !== draft.teamB &&
    [draft.give, draft.get].every(
      (ids) => ids.length >= 1 && ids.length <= 5,
    ) &&
    new Set([...draft.give, ...draft.get]).size ===
      draft.give.length + draft.get.length &&
    draft.give.every((id) =>
      dataset.tables.ModelPlayers.some(
        (p) => str(p.PlayerID) === id && str(p.OnTeamID) === draft.teamA,
      ),
    ) &&
    draft.get.every((id) =>
      dataset.tables.ModelPlayers.some(
        (p) => str(p.PlayerID) === id && str(p.OnTeamID) === draft.teamB,
      ),
    )
  );
}

// Respect the deployed RPC's 64-KiB state limit, including other account settings/evidence and UTF-8 notes.
export function writeSavedTrades(state: AppState, trades: SavedTrade[]) {
  const raw = JSON.stringify(collectionSchema.parse({ version: 1, trades }));
  const next = {
    ...state,
    filters: { ...state.filters, [savedTradesKey]: raw },
  };
  if (
    new TextEncoder().encode(JSON.stringify(next, null, 2)).byteLength > 64000
  )
    throw Error(
      "Workspace sync storage is full. Shorten notes or remove saved trades before saving another.",
    );
  return raw;
}

// Copy existing authoritative outputs only; saving never introduces a second trade valuation formula.
export function summaryFromSearch(row: SearchRow): SavedTradeSummary {
  return {
    impactVersion: tradeImpactVersion,
    lineupBasis: readLineupBasis(row.lineupBasis),
    ownBefore: row.ownBefore,
    ownAfter: row.ownAfter,
    otherBefore: row.otherBefore,
    otherAfter: row.otherAfter,
    own: row.own,
    other: row.other,
    ownTotal: row.ownTotal,
    otherTotal: row.otherTotal,
    grade: row.grade,
    surplus: row.surplus,
    points: row.points,
    legal: row.legal,
    conditional: row.warnings.length > 0,
  };
}
export function summaryFromTrade(
  result: TradeResult,
  basis?: LineupBasis,
): SavedTradeSummary {
  // Saving uses the same selected outputs as search and the analyzer, including manual saves without a query.
  const impact = tradeImpact(result, basis);
  return result.valid && impact
    ? {
        impactVersion: tradeImpactVersion,
        lineupBasis: impact.basis,
        ownBefore: impact.own.beforePerWeek,
        ownAfter: impact.own.afterPerWeek,
        otherBefore: impact.other.beforePerWeek,
        otherAfter: impact.other.afterPerWeek,
        own: impact.own.expectedPerWeek,
        other: impact.other.expectedPerWeek,
        ownTotal: impact.own.expected,
        otherTotal: impact.other.expected,
        grade: result.grade,
        surplus: result.surplusTest,
        points: result.pointsTest,
        legal: result.legality,
        conditional:
          result.uncertainty.length > 0 ||
          result.directA.errors.length > 0 ||
          result.directB.errors.length > 0 ||
          result.potentialA.errors.length > 0 ||
          result.potentialB.errors.length > 0,
      }
    : {
        impactVersion: tradeImpactVersion,
        own: null,
        other: null,
        ownTotal: null,
        otherTotal: null,
        grade: "Unavailable",
        surplus: "UNAVAILABLE",
        points: "UNAVAILABLE",
        legal: null,
        conditional: true,
      };
}

// Duplicate saves refresh search settings/timestamps while preserving the original summary, custom name and notes.
export function saveTrade(
  state: AppState,
  m: Model,
  draft: Draft,
  summary: SavedTradeSummary,
  query?: TradeSearchQuery,
  now = new Date().toISOString(),
) {
  const read = readSavedTrades(state.filters[savedTradesKey]);
  if (read.issue) throw Error(read.issue);
  if (!ownsSavedDraft(m.dataset, draft))
    throw Error(
      "Choose one to five currently owned players on each side before saving.",
    );
  // Invalid edits cannot silently become null or disappear from the saved search settings.
  const checkedQuery =
    query === undefined
      ? undefined
      : querySchema.safeParse({
          ...query,
          teamA: draft.teamA,
          give: [...draft.give],
        });
  if (checkedQuery && !checkedQuery.success)
    throw Error("Correct invalid search controls before saving this trade.");
  const parsedQuery = checkedQuery?.success ? checkedQuery.data : undefined;
  if (parsedQuery && tradeSearchBounds(m, parsedQuery).errors.length)
    throw Error("Correct invalid search controls before saving this trade.");
  const season = num(m.dataset.tables.ModelContext[0].Season);
  const identity = savedTradeIdentity(season, draft);
  const prior = read.trades.find(
    (t) =>
      savedTradeIdentity(t.season, t.draft) === identity &&
      JSON.stringify(t.scenario) === JSON.stringify(m.simulation?.scenario),
  );
  const label = (ids: string[]) =>
    ids.map((id) => m.byId.get(id)?.name ?? id).join(" + ");
  const trade: SavedTrade = prior
    ? {
        ...prior,
        draft,
        lineupBasis: readLineupBasis(summary.lineupBasis),
        query: parsedQuery ?? prior.query,
        updatedAt: now,
      }
    : {
        id: crypto.randomUUID(),
        season,
        name: `${label(draft.give)} → ${label(draft.get)}`.slice(0, 120),
        notes: "",
        draft,
        query: parsedQuery,
        lineupBasis: readLineupBasis(summary.lineupBasis),
        scenario: m.simulation?.scenario
          ? structuredClone(m.simulation.scenario)
          : undefined,
        createdAt: now,
        updatedAt: now,
        original: {
          ...summary,
          datasetHash: m.dataset.hash,
          sourceUTC: m.dataset.sourceUTC,
        },
      };
  return writeSavedTrades(
    state,
    prior
      ? read.trades.map((t) => (t.id === prior.id ? trade : t))
      : [...read.trades, trade],
  );
}

// Reconcile every committed import/cloud/local snapshot; other-season records cannot be judged against this season's ownership.
export function reconcileSavedTrades(
  workspace: Workspace | null,
): Workspace | null {
  if (!workspace?.dataset || !workspace.state.filters[savedTradesKey])
    return workspace;
  const read = readSavedTrades(workspace.state.filters[savedTradesKey]);
  if (read.issue) return workspace;
  const season = num(workspace.dataset.tables.ModelContext[0].Season);
  const keep = read.trades.filter(
    (t) =>
      !!t.scenario ||
      t.season !== season ||
      ownsSavedDraft(workspace.dataset!, t.draft),
  );
  if (keep.length === read.trades.length) return workspace;
  // Pruning only shrinks existing state and must not make a previously oversized workspace unloadable.
  return {
    ...workspace,
    state: {
      ...workspace.state,
      filters: {
        ...workspace.state.filters,
        [savedTradesKey]: JSON.stringify({ version: 1, trades: keep }),
      },
    },
    pendingState: true,
    stateRequestId: crypto.randomUUID(),
  };
}
