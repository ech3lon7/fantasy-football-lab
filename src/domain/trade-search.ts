import {
  managerAssessment,
  managerSettingsSchema,
  type ManagerSettings,
  type ManagerAssessment,
} from "./manager-expectations";
import {
  surfaceAppeal,
  type SurfaceEvidence,
  type SurfaceFilter,
} from "./surface-appeal";
import {
  cmpId,
  n,
  num,
  str,
  sum,
  positions,
  type Position,
  type Dataset,
  type Settings,
} from "./contracts";
// Reuse existing league-relative positional grades rather than inventing a second grade formula.
import {
  teamsAssessment,
  lineup,
  rosterExcess,
  irAssignments,
} from "./lineups";
import { evaluateTrade, type TradeResult } from "./trades";
import {
  tradeImpact,
  readLineupBasis,
  lineupScoringVersion,
  type LineupBasis,
} from "./trade-impact";
// Positional fit uses the same saved/imported starter assignments as the existing analyzer.
import { readStarterLineup, tradeImpactVersion } from "./starter-lineups";
import type { Model, Player } from "./valuation";
import type { OpponentIncentive } from "./trade-discovery";
import type { RosterScenario } from "./roster-scenarios";

// Discovery settings are optional so saved fixed-package searches retain their original behavior.
export interface DiscoveryOptions {
  // Omitted means all opponents; an explicitly empty list must never silently widen the search.
  teams?: string[];
  flexible?: { pool: string[]; minimum: number; maximum: number };
  // Optional incoming bounds allow one search to include singles and larger same-team packages.
  receive?: { minimum: number; maximum: number };
  target?: string;
  ranking?: "own" | "other" | "balanced" | "acceptance";
  nearMisses?: boolean;
}

// Package usefulness is independent of the legacy pre-trade upgrade counts and value tests.
export interface UsefulnessEvidence {
  offered: string;
  compared: string | null;
  group: "starter" | "depth";
  role: string;
  offeredPPG: number;
  comparedPPG: number;
  gain: number;
  minimum: number;
  competitionPPG: number | null;
  competitionGain: number | null;
}

// Optional discovery criteria never change valuations or the trade evaluator's inputs.
export interface UpgradeFilter {
  mode: "starter" | "depth" | "either" | "best";
  minimum: number;
  // Optional counts retain the legacy any-one behavior for existing callers without count criteria.
  requiredStarters?: number;
  requiredBench?: number;
  // Best-roster counts represent distinct positions, independent of starter/bench designation.
  requiredBest?: number;
}
export interface UpgradeEvidence {
  offered: string;
  compared: string;
  group: "starter" | "depth" | "best";
  offeredPPG: number;
  comparedPPG: number;
  gain: number;
  source: string;
}
// Weekly limits filter existing average lineup gains; null means no bound on that side.
export interface WeeklyRange {
  minimum: number | null;
  maximum: number | null;
}
export interface WeeklyFilter {
  own?: WeeklyRange;
  other?: WeeklyRange;
}
// This order compares existing letter grades only; the grade calculation remains in teamsAssessment.
export const positionGradeScale = [
  "F",
  "D−",
  "D",
  "D+",
  "C−",
  "C",
  "C+",
  "B−",
  "B",
  "B+",
  "A−",
  "A",
  "A+",
] as const;
export interface DeficitFilter {
  position: Position;
  ceiling: string;
}
export interface DeficitEvidence extends DeficitFilter {
  grade: string;
  status: string;
}
// Fetch weekly slot explanations only on demand instead of retaining full lineups for every search match.
export interface SearchLineupSide {
  source: string;
  expectedPerWeek: number | null;
  expectedTotal: number | null;
  replacements: string[];
  incoming: string[];
  benchOutgoing: string[];
  issues: string[];
  weekly: {
    week: number;
    before: number | null;
    after: number | null;
    gain: number | null;
    changes: {
      slot: string;
      before: string | null;
      after: string | null;
      gain: number | null;
    }[];
  }[];
}
export interface SearchLineupDetails {
  own: SearchLineupSide;
  other: SearchLineupSide;
  // Legacy secondary field names carry the alternative basis; source labels identify its actual interpretation.
  ownMarked: SearchLineupSide;
  otherMarked: SearchLineupSide;
  incentive?: OpponentIncentive;
}
// Incoming criteria screen existing labels and positions without changing values or ranking.
export interface IncomingFilter {
  signals?: ("Gem" | "Watch")[];
  minimumSignals?: number;
  positions?: Position[];
  minimumPositions?: number;
}
// Results stay temporary; explicitly saved trades may retain their compact search query.
export interface TradeSearchQuery {
  // Missing basis preserves historical optimized-search behavior.
  lineupBasis?: LineupBasis;
  teamA: string;
  give: string[];
  // Missing mode preserves strict index matching in legacy saved searches.
  indexMode?: "automatic" | "strict";
  goal?: "explore" | "improve" | "position" | "surface" | "custom";
  count: number;
  below: number;
  above: number;
  upgrade?: UpgradeFilter;
  weekly?: WeeklyFilter;
  deficit?: DeficitFilter;
  incoming?: IncomingFilter;
  usefulness?: { minimum: number };
  discovery?: DiscoveryOptions;
  // Optional surface appeal screens source-based recipient lineups independently of our valuation model.
  // Manager expectations are a separate opt-in evaluator; old surface settings retain their meaning.
  manager?: ManagerSettings;
  surface?: SurfaceFilter;
}
// Old saved searches keep their exact receive count; only an explicit range broadens package sizes.
export function incomingCountRange(q: TradeSearchQuery) {
  return q.discovery?.receive ?? { minimum: q.count, maximum: q.count };
}
export interface SearchMatch {
  key: string;
  teamB: string;
  get: string[];
  incoming: number;
  outgoing: number;
  difference: number;
  upgrades?: UpgradeEvidence[];
  deficit?: DeficitEvidence;
  // Flexible searches carry their actual outgoing package through scoring, loading, saving and details.
  give?: string[];
}
export interface SearchRow extends SearchMatch {
  manager?: ManagerAssessment;
  surface?: SurfaceEvidence;
  // Compact before/after metadata travels with each result, never recomputed from a different live selection.
  lineupBasis?: LineupBasis;
  ownBefore?: number | null;
  ownAfter?: number | null;
  otherBefore?: number | null;
  otherAfter?: number | null;
  // Position-goal contributions include appearances in FLEX.
  positionGain?: number | null;
  nearMiss?: { reasons: string[]; distance: number };
  usefulness?: UsefulnessEvidence[];
  own: number | null;
  other: number | null;
  ownTotal: number | null;
  otherTotal: number | null;
  grade: string;
  surplus: string;
  points: string;
  legal: boolean | null;
  warnings: string[];
  dropsA: string[];
  dropsB: string[];
  irA: string[];
  irB: string[];
}
export interface SearchStats {
  teams: number;
  checked: number;
  excluded: number;
  thinTeams: number;
  matched: number;
  scored: number;
  upgradeExcluded?: number;
  weeklyExcluded?: number;
  positionExcluded?: number;
  deficitExcluded?: number;
  incomingExcluded?: number;
  usefulnessExcluded?: number;
  protectedExcluded?: number;
  surfaceExcluded?: number;
  managerExcluded?: number;
}
export interface SearchProgress {
  phase: "Finding matching packages" | "Evaluating trades" | "Sorting results";
  stats: SearchStats;
  // Worker timings describe real completed evaluations, rather than assuming a fixed speed per package.
  elapsedMs?: number;
  remainingMs?: number;
}
// Recovery counts are exact completed evaluations, tied to the original request/context.
export interface SearchRecovery {
  id: string;
  changes: string[];
  query: TradeSearchQuery;
  count: number;
}
export type SearchRequest =
  | {
      type: "start";
      id: string;
      context: string;
      dataset: Dataset;
      settings: Settings;
      evidence: string;
      roleWeight: string;
      lineupsRaw?: string;
      query: TradeSearchQuery;
      // Workers always value the live source first, then apply the same frozen-index ownership overlay as the UI.
      scenario?: RosterScenario;
    }
  | { type: "page"; id: string; context: string; offset: number }
  | { type: "details"; id: string; context: string; key: string };
export type SearchResponse = { id: string; context: string } & (
  | { type: "progress"; progress: SearchProgress }
  | {
      type: "complete" | "page";
      rows: SearchRow[];
      total: number;
      offset: number;
      stats: SearchStats;
      suggestions?: SearchRow[];
    }
  | {
      type: "recovery";
      options?: SearchRecovery[];
      checked?: number;
      total?: number;
      error?: string;
    }
  | { type: "error"; message: string }
  | {
      type: "details";
      key: string;
      details?: SearchLineupDetails;
      error?: string;
    }
);
export const searchPageSize = 50;

// Include only inputs that affect discovery/scoring; changing an incoming draft must not invalidate peers.
export function tradeSearchContext(
  m: Model,
  query: TradeSearchQuery,
  lineupsRaw = "",
  workspace = "",
) {
  return JSON.stringify([
    tradeImpactVersion,
    lineupScoringVersion,
    "departure-aware-upgrades-v1",
    readLineupBasis(query.lineupBasis),
    workspace,
    m.dataset.hash,
    m.analysisVersion,
    m.weeks,
    // Scoring-policy changes invalidate prior pages and recovery previews.
    m.ignoreByeWeeks ?? false,
    m.ignoreTemporaryAbsences ?? false,
    Object.entries(m.settings).sort(([a], [b]) => a.localeCompare(b)),
    m.evidenceRaw,
    m.roleScenarioWeight,
    lineupsRaw,
    query.teamA,
    query.give,
    query.count,
    query.indexMode ?? "strict",
    query.goal ?? "custom",
    query.below,
    query.above,
    query.discovery ?? null,
    // Invalid numeric edits also invalidate old results instead of collapsing into an unbounded/null preference.
    query.manager ?? null,
    query.surface
      ? [
          query.surface.metric,
          String(query.surface.minimum),
          query.surface.requireValueTests,
        ]
      : null,
    // Disabled controls do not affect existing searches; enabled changes invalidate old results.
    query.upgrade
      ? [
          query.upgrade.mode,
          query.upgrade.minimum,
          query.upgrade.requiredStarters ?? null,
          query.upgrade.requiredBench ?? null,
          query.upgrade.requiredBest ?? null,
        ]
      : null,
    query.deficit ? [query.deficit.position, query.deficit.ceiling] : null,
    // Invalid edits invalidate results too; disabling usefulness preserves the old search path.
    query.usefulness ? [String(query.usefulness.minimum)] : null,
    // Include selections and counts in stale-result protection, even during invalid numeric edits.
    query.incoming
      ? [
          query.incoming.signals ?? [],
          String(query.incoming.minimumSignals ?? 1),
          query.incoming.positions ?? [],
          String(query.incoming.minimumPositions ?? 1),
        ]
      : null,
    // Distinguish invalid numeric edits from valid unbounded limits so stale searches cannot revive.
    query.weekly
      ? [query.weekly.own, query.weekly.other].map((range) =>
          range
            ? [range.minimum, range.maximum].map((value) =>
                value === null || Number.isFinite(value)
                  ? value
                  : String(value),
              )
            : null,
        )
      : null,
  ]);
}

// Missing indices block outgoing searches, while genuine zero remains a usable number.
export function tradeSearchBounds(m: Model, q: TradeSearchQuery) {
  const errors: string[] = [];
  if (q.manager && !managerSettingsSchema.safeParse(q.manager).success)
    errors.push("Choose valid manager expectation settings.");
  if (
    q.surface &&
    (!["average", "projection", "both"].includes(q.surface.metric) ||
      !Number.isFinite(q.surface.minimum) ||
      q.surface.minimum < 0 ||
      typeof q.surface.requireValueTests !== "boolean")
  )
    errors.push(
      "Choose a valid surface metric and a nonnegative minimum apparent gain.",
    );
  // Unknown basis values must not silently change a saved search's meaning.
  if (
    q.lineupBasis !== undefined &&
    !["best-available", "marked-starters"].includes(q.lineupBasis)
  )
    errors.push("Choose a valid lineup scoring basis.");
  // Validate the opponent scope before enumerating packages; only distinct, existing opposing fantasy teams are allowed.
  const selectedTeams = q.discovery?.teams;
  if (
    selectedTeams !== undefined &&
    (!selectedTeams.length ||
      new Set(selectedTeams).size !== selectedTeams.length ||
      selectedTeams.some(
        (id) =>
          id === "0" ||
          id === q.teamA ||
          !m.dataset.tables.ModelTeams.some((team) => str(team.TeamID) === id),
      ))
  )
    errors.push(
      "Select at least one valid opposing fantasy team to search, without duplicates.",
    );
  if (
    q.discovery?.target &&
    selectedTeams &&
    !selectedTeams.includes(m.byId.get(q.discovery.target)?.owner ?? "")
  )
    errors.push(
      "The required target belongs to an excluded team. Include that team or clear the target.",
    );
  // Every unselected player is protected; validate the explicit candidate pool before generating subsets.
  const flexible = q.discovery?.flexible;
  const offered = flexible?.pool ?? q.give;
  const maximum = flexible?.maximum ?? q.give.length;
  if (
    flexible &&
    (!Number.isInteger(flexible.minimum) ||
      !Number.isInteger(flexible.maximum) ||
      flexible.minimum < 1 ||
      flexible.maximum > 5 ||
      flexible.minimum > flexible.maximum ||
      flexible.minimum > flexible.pool.length ||
      flexible.pool.length > 12)
  )
    errors.push(
      "Choose up to 12 tradable players and outgoing counts from 1 to 5 within the pool size.",
    );
  if (
    q.discovery?.ranking &&
    !["own", "other", "balanced", "acceptance"].includes(q.discovery.ranking)
  )
    errors.push("Choose a recognized trade ranking.");
  if (q.discovery?.target) {
    const target = m.byId.get(q.discovery.target);
    if (
      !target ||
      target.owner === "0" ||
      target.owner === q.teamA ||
      n(target.index) === null
    )
      errors.push(
        "Choose a target with a usable index on another fantasy team.",
      );
  }
  // Only an enabled usefulness minimum is validated; genuine zero still requires a strictly positive upgrade.
  if (
    q.usefulness &&
    (!Number.isFinite(q.usefulness.minimum) || q.usefulness.minimum < 0)
  )
    errors.push(
      "Enter a nonnegative minimum Expected PPG improvement for usefulness.",
    );
  if (!m.dataset.tables.ModelTeams.some((t) => str(t.TeamID) === q.teamA))
    errors.push("Choose your team.");
  if (
    !offered.length ||
    offered.length > (flexible ? 12 : 5) ||
    new Set(offered).size !== offered.length
  )
    errors.push(
      flexible
        ? "Select one to twelve distinct tradable players."
        : "Select one to five distinct outgoing players.",
    );
  if (offered.some((id) => m.byId.get(id)?.owner !== q.teamA))
    errors.push("Outgoing players must belong to your selected team.");
  if (offered.some((id) => n(m.byId.get(id)?.index) === null))
    errors.push("An outgoing player has an unavailable index.");
  if (!Number.isInteger(q.count) || q.count < 1 || q.count > 5)
    errors.push("Choose one to five players to receive.");
  // Validate both incoming endpoints before the discovery worker enumerates any count in the range.
  const receive = incomingCountRange(q);
  if (
    !Number.isInteger(receive.minimum) ||
    !Number.isInteger(receive.maximum) ||
    receive.minimum < 1 ||
    receive.maximum > 5 ||
    receive.minimum > receive.maximum
  )
    errors.push(
      "Choose an incoming-player range from 1 to 5, with minimum no greater than maximum.",
    );
  if (
    q.indexMode !== "automatic" &&
    ![q.below, q.above].every((x) => Number.isFinite(x) && x >= 0)
  )
    errors.push("Enter nonnegative numbers for both index offsets.");
  // Disabled categories impose no minimum; enabled counts must fit the incoming package.
  for (const [selected, minimum, allowed, name] of [
    [
      q.incoming?.signals,
      q.incoming?.minimumSignals ?? 1,
      ["Gem", "Watch"],
      "Gem/Watch",
    ],
    [
      q.incoming?.positions,
      q.incoming?.minimumPositions ?? 1,
      positions,
      "position",
    ],
  ] as const) {
    if (!selected?.length) continue;
    if (
      new Set(selected).size !== selected.length ||
      selected.some((value) => !(allowed as readonly string[]).includes(value))
    )
      errors.push(`Choose valid, distinct incoming ${name} selections.`);
    if (!Number.isInteger(minimum) || minimum < 1 || minimum > receive.maximum)
      errors.push(
        `Minimum incoming ${name} matches must be a whole number from 1 to ${receive.maximum}.`,
      );
  }
  // Only enabled upgrade criteria are validated; disabled searches keep their previous behavior.
  if (
    q.upgrade &&
    (!["starter", "depth", "either", "best"].includes(q.upgrade.mode) ||
      !Number.isFinite(q.upgrade.minimum) ||
      q.upgrade.minimum < 0)
  )
    errors.push(
      "Choose a valid upgrade mode and a nonnegative Expected PPG advantage.",
    );
  // Enabled count requirements must be achievable with distinct offered players; inactive groups do not consume offers.
  if (q.upgrade) {
    const counts = upgradeCounts(q.upgrade);
    const explicit =
      q.upgrade.requiredStarters !== undefined ||
      q.upgrade.requiredBench !== undefined ||
      q.upgrade.requiredBest !== undefined;
    if (
      ![counts.starter, counts.depth, counts.best].every(
        (value) => Number.isInteger(value) && value >= 0 && value <= 5,
      ) ||
      (explicit && counts.starter + counts.depth + counts.best < 1) ||
      counts.starter + counts.depth + counts.best > maximum
    )
      errors.push(
        "Upgrade minimums must be whole numbers from 0 to 5, require at least one upgrade, and total no more than the outgoing players.",
      );
  }
  // One best-roster comparison exists per offered position, so duplicate-position offers cannot inflate this minimum.
  if (
    q.upgrade?.mode === "best" &&
    upgradeCounts(q.upgrade).best >
      new Set(offered.map((id) => m.byId.get(id)?.pos).filter(Boolean)).size
  )
    errors.push(
      "The best-at-position minimum cannot exceed the number of distinct offered positions.",
    );
  // The ceiling applies to one explicitly selected position actually represented in the outgoing package.
  if (
    q.deficit &&
    (!positions.includes(q.deficit.position) ||
      !offered.some((id) => m.byId.get(id)?.pos === q.deficit!.position) ||
      !positionGradeScale.some((grade) => grade === q.deficit!.ceiling))
  )
    errors.push(
      "Choose an offered deficit position and a valid grade ceiling.",
    );
  // Signed, inclusive weekly limits are independent for each team and validated only when enabled.
  for (const [label, range] of [
    ["Your", q.weekly?.own],
    ["Their", q.weekly?.other],
  ] as const) {
    if (!range) continue;
    if (
      ![range.minimum, range.maximum].every(
        (value) => value === null || Number.isFinite(value),
      )
    )
      errors.push(`${label} weekly limits must be finite numbers or blank.`);
    else if (
      range.minimum !== null &&
      range.maximum !== null &&
      range.minimum > range.maximum
    )
      errors.push(`${label} minimum weekly gain cannot exceed its maximum.`);
  }
  // One requested position keeps an upgrade distinct from gains elsewhere in the lineup.
  if (q.goal === "position" && q.incoming?.positions?.length !== 1)
    errors.push(
      "Choose one position for the position-upgrade goal, or use Custom search.",
    );
  const outgoing = sum(q.give.map((id) => m.byId.get(id)?.index ?? 0));
  // Automatic matching has no hidden price window; finite bounds retain safe enumerator arithmetic.
  const lower =
      q.indexMode === "automatic" ? -Number.MAX_VALUE : outgoing - q.below,
    upper = q.indexMode === "automatic" ? Number.MAX_VALUE : outgoing + q.above;
  if (![outgoing, lower, upper].every(Number.isFinite))
    errors.push("The combined index range must be finite.");
  return { errors, outgoing, lower, upper };
}

// Apply bounds to authoritative weekly averages; missing scoring never becomes zero.
export function matchesWeekly(
  row: Pick<SearchRow, "own" | "other">,
  filter?: WeeklyFilter,
) {
  return (
    [
      [row.own, filter?.own],
      [row.other, filter?.other],
    ] as const
  ).every(([value, range]) => {
    if (!range || (range.minimum === null && range.maximum === null))
      return true;
    return (
      n(value) !== null &&
      (range.minimum === null || value! >= range.minimum) &&
      (range.maximum === null || value! <= range.maximum)
    );
  });
}

// Compare known letter grades inclusively; unavailable grades are not silently treated as F.
export function gradeAtOrBelow(grade: string, ceiling: string) {
  const rank = positionGradeScale.findIndex((value) => value === grade);
  const limit = positionGradeScale.findIndex((value) => value === ceiling);
  return rank >= 0 && limit >= 0 && rank <= limit;
}

// Interpret only active groups, preserving any-one qualification for older Either requests without explicit counts.
export function upgradeCounts(filter: UpgradeFilter) {
  return {
    starter:
      filter.mode === "depth" || filter.mode === "best"
        ? 0
        : (filter.requiredStarters ?? (filter.mode === "starter" ? 1 : 0)),
    depth:
      filter.mode === "starter" || filter.mode === "best"
        ? 0
        : (filter.requiredBench ?? (filter.mode === "depth" ? 1 : 0)),
    best: filter.mode === "best" ? (filter.requiredBest ?? 1) : 0,
  };
}

// Counts and the selected deficit position must be satisfied by the same distinct-player assignment.
export function meetsUpgradeRequirements(
  m: Model,
  q: TradeSearchQuery,
  edges: UpgradeEvidence[],
) {
  if (!q.upgrade) return true;
  const required = upgradeCounts(q.upgrade);
  return (
    edges.length > 0 &&
    edges.filter((edge) => edge.group === "starter").length >=
      required.starter &&
    edges.filter((edge) => edge.group === "depth").length >= required.depth &&
    edges.filter((edge) => edge.group === "best").length >= required.best &&
    (!q.deficit ||
      edges.some(
        (edge) => m.byId.get(edge.offered)?.pos === q.deficit!.position,
      ))
  );
}

// Pair same-position arrivals and departures strongest-first, once per player; weaker retained teammates cannot disguise a downgrade.
function departureComparisons(m: Model, give: string[], departures: string[]) {
  const strongest = (a: Player, b: Player) =>
    (b.expected ?? Infinity) - (a.expected ?? Infinity) || cmpId(a.id, b.id);
  const comparisons = new Map<string, string>();
  for (const position of new Set(give.map((id) => m.byId.get(id)!.pos))) {
    const offered = give
      .map((id) => m.byId.get(id)!)
      .filter((p) => p.pos === position)
      .sort(strongest);
    const leaving = departures
      .map((id) => m.byId.get(id)!)
      .filter((p) => p.pos === position)
      .sort(strongest);
    leaving
      .slice(0, offered.length)
      .forEach((player, index) =>
        comparisons.set(offered[index].id, player.id),
      );
  }
  return comparisons;
}

// Assign fixed offered players to distinct current opponents before any players leave in the trade.
export function offeredUpgrades(
  m: Model,
  q: TradeSearchQuery,
  teamB: string,
  lineupsRaw?: string,
  departures: string[] = [],
): UpgradeEvidence[] {
  if (!q.upgrade) return [];
  const filter = q.upgrade;
  // Enumeration first checks general fit; complete packages then account for the actual surrendered positional counterpart.
  const replacements = departureComparisons(m, q.give, departures);
  // Best-roster fit ignores lineup designations and includes IR; unknown forecasts invalidate only their position.
  if (filter.mode === "best") {
    const roster = m.players.filter((player) => player.owner === teamB);
    const result: UpgradeEvidence[] = [];
    for (const position of new Set(q.give.map((id) => m.byId.get(id)?.pos))) {
      const peers = roster.filter((player) => player.pos === position);
      if (!peers.length || peers.some((player) => n(player.expected) === null))
        continue;
      const best = [...peers].sort(
        (a, b) => b.expected! - a.expected! || cmpId(a.id, b.id),
      )[0];
      // Choose one strongest qualifying offer per position; ties use PlayerID and never reuse their best player.
      const offered = q.give
        .map((id) => m.byId.get(id))
        .filter(
          (player): player is Player =>
            !!player &&
            player.pos === position &&
            n(player.expected) !== null &&
            player.expected! > best.expected! &&
            player.expected! - best.expected! >= filter.minimum,
        )
        .sort((a, b) => b.expected! - a.expected! || cmpId(a.id, b.id))[0];
      if (offered)
        result.push({
          offered: offered.id,
          compared: best.id,
          group: "best",
          offeredPPG: offered.expected!,
          comparedPPG: best.expected!,
          gain: offered.expected! - best.expected!,
          source: "Best roster Expected PPG (including bench and IR)",
        });
    }
    return result.sort(
      (a, b) => cmpId(a.offered, b.offered) || cmpId(a.compared, b.compared),
    );
  }
  const starter = readStarterLineup(m, teamB, lineupsRaw);
  // Actual starter/bench membership must be known; never infer bench status from an invalid plan or IR.
  if (starter.errors.length) return [];
  const starterIds = new Set(starter.ids);
  const offered = q.give
    .map((id) => m.byId.get(id))
    .filter((p): p is Player => !!p && n(p.expected) !== null)
    .sort((a, b) => cmpId(a.id, b.id));
  const opponents = m.players
    .filter((p) => p.owner === teamB && n(p.expected) !== null)
    .sort((a, b) => cmpId(a.id, b.id));
  // Canonical display order and stable IDs make equal-valued solutions independent of roster/selection order.
  const order = (a: UpgradeEvidence, b: UpgradeEvidence) =>
    Number(a.group === "depth") - Number(b.group === "depth") ||
    cmpId(a.offered, b.offered) ||
    cmpId(a.compared, b.compared);
  const totals = (edges: UpgradeEvidence[]) => [
    edges.filter((e) => e.group === "starter").length,
    edges.filter((e) => e.group === "depth").length,
    sum(edges.filter((e) => e.group === "starter").map((e) => e.gain)),
    sum(edges.map((e) => e.gain)),
  ];
  // Counts dominate advantages: maximize starters, then depth; use larger starter/total gains only to break ties.
  const better = (a: UpgradeEvidence[], b: UpgradeEvidence[]) => {
    const left = totals(a),
      right = totals(b);
    for (let i = 0; i < left.length; i++)
      if (left[i] !== right[i]) return left[i] > right[i];
    for (let i = 0; i < a.length; i++) {
      const tie = order(a[i], b[i]);
      if (tie) return tie < 0;
    }
    return false;
  };
  // Retain each starter-count alternative per offer mask so starter priority cannot discard a requested bench mix.
  const width = offered.length + 1;
  let states: (UpgradeEvidence[] | undefined)[] = Array(
    (1 << offered.length) * width,
  );
  states[0] = [];
  for (const opponent of opponents) {
    const group = starterIds.has(opponent.id) ? "starter" : "depth";
    if (filter.mode !== "either" && filter.mode !== group) continue;
    if (
      group === "depth" &&
      (opponent.slot === 21 ||
        (starter.source === "Imported ESPN lineup" && opponent.slot !== 20))
    )
      continue;
    const next = [...states];
    // Read only the previous states so this opponent cannot be consumed by two offers in the same iteration.
    for (let state = 0; state < states.length; state++) {
      const previous = states[state];
      if (!previous) continue;
      const mask = Math.floor(state / width),
        starterCount = state % width;
      for (let i = 0; i < offered.length; i++) {
        const player = offered[i];
        if (mask & (1 << i) || player.pos !== opponent.pos) continue;
        // Beat the surrendered counterpart as well as the role; a departing starter cannot be replaced by a weaker reference.
        const departure = replacements.get(player.id);
        const departurePPG = departure
          ? (m.byId.get(departure)!.expected ?? Infinity)
          : null;
        if (
          departurePPG !== null &&
          (player.expected! <= departurePPG ||
            player.expected! - departurePPG < filter.minimum ||
            (starterIds.has(departure!) && opponent.expected! < departurePPG))
        )
          continue;
        const gain = player.expected! - opponent.expected!;
        if (gain <= 0 || gain < filter.minimum) continue;
        const candidate = [
          ...previous,
          {
            offered: player.id,
            compared: opponent.id,
            group,
            offeredPPG: player.expected!,
            comparedPPG: opponent.expected!,
            gain,
            source:
              group === "starter"
                ? starter.source
                : `${starter.source} (bench)`,
          } satisfies UpgradeEvidence,
        ].sort(order);
        const target =
          (mask | (1 << i)) * width +
          starterCount +
          Number(group === "starter");
        if (!next[target] || better(candidate, next[target]!))
          next[target] = candidate;
      }
    }
    states = next;
  }
  // Prefer qualifying mixes, then retain existing starter/gain/ID priorities; partial results explain rejected teams in callers.
  const candidates = states.filter(
    (candidate): candidate is UpgradeEvidence[] => !!candidate,
  );
  const qualified = candidates.filter((candidate) =>
    meetsUpgradeRequirements(m, q, candidate),
  );
  return (qualified.length ? qualified : candidates).reduce<UpgradeEvidence[]>(
    (best, candidate) => (better(candidate, best) ? candidate : best),
    [],
  );
}

// Count only players satisfying every enabled category, so a WR and an unrelated Gem cannot qualify together.
export function matchesIncoming(players: Player[], filter?: IncomingFilter) {
  const signals = filter?.signals ?? [],
    selected = filter?.positions ?? [];
  const count = players.filter(
    (p) =>
      (!signals.length || signals.includes(p.gem as "Gem" | "Watch")) &&
      (!selected.length || selected.includes(p.pos as Position)),
  ).length;
  return (
    (!signals.length || count >= (filter?.minimumSignals ?? 1)) &&
    (!selected.length || count >= (filter?.minimumPositions ?? 1))
  );
}

// Enumerate complete, same-owner combinations; conservative bounds prune only impossible branches.
export function findTradeMatches(
  m: Model,
  q: TradeSearchQuery,
  onProgress?: (stats: SearchStats) => void,
  lineupsRaw?: string,
) {
  const bounds = tradeSearchBounds(m, q);
  if (bounds.errors.length) throw Error(bounds.errors.join(" "));
  const teams = m.dataset.tables.ModelTeams.map((t) => str(t.TeamID))
    .filter((id) => id !== "0" && id !== q.teamA)
    // Restrict owners before building singles or packages; excluded teams never enter evaluation or near misses.
    .filter(
      (id) =>
        q.discovery?.teams === undefined || q.discovery.teams.includes(id),
    )
    // A named target restricts both the counterparty and package membership, never combines owners.
    .filter(
      (id) =>
        !q.discovery?.target || m.byId.get(q.discovery.target)?.owner === id,
    )
    .sort(cmpId);
  const stats: SearchStats = {
    teams: teams.length,
    checked: 0,
    excluded: 0,
    thinTeams: 0,
    matched: 0,
    scored: 0,
    ...(q.upgrade ? { upgradeExcluded: 0 } : {}),
    ...(q.deficit ? { deficitExcluded: 0 } : {}),
    ...(q.incoming ? { incomingExcluded: 0 } : {}),
  };
  // Compute the same grades displayed in Teams once, from the unchanged pre-trade snapshot.
  const assessments = q.deficit ? teamsAssessment(m) : undefined;
  const matches: SearchMatch[] = [];
  let nodes = 0;
  for (const teamB of teams) {
    const assessed = q.deficit
      ? assessments
          ?.get(teamB)
          ?.find((row) => row.position === q.deficit!.position)
      : undefined;
    if (
      q.deficit &&
      (!assessed || !gradeAtOrBelow(assessed.grade, q.deficit.ceiling))
    ) {
      stats.deficitExcluded!++;
      stats.checked++;
      onProgress?.({ ...stats });
      continue;
    }
    const deficit =
      q.deficit && assessed
        ? { ...q.deficit, grade: assessed.grade, status: assessed.status }
        : undefined;
    // Fit is identical for every incoming package from this team, so check it once before enumeration/scoring.
    const upgrades = q.upgrade
      ? offeredUpgrades(m, q, teamB, lineupsRaw)
      : undefined;
    // Reject missing comparisons and partial assignments unless every requested minimum and deficit-position rule passes.
    if (upgrades && !meetsUpgradeRequirements(m, q, upgrades)) {
      stats.upgradeExcluded!++;
      stats.checked++;
      onProgress?.({ ...stats });
      continue;
    }
    const owned = m.players.filter((p) => p.owner === teamB);
    const pool = owned
      .filter((p) => n(p.index) !== null)
      .sort((a, b) => a.index! - b.index! || cmpId(a.id, b.id));
    stats.excluded += owned.length - pool.length;
    if (pool.length < q.count) stats.thinTeams++;
    const chosen: Player[] = [];
    // Increasing positions avoid permutations; comparison uses unrounded numeric sums.
    function visit(start: number, remaining: number, total: number) {
      if (++nodes % 2048 === 0) onProgress?.({ ...stats });
      if (!remaining) {
        if (total >= bounds.lower && total <= bounds.upper) {
          if (
            q.discovery?.target &&
            !chosen.some((p) => p.id === q.discovery!.target)
          )
            return;
          // Screen complete index-matching packages before scoring; existing index pruning and sort order remain intact.
          if (!matchesIncoming(chosen, q.incoming)) {
            stats.incomingExcluded = (stats.incomingExcluded ?? 0) + 1;
            return;
          }
          const get = chosen.map((p) => p.id).sort(cmpId);
          // Recheck the actual package: team-level fit cannot know which stronger players will be surrendered.
          const packageUpgrades =
            q.upgrade &&
            get.some((id) =>
              q.give.some(
                (offered) => m.byId.get(offered)!.pos === m.byId.get(id)!.pos,
              ),
            )
              ? offeredUpgrades(m, q, teamB, lineupsRaw, get)
              : upgrades;
          if (
            packageUpgrades &&
            !meetsUpgradeRequirements(m, q, packageUpgrades)
          ) {
            stats.upgradeExcluded!++;
            return;
          }
          matches.push({
            key: JSON.stringify([teamB, get]),
            teamB,
            get,
            incoming: total,
            outgoing: bounds.outgoing,
            difference: total - bounds.outgoing,
            ...(packageUpgrades ? { upgrades: packageUpgrades } : {}),
            ...(deficit ? { deficit } : {}),
          });
          stats.matched++;
        }
        return;
      }
      if (pool.length - start < remaining) return;
      // Leave a generous floating-point guard on pruning only; final membership has no rounding/tolerance.
      const minimum =
        total + sum(pool.slice(start, start + remaining).map((p) => p.index!));
      const maximum = total + sum(pool.slice(-remaining).map((p) => p.index!));
      const guard =
        Number.EPSILON *
        64 *
        Math.max(
          1,
          Math.abs(minimum),
          Math.abs(maximum),
          Math.abs(bounds.lower),
          Math.abs(bounds.upper),
        );
      if (minimum > bounds.upper + guard || maximum < bounds.lower - guard)
        return;
      for (let i = start; i <= pool.length - remaining; i++) {
        chosen.push(pool[i]);
        visit(i + 1, remaining - 1, total + pool[i].index!);
        chosen.pop();
      }
    }
    visit(0, q.count, 0);
    stats.checked++;
    onProgress?.({ ...stats });
  }
  return { matches, stats };
}

// Check the evaluator's trade-only legal roster; waiver claims never manufacture usefulness for an offered player.
export function packageUsefulness(
  m: Model,
  q: TradeSearchQuery,
  initial: string[],
  after: string[],
  ir: string[],
  allowPartial = false,
): UsefulnessEvidence[] {
  if (!q.usefulness) return [];
  if (rosterExcess(m, after) > 0) return [];
  const excluded = new Set(ir);
  const bag = after
    .filter((id) => !excluded.has(id))
    .map((id) => m.byId.get(id)!);
  if (
    q.give.some(
      (id) =>
        !bag.some((p) => p.id === id) ||
        n(m.byId.get(id)?.expected) === null ||
        m.byId.get(id)!.available <= 0,
    )
  )
    return [];
  // Baselines use the original active roster, including departing/dropped players, so the trade cannot manufacture vacancies.
  const originalIR = new Set(irAssignments(m, initial));
  const incumbents = initial
    .filter((id) => !originalIR.has(id))
    .map((id) => m.byId.get(id)!);
  // Missing forecasts before or after the trade cannot establish a reliable improvement in a competing position.
  const offeredPositions = new Set(q.give.map((id) => m.byId.get(id)!.pos));
  const flexPositions = ["RB", "WR", "TE"];
  if (
    [...incumbents, ...bag].some(
      (p) =>
        (offeredPositions.has(p.pos) ||
          (num(m.dataset.tables.ModelContext[0].FlexSlots) > 0 &&
            flexPositions.includes(p.pos) &&
            [...offeredPositions].some((pos) =>
              flexPositions.includes(pos),
            ))) &&
        (n(p.expected) === null || n(p.value) === null),
    )
  )
    return [];
  // Healthy slot assignment measures general roster fit through the horizon, rather than one week's bye/matchup.
  const before = lineup(
    m,
    incumbents.map((p) => p.id),
    m.current,
    false,
    true,
    "expected",
  );
  const final = lineup(
    m,
    bag.map((p) => p.id),
    m.current,
    false,
    true,
    "expected",
  );
  const beforeStarters = new Set(before.ids.filter(Boolean)),
    finalStarters = new Set(final.ids.filter(Boolean));
  // Empty starting slots do not create additional bench slots for otherwise unusable offers.
  if (
    bag.length - finalStarters.size >
    num(m.dataset.tables.ModelContext[0].BenchSlots)
  )
    return [];
  const byStrength = (a: Player, b: Player) =>
    b.expected! - a.expected! || cmpId(a.id, b.id);
  const reserve = (
    players: Player[],
    starters: Set<string | null>,
    pos: Position,
  ) =>
    players
      .filter((p) => p.pos === pos && !starters.has(p.id))
      .sort(byStrength);
  // One best-backup role exists per position; all incoming players compete for those same finite roles.
  const roles = before.ids.map((id, i) => ({
    id,
    group: "starter" as "starter" | "depth",
    slot: before.slots[i],
    key: `${before.slots[i]} starter ${before.slots.slice(0, i + 1).filter((slot) => slot === before.slots[i]).length}`,
  }));
  for (const pos of offeredPositions)
    roles.push({
      id: reserve(incumbents, beforeStarters, pos)[0]?.id ?? null,
      group: "depth",
      slot: pos,
      key: `${pos} best backup`,
    });
  const offered = q.give
    .map((id) => m.byId.get(id)!)
    .sort((a, b) => cmpId(a.id, b.id));
  // Apply the same departure-aware reference to automatic explanations and all-offer usefulness checks, including required drops.
  const replacements = departureComparisons(
    m,
    q.give,
    initial.filter((id) => !after.includes(id)),
  );
  let states: (UsefulnessEvidence[] | undefined)[] = Array(1 << offered.length);
  states[0] = [];
  // A role is consumed once, and the bitmask consumes each offer once; larger gains only break equal-coverage ties.
  for (const role of roles) {
    // A surviving starter already fills a role; an offer must improve a displaced or departing starter instead.
    if (role.group === "starter" && role.id && finalStarters.has(role.id))
      continue;
    const next = [...states];
    for (let mask = 0; mask < states.length; mask++) {
      const previous = states[mask];
      if (!previous) continue;
      for (let i = 0; i < offered.length; i++) {
        const player = offered[i];
        if (mask & (1 << i)) continue;
        // Keep genuine promotions from depth, but a weaker return cannot replace a stronger departing counterpart and claim an upgrade.
        const departure = replacements.get(player.id);
        const departurePPG = departure
          ? (m.byId.get(departure)!.expected ?? Infinity)
          : null;
        if (
          departurePPG !== null &&
          (player.expected! <= departurePPG ||
            player.expected! - departurePPG < q.usefulness.minimum ||
            (beforeStarters.has(departure!) &&
              (role.id ? (m.byId.get(role.id)!.expected ?? -Infinity) : 0) <
                departurePPG))
        )
          continue;
        const starter = finalStarters.has(player.id);
        if (!starter && num(m.dataset.tables.ModelContext[0].BenchSlots) <= 0)
          continue;
        if (
          (role.group === "starter") !== starter ||
          (role.slot === "FLEX"
            ? !flexPositions.includes(player.pos)
            : role.slot !== player.pos)
        )
          continue;
        const reserves = reserve(bag, finalStarters, player.pos);
        if (!starter && reserves[0]?.id !== player.id) continue;
        const compared = role.id ? m.byId.get(role.id)! : null;
        const comparedPPG = compared?.expected ?? 0;
        // A displaced starter can become strong depth: the incoming reserve must beat that competition too.
        const competitionPPG = starter
          ? null
          : (reserves.find((p) => p.id !== player.id)?.expected ?? 0);
        const gain = player.expected! - comparedPPG;
        const qualifyingGain =
          player.expected! -
          Math.max(comparedPPG, competitionPPG ?? comparedPPG);
        if (
          gain <= 0 ||
          qualifyingGain <= 0 ||
          qualifyingGain < q.usefulness.minimum
        )
          continue;
        const candidate = [
          ...previous,
          {
            offered: player.id,
            compared: role.id,
            group: role.group,
            role: role.key,
            offeredPPG: player.expected!,
            comparedPPG,
            gain,
            // Retain the actual search threshold with its evidence, even if the user edits controls before rerunning.
            minimum: q.usefulness.minimum,
            competitionPPG,
            competitionGain:
              competitionPPG === null
                ? null
                : player.expected! - competitionPPG,
          },
        ];
        const target = mask | (1 << i);
        if (
          !next[target] ||
          sum(candidate.map((e) => e.gain)) >
            sum(next[target]!.map((e) => e.gain))
        )
          next[target] = candidate;
      }
    }
    states = next;
  }
  // Explanations may show a partial set of genuine improvements; the search filter still requires every offer by default.
  if (allowPartial)
    return states.reduce<UsefulnessEvidence[]>(
      (best, candidate) =>
        candidate &&
        (candidate.length > best.length ||
          (candidate.length === best.length &&
            sum(candidate.map((e) => e.gain)) > sum(best.map((e) => e.gain))))
          ? candidate
          : best,
      [],
    );
  return states[states.length - 1] ?? [];
}

// Delegate all trade math to the existing evaluator, retaining invalid matches with unavailable scores.
export function scoreTradeMatch(
  m: Model,
  q: TradeSearchQuery,
  match: SearchMatch,
  lineupsRaw?: string,
  // Chain search can reuse its already evaluated trade without repeating legal-roster and weekly calculations.
  evaluated?: TradeResult,
): SearchRow {
  // Use the chosen subset rather than the draft/pool for every authoritative trade calculation.
  if (match.give) q = { ...q, give: [...match.give] };
  const r =
    evaluated ??
    evaluateTrade(
      m,
      {
        teamA: q.teamA,
        teamB: match.teamB,
        give: [...q.give],
        get: [...match.get],
      },
      // Search scores are trade-only: legal waiver additions cannot change these gains, tests or injury warnings.
      false,
      lineupsRaw,
    );
  if (!r.valid)
    return {
      ...match,
      lineupBasis: readLineupBasis(q.lineupBasis),
      own: null,
      other: null,
      ownTotal: null,
      otherTotal: null,
      grade: "Unavailable",
      surplus: "UNAVAILABLE",
      points: "UNAVAILABLE",
      legal: null,
      warnings: r.errors,
      dropsA: [],
      dropsB: [],
      irA: [],
      irB: [],
    };
  // Select both sides under the same captured basis before filtering or ranking the package.
  const impact = tradeImpact(r, q.lineupBasis)!;
  const availability = [...q.give, ...match.get].flatMap((id) => {
    const p = m.byId.get(id)!;
    return [
      p.injury !== "ACTIVE" ? `${p.name}: ${p.injury}` : "",
      !m.ignoreByeWeeks && p.bye === m.current
        ? `${p.name}: bye this week`
        : "",
    ].filter(Boolean);
  });
  return {
    ...match,
    // Scored/direct inspections must use the complete package too, rather than retaining a broad team-level comparison.
    ...(q.upgrade
      ? { upgrades: offeredUpgrades(m, q, match.teamB, lineupsRaw, match.get) }
      : {}),
    // Use the same legal roster and drop proposals already used for this package's authoritative scoring.
    ...(q.usefulness
      ? { usefulness: packageUsefulness(m, q, r.initialB, r.legalB, r.irB) }
      : {}),
    // Attribute points in the same optimized weekly lineups to the requested position, including FLEX.
    ...(q.goal === "position"
      ? {
          positionGain:
            impact.own.expectedPerWeek === null
              ? null
              : sum(
                  impact.own.weekly.map((w) => {
                    const score = (ids: (string | null)[]) =>
                      sum(
                        ids.map((id) =>
                          id &&
                          m.byId.get(id)?.pos === q.incoming?.positions?.[0]
                            ? m.byId.get(id)!.expected!
                            : 0,
                        ),
                      );
                    return score(w.ids) - score(w.beforeIds);
                  }),
                ) / m.weeks.length,
        }
      : {}),
    // Capture the same legal roster/drop decisions used for private scoring, while evaluating visible averages separately.
    ...(q.manager
      ? {
          manager: managerAssessment(
            m,
            {
              teamA: q.teamA,
              teamB: match.teamB,
              give: q.give,
              get: match.get,
            },
            r,
            q.manager,
          ),
        }
      : {}),
    ...(q.surface
      ? {
          surface: surfaceAppeal(
            m,
            {
              teamA: q.teamA,
              teamB: match.teamB,
              give: q.give,
              get: match.get,
            },
            r,
            q.surface,
            q.lineupBasis,
            lineupsRaw,
          ),
        }
      : {}),
    lineupBasis: impact.basis,
    ownBefore: impact.own.beforePerWeek,
    ownAfter: impact.own.afterPerWeek,
    otherBefore: impact.other.beforePerWeek,
    otherAfter: impact.other.afterPerWeek,
    own: n(impact.own.expectedPerWeek),
    other: n(impact.other.expectedPerWeek),
    ownTotal: n(impact.own.expected),
    otherTotal: n(impact.other.expected),
    grade: r.grade,
    surplus: r.surplusTest,
    points: r.pointsTest,
    legal: r.legality,
    warnings: [
      ...new Set([
        ...r.uncertainty,
        ...r.directA.errors,
        ...r.directA.warnings,
        ...r.directB.errors,
        ...r.directB.warnings,
        ...r.potentialA.errors,
        ...r.potentialB.errors,
        ...availability,
        ...(m.simulation?.issues ?? []),
        ...(!r.legality ? ["Unresolved roster conflict"] : []),
      ]),
    ],
    dropsA: r.dropsA,
    dropsB: r.dropsB,
    irA: r.irA,
    irB: r.irB,
  };
}

// Explain the exact evaluated lineups on demand; positional-fit assignments are not scoring replacements.
export function searchLineupDetails(
  m: Model,
  q: TradeSearchQuery,
  match: SearchMatch,
  lineupsRaw?: string,
): SearchLineupDetails {
  // Expanded replacements must describe the same outgoing subset that produced this result.
  if (match.give) q = { ...q, give: [...match.give] };
  const r = evaluateTrade(
    m,
    {
      teamA: q.teamA,
      teamB: match.teamB,
      give: [...q.give],
      get: [...match.get],
    },
    true,
    lineupsRaw,
  );
  if (!r.valid) throw Error(r.errors.join(" "));
  const side = (direct: typeof r.directA): SearchLineupSide => ({
    source: direct.source,
    expectedPerWeek: direct.expectedPerWeek,
    expectedTotal: direct.expected,
    replacements: direct.replacements,
    incoming: direct.promotedIncoming,
    benchOutgoing: direct.benchOutgoing,
    issues: [...direct.errors, ...direct.warnings],
    weekly: direct.weekly.map((week) => ({
      week: week.week,
      before: week.beforeExpected,
      after: week.afterExpected,
      gain: week.expectedGain,
      // A player may move between WR/RB/TE and FLEX; show slot changes rather than inventing one-to-one swaps.
      changes: week.slots.flatMap((slot, i) => {
        const before = week.beforeIds[i] || null,
          after = week.ids[i] || null;
        if (before === after) return [];
        const beforePoints = before ? n(m.byId.get(before)?.expected) : 0;
        const afterPoints = after ? n(m.byId.get(after)?.expected) : 0;
        return [
          {
            slot,
            before,
            after,
            gain:
              week.expectedGain === null ||
              beforePoints === null ||
              afterPoints === null
                ? null
                : afterPoints - beforePoints,
          },
        ];
      }),
    })),
  });
  // Primary details follow the captured query; the other basis remains explicitly secondary.
  const selected = tradeImpact(r, q.lineupBasis)!;
  const alternative = tradeImpact(
    r,
    selected.basis === "marked-starters" ? "best-available" : "marked-starters",
  )!;
  return {
    own: side(selected.own),
    other: side(selected.other),
    ownMarked: side(alternative.own),
    otherMarked: side(alternative.other),
  };
}

// Sort every scored match globally, with unavailable scores after real losses and stable ID ties.
export function compareSearchRows(a: SearchRow, b: SearchRow) {
  if (a.own === null && b.own !== null) return 1;
  if (b.own === null && a.own !== null) return -1;
  return (
    (b.own ?? 0) - (a.own ?? 0) ||
    Math.abs(a.difference) - Math.abs(b.difference) ||
    cmpId(a.teamB, b.teamB) ||
    a.get.reduce((order, id, i) => order || cmpId(id, b.get[i] ?? ""), 0)
  );
}
