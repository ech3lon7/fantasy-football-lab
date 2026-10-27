import { cmpId, num, str, sum, type Draft } from "./contracts";
import { evaluateTrade, type TradeResult } from "./trades";
import {
  scoreTradeMatch,
  type SearchRow,
  type TradeSearchQuery,
} from "./trade-search";
import { readLineupBasis, type LineupBasis } from "./trade-impact";
import {
  applyRosterScenario,
  scenarioRosterBase,
  sourceDataset,
  type RosterScenario,
  type ScenarioMove,
} from "./roster-scenarios";
import type { Model, Player } from "./valuation";

// Chain controls are independent of ordinary single-trade filters; all values are in average remaining-season points/week.
export interface ChainQuery {
  team: string;
  pool: string[];
  mode: "safe" | "speculative" | "both";
  maximumLoss: number;
  minimumGain: number;
  first: { offer: ChainRange; receive: ChainRange; teams?: string[] };
  second: { offer: ChainRange; receive: ChainRange; teams?: string[] };
  basis: LineupBasis;
  depth: "standard" | "deeper";
}
export interface ChainRange {
  minimum: number;
  maximum: number;
}
export interface ChainLeg {
  draft: Draft;
  row: SearchRow;
}
export interface TradeChain {
  key: string;
  mode: "safe" | "speculative";
  first: ChainLeg;
  second: ChainLeg;
  afterFirst: RosterScenario;
  before: number;
  intermediate: number;
  after: number;
  gain: number;
  opponentGain: number;
}
export interface ChainStats {
  phase: "Finding first trades" | "Finding follow-up trades" | "Complete";
  scanned: number;
  evaluated: number;
  firstEligible: number;
  firstExplored: number;
  found: number;
  rejectedValue: number;
  rejectedRoster: number;
  rejectedGain: number;
  limited: boolean;
}
export interface ChainResults {
  chains: TradeChain[];
  stats: ChainStats;
}

// Fixed work budgets keep cancellation responsive through worker termination; deeper search expands, but never promises exhaustive coverage.
export const chainBudgets = {
  standard: { scans: 12000, first: 400, beam: 12, second: 1200 },
  deeper: { scans: 60000, first: 1200, beam: 36, second: 6000 },
};
// Only usable numeric valuations enter packages; stable sorted identities keep ties and repeated discoveries deterministic.
const usable = (p: Player) =>
  p.expected !== null &&
  p.value !== null &&
  p.positive !== null &&
  p.index !== null;
const draftKey = (d: Draft) =>
  JSON.stringify([
    d.teamA,
    d.teamB,
    [...d.give].sort(cmpId),
    [...d.get].sort(cmpId),
  ]);

// Validate every worker input without silently clipping package sizes, broadening teams, or treating empty numeric fields as zero.
export function chainErrors(m: Model, q: ChainQuery): string[] {
  const errors: string[] = [];
  const teams = m.dataset.tables.ModelTeams.map((t) => str(t.TeamID)).filter(
    (id) => id !== "0",
  );
  if (!teams.includes(q.team)) errors.push("Choose your fantasy team.");
  if (
    !q.pool.length ||
    q.pool.length > 12 ||
    new Set(q.pool).size !== q.pool.length ||
    q.pool.some(
      (id) => m.byId.get(id)?.owner !== q.team || !usable(m.byId.get(id)!),
    )
  )
    errors.push(
      "Select 1–12 currently owned, usable players in the tradable pool.",
    );
  if (
    !["safe", "speculative", "both"].includes(q.mode) ||
    !["standard", "deeper"].includes(q.depth) ||
    !["best-available", "marked-starters"].includes(q.basis)
  )
    errors.push("Invalid chain search mode.");
  if (
    !Number.isFinite(q.maximumLoss) ||
    q.maximumLoss < 0 ||
    !Number.isFinite(q.minimumGain) ||
    q.minimumGain <= 0
  )
    errors.push(
      "Use a nonnegative temporary-loss limit and a positive final-gain minimum.",
    );
  for (const [name, step] of [
    ["First", q.first],
    ["Second", q.second],
  ] as const) {
    for (const range of [step.offer, step.receive])
      if (
        !Number.isInteger(range.minimum) ||
        !Number.isInteger(range.maximum) ||
        range.minimum < 1 ||
        range.maximum > 5 ||
        range.minimum > range.maximum
      )
        errors.push(`${name} trade needs valid 1–5 player size ranges.`);
    if (
      step.teams &&
      (!step.teams.length ||
        new Set(step.teams).size !== step.teams.length ||
        step.teams.some((id) => id === q.team || !teams.includes(id)))
    )
      errors.push(`${name} trade needs at least one valid opponent.`);
  }
  if (q.first.offer.minimum > q.pool.length)
    errors.push("Your pool is smaller than the first offer minimum.");
  if (!m.weeks.length)
    errors.push("The remaining fantasy horizon is complete.");
  return errors;
}

// Reuse the authoritative evaluator for both steps, keeping price tests, lineup effects, and actual drops separate.
export function evaluateChainLeg(
  m: Model,
  draft: Draft,
  basis: LineupBasis,
  lineupsRaw?: string,
) {
  const result = evaluateTrade(m, draft, false, lineupsRaw);
  const query: TradeSearchQuery = {
    teamA: draft.teamA,
    give: draft.give,
    count: draft.get.length,
    below: 0,
    above: 0,
    indexMode: "automatic",
    lineupBasis: basis,
  };
  const index = (ids: string[]) =>
    sum(ids.map((id) => m.byId.get(id)?.index ?? 0));
  const incoming = index(draft.get),
    outgoing = index(draft.give);
  const row = scoreTradeMatch(
    m,
    query,
    {
      key: draftKey(draft),
      teamB: draft.teamB,
      give: draft.give,
      get: draft.get,
      incoming,
      outgoing,
      difference: incoming - outgoing,
    },
    lineupsRaw,
    result,
  );
  return { leg: { draft, row }, result };
}

// Freeze current ownership and carry each week's actual post-trade marked roles; no source valuation, baseline, or real roster is changed.
export function advanceChainRoster(
  m: Model,
  draft: Draft,
  lineupsRaw?: string,
  evaluated?: TradeResult,
): Model {
  const result = evaluated ?? evaluateTrade(m, draft, false, lineupsRaw);
  if (!result.valid || !result.legality)
    throw Error("Cannot advance an invalid or illegal chain trade.");
  // A compact post-trade ownership checkpoint also preserves actual IR slots; replaying an ordinary forced trade would bench every arrival.
  const own = new Set(result.legalA),
    other = new Set(result.legalB);
  const arrivals = new Set([...draft.give, ...draft.get]);
  const baseRoster = scenarioRosterBase(m).flatMap(([id, owner, slot]) => {
    const destination =
      owner === draft.teamA || owner === draft.teamB
        ? own.has(id)
          ? draft.teamA
          : other.has(id)
            ? draft.teamB
            : "0"
        : owner;
    return destination === "0"
      ? []
      : [
          [id, destination, arrivals.has(id) && slot !== 21 ? 20 : slot] as [
            string,
            string,
            number | null,
          ],
        ];
  });
  const moves: ScenarioMove[] = [];
  const previous = m.simulation?.scenario;
  const carried =
    previous?.cursor === previous?.weeklyLineupCursor
      ? previous?.weeklyLineups
      : undefined;
  const weeklyLineups = (carried ?? []).filter(
    (plan) => plan.team !== draft.teamA && plan.team !== draft.teamB,
  );
  for (const [team, impact] of [
    [draft.teamA, result.directA],
    [draft.teamB, result.directB],
  ] as const) {
    for (const week of impact.weekly)
      weeklyLineups.push({
        week: week.week,
        team,
        ids: week.ids.filter((id): id is string => id !== null),
        assignments: week.ids,
      });
    const current =
      impact.weekly.find((week) => week.week === m.current) ?? impact.weekly[0];
    if (current)
      moves.push({
        kind: "lineup",
        team,
        ids: current.ids.filter((id): id is string => id !== null),
        assignments: current.ids,
      });
  }
  const source = sourceDataset(m);
  const fingerprint = JSON.stringify([m.analysisVersion, draft, lineupsRaw]);
  let hash = 2166136261;
  for (const char of fingerprint)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const scenario: RosterScenario = {
    id: `chain-${(hash >>> 0).toString(16)}`,
    name: "Chain prerequisite: first trade completed",
    season: num(source.tables.ModelContext[0].Season),
    team: draft.teamA,
    sourceHash: source.hash,
    baseRoster,
    baseLineups: lineupsRaw ?? m.simulation?.lineupsRaw ?? "",
    retainLiveAvailability: !m.ignoreTemporaryAbsences,
    weeklyLineups,
    weeklyLineupCursor: moves.length,
    moves,
    cursor: moves.length,
  };
  return applyRosterScenario(m, scenario, lineupsRaw);
}

// Enumerate packages lazily; round-robin offers/opponents prevent one large roster from consuming the entire search budget first.
function* combinations(
  ids: string[],
  range: ChainRange,
  start = 0,
  chosen: string[] = [],
): Generator<string[]> {
  if (chosen.length >= range.minimum) yield [...chosen];
  if (chosen.length === range.maximum) return;
  for (let i = start; i < ids.length; i++) {
    chosen.push(ids[i]);
    yield* combinations(ids, range, i + 1, chosen);
    chosen.pop();
  }
}
function* candidates(
  m: Model,
  q: ChainQuery,
  step: ChainQuery["first"],
  pool: string[],
): Generator<Draft> {
  const opponents = m.dataset.tables.ModelTeams.map((t) => str(t.TeamID))
    .filter(
      (id) =>
        id !== "0" && id !== q.team && (!step.teams || step.teams.includes(id)),
    )
    .sort(cmpId);
  const players = (team: string) =>
    m.players
      .filter((p) => p.owner === team && usable(p))
      .sort((a, b) => b.expected! - a.expected! || cmpId(a.id, b.id))
      .map((p) => p.id);
  const teams = opponents.map((teamB) => ({ teamB, ids: players(teamB) }));
  const jobs: {
    give: string[];
    teamB: string;
    iterator: Generator<string[]>;
  }[] = [];
  // Create iterators only as callers consume candidates, so a bounded search never allocates every 17-player follow-up combination.
  for (const give of combinations([...pool].sort(cmpId), step.offer)) {
    for (const { teamB, ids } of teams) {
      const iterator = combinations(ids, step.receive);
      const entry = iterator.next();
      if (entry.done) continue;
      jobs.push({ give, teamB, iterator });
      yield { teamA: q.team, teamB, give, get: entry.value };
    }
  }
  let active = jobs;
  while (active.length) {
    const next: typeof jobs = [];
    for (const job of active) {
      const entry = job.iterator.next();
      if (entry.done) continue;
      next.push(job);
      yield {
        teamA: q.team,
        teamB: job.teamB,
        give: job.give,
        get: entry.value,
      };
    }
    active = next;
  }
}

// Cheap lower-bound tests only reject provable price failures; required-drop costs remain exclusively in the full evaluator.
function couldPassPrice(m: Model, d: Draft) {
  const equal = d.give.length === d.get.length;
  const small = d.give.length < d.get.length ? d.give : d.get;
  const large = d.give.length < d.get.length ? d.get : d.give;
  const factor = equal ? 1 : 1 + m.settings.Premium;
  const pass = (metric: (p: Player) => number) => {
    const amount = (ids: string[]) =>
      sum(ids.map((id) => metric(m.byId.get(id)!)));
    return equal
      ? amount(d.get) >= amount(d.give)
      : amount(large) >= amount(small) * factor;
  };
  return pass((p) => p.positive!) && pass((p) => p.value! * p.available);
}

// Final ranking uses the original-to-final gain; opponent losses remain visible and never become an acceptance probability.
export function compareChains(a: TradeChain, b: TradeChain) {
  return (
    b.gain - a.gain ||
    Math.max(0, -a.first.row.own!) - Math.max(0, -b.first.row.own!) ||
    b.opponentGain - a.opponentGain ||
    a.key.localeCompare(b.key)
  );
}
export function searchTradeChains(
  m: Model,
  q: ChainQuery,
  lineupsRaw?: string,
  progress?: (stats: ChainStats) => void,
): ChainResults {
  const errors = chainErrors(m, q);
  if (errors.length) throw Error(errors.join(" "));
  const budget = chainBudgets[q.depth];
  const stats: ChainStats = {
    phase: "Finding first trades",
    scanned: 0,
    evaluated: 0,
    firstEligible: 0,
    firstExplored: 0,
    found: 0,
    rejectedValue: 0,
    rejectedRoster: 0,
    rejectedGain: 0,
    limited: false,
  };
  const original = new Set(
    m.players.filter((p) => p.owner === q.team).map((p) => p.id),
  );
  const protectedIds = new Set(
    [...original].filter((id) => !q.pool.includes(id)),
  );
  const seeds: { leg: ChainLeg; result: TradeResult }[] = [];
  const chains: TradeChain[] = [];
  const accepted = (leg: ChainLeg) => {
    const row = leg.row;
    if (!row.legal || row.dropsA.some((id) => protectedIds.has(id))) {
      stats.rejectedRoster++;
      return false;
    }
    if (row.surplus !== "PASS" || row.points !== "PASS") {
      stats.rejectedValue++;
      return false;
    }
    if (
      row.own === null ||
      row.other === null ||
      row.ownBefore == null ||
      row.ownAfter == null
    ) {
      stats.rejectedGain++;
      return false;
    }
    return true;
  };
  const seedSort = (a: (typeof seeds)[number], b: (typeof seeds)[number]) =>
    b.leg.row.own! - a.leg.row.own! ||
    b.leg.row.incoming - a.leg.row.incoming ||
    a.leg.row.key.localeCompare(b.leg.row.key);
  const first = candidates(m, q, q.first, q.pool);
  let firstScans = 0,
    firstEvaluations = 0;
  while (firstScans < budget.scans && firstEvaluations < budget.first) {
    const entry = first.next();
    if (entry.done) break;
    stats.scanned++;
    firstScans++;
    if (!couldPassPrice(m, entry.value)) {
      stats.rejectedValue++;
      progress?.({ ...stats });
      continue;
    }
    const scored = evaluateChainLeg(
      m,
      entry.value,
      readLineupBasis(q.basis),
      lineupsRaw,
    );
    stats.evaluated++;
    firstEvaluations++;
    if (accepted(scored.leg)) {
      const gain = scored.leg.row.own!;
      const safe = gain > 0;
      if (
        gain >= -q.maximumLoss &&
        (q.mode === "both" || (q.mode === "safe") === safe)
      ) {
        stats.firstEligible++;
        seeds.push(scored);
        // Keep separate safe/speculative shortlists when Both is selected, so positive first steps cannot crowd out all bridge trades.
        const perMode = budget.beam;
        for (const mode of [true, false]) {
          const group = seeds
            .filter((seed) => seed.leg.row.own! > 0 === mode)
            .sort(seedSort);
          for (const removed of group.slice(perMode))
            seeds.splice(seeds.indexOf(removed), 1);
        }
      } else stats.rejectedGain++;
    }
    progress?.({ ...stats });
  }
  // Reserve half the final beam for each available class, then fill unused slots from the other class rather than wasting work budget.
  if (q.mode === "both") {
    const reserved = [true, false].flatMap((safe) =>
      seeds
        .filter((seed) => seed.leg.row.own! > 0 === safe)
        .sort(seedSort)
        .slice(0, budget.beam / 2),
    );
    const extra = seeds
      .filter((seed) => !reserved.includes(seed))
      .sort(seedSort)
      .slice(0, budget.beam - reserved.length);
    seeds.splice(0, seeds.length, ...reserved, ...extra);
  }
  if (
    firstScans === budget.scans ||
    firstEvaluations === budget.first ||
    stats.firstEligible > seeds.length
  )
    stats.limited = true;
  stats.phase = "Finding follow-up trades";
  seeds.sort(seedSort);
  const perSeedEvaluations = Math.max(
    1,
    Math.floor(budget.second / Math.max(1, seeds.length)),
  );
  const perSeedScans = Math.max(
    1,
    Math.floor(budget.scans / Math.max(1, seeds.length)),
  );
  for (const seed of seeds) {
    stats.firstExplored++;
    const afterFirst = advanceChainRoster(
      m,
      seed.leg.draft,
      lineupsRaw,
      seed.result,
    );
    const plans = afterFirst.simulation!.lineupsRaw;
    const pool = afterFirst.players
      .filter(
        (p) =>
          p.owner === q.team &&
          usable(p) &&
          (q.pool.includes(p.id) || !original.has(p.id)),
      )
      .map((p) => p.id);
    const followups = candidates(afterFirst, q, q.second, pool);
    let scans = 0,
      evaluations = 0;
    while (scans < perSeedScans && evaluations < perSeedEvaluations) {
      const entry = followups.next();
      if (entry.done) break;
      scans++;
      stats.scanned++;
      if (!couldPassPrice(afterFirst, entry.value)) {
        stats.rejectedValue++;
        progress?.({ ...stats });
        continue;
      }
      const second = evaluateChainLeg(
        afterFirst,
        entry.value,
        q.basis,
        plans,
      ).leg;
      evaluations++;
      stats.evaluated++;
      if (accepted(second)) {
        // A discontinuity means the carried lineup could not be represented; never manufacture a gain by changing the intermediate baseline.
        const before = seed.leg.row.ownBefore!,
          intermediate = seed.leg.row.ownAfter!;
        const after = second.row.ownAfter!;
        const gain = after - before;
        if (
          Math.abs(second.row.ownBefore! - intermediate) < 0.000001 &&
          gain >= q.minimumGain
        ) {
          const chain: TradeChain = {
            key: JSON.stringify([seed.leg.row.key, second.row.key]),
            mode: seed.leg.row.own! > 0 ? "safe" : "speculative",
            first: seed.leg,
            second,
            afterFirst: afterFirst.simulation!.scenario,
            before,
            intermediate,
            after,
            gain,
            opponentGain: seed.leg.row.other! + second.row.other!,
          };
          chains.push(chain);
          stats.found++;
          chains.sort(compareChains);
          if (chains.length > 30) {
            chains.pop();
            stats.limited = true;
          }
        } else stats.rejectedGain++;
      }
      progress?.({ ...stats });
    }
    if (scans === perSeedScans || evaluations === perSeedEvaluations)
      stats.limited = true;
    progress?.({ ...stats });
  }
  stats.phase = "Complete";
  progress?.({ ...stats });
  return { chains, stats };
}
