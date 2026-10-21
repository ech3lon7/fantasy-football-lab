import { cmpId, n, str, sum, type Dataset, type Settings } from "./contracts";
import { evaluateTrade } from "./trades";
// Positional fit uses the same saved/imported starter assignments as the existing analyzer.
import { readStarterLineup } from "./starter-lineups";
import type { Model, Player } from "./valuation";

// Optional discovery criteria never change valuations or the trade evaluator's inputs.
export interface UpgradeFilter {
  mode: "starter" | "depth" | "either";
  minimum: number;
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
// Horizon limits filter the existing remaining-season point totals; null means no bound on that side.
export interface HorizonRange {
  minimum: number | null;
  maximum: number | null;
}
export interface HorizonFilter {
  own?: HorizonRange;
  other?: HorizonRange;
}
// Search contracts are temporary analysis state, never part of the synced workspace schema.
export interface TradeSearchQuery {
  teamA: string;
  give: string[];
  count: number;
  below: number;
  above: number;
  upgrade?: UpgradeFilter;
  horizon?: HorizonFilter;
}
export interface SearchMatch {
  key: string;
  teamB: string;
  get: string[];
  incoming: number;
  outgoing: number;
  difference: number;
  upgrades?: UpgradeEvidence[];
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
  horizonExcluded?: number;
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
  | { type: "page"; id: string; context: string; offset: number };
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
    query.upgrade ? [query.upgrade.mode, query.upgrade.minimum] : null,
    // Distinguish invalid numeric edits from valid unbounded limits so stale searches cannot revive.
    query.horizon
      ? [query.horizon.own, query.horizon.other].map((range) =>
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
  // Signed, inclusive horizon limits are independent for each team and validated only when enabled.
  for (const [label, range] of [
    ["Your", q.horizon?.own],
    ["Their", q.horizon?.other],
  ] as const) {
    if (!range) continue;
    if (
      ![range.minimum, range.maximum].every(
        (value) => value === null || Number.isFinite(value),
      )
    )
      errors.push(`${label} horizon limits must be finite numbers or blank.`);
    else if (
      range.minimum !== null &&
      range.maximum !== null &&
      range.minimum > range.maximum
    )
      errors.push(`${label} minimum horizon gain cannot exceed its maximum.`);
  }
  const outgoing = sum(q.give.map((id) => m.byId.get(id)?.index ?? 0));
  const lower = outgoing - q.below,
    upper = outgoing + q.above;
  if (![outgoing, lower, upper].every(Number.isFinite))
    errors.push("The combined index range must be finite.");
  return { errors, outgoing, lower, upper };
}

// Apply both teams' active bounds to authoritative totals, never per-week averages or unavailable-as-zero values.
export function matchesHorizon(
  row: Pick<SearchRow, "ownTotal" | "otherTotal">,
  filter?: HorizonFilter,
) {
  return (
    [
      [row.ownTotal, filter?.own],
      [row.otherTotal, filter?.other],
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
  // At most five offered players means only 32 masks; each opponent is processed once to prohibit reuse.
  let states: (UpgradeEvidence[] | undefined)[] = Array(1 << offered.length);
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
    for (let mask = 0; mask < states.length; mask++) {
      const previous = states[mask];
      if (!previous) continue;
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
        const target = mask | (1 << i);
        if (!next[target] || better(candidate, next[target]!))
          next[target] = candidate;
      }
    }
    states = next;
  }
  // Unmatched offered players are allowed: the discovery filter still requires only one genuine upgrade.
  return states.reduce<UpgradeEvidence[]>(
    (best, candidate) =>
      candidate && better(candidate, best) ? candidate : best,
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
  };
  const matches: SearchMatch[] = [];
  let nodes = 0;
  for (const teamB of teams) {
    // Fit is identical for every incoming package from this team, so check it once before enumeration/scoring.
    const upgrades = q.upgrade
      ? offeredUpgrades(m, q, teamB, lineupsRaw)
      : undefined;
    if (upgrades && !upgrades.length) {
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
