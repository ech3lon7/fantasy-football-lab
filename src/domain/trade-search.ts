import {
  cmpId,
  n,
  str,
  sum,
  positions,
  type Position,
  type Dataset,
  type Settings,
} from "./contracts";
// Reuse existing league-relative positional grades rather than inventing a second grade formula.
import { teamsAssessment } from "./lineups";
import { evaluateTrade } from "./trades";
// Positional fit uses the same saved/imported starter assignments as the existing analyzer.
import { readStarterLineup } from "./starter-lineups";
import type { Model, Player } from "./valuation";

// Optional discovery criteria never change valuations or the trade evaluator's inputs.
export interface UpgradeFilter {
  mode: "starter" | "depth" | "either";
  minimum: number;
  // Optional counts retain the legacy any-one behavior for existing callers without count criteria.
  requiredStarters?: number;
  requiredBench?: number;
}
export interface UpgradeEvidence {
  offered: string;
  compared: string;
  group: "starter" | "depth";
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
}
// Search contracts are temporary analysis state, never part of the synced workspace schema.
export interface TradeSearchQuery {
  teamA: string;
  give: string[];
  count: number;
  below: number;
  above: number;
  upgrade?: UpgradeFilter;
  weekly?: WeeklyFilter;
  deficit?: DeficitFilter;
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
}
export interface SearchRow extends SearchMatch {
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
  deficitExcluded?: number;
}
export interface SearchProgress {
  phase: "Finding matching packages" | "Evaluating trades" | "Sorting results";
  stats: SearchStats;
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
    workspace,
    m.dataset.hash,
    m.analysisVersion,
    m.weeks,
    Object.entries(m.settings).sort(([a], [b]) => a.localeCompare(b)),
    m.evidenceRaw,
    m.roleScenarioWeight,
    lineupsRaw,
    query.teamA,
    query.give,
    query.count,
    query.below,
    query.above,
    // Disabled controls do not affect existing searches; enabled changes invalidate old results.
    query.upgrade
      ? [
          query.upgrade.mode,
          query.upgrade.minimum,
          query.upgrade.requiredStarters ?? null,
          query.upgrade.requiredBench ?? null,
        ]
      : null,
    query.deficit ? [query.deficit.position, query.deficit.ceiling] : null,
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
  if (!m.dataset.tables.ModelTeams.some((t) => str(t.TeamID) === q.teamA))
    errors.push("Choose your team.");
  if (
    !q.give.length ||
    q.give.length > 5 ||
    new Set(q.give).size !== q.give.length
  )
    errors.push("Select one to five distinct outgoing players.");
  if (q.give.some((id) => m.byId.get(id)?.owner !== q.teamA))
    errors.push("Outgoing players must belong to your selected team.");
  if (q.give.some((id) => n(m.byId.get(id)?.index) === null))
    errors.push("An outgoing player has an unavailable index.");
  if (!Number.isInteger(q.count) || q.count < 1 || q.count > 5)
    errors.push("Choose one to five players to receive.");
  if (![q.below, q.above].every((x) => Number.isFinite(x) && x >= 0))
    errors.push("Enter nonnegative numbers for both index offsets.");
  // Only enabled upgrade criteria are validated; disabled searches keep their previous behavior.
  if (
    q.upgrade &&
    (!["starter", "depth", "either"].includes(q.upgrade.mode) ||
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
      q.upgrade.requiredBench !== undefined;
    if (
      ![counts.starter, counts.depth].every(
        (value) => Number.isInteger(value) && value >= 0 && value <= 5,
      ) ||
      (explicit && counts.starter + counts.depth < 1) ||
      counts.starter + counts.depth > q.give.length
    )
      errors.push(
        "Upgrade minimums must be whole numbers from 0 to 5, require at least one upgrade, and total no more than the outgoing players.",
      );
  }
  // The ceiling applies to one explicitly selected position actually represented in the outgoing package.
  if (
    q.deficit &&
    (!positions.includes(q.deficit.position) ||
      !q.give.some((id) => m.byId.get(id)?.pos === q.deficit!.position) ||
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
  const outgoing = sum(q.give.map((id) => m.byId.get(id)?.index ?? 0));
  const lower = outgoing - q.below,
    upper = outgoing + q.above;
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
      filter.mode === "depth"
        ? 0
        : (filter.requiredStarters ?? (filter.mode === "starter" ? 1 : 0)),
    depth:
      filter.mode === "starter"
        ? 0
        : (filter.requiredBench ?? (filter.mode === "depth" ? 1 : 0)),
  };
}

// Counts and the selected deficit position must be satisfied by the same distinct-player assignment.
function meetsUpgradeRequirements(
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
    (!q.deficit ||
      edges.some(
        (edge) => m.byId.get(edge.offered)?.pos === q.deficit!.position,
      ))
  );
}

// Assign fixed offered players to distinct current opponents before any players leave in the trade.
export function offeredUpgrades(
  m: Model,
  q: TradeSearchQuery,
  teamB: string,
  lineupsRaw?: string,
): UpgradeEvidence[] {
  if (!q.upgrade) return [];
  const filter = q.upgrade;
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
          const get = chosen.map((p) => p.id).sort(cmpId);
          matches.push({
            key: JSON.stringify([teamB, get]),
            teamB,
            get,
            incoming: total,
            outgoing: bounds.outgoing,
            difference: total - bounds.outgoing,
            ...(upgrades ? { upgrades } : {}),
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

// Delegate all trade math to the existing evaluator, retaining invalid matches with unavailable scores.
export function scoreTradeMatch(
  m: Model,
  q: TradeSearchQuery,
  match: SearchMatch,
  lineupsRaw?: string,
): SearchRow {
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
  if (!r.valid)
    return {
      ...match,
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
  const availability = [...q.give, ...match.get].flatMap((id) => {
    const p = m.byId.get(id)!;
    return [
      p.injury !== "ACTIVE" ? `${p.name}: ${p.injury}` : "",
      p.bye === m.current ? `${p.name}: bye this week` : "",
    ].filter(Boolean);
  });
  return {
    ...match,
    own: n(r.directA.expectedPerWeek),
    other: n(r.directB.expectedPerWeek),
    ownTotal: n(r.directA.expected),
    otherTotal: n(r.directB.expected),
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
        ...availability,
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
  return { own: side(r.directA), other: side(r.directB) };
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
