import {
  cmpId,
  num,
  str,
  sum,
  positions,
  type Position,
  type Draft,
} from "./contracts";
import { evaluateTrade, type TradeResult } from "./trades";
import {
  applyChainPreset,
  chainPresets,
  chainSearchRounds,
  chainRankingScore,
  type ChainDiscovery,
  type ChainRanking,
} from "./chain-discovery";
export { applyChainPreset, chainPresets };
import {
  positionGradeScale,
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
import {
  managerAssessment,
  managerFailures,
  managerSettingsSchema,
  type ManagerSettings,
} from "./manager-expectations";
import { surfaceAppeal, type SurfaceEvidence } from "./surface-appeal";
import { tradeImpact } from "./trade-impact";
import {
  defaultChainDependency,
  chainIndexEvidence,
  chainSurfaceFailures,
  chainRetradeEvidence,
  retainedCoverage,
  chainRetainedEvidence,
  chainDependencyEvidence,
  type ChainDependencySettings,
  type ChainDependencyEvidence,
  type ChainIndexWindow,
  type ChainIndexEvidence,
  type ChainSurfaceFilter,
} from "./chain-plausibility";
import type { Model, Player } from "./valuation";
import {
  chainPositionImpact,
  chainGradeFailures,
  type ChainGradeLimit,
  type ChainPositionImpact,
} from "./chain-position-impact";
import { lineup, teamsAssessment, type PositionGrade } from "./lineups";
import {
  deficitProtectionErrors,
  deficitProtectionFailures,
  type DeficitProtection,
} from "./trade-safeguards";

// Chain controls are independent of ordinary single-trade filters; all values are in average remaining-season points/week.
export interface ChainQuery {
  team: string;
  pool: string[];
  discovery?: ChainDiscovery;
  mode: "safe" | "speculative" | "both";
  maximumLoss: number;
  minimumGain: number;
  first: ChainStep;
  second: ChainStep;
  // Omitted preserves legacy strict price checks; presets explicitly opt into warning-only discovery.
  pricePolicy?: "required" | "warnings";
  basis: LineupBasis;
  depth: "standard" | "deeper";
  // Missing preferences use the same strict defaults as the UI; old callers cannot bypass recipient checks.
  recipient?: { maximumValueLossPct: number; minimumGain: number };
  // Missing preferences adopt the reviewed connected-chain defaults without changing other saved selections.
  dependency?: ChainDependencySettings;
}
// Each step owns independent, optional fit rules; disabled targeting never evaluates or restricts grades.
export interface ChainFitRule {
  enabled: boolean;
  mode: "prefer" | "require";
  match: "any" | "all";
  grade: string;
  positions: Position[];
}
export interface ChainStep {
  // Original players required in step two remain reserved until that offer; each leg owns its independent anchors.
  requiredGive?: string[];
  requiredGet?: string[];
  receivePosition?: Position;
  gradeLimit?: ChainGradeLimit;
  deficitProtection?: DeficitProtection;
  offer: ChainRange;
  receive: ChainRange;
  teams?: string[];
  fit?: { deficit?: ChainFitRule; surplus?: ChainFitRule };
  indexWindow?: ChainIndexWindow;
  manager?: ManagerSettings;
  surface?: ChainSurfaceFilter;
}
export interface ChainFitEvidence {
  kind: "deficit" | "surplus";
  mode: "prefer" | "require";
  match: "any" | "all";
  threshold: string;
  positions: {
    position: Position;
    grade: string;
    qualifies: boolean;
    status: string;
  }[];
  matched: boolean;
}
// Defaults suggest a surplus-to-deficit route without activating either rule.
export function defaultChainFit(kind: "deficit" | "surplus"): ChainFitRule {
  return {
    enabled: false,
    mode: "prefer",
    match: "any",
    grade: kind === "deficit" ? "C+" : "B+",
    positions: [],
  };
}
// Grade evidence uses the same league-relative assessments as Teams, taken before the particular leg, never after it.
export function chainFitEvidence(
  m: Model,
  d: Draft,
  fit?: ChainStep["fit"],
  assessments?: Map<string, PositionGrade[]>,
): ChainFitEvidence[] {
  const active = (["deficit", "surplus"] as const).filter(
    (kind) => fit?.[kind]?.enabled,
  );
  if (!active.length) return [];
  const grades = (assessments ?? teamsAssessment(m)).get(d.teamB) ?? [];
  return active.map((kind) => {
    const rule = fit![kind]!;
    const relevant = [
      ...new Set(
        (kind === "deficit" ? d.give : d.get).map((id) => m.byId.get(id)!.pos),
      ),
    ];
    const selected = rule.positions.length ? rule.positions : relevant;
    const threshold = positionGradeScale.findIndex((g) => g === rule.grade);
    const evidence = selected.map((position) => {
      const row = grades.find((g) => g.position === position);
      const rank = positionGradeScale.findIndex((g) => g === row?.grade);
      return {
        position,
        grade: row?.grade ?? "Unavailable",
        status: row?.status ?? "Unavailable",
        qualifies:
          relevant.includes(position) &&
          rank >= 0 &&
          threshold >= 0 &&
          (kind === "deficit" ? rank <= threshold : rank >= threshold),
      };
    });
    return {
      kind,
      mode: rule.mode,
      match: rule.match,
      threshold: rule.grade,
      positions: evidence,
      matched:
        evidence.length > 0 &&
        (rule.match === "all"
          ? evidence.every((g) => g.qualifies)
          : evidence.some((g) => g.qualifies)),
    };
  });
}
// Cache assessments only for this immutable stage; advancing a chain creates a new assessor and recomputes every team's grades.
function fitAssessor(m: Model, step: ChainStep) {
  const active = Object.values(step.fit ?? {}).some((rule) => rule?.enabled);
  const grades = active ? teamsAssessment(m) : undefined;
  return (d: Draft) => chainFitEvidence(m, d, step.fit, grades);
}
const fitScore = (evidence?: ChainFitEvidence[]) =>
  evidence?.filter((e) => e.matched).length ?? 0;

// Requiring an acquired card in offer two also anchors its acquisition in trade one; the original saved query stays unchanged.
function anchoredFirstStep(m: Model, q: ChainQuery): ChainStep {
  const acquired = (q.second.requiredGive ?? []).filter(
    (id) => m.byId.get(id)?.owner !== q.team,
  );
  return acquired.length
    ? {
        ...q.first,
        requiredGet: [
          ...new Set([...(q.first.requiredGet ?? []), ...acquired]),
        ],
      }
    : q.first;
}

export const defaultChainRecipient = {
  maximumValueLossPct: 0.1,
  minimumGain: 1,
};
export interface ChainRecipientEvidence {
  scored: boolean;
  receivedIndex: number;
  surrenderedIndex: number;
  receivedComparableIndex: number;
  surrenderedComparableIndex: number;
  comparisonPremium: number;
  lossPct: number;
  gain: number | null;
  maximumValueLossPct: number;
  minimumGain: number;
  gainPct?: number | null;
  failures: string[];
}
export interface ChainRange {
  minimum: number;
  maximum: number;
}
export interface ChainLeg {
  positionImpact?: ChainPositionImpact;
  draft: Draft;
  row: SearchRow;
  recipient: ChainRecipientEvidence;
  fit?: ChainFitEvidence[];
  indexWindow?: ChainIndexEvidence;
  surface?: SurfaceEvidence;
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
  dependency?: ChainDependencyEvidence;
  kind?: "connected" | "sequential";
  relaxations?: string[];
}
// Identify search semantics independently of the user-managed app version in progress and debug exports.
export const chainSearchVersion = "coverage-grade-search-6";
export interface ChainStats {
  rejectedGrades?: number;
  limits?: {
    firstEvaluations: number;
    totalEvaluations: number;
    scans: number;
  };
  rejectedDeficit?: number;
  phase: "Finding first trades" | "Finding follow-up trades" | "Complete";
  scanned: number;
  evaluated: number;
  firstEligible: number;
  firstExplored: number;
  found: number;
  rejectedValue: number;
  rejectedRoster: number;
  rejectedGain: number;
  skippedImpossibleGain?: number;
  rejectedRecipient: number;
  rejectedFit: number;
  rejectedIndex: number;
  rejectedSurface: number;
  rejectedManager?: number;
  rejectedDependency: number;
  dependencyEvaluated: number;
  dependencyPending: number;
  firstEvaluatedBySize: Record<string, number>;
  secondEvaluatedBySize: Record<string, number>;
  rejectedRecipientBeforeScoring: number;
  bestFinalGain: number | null;
  // Search coverage excludes the independent cap on displayed qualifying results.
  limited: boolean;
  resultCapped: boolean;
  searchVersion: string;
  coverage: {
    first: { scanned: number; evaluated: number; complete: boolean };
    followups: {
      scanned: number;
      evaluated: number;
      completed: number;
      unfinished: number;
      deferred: number;
    };
    unusedEvaluations: number;
    unusedScans: number;
    stopReasons: string[];
  };
}
export interface ChainResults {
  attempts?: {
    query: ChainQuery;
    changes: string[];
    stats: ChainStats;
    found: number;
  }[];
  chains: TradeChain[];
  stats: ChainStats;
  // Separate exclusion samples show actual per-leg filters and connectedness without storing every rejected candidate.
  plausibilityRejections: {
    step: 1 | 2;
    draft: Draft;
    failures: string[];
    indexWindow?: ChainIndexEvidence;
    surface?: SurfaceEvidence;
  }[];
  dependencyRejections: {
    first: Draft;
    second: Draft;
    evidence: ChainDependencyEvidence;
  }[];
  // Keep a bounded diagnostic sample, not every rejected candidate or another dataset copy.
  recipientRejections: {
    step: 1 | 2;
    draft: Draft;
    evidence: ChainRecipientEvidence;
  }[];
}

// Common normalized indices preserve surplus ratios; zeros stay numeric, and an unknown gain never counts as a benefit.
export function chainRecipientEvidence(
  row: Pick<SearchRow, "outgoing" | "incoming" | "give" | "get" | "other"> &
    Partial<Pick<SearchRow, "otherBefore">>,
  policy = defaultChainRecipient,
  premium = 0,
  scored = true,
): ChainRecipientEvidence {
  // Scale the smaller package once by the existing premium; legitimate consolidation must not look like an automatic recipient concession.
  const giveCount = row.give?.length ?? row.get.length;
  const comparisonPremium = giveCount === row.get.length ? 0 : premium;
  const receivedComparableIndex =
    row.outgoing * (giveCount < row.get.length ? 1 + comparisonPremium : 1);
  const surrenderedComparableIndex =
    row.incoming * (row.get.length < giveCount ? 1 + comparisonPremium : 1);
  const lossPct =
    surrenderedComparableIndex > 0
      ? Math.max(
          0,
          (surrenderedComparableIndex - receivedComparableIndex) /
            surrenderedComparableIndex,
        )
      : 0;
  const failures: string[] = [];
  if (lossPct > policy.maximumValueLossPct)
    failures.push(
      `Recipient gives ${row.incoming.toFixed(2)} index and receives ${row.outgoing.toFixed(2)}${comparisonPremium ? `; premium-adjusted comparison gives ${surrenderedComparableIndex.toFixed(2)} / receives ${receivedComparableIndex.toFixed(2)} (${(comparisonPremium * 100).toFixed(2)}% applied once to the smaller package)` : ""}: ${(lossPct * 100).toFixed(2)}% loss exceeds ${(policy.maximumValueLossPct * 100).toFixed(2)}%.`,
    );
  if (scored && (row.other === null || row.other < policy.minimumGain))
    failures.push(
      `Recipient lineup gain is ${row.other === null ? "unavailable" : row.other.toFixed(2) + " EPPG"}; requires a gain of at least ${policy.minimumGain.toFixed(2)} EPPG.`,
    );
  return {
    scored,
    gainPct:
      row.other !== null && row.otherBefore != null && row.otherBefore > 0
        ? row.other / row.otherBefore
        : null,
    receivedIndex: row.outgoing,
    surrenderedIndex: row.incoming,
    receivedComparableIndex,
    surrenderedComparableIndex,
    comparisonPremium,
    lossPct,
    gain: row.other,
    ...policy,
    failures,
  };
}

// Fixed work budgets keep cancellation responsive through worker termination; deeper search expands, but never promises exhaustive coverage.
export const chainBudgets = {
  // Broader explicit allowances explore additional bridges and follow-ups without weakening any trade predicate.
  standard: { scans: 120000, first: 3200, beam: 24, second: 12800 },
  deeper: { scans: 600000, first: 12000, beam: 72, second: 48000 },
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
  const recipient = q.recipient ?? defaultChainRecipient;
  if (
    !Number.isFinite(recipient.maximumValueLossPct) ||
    recipient.maximumValueLossPct < 0 ||
    recipient.maximumValueLossPct > 1 ||
    !Number.isFinite(recipient.minimumGain)
  )
    errors.push(
      "Use a recipient value-loss limit from 0–100% and a finite minimum recipient gain (negative permits a scoring loss).",
    );
  // Discovery settings cannot bypass source/ownership validation or silently widen protected teams and players.
  const discovery = q.discovery;
  if (discovery) {
    if (
      !["connected", "sequential", "both"].includes(discovery.sequences) ||
      !["own", "mutual", "appeal"].includes(discovery.ranking)
    )
      errors.push("Choose valid sequence and ranking options.");
    if (
      discovery.position &&
      ![...positions, "depth"].includes(discovery.position)
    )
      errors.push("Choose a valid target position.");
    if (
      discovery.requiredTargets &&
      (new Set(discovery.requiredTargets).size !==
        discovery.requiredTargets.length ||
        discovery.requiredTargets.some(
          (id) =>
            !m.byId.has(id) ||
            m.byId.get(id)!.owner === q.team ||
            m.byId.get(id)!.owner === "0",
        ))
    )
      errors.push("Required targets must belong to another fantasy team.");
    const b = discovery.broaden;
    if (
      b &&
      (typeof b.enabled !== "boolean" ||
        !Number.isFinite(b.maximumRecipientLoss) ||
        b.maximumRecipientLoss < 0 ||
        !Number.isFinite(b.maximumValueLossPct) ||
        b.maximumValueLossPct < 0 ||
        b.maximumValueLossPct > 1 ||
        !Number.isFinite(b.indexExtra) ||
        b.indexExtra < 0)
    )
      errors.push(
        "Automatic broadening needs finite nonnegative limits and a value concession at most 100%.",
      );
    const pin = discovery.pinnedFirst;
    if (
      pin &&
      (pin.teamA !== q.team ||
        (!q.first.teams?.includes(pin.teamB) && q.first.teams !== undefined) ||
        new Set([...pin.give, ...pin.get]).size !==
          pin.give.length + pin.get.length ||
        pin.give.some((id) => !q.pool.includes(id)) ||
        pin.get.some((id) => m.byId.get(id)?.owner !== pin.teamB) ||
        pin.give.length < q.first.offer.minimum ||
        pin.give.length > q.first.offer.maximum ||
        pin.get.length < q.first.receive.minimum ||
        pin.get.length > q.first.receive.maximum)
    )
      errors.push(
        "The locked first trade must match your selected team, pool, teams and package sizes.",
      );
  }
  if (q.pricePolicy && !["required", "warnings"].includes(q.pricePolicy))
    errors.push("Invalid chain price-test policy.");
  // Materiality is always required; malformed or blank active controls cannot silently switch it off.
  const dependency = q.dependency ?? defaultChainDependency;
  if (
    !["either", "retrade", "retain"].includes(dependency.route) ||
    !Number.isFinite(dependency.minimumAcquiredShare) ||
    dependency.minimumAcquiredShare <= 0 ||
    dependency.minimumAcquiredShare > 1 ||
    !Number.isFinite(dependency.minimumInteractionGain) ||
    dependency.minimumInteractionGain <= 0
  )
    errors.push(
      "Use a valid chain route, acquired contribution above 0–100%, and a positive interaction-gain minimum.",
    );
  for (const [name, step] of [
    ["First", anchoredFirstStep(m, q)],
    ["Second", q.second],
  ] as const) {
    // Stale ownership, conflicting teams and oversized required packages are actionable errors rather than weakened filters.
    for (const [direction, ids, range] of [
      ["offer", step.requiredGive ?? [], step.offer],
      ["receive", step.requiredGet ?? [], step.receive],
    ] as const) {
      if (
        !Array.isArray(ids) ||
        new Set(ids).size !== ids.length ||
        ids.length > range.maximum ||
        ids.some((id) => {
          const p = m.byId.get(id);
          if (!p || !usable(p)) return true;
          if (direction === "receive")
            return (
              p.owner === q.team ||
              p.owner === "0" ||
              (!!step.teams && !step.teams.includes(p.owner))
            );
          return name === "First"
            ? !q.pool.includes(id)
            : p.owner === q.team
              ? !q.pool.includes(id)
              : p.owner === "0" ||
                (!!q.first.teams && !q.first.teams.includes(p.owner));
        })
      )
        errors.push(
          `${name} trade required ${direction} players must fit the package size, ownership and selected pool/teams.`,
        );
      if (
        direction === "receive" &&
        new Set(ids.map((id) => m.byId.get(id)?.owner)).size > 1
      )
        errors.push(
          `${name} trade required receive players must belong to the same opponent.`,
        );
    }
    if (step.receivePosition && !positions.includes(step.receivePosition))
      errors.push(`${name} trade has an invalid required incoming position.`);
    if (
      step.gradeLimit &&
      (!["own", "other", "both"].includes(step.gradeLimit.side) ||
        !Number.isInteger(step.gradeLimit.maximumDrop) ||
        step.gradeLimit.maximumDrop < 0 ||
        step.gradeLimit.maximumDrop >= positionGradeScale.length)
    )
      errors.push(
        `${name} trade needs a whole-number maximum grade drop from 0–${positionGradeScale.length - 1}.`,
      );
    errors.push(
      ...deficitProtectionErrors(step.deficitProtection).map(
        (error) => `${name} trade: ${error}`,
      ),
    );
    // Optional per-leg filters validate independently and never read the standard finder's settings.
    if (
      step.indexWindow &&
      (!Number.isFinite(step.indexWindow.below) ||
        step.indexWindow.below < 0 ||
        !Number.isFinite(step.indexWindow.above) ||
        step.indexWindow.above < 0)
    )
      errors.push(
        `${name} trade needs nonnegative finite index-window bounds.`,
      );
    if (step.manager && !managerSettingsSchema.safeParse(step.manager).success)
      errors.push(`${name} trade needs valid manager expectation settings.`);
    if (
      step.surface &&
      (!["average", "projection", "both"].includes(step.surface.metric) ||
        !Number.isFinite(step.surface.minimumGain) ||
        step.surface.minimumGain < 0)
    )
      errors.push(
        `${name} trade needs a valid surface metric and nonnegative minimum.`,
      );
    // Validate active rules only; unavailable grades cannot silently satisfy a required match.
    for (const rule of Object.values(step.fit ?? {}))
      if (
        rule?.enabled &&
        (!positionGradeScale.some((g) => g === rule.grade) ||
          !["prefer", "require"].includes(rule.mode) ||
          !["any", "all"].includes(rule.match) ||
          !Array.isArray(rule.positions) ||
          new Set(rule.positions).size !== rule.positions.length ||
          rule.positions.some((p) => !positions.includes(p)))
      )
        errors.push(`${name} trade has invalid surplus/deficit controls.`);
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
  // A player cannot depart twice; a locked first exchange must honor the same constraints as an enumerated exchange.
  if (
    (q.first.requiredGive ?? []).some((id) =>
      q.second.requiredGive?.includes(id),
    )
  )
    errors.push(
      "A player required in trade two cannot also be required in trade one.",
    );
  const pin = q.discovery?.pinnedFirst;
  if (
    pin &&
    ((q.first.requiredGive ?? []).some((id) => !pin.give.includes(id)) ||
      (anchoredFirstStep(m, q).requiredGet ?? []).some(
        (id) => !pin.get.includes(id),
      ) ||
      (q.second.requiredGive ?? []).some((id) => pin.give.includes(id)) ||
      (q.first.receivePosition &&
        !pin.get.some((id) => m.byId.get(id)?.pos === q.first.receivePosition)))
  )
    errors.push(
      "The locked first trade conflicts with a required player or incoming position.",
    );
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
  recipient = defaultChainRecipient,
  deficitProtection?: DeficitProtection,
) {
  const result = evaluateTrade(m, draft, false, lineupsRaw);
  const query: TradeSearchQuery = {
    deficitProtection,
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
  return {
    leg: {
      draft,
      row,
      recipient: chainRecipientEvidence(row, recipient, m.settings.Premium),
    } as ChainLeg,
    result,
  };
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

// Interleave requested offer sizes before advancing each exact-size stream, so a finite budget reaches singles and packages alike.
function* balancedOffers(
  ids: string[],
  range: ChainRange,
  required: string[] = [],
): Generator<string[]> {
  // Seed each package with its anchors, preserving finite search work for relevant combinations rather than late exclusions.
  if (
    required.some((id) => !ids.includes(id)) ||
    required.length > range.maximum
  )
    return;
  const remaining = ids.filter((id) => !required.includes(id));
  let streams = Array.from(
    { length: range.maximum - Math.max(range.minimum, required.length) + 1 },
    (_, i) =>
      combinations(remaining, {
        minimum: Math.max(range.minimum, required.length) + i - required.length,
        maximum: Math.max(range.minimum, required.length) + i - required.length,
      }),
  );
  while (streams.length) {
    const next: typeof streams = [];
    for (const stream of streams) {
      const entry = stream.next();
      if (entry.done) continue;
      next.push(stream);
      yield [...required, ...entry.value];
    }
    streams = next;
  }
}
// Anchor the incoming position directly, assigning each package to its earliest matching card so no duplicate or unbounded hidden scan is introduced.
function* incomingPackages(
  m: Model,
  ids: string[],
  count: number,
  step: ChainStep,
): Generator<string[]> {
  const required = step.requiredGet ?? [],
    range = { minimum: count, maximum: count };
  if (
    !step.receivePosition ||
    required.some((id) => m.byId.get(id)?.pos === step.receivePosition)
  ) {
    yield* balancedOffers(ids, range, required);
    return;
  }
  const earlier = new Set<string>();
  for (const id of ids.filter(
    (id) => m.byId.get(id)?.pos === step.receivePosition,
  )) {
    yield* balancedOffers(
      ids.filter((player) => !earlier.has(player)),
      range,
      [...required, id],
    );
    earlier.add(id);
  }
}

function* candidates(
  m: Model,
  q: ChainQuery,
  step: ChainQuery["first"],
  pool: string[],
  earlyReturns = 1,
  assess = fitAssessor(m, step),
  order: "surplus" | "scoring" = "surplus",
): Generator<Draft> {
  const hasFit = Object.values(step.fit ?? {}).some((rule) => rule?.enabled);
  const opponents = m.dataset.tables.ModelTeams.map((t) => str(t.TeamID))
    .filter(
      (id) =>
        id !== "0" &&
        id !== q.team &&
        (!step.teams || step.teams.includes(id)) &&
        (step.requiredGet ?? []).every(
          (player) => m.byId.get(player)?.owner === id,
        ),
    )
    .sort(cmpId);
  const players = (team: string) =>
    m.players
      .filter((p) => p.owner === team && usable(p))
      .sort((a, b) => b.expected! - a.expected! || cmpId(a.id, b.id))
      .map((p) => p.id);
  const teams = opponents.map((teamB) => ({ teamB, ids: players(teamB) }));
  let jobs: {
    give: string[];
    teamB: string;
    iterator: Generator<string[]>;
    preference: number;
  }[] = [];
  // Visit early comparable returns per offer/size/opponent before broadening the outgoing pool; retain the remaining lazy streams.
  // IDs are tie-breakers only: bounded package streams must reach valuable offers before low-ID filler consumes their budget.
  const offerScore = (id: string) => {
    const player = m.byId.get(id)!;
    return order === "surplus" ? player.index! : player.expected!;
  };
  const orderedPool = [...pool].sort(
    (a, b) => offerScore(b) - offerScore(a) || cmpId(a, b),
  );
  for (const give of balancedOffers(
    orderedPool,
    step.offer,
    step.requiredGive,
  )) {
    const cohort: typeof jobs = [];
    const offered = sum(give.map((id) => m.byId.get(id)!.index!));
    for (
      let count = step.receive.minimum;
      count <= step.receive.maximum;
      count++
    )
      for (const { teamB, ids } of teams) {
        const target =
          (offered *
            (count > give.length
              ? 1 + m.settings.Premium
              : count < give.length
                ? 1 / (1 + m.settings.Premium)
                : 1)) /
          count;
        // Disabled targeting avoids all grade-ordering work; active per-player scores are reused by the sort.
        const fitScores = hasFit
          ? new Map(
              ids.map((id) => [
                id,
                fitScore(assess({ teamA: q.team, teamB, give, get: [id] })),
              ]),
            )
          : undefined;
        const ordered = [...ids].sort(
          (a, b) =>
            (fitScores?.get(b) ?? 0) - (fitScores?.get(a) ?? 0) ||
            Math.abs(m.byId.get(a)!.index! - target) -
              Math.abs(m.byId.get(b)!.index! - target) ||
            cmpId(a, b),
        );
        cohort.push({
          give,
          teamB,
          preference: hasFit
            ? fitScore(assess({ teamA: q.team, teamB, give, get: ids }))
            : 0,
          // Incoming anchors constrain enumeration itself, including exact two-player returns.
          iterator: incomingPackages(m, ordered, count, step),
        });
      }
    // Explore fit-friendly counterparties first for each offered package, with nonmatching teams still in the stream.
    if (hasFit) cohort.sort((a, b) => b.preference - a.preference);
    for (let round = 0; round < earlyReturns; round++)
      for (const job of cohort) {
        const entry = job.iterator.next();
        if (!entry.done)
          yield {
            teamA: q.team,
            teamB: job.teamB,
            give: job.give,
            get: entry.value,
          };
      }
    jobs.push(...cohort);
  }
  // Continue every surviving return stream round-robin when budget remains; no package or player is removed by this ordering heuristic.
  while (jobs.length) {
    const next: typeof jobs = [];
    for (const job of jobs) {
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
    jobs = next;
  }
}

// Interleave surplus-first breadth with scoring-first early returns; both preserve every offer and deduplicate within the unchanged work budget.
function* candidatePortfolio(
  m: Model,
  q: ChainQuery,
  step: ChainQuery["first"],
  pool: string[],
  assess = fitAssessor(m, step),
): Generator<Draft> {
  let streams = [
    candidates(m, q, step, pool, 1, assess),
    candidates(m, q, step, pool, 2, assess, "scoring"),
  ];
  const seen = new Set<string>();
  while (streams.length) {
    const next: typeof streams = [];
    for (const stream of streams) {
      const entry = stream.next();
      if (entry.done) continue;
      next.push(stream);
      const key = draftKey(entry.value);
      if (seen.has(key)) continue;
      seen.add(key);
      yield entry.value;
    }
    streams = next;
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

// Allow healthy, over-capacity rosters and empty roles instead of negative scorers: actual legal weekly lineups cannot exceed this ceiling.
export function chainScoringCeiling(m: Model, roster: string[], draft: Draft) {
  const relaxed = roster
    .filter((id) => !draft.give.includes(id))
    .concat(draft.get)
    .filter((id) => (m.byId.get(id)?.expected ?? -Infinity) >= 0);
  return lineup(m, relaxed, m.current, false, true, "expected").expected;
}

// Final ranking uses the original-to-final gain; passing recipient preferences never becomes an acceptance probability.
export function compareChains(
  a: TradeChain,
  b: TradeChain,
  ranking: ChainRanking = "own",
) {
  return (
    chainRankingScore(b, ranking) - chainRankingScore(a, ranking) ||
    b.gain - a.gain ||
    Number(b.dependency?.route === "retrade") -
      Number(a.dependency?.route === "retrade") ||
    fitScore(b.first.fit) +
      fitScore(b.second.fit) -
      fitScore(a.first.fit) -
      fitScore(a.second.fit) ||
    Math.max(0, -a.first.row.own!) - Math.max(0, -b.first.row.own!) ||
    b.opponentGain - a.opponentGain ||
    a.key.localeCompare(b.key)
  );
}
// Keep earlier discoveries when deeper work changes which top results fit in a bounded display. Counts are a conservative known union.
export function mergeChainResults(
  previous: ChainResults,
  next: ChainResults,
  ranking: ChainRanking = "own",
): ChainResults {
  const chains = [
    ...new Map(
      [...previous.chains, ...next.chains].map((c) => [c.key, c]),
    ).values(),
  ].sort((a, b) => compareChains(a, b, ranking));
  return {
    ...next,
    chains,
    attempts: [...(previous.attempts ?? []), ...(next.attempts ?? [])],
    stats: {
      ...next.stats,
      found: Math.max(previous.stats.found, next.stats.found, chains.length),
      evaluated: previous.stats.evaluated + next.stats.evaluated,
      scanned: previous.stats.scanned + next.stats.scanned,
      limits: {
        firstEvaluations:
          (previous.stats.limits?.firstEvaluations ?? 0) +
          (next.stats.limits?.firstEvaluations ?? 0),
        totalEvaluations:
          (previous.stats.limits?.totalEvaluations ?? 0) +
          (next.stats.limits?.totalEvaluations ?? 0),
        scans:
          (previous.stats.limits?.scans ?? 0) + (next.stats.limits?.scans ?? 0),
      },
      limited: previous.stats.limited || next.stats.limited,
      resultCapped: previous.stats.resultCapped || next.stats.resultCapped,
    },
  };
}
export function searchTradeChains(
  m: Model,
  q: ChainQuery,
  lineupsRaw?: string,
  progress?: (stats: ChainStats) => void,
): ChainResults {
  // Normalize new semantics for legacy callers while preserving all explicit existing controls.
  q = { ...q, dependency: q.dependency ?? { ...defaultChainDependency } };
  const errors = chainErrors(m, q);
  if (errors.length) throw Error(errors.join(" "));
  const budget = chainBudgets[q.depth];
  const requirePrices = q.pricePolicy !== "warnings";
  const stats: ChainStats = {
    limits: {
      firstEvaluations: budget.first,
      totalEvaluations: budget.first + budget.second,
      scans: budget.scans * 2,
    },
    rejectedDeficit: 0,
    phase: "Finding first trades",
    scanned: 0,
    evaluated: 0,
    firstEligible: 0,
    firstExplored: 0,
    found: 0,
    rejectedValue: 0,
    rejectedRoster: 0,
    rejectedGain: 0,
    skippedImpossibleGain: 0,
    rejectedRecipient: 0,
    rejectedFit: 0,
    rejectedIndex: 0,
    rejectedSurface: 0,
    rejectedDependency: 0,
    dependencyEvaluated: 0,
    dependencyPending: 0,
    firstEvaluatedBySize: {},
    secondEvaluatedBySize: {},
    rejectedRecipientBeforeScoring: 0,
    bestFinalGain: null,
    limited: false,
    resultCapped: false,
    searchVersion: chainSearchVersion,
    coverage: {
      first: { scanned: 0, evaluated: 0, complete: false },
      followups: {
        scanned: 0,
        evaluated: 0,
        completed: 0,
        unfinished: 0,
        deferred: 0,
      },
      unusedEvaluations: budget.first + budget.second,
      unusedScans: budget.scans * 2,
      stopReasons: [],
    },
  };
  const original = new Set(
    m.players.filter((p) => p.owner === q.team).map((p) => p.id),
  );
  const protectedIds = new Set(
    [...original].filter((id) => !q.pool.includes(id)),
  );
  const seeds: { leg: ChainLeg; result: TradeResult }[] = [];
  const chains: TradeChain[] = [];
  const recipientRejections: ChainResults["recipientRejections"] = [];
  const plausibilityRejections: ChainResults["plausibilityRejections"] = [];
  const dependencyRejections: ChainResults["dependencyRejections"] = [];
  // These caches belong to one frozen initial checkpoint and query, so no evidence leaks across settings, scenarios or imports.
  const standaloneCache = new Map<
    string,
    { result?: TradeResult; issue: string }
  >();
  const passesWindow = (model: Model, draft: Draft, step: 1 | 2) => {
    const filter = (step === 1 ? q.first : q.second).indexWindow;
    if (!filter) return true;
    const evidence = chainIndexEvidence(model, draft, filter);
    if (evidence.passed) return true;
    stats.rejectedIndex++;
    if (
      plausibilityRejections.filter((entry) => entry.step === step).length < 5
    )
      plausibilityRejections.push({
        step,
        draft,
        indexWindow: evidence,
        failures: [
          "Incoming raw surplus index is outside the configured per-leg window.",
        ],
      });
    return false;
  };
  // Source comparisons reuse the established calculator but not ordinary search's positive-own-gain gate.
  const passesSurface = (
    model: Model,
    leg: ChainLeg,
    result: TradeResult,
    step: 1 | 2,
    plans?: string,
  ) => {
    const config = step === 1 ? q.first : q.second;
    // Grade protection runs only when explicitly enabled, after normal legality/scoring/recipient checks.
    if (config.gradeLimit) {
      leg.positionImpact = chainPositionImpact(model, leg.draft, result);
      const failures = chainGradeFailures(
        leg.positionImpact,
        config.gradeLimit,
      );
      if (failures.length) {
        stats.rejectedGrades = (stats.rejectedGrades ?? 0) + 1;
        if (
          plausibilityRejections.filter((entry) => entry.step === step).length <
          5
        )
          plausibilityRejections.push({ step, draft: leg.draft, failures });
        return false;
      }
    }
    if (config.indexWindow)
      leg.indexWindow = chainIndexEvidence(
        model,
        leg.draft,
        config.indexWindow,
      );
    // Stage-two callers supply the post-stage-one model; private final gain cannot rescue a failed recipient safeguard.
    if (config.manager) {
      leg.row.manager = managerAssessment(
        model,
        leg.draft,
        result,
        config.manager,
      );
      const failures = managerFailures(leg.row.manager, config.manager);
      if (failures.length) {
        stats.rejectedManager = (stats.rejectedManager ?? 0) + 1;
        if (
          plausibilityRejections.filter((entry) => entry.step === step).length <
          5
        )
          plausibilityRejections.push({ step, draft: leg.draft, failures });
        return false;
      }
    }
    // Source appeal remains supporting evidence when it is not an explicitly enabled eligibility filter.
    if (!config.surface && q.discovery?.ranking === "appeal")
      leg.surface = surfaceAppeal(
        model,
        leg.draft,
        result,
        { metric: "both", minimum: 0, requireValueTests: false },
        q.basis,
        plans,
      );
    if (!config.surface) return true;
    leg.surface = surfaceAppeal(
      model,
      leg.draft,
      result,
      {
        metric: config.surface.metric,
        minimum: config.surface.minimumGain,
        requireValueTests: false,
      },
      q.basis,
      plans,
    );
    const failures = chainSurfaceFailures(leg.surface, config.surface);
    if (!failures.length) return true;
    stats.rejectedSurface++;
    if (
      plausibilityRejections.filter((entry) => entry.step === step).length < 5
    )
      plausibilityRejections.push({
        step,
        draft: leg.draft,
        surface: leg.surface,
        failures,
      });
    return false;
  };
  // Counterfactual scoring is cached, separately counted, and never substitutes zero for invalid ownership, protected drops or missing scores.
  const dependencyFor = (
    afterFirst: Model,
    first: ChainLeg,
    second: ChainLeg,
    result: TradeResult,
  ): ChainDependencyEvidence | null => {
    const policy = q.dependency!;
    const retrade = chainRetradeEvidence(
      afterFirst,
      first.draft,
      second.draft,
      policy,
    );
    const coverage = retainedCoverage(
      m,
      first.draft,
      second.draft,
      result,
      q.basis,
    );
    let standalone: { before: number; after: number } | undefined;
    let issue =
      policy.route === "retrade"
        ? "Keep-and-release route is not selected."
        : retrade.passed && policy.route === "either"
          ? "Not evaluated: meaningful re-trade already qualifies."
          : "";
    if (
      !issue &&
      (coverage.length ||
        (q.discovery && q.discovery.sequences !== "connected"))
    ) {
      const key = draftKey(second.draft);
      let cached = standaloneCache.get(key);
      if (!cached) {
        const originalOwnership =
          second.draft.give.every((id) => m.byId.get(id)?.owner === q.team) &&
          second.draft.get.every(
            (id) => m.byId.get(id)?.owner === second.draft.teamB,
          );
        if (!originalOwnership)
          cached = {
            issue:
              "Standalone trade 2 has invalid ownership at the initial checkpoint.",
          };
        else {
          if (stats.evaluated >= budget.first + budget.second) {
            stats.dependencyPending++;
            return null;
          }
          stats.evaluated++;
          stats.dependencyEvaluated++;
          try {
            cached = {
              result: evaluateTrade(m, second.draft, false, lineupsRaw),
              issue: "",
            };
          } catch (error) {
            cached = {
              issue:
                error instanceof Error
                  ? error.message
                  : "Standalone trade 2 could not be scored.",
            };
          }
        }
        standaloneCache.set(key, cached);
      }
      issue = cached.issue;
      if (cached.result) {
        const comparison = tradeImpact(cached.result, q.basis)?.own;
        if (
          !cached.result.valid ||
          !cached.result.legality ||
          cached.result.dropsA.some((id) => protectedIds.has(id))
        )
          issue =
            "Standalone trade 2 is invalid or requires an illegal/protected drop.";
        else if (
          comparison?.beforePerWeek == null ||
          comparison.afterPerWeek == null
        )
          issue = "Standalone trade 2 has unavailable scoring.";
        else if (
          Math.abs(comparison.beforePerWeek - first.row.ownBefore!) >= 0.000001
        )
          issue =
            "Standalone trade 2 does not match the original scoring checkpoint.";
        else
          standalone = {
            before: comparison.beforePerWeek,
            after: comparison.afterPerWeek,
          };
      }
    }
    const retained = chainRetainedEvidence(
      policy,
      coverage,
      first.row.ownBefore!,
      first.row.ownAfter!,
      second.row.ownAfter!,
      standalone,
      issue,
    );
    const evidence = chainDependencyEvidence(policy, retrade, retained);
    return standalone && q.discovery?.sequences !== "connected"
      ? { ...evidence, standalone }
      : evidence;
  };
  // Progress snapshots carry current allowances and independent nested counts, including when the user cancels or downloads a running search.
  const publish = () => {
    stats.coverage.unusedEvaluations = Math.max(
      0,
      budget.first + budget.second - stats.evaluated,
    );
    stats.coverage.unusedScans = Math.max(0, budget.scans * 2 - stats.scanned);
    stats.resultCapped = stats.found > chains.length;
    progress?.({
      ...stats,
      coverage: {
        ...stats.coverage,
        first: { ...stats.coverage.first },
        followups: { ...stats.coverage.followups },
        stopReasons: [...stats.coverage.stopReasons],
      },
    });
  };
  // Record proven value mismatches without consuming a full lineup evaluation; no recipient scoring is invented for these samples.
  const rejectRecipient = (
    draft: Draft,
    evidence: ChainRecipientEvidence,
    step: 1 | 2,
  ) => {
    stats.rejectedRecipient++;
    if (recipientRejections.filter((entry) => entry.step === step).length < 5)
      recipientRejections.push({ step, draft, evidence });
  };
  const precheckRecipient = (model: Model, draft: Draft, step: 1 | 2) => {
    const index = (ids: string[]) =>
      sum(ids.map((id) => model.byId.get(id)!.index!));
    const evidence = chainRecipientEvidence(
      {
        outgoing: index(draft.give),
        incoming: index(draft.get),
        give: draft.give,
        get: draft.get,
        other: null,
      },
      q.recipient ?? defaultChainRecipient,
      model.settings.Premium,
      false,
    );
    if (!evidence.failures.length) return true;
    stats.rejectedRecipientBeforeScoring++;
    rejectRecipient(draft, evidence, step);
    return false;
  };
  const accepted = (leg: ChainLeg, step: 1 | 2) => {
    const row = leg.row;
    // Recheck each recipient against its own roster at that leg, not the original league before trade one.
    const deficitFailures = deficitProtectionFailures(
      row.deficitProtection,
      (step === 1 ? q.first : q.second).deficitProtection,
    );
    if (deficitFailures.length) {
      stats.rejectedDeficit!++;
      if (plausibilityRejections.length < 10)
        plausibilityRejections.push({
          step,
          draft: leg.draft,
          failures: deficitFailures,
        });
      return false;
    }
    if (
      !row.legal ||
      row.dropsA.some(
        (id) =>
          protectedIds.has(id) ||
          (step === 1 && q.second.requiredGive?.includes(id)),
      )
    ) {
      stats.rejectedRoster++;
      if (plausibilityRejections.length < 10) {
        const cuts = row.dropsA
          .filter(
            (id) =>
              protectedIds.has(id) ||
              (step === 1 && q.second.requiredGive?.includes(id)),
          )
          .map((id) => m.byId.get(id)?.name ?? "Unknown player");
        plausibilityRejections.push({
          step,
          draft: leg.draft,
          failures: [
            cuts.length
              ? `Required drops are protected: ${cuts.join(", ")}. Include them in the chain pool only if you permit their removal.`
              : "This exchange has an unresolved roster or ownership conflict.",
          ],
        });
      }
      return false;
    }
    if (requirePrices && (row.surplus !== "PASS" || row.points !== "PASS")) {
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
    // Both legs must independently benefit their recipient and respect the concession limit, even in speculative mode.
    if (leg.recipient.failures.length) {
      rejectRecipient(leg.draft, leg.recipient, step);
      return false;
    }
    return true;
  };
  const seedSort = (a: (typeof seeds)[number], b: (typeof seeds)[number]) =>
    fitScore(b.leg.fit) - fitScore(a.leg.fit) ||
    b.leg.row.own! - a.leg.row.own! ||
    b.leg.row.incoming - a.leg.row.incoming ||
    a.leg.row.key.localeCompare(b.leg.row.key);
  // Preserve established package-shape coverage, then distinct position/team and acquired-player bridges; never delete deferred alternatives.
  const orderSeeds = () => {
    const byMode = [true, false].map((safe) => {
      const ordered = seeds
        .filter((seed) => seed.leg.row.own! > 0 === safe)
        .sort(seedSort);
      const unique = (key: (seed: (typeof seeds)[number]) => string) => {
        const seen = new Set<string>();
        return ordered.filter((seed) => {
          const identity = key(seed);
          if (seen.has(identity)) return false;
          seen.add(identity);
          return true;
        });
      };
      const shapes = unique(
        (seed) => `${seed.leg.draft.give.length}:${seed.leg.draft.get.length}`,
      ).sort(
        (a, b) =>
          a.leg.draft.give.length +
            a.leg.draft.get.length -
            b.leg.draft.give.length -
            b.leg.draft.get.length || seedSort(a, b),
      );
      const roles = unique((seed) =>
        JSON.stringify([
          seed.leg.draft.teamB,
          [
            ...new Set(seed.leg.draft.get.map((id) => m.byId.get(id)!.pos)),
          ].sort(),
        ]),
      );
      const players = unique((seed) =>
        [...seed.leg.draft.get].sort(cmpId).join(","),
      );
      // Identity deduplication preserves every eligible first trade after its preferred representative has been scheduled.
      return [...new Set([...shapes, ...roles, ...players, ...ordered])];
    });
    // Both retains alternating safe/speculative opportunities; a shorter class immediately yields its unused places to the other.
    const result: typeof seeds = [];
    for (let i = 0; i < Math.max(...byMode.map((group) => group.length)); i++)
      for (const group of byMode) if (group[i]) result.push(group[i]);
    return result;
  };
  // Required fit rejects before expensive scoring; disabled/Prefer rules never exclude a candidate.
  const firstStep = anchoredFirstStep(m, q);
  const firstFit = fitAssessor(m, firstStep);
  const passesFit = (evidence: ChainFitEvidence[]) => {
    if (evidence.some((e) => e.mode === "require" && !e.matched)) {
      stats.rejectedFit++;
      return false;
    }
    return true;
  };
  // A follow-up request searches its exact first exchange, without mutating either saved roster.
  const first = q.discovery?.pinnedFirst
    ? [q.discovery.pinnedFirst][Symbol.iterator]()
    : candidatePortfolio(
        m,
        q,
        firstStep,
        q.pool.filter((id) => !q.second.requiredGive?.includes(id)),
        firstFit,
      );
  let firstScans = 0,
    firstEvaluations = 0;
  while (firstScans < budget.scans && firstEvaluations < budget.first) {
    const entry = first.next();
    if (entry.done) {
      stats.coverage.first.complete = true;
      break;
    }
    stats.scanned++;
    firstScans++;
    stats.coverage.first.scanned = firstScans;
    const fit = firstFit(entry.value);
    if (!passesFit(fit) || !passesWindow(m, entry.value, 1)) continue;
    if (requirePrices && !couldPassPrice(m, entry.value)) {
      stats.rejectedValue++;
      publish();
      continue;
    }
    if (!precheckRecipient(m, entry.value, 1)) {
      publish();
      continue;
    }
    const scored = evaluateChainLeg(
      m,
      entry.value,
      readLineupBasis(q.basis),
      lineupsRaw,
      q.recipient,
      q.first.deficitProtection,
    );
    if (fit.length) scored.leg.fit = fit;
    stats.evaluated++;
    firstEvaluations++;
    stats.coverage.first.evaluated = firstEvaluations;
    const size = `${entry.value.give.length}-for-${entry.value.get.length}`;
    stats.firstEvaluatedBySize[size] =
      (stats.firstEvaluatedBySize[size] ?? 0) + 1;
    if (
      accepted(scored.leg, 1) &&
      passesSurface(m, scored.leg, scored.result, 1, lineupsRaw)
    ) {
      const gain = scored.leg.row.own!;
      const safe = q.discovery ? gain >= 0 : gain > 0;
      if (
        gain >= -q.maximumLoss &&
        (q.mode === "both" || (q.mode === "safe") === safe)
      ) {
        stats.firstEligible++;
        seeds.push(scored);
      } else stats.rejectedGain++;
    }
    publish();
  }
  // A boundary peek distinguishes exact exhaustion from a budget stop without scoring another candidate.
  if (!stats.coverage.first.complete)
    stats.coverage.first.complete = first.next().done === true;
  if (!stats.coverage.first.complete) {
    if (firstScans >= budget.scans)
      stats.coverage.stopReasons.push("first-scan-budget");
    if (firstEvaluations >= budget.first)
      stats.coverage.stopReasons.push("first-evaluation-budget");
  }
  stats.phase = "Finding follow-up trades";
  const deferred = orderSeeds();
  // Keep only compact cursors for waiting branches; a long-running stream must not monopolize a resident roster slot.
  const pending = deferred.map((seed) => ({ seed, offset: 0, pass: 0 }));
  let nextSeed = 0;
  const quantum = Math.max(
    1,
    Math.min(
      64,
      Math.floor(
        (budget.first + budget.second - stats.evaluated) /
          Math.max(1, deferred.length),
      ),
    ),
  );
  // Rebuild a parked branch at its deterministic candidate cursor without repeating scoring or retaining its advanced model.
  function* followupsFor(seed: (typeof seeds)[number], offset: number) {
    const afterFirst = advanceChainRoster(
      m,
      seed.leg.draft,
      lineupsRaw,
      seed.result,
    );
    const plans = afterFirst.simulation!.lineupsRaw;
    // Cache the entire checkpoint roster, including protected players, for optimistic scoring before required drops.
    const ownRoster = afterFirst.players
      .filter((p) => p.owner === q.team)
      .map((p) => p.id);
    const pool = afterFirst.players
      .filter(
        (p) =>
          p.owner === q.team &&
          usable(p) &&
          (q.pool.includes(p.id) || !original.has(p.id)),
      )
      .map((p) => p.id);
    const secondFit = fitAssessor(afterFirst, q.second);
    const followups = candidatePortfolio(
      afterFirst,
      q,
      q.second,
      pool,
      secondFit,
    );
    let cursor = 0;
    for (const draft of followups) {
      if (cursor++ < offset) continue;
      // The scheduler counts every candidate, including cheap rejections, against its shared scan allowance.
      yield () => {
        const fit = secondFit(draft);
        if (!passesFit(fit) || !passesWindow(afterFirst, draft, 2))
          return false;
        if (requirePrices && !couldPassPrice(afterFirst, draft)) {
          stats.rejectedValue++;
          return false;
        }
        // A required final target cannot be rescued by scoring an offer that never acquires or retains it.
        const selectedFinal = [
          ...seed.leg.draft.get.filter((id) => !draft.give.includes(id)),
          ...draft.get,
        ];
        if (
          (q.discovery?.requiredTargets ?? []).some(
            (id) => !selectedFinal.includes(id),
          )
        ) {
          stats.rejectedFit++;
          return false;
        }
        if (!precheckRecipient(afterFirst, draft, 2)) {
          return false;
        }
        // Skip full scoring only when even an optimistic final lineup cannot meet the original-to-final gain requirement.
        if (
          chainScoringCeiling(afterFirst, ownRoster, draft) + 1e-9 <
          seed.leg.row.ownBefore! + q.minimumGain
        ) {
          stats.skippedImpossibleGain!++;
          stats.rejectedGain++;
          return false;
        }
        const evaluatedSecond = evaluateChainLeg(
          afterFirst,
          draft,
          q.basis,
          plans,
          q.recipient,
          q.second.deficitProtection,
        );
        const second = evaluatedSecond.leg;
        if (fit.length) second.fit = fit;
        const size = `${draft.give.length}-for-${draft.get.length}`;
        stats.secondEvaluatedBySize[size] =
          (stats.secondEvaluatedBySize[size] ?? 0) + 1;
        stats.evaluated++;
        if (
          accepted(second, 2) &&
          passesSurface(afterFirst, second, evaluatedSecond.result, 2, plans)
        ) {
          // A discontinuity means the carried lineup could not be represented; never manufacture a gain by changing the intermediate baseline.
          const before = seed.leg.row.ownBefore!,
            intermediate = seed.leg.row.ownAfter!;
          const after = second.row.ownAfter!;
          const gain = after - before;
          // Disconnected pairs never become chains; unperformed counterfactual work is an incomplete search, not a failed dependency test.
          if (Math.abs(second.row.ownBefore! - intermediate) >= 0.000001) {
            stats.rejectedGain++;
            return true;
          }
          // A known final-gain failure needs no expensive counterfactual; keep cheap connected re-trades as honest near-threshold evidence.
          if (gain < q.minimumGain) {
            const bridge = chainRetradeEvidence(
              afterFirst,
              seed.leg.draft,
              second.draft,
              q.dependency!,
            );
            if (q.dependency!.route !== "retain" && bridge.passed)
              stats.bestFinalGain =
                stats.bestFinalGain === null
                  ? gain
                  : Math.max(stats.bestFinalGain, gain);
            stats.rejectedGain++;
            return true;
          }
          const dependency = dependencyFor(
            afterFirst,
            seed.leg,
            second,
            evaluatedSecond.result,
          );
          if (!dependency) return true;
          const connected = !!dependency.route;
          // Independent upgrades must each help and trade two must be legally useful on its own, rather than merely failing a dependency check.
          const independent =
            !connected &&
            seed.leg.row.own! >= 0 &&
            second.row.own! > 0 &&
            !!dependency.standalone &&
            dependency.standalone.after > dependency.standalone.before;
          const sequence = q.discovery?.sequences ?? "connected";
          if (
            (!connected && (!independent || sequence === "connected")) ||
            (connected && sequence === "sequential")
          ) {
            stats.rejectedDependency++;
            if (dependencyRejections.length < 5)
              dependencyRejections.push({
                first: seed.leg.draft,
                second: second.draft,
                evidence: dependency,
              });
            return true;
          }
          // Final targets refer to retained acquisitions, not cards immediately re-traded away. Depth means a retained reserve.
          const kept = [
            ...seed.leg.draft.get.filter(
              (id) => !second.draft.give.includes(id),
            ),
            ...second.draft.get,
          ].filter(
            (id) =>
              evaluatedSecond.result.valid &&
              evaluatedSecond.result.legalA.includes(id),
          );
          const target = q.discovery?.position;
          const scoredIds =
            tradeImpact(evaluatedSecond.result, q.basis)?.own.weekly.flatMap(
              (w) => w.ids,
            ) ?? [];
          if (
            (q.discovery?.requiredTargets ?? []).some(
              (id) => !kept.includes(id),
            ) ||
            (target &&
              !kept.some((id) =>
                target === "depth"
                  ? !scoredIds.includes(id)
                  : m.byId.get(id)?.pos === target,
              ))
          ) {
            stats.rejectedFit++;
            return true;
          }
          // Report the best complete inspected chain that passes all other checks, even when it falls short of the requested final gain.
          if (Math.abs(second.row.ownBefore! - intermediate) < 0.000001)
            stats.bestFinalGain =
              stats.bestFinalGain === null
                ? gain
                : Math.max(stats.bestFinalGain, gain);
          if (
            Math.abs(second.row.ownBefore! - intermediate) < 0.000001 &&
            gain >= q.minimumGain
          ) {
            // Retained results show both teams' grade sacrifices even when grade filtering is disabled.
            seed.leg.positionImpact ??= chainPositionImpact(
              m,
              seed.leg.draft,
              seed.result,
            );
            second.positionImpact ??= chainPositionImpact(
              afterFirst,
              second.draft,
              evaluatedSecond.result,
            );
            const chain: TradeChain = {
              key: JSON.stringify([seed.leg.row.key, second.row.key]),
              mode: (
                q.discovery ? seed.leg.row.own! >= 0 : seed.leg.row.own! > 0
              )
                ? "safe"
                : "speculative",
              first: seed.leg,
              second,
              afterFirst: afterFirst.simulation!.scenario,
              before,
              intermediate,
              after,
              gain,
              opponentGain: seed.leg.row.other! + second.row.other!,
              dependency,
              kind: connected ? "connected" : "sequential",
            };
            chains.push(chain);
            stats.found++;
            chains.sort((a, b) => compareChains(a, b, q.discovery?.ranking));
            if (chains.length > 30) {
              chains.pop();
              // Retaining only the top 30 affects display, not whether the search exhausted its work streams.
            }
          } else stats.rejectedGain++;
        }
        return true;
      };
    }
  }
  const active: {
    resume: (typeof pending)[number];
    used: number;
    stream: ReturnType<typeof followupsFor>;
    task: IteratorResult<() => boolean>;
  }[] = [];
  // Prime only the active window; empty branches finish immediately and release their place to deferred first trades.
  const fillActive = () => {
    while (
      active.length < budget.beam &&
      nextSeed < pending.length &&
      stats.scanned < budget.scans * 2 &&
      stats.evaluated < budget.first + budget.second
    ) {
      const resume = pending[nextSeed++];
      const stream = followupsFor(resume.seed, resume.offset);
      if (resume.offset === 0) stats.firstExplored++;
      const task = stream.next();
      if (task.done) stats.coverage.followups.completed++;
      else active.push({ stream, task, resume, used: 0 });
    }
  };
  // Share all remaining evaluations and scans; exhausted first-stage capacity is available to follow-ups instead of being wasted.
  let followupScans = 0,
    followupEvaluations = 0;
  fillActive();
  while (
    active.length &&
    stats.scanned < budget.scans * 2 &&
    stats.evaluated < budget.first + budget.second
  ) {
    const branch = active.shift()!;
    followupScans++;
    stats.scanned++;
    if (branch.task.value!()) followupEvaluations++;
    branch.resume.offset++;
    branch.task = branch.stream.next();
    if (branch.task.done) stats.coverage.followups.completed++;
    // Probe waiting first trades fairly, then double each resumed slice to avoid repeatedly rebuilding long prefixes one candidate at a time.
    else if (
      ++branch.used >= quantum * 2 ** branch.resume.pass &&
      nextSeed < pending.length
    ) {
      branch.stream.return(undefined);
      branch.resume.pass++;
      pending.push(branch.resume);
    } else active.push(branch);
    fillActive();
    stats.coverage.followups.scanned = followupScans;
    stats.coverage.followups.evaluated = followupEvaluations;
    stats.coverage.followups.unfinished =
      stats.firstExplored - stats.coverage.followups.completed;
    stats.coverage.followups.deferred = deferred.length - stats.firstExplored;
    publish();
  }
  // Display limits never imply incomplete exploration; stop reasons and unused work describe only the selected search universe.
  stats.coverage.followups.unfinished =
    stats.firstExplored - stats.coverage.followups.completed;
  stats.coverage.followups.deferred = deferred.length - stats.firstExplored;
  stats.coverage.unusedEvaluations = Math.max(
    0,
    budget.first + budget.second - stats.evaluated,
  );
  stats.coverage.unusedScans = Math.max(0, budget.scans * 2 - stats.scanned);
  if (active.length || nextSeed < pending.length) {
    if (!stats.coverage.unusedEvaluations)
      stats.coverage.stopReasons.push("followup-evaluation-budget");
    if (!stats.coverage.unusedScans)
      stats.coverage.stopReasons.push("followup-scan-budget");
  }
  if (stats.dependencyPending)
    stats.coverage.stopReasons.push("dependency-evaluation-budget");
  stats.limited =
    stats.dependencyPending > 0 ||
    !stats.coverage.first.complete ||
    active.length > 0 ||
    nextSeed < pending.length;
  stats.resultCapped = stats.found > chains.length;
  stats.phase = "Complete";
  publish();
  return {
    chains,
    stats,
    recipientRejections,
    plausibilityRejections,
    dependencyRejections,
  };
}

// Run a bounded recovery ladder only after zero results; all hard constraints and optional surface/needs filters remain identical.
export function discoverTradeChains(
  m: Model,
  q: ChainQuery,
  plans?: string,
  progress?: (stats: ChainStats) => void,
): ChainResults {
  const errors = chainErrors(m, q);
  if (errors.length) throw Error(errors.join(" "));
  const attempts: NonNullable<ChainResults["attempts"]> = [];
  let result: ChainResults | undefined;
  for (const round of chainSearchRounds(q)) {
    const evaluated = attempts.reduce((n, a) => n + a.stats.evaluated, 0);
    result = searchTradeChains(m, round.query, plans, (stats) =>
      progress?.({
        ...stats,
        evaluated: evaluated + stats.evaluated,
        limits: stats.limits
          ? {
              ...stats.limits,
              totalEvaluations: evaluated + stats.limits.totalEvaluations,
            }
          : undefined,
      }),
    );
    result.chains.forEach((c) => {
      c.relaxations = round.changes;
    });
    attempts.push({
      query: round.query,
      changes: round.changes,
      stats: structuredClone(result.stats),
      found: result.stats.found,
    });
    if (result.chains.length) break;
  }
  const final = result!;
  // Each attempt retains exact coverage and limits; totals never imply that the broader universe was exhausted.
  final.attempts = attempts;
  final.stats = {
    ...final.stats,
    evaluated: attempts.reduce((n, a) => n + a.stats.evaluated, 0),
    scanned: attempts.reduce((n, a) => n + a.stats.scanned, 0),
    limits: {
      firstEvaluations: attempts.reduce(
        (n, a) => n + (a.stats.limits?.firstEvaluations ?? 0),
        0,
      ),
      totalEvaluations: attempts.reduce(
        (n, a) => n + (a.stats.limits?.totalEvaluations ?? 0),
        0,
      ),
      scans: attempts.reduce((n, a) => n + (a.stats.limits?.scans ?? 0), 0),
    },
    limited: attempts.some((a) => a.stats.limited),
  };
  return final;
}
