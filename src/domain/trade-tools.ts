import { n, sum, type Draft } from "./contracts";
import { readLineupBasis, lineupBasisLabel } from "./trade-impact";
import type { Model } from "./valuation";
import { teamsAssessment } from "./lineups";
import { discoveryFailures } from "./trade-discovery";
import {
  gradeAtOrBelow,
  incomingCountRange,
  matchesIncoming,
  meetsUpgradeRequirements,
  offeredUpgrades,
  scoreTradeMatch,
  tradeSearchBounds,
  type TradeSearchQuery,
} from "./trade-search";

// Exact extrema use the allowed offer counts, not the sum of everyone in a potentially twelve-player pool.
export function poolIndexRanges(m: Model, q: TradeSearchQuery) {
  const f = q.discovery?.flexible,
    ids = f?.pool ?? q.give,
    values = ids.map((id) => n(m.byId.get(id)?.index));
  const minimum = f?.minimum ?? ids.length,
    maximum = f?.maximum ?? ids.length;
  if (
    !ids.length ||
    values.some((v) => v === null) ||
    !Number.isInteger(minimum) ||
    !Number.isInteger(maximum) ||
    minimum < 1 ||
    maximum < minimum ||
    maximum > 5 ||
    minimum > ids.length
  )
    return null;
  const ordered = (values as number[]).sort((a, b) => a - b);
  const counts = Array.from(
    { length: Math.min(maximum, ids.length) - minimum + 1 },
    (_, i) => {
      const count = minimum + i;
      return {
        count,
        minimum: sum(ordered.slice(0, count)),
        maximum: sum(ordered.slice(-count)),
      };
    },
  );
  return {
    minimum: Math.min(...counts.map((c) => c.minimum)),
    maximum: Math.max(...counts.map((c) => c.maximum)),
    counts,
  };
}

// Evaluate one explicitly formed candidate against every applicable current filter, without re-running a potentially huge search.
export function diagnoseTradeCandidate(
  m: Model,
  q: TradeSearchQuery,
  draft: Draft,
  lineupsRaw?: string,
) {
  const reasons: string[] = [],
    give = draft.give,
    get = draft.get;
  if (!give.length || !get.length)
    return {
      reasons: [
        "Choose the outgoing and incoming candidate in the analyzer to diagnose it.",
      ],
      outgoing: null,
      incoming: null,
    };
  if (draft.teamA !== q.teamA)
    reasons.push("The analyzer and search use different outgoing teams.");
  const f = q.discovery?.flexible;
  if (
    f
      ? give.length < f.minimum ||
        give.length > f.maximum ||
        give.some((id) => !f.pool.includes(id))
      : JSON.stringify([...give].sort()) !== JSON.stringify([...q.give].sort())
  )
    reasons.push(
      "Outgoing players or their count are outside the selected tradable pool / offer sizes.",
    );
  const receive = incomingCountRange(q);
  if (get.length < receive.minimum || get.length > receive.maximum)
    reasons.push(
      "Incoming player count is outside the selected receive range.",
    );
  if (
    get.some((id) => m.byId.get(id)?.owner !== draft.teamB) ||
    give.some((id) => m.byId.get(id)?.owner !== draft.teamA)
  )
    reasons.push(
      "The candidate does not match current ownership in this analysis mode.",
    );
  if (q.discovery?.target && !get.includes(q.discovery.target))
    reasons.push("The required incoming target is absent.");
  if (
    !matchesIncoming(
      get.flatMap((id) => (m.byId.has(id) ? [m.byId.get(id)!] : [])),
      q.incoming,
    )
  )
    reasons.push("Incoming Gem/Watch or position minimums are not met.");
  const child = { ...q, give, count: get.length },
    bounds = tradeSearchBounds(m, {
      ...child,
      discovery: { ...q.discovery, flexible: undefined, receive: undefined },
    });
  reasons.push(...bounds.errors);
  const outgoing = give.every((id) => n(m.byId.get(id)?.index) !== null)
    ? sum(give.map((id) => m.byId.get(id)!.index!))
    : null;
  const incoming = get.every((id) => n(m.byId.get(id)?.index) !== null)
    ? sum(get.map((id) => m.byId.get(id)!.index!))
    : null;
  if (
    q.indexMode !== "automatic" &&
    outgoing !== null &&
    incoming !== null &&
    (incoming < outgoing - q.below || incoming > outgoing + q.above)
  )
    reasons.push(
      `Incoming index ${incoming} is outside ${outgoing - q.below}–${outgoing + q.above}.`,
    );
  if (q.deficit) {
    const grade = teamsAssessment(m)
      .get(draft.teamB)
      ?.find((g) => g.position === q.deficit!.position)?.grade;
    if (!grade || !gradeAtOrBelow(grade, q.deficit.ceiling))
      reasons.push(
        `Opponent ${q.deficit.position} grade ${grade ?? "unavailable"} does not meet the ${q.deficit.ceiling} deficit ceiling.`,
      );
  }
  if (
    q.upgrade &&
    !meetsUpgradeRequirements(
      m,
      child,
      offeredUpgrades(m, child, draft.teamB, lineupsRaw),
    )
  )
    reasons.push("Opponent positional-upgrade requirements are not met.");
  if (!bounds.errors.length && !reasons.some((r) => r.includes("ownership"))) {
    const match = {
      key: JSON.stringify([draft.teamB, give, get]),
      teamB: draft.teamB,
      get,
      give,
      outgoing: outgoing ?? 0,
      incoming: incoming ?? 0,
      difference: (incoming ?? 0) - (outgoing ?? 0),
    };
    const scored = scoreTradeMatch(m, child, match, lineupsRaw);
    reasons.push(...discoveryFailures(scored, q));
    return {
      outgoing,
      incoming,
      lower:
        outgoing === null || q.indexMode === "automatic"
          ? null
          : outgoing - q.below,
      upper:
        outgoing === null || q.indexMode === "automatic"
          ? null
          : outgoing + q.above,
      reasons: [...new Set(reasons)],
      // Expose both baselines for one candidate, without relaxing the active search limits.
      lineupBasis: readLineupBasis(q.lineupBasis),
      beforeAfter: {
        ownBefore: scored.ownBefore,
        ownAfter: scored.ownAfter,
        otherBefore: scored.otherBefore,
        otherAfter: scored.otherAfter,
      },
      alternative: (() => {
        const alternateQuery = {
          ...child,
          lineupBasis:
            readLineupBasis(q.lineupBasis) === "best-available"
              ? ("marked-starters" as const)
              : ("best-available" as const),
        };
        const alternate = scoreTradeMatch(m, alternateQuery, match, lineupsRaw);
        return {
          basis: alternateQuery.lineupBasis,
          own: alternate.own,
          other: alternate.other,
          ownBefore: alternate.ownBefore,
          ownAfter: alternate.ownAfter,
          otherBefore: alternate.otherBefore,
          otherAfter: alternate.otherAfter,
        };
      })(),
      basisLabel: lineupBasisLabel(q.lineupBasis),
      ownGainPerWeek: scored.own,
      otherGainPerWeek: scored.other,
      warnings: scored.warnings,
      surplusTest: scored.surplus,
      pointsTest: scored.points,
      note: "Value-test failures describe the deal; they do not by themselves exclude an index match. Passing candidates can be on later ranked pages.",
    };
  }
  return { outgoing, incoming, reasons: [...new Set(reasons)] };
}

// Export only analysis inputs, never workspace account IDs, authentication/session storage, credentials or raw weekly history.
export function tradeDebugReport(
  m: Model,
  query: TradeSearchQuery,
  draft: Draft,
  lineupsRaw: string | undefined,
  applied: unknown,
  status: unknown,
) {
  return {
    format: "fantasy-trade-debug-1",
    exportedAt: new Date().toISOString(),
    datasetHash: m.dataset.hash,
    sourceUTC: m.dataset.sourceUTC,
    analysisVersion: m.analysisVersion,
    // Debug exports state the scoring policy explicitly; player/game counts and source schedules remain factual.
    scoringBasis: m.ignoreTemporaryAbsences
      ? "Hypothetical · byes ignored; temporary injury absences ignored; IR excluded"
      : m.ignoreByeWeeks
        ? "Hypothetical · byes ignored; injuries retained"
        : "Live · scheduled weeks",
    // Separate lineup semantics from availability; retain the legacy scoringBasis field for older debug readers.
    lineupBasis: readLineupBasis(query.lineupBasis),
    availabilityPolicy: m.ignoreTemporaryAbsences
      ? "byes-and-temporary-injuries-ignored-ir-excluded"
      : m.ignoreByeWeeks
        ? "known-byes-ignored-injuries-retained"
        : "scheduled-weeks",
    currentQuery: query,
    lastAppliedSearch: applied,
    searchStatus: status,
    draft,
    settings: m.settings,
    simulation: m.simulation?.scenario,
    candidate: diagnoseTradeCandidate(m, query, draft, lineupsRaw),
    poolRanges: poolIndexRanges(m, query),
    starterPlans: lineupsRaw ?? "",
    context: m.dataset.tables.ModelContext,
    teams: m.dataset.tables.ModelTeams,
    roster: m.dataset.tables.ModelRosters,
    schedule: m.dataset.tables.ModelSchedule,
    players: m.players.map((p) => ({
      id: p.id,
      name: p.name,
      pos: p.pos,
      owner: p.owner,
      index: p.index,
      expected: p.expected,
      value: p.value,
      injury: p.injury,
      uncertain: p.uncertain,
      out: p.out,
      slot: p.slot,
      droppable: p.droppable,
      available: p.available,
      gem: p.gem,
      returnWeek: p.opportunity.returnWeek,
    })),
  };
}
