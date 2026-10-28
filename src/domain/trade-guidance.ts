import type { Position } from "./contracts";
import type { Model } from "./valuation";
import {
  incomingCountRange,
  scoreTradeMatch,
  type SearchRecovery,
  type SearchRow,
  type TradeSearchQuery,
} from "./trade-search";
import { discoveryFailures, findDiscoveryMatches } from "./trade-discovery";

// Explicit goal selection resets screening restrictions, while retaining offered/protected players and targets.
export function guidedQuery(
  q: TradeSearchQuery,
  goal: NonNullable<TradeSearchQuery["goal"]>,
  position: Position = "WR",
): TradeSearchQuery {
  if (goal === "custom") return { ...q, goal };
  return {
    // Goal presets retain the shared scoring preference.
    lineupBasis: q.lineupBasis,
    teamA: q.teamA,
    give: [...q.give],
    goal,
    indexMode: "automatic",
    below: 5,
    above: 5,
    count: 3,
    discovery: {
      // Goal presets preserve explicitly selected opponents, just like protected players and the required target.
      teams: q.discovery?.teams,
      flexible: q.discovery?.flexible,
      target: q.discovery?.target,
      receive: { minimum: 1, maximum: 3 },
      ranking: goal === "surface" ? "own" : "balanced",
    },
    // Surface discovery requires your model gain while deliberately allowing their modeled gain to disagree with their surface appeal.
    surface:
      goal === "surface"
        ? { metric: "both", minimum: 0, requireValueTests: false }
        : undefined,
    weekly:
      goal === "explore"
        ? undefined
        : {
            own: { minimum: 1, maximum: null },
            other:
              goal === "surface" ? undefined : { minimum: 0, maximum: null },
          },
    incoming:
      goal === "position"
        ? { positions: [position], minimumPositions: 1 }
        : undefined,
  };
}

// Offer named individual changes and their combination; never relax ownership, protection, targets or player criteria.
export function recoveryQueries(
  q: TradeSearchQuery,
): Omit<SearchRecovery, "count">[] {
  const adjustments: {
    label: string;
    apply: (q: TradeSearchQuery) => TradeSearchQuery;
  }[] = [];
  if ((q.weekly?.own?.minimum ?? -Infinity) > 1)
    adjustments.push({
      label: "Lower your minimum to +1 point/week",
      apply: (p) => ({
        ...p,
        weekly: { ...p.weekly, own: { ...p.weekly!.own!, minimum: 1 } },
      }),
    });
  if ((q.weekly?.other?.minimum ?? -Infinity) > 0)
    adjustments.push({
      label: "Lower their minimum to 0 points/week",
      apply: (p) => ({
        ...p,
        weekly: { ...p.weekly, other: { ...p.weekly!.other!, minimum: 0 } },
      }),
    });
  if (q.indexMode !== "automatic")
    adjustments.push({
      label: "Use automatic index matching",
      apply: (p) => ({ ...p, indexMode: "automatic" }),
    });
  const receive = incomingCountRange(q);
  if (receive.minimum > 1 || receive.maximum < 3)
    adjustments.push({
      label: `Include 1–${Math.max(3, receive.maximum)} player returns`,
      apply: (p) => ({
        ...p,
        count: Math.max(3, receive.maximum),
        discovery: {
          ...p.discovery,
          receive: { minimum: 1, maximum: Math.max(3, receive.maximum) },
        },
      }),
    });
  const options = adjustments.map((a, i) => ({
    id: `recovery-${i}`,
    changes: [a.label],
    query: { ...a.apply(structuredClone(q)), goal: q.goal },
  }));
  if (adjustments.length > 1)
    options.push({
      id: "recovery-combined",
      changes: adjustments.map((a) => a.label),
      query: {
        ...adjustments.reduce((p, a) => a.apply(p), structuredClone(q)),
        goal: q.goal,
      },
    });
  return options;
}

// One exhaustive superset supplies exact counts for all previews; reuse completed evaluations without changing scoring.
export function findTradeRecoveries(
  m: Model,
  q: TradeSearchQuery,
  lineupsRaw?: string,
  cache = new Map<string, SearchRow>(),
  progress?: (checked: number, total: number) => void,
): SearchRecovery[] {
  const variants = recoveryQueries(q);
  if (!variants.length) return [];
  const widest = variants.at(-1)!.query;
  const universe = {
    ...widest,
    discovery: { ...widest.discovery, nearMisses: false },
  };
  const { matches } = findDiscoveryMatches(
    m,
    universe,
    () => progress?.(0, 0),
    lineupsRaw,
  );
  const options = variants.map((v) => ({ ...v, count: 0 }));
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const row =
      cache.get(match.key) ?? scoreTradeMatch(m, universe, match, lineupsRaw);
    for (const option of options)
      if (!discoveryFailures(row, option.query).length) option.count++;
    progress?.(i + 1, matches.length);
  }
  // Zero-count changes do not pretend to solve the search; combined previews list every required change.
  return options.filter((option) => option.count > 0);
}
