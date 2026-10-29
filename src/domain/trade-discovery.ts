import { managerFailures } from "./manager-expectations";
import { surfaceFailures } from "./surface-appeal";
import { cmpId, n, positions, sum } from "./contracts";
import { irAssignments, lineup, teamsAssessment } from "./lineups";
import { evaluateTrade } from "./trades";
import { lineupBasisLabel, readLineupBasis } from "./trade-impact";
import type { Model } from "./valuation";
import {
  compareSearchRows,
  findTradeMatches,
  incomingCountRange,
  matchesWeekly,
  packageUsefulness,
  type UsefulnessEvidence,
  tradeSearchBounds,
  type SearchMatch,
  type SearchRow,
  type SearchStats,
  type TradeSearchQuery,
} from "./trade-search";

// Generate only explicitly tradable subsets; unselected roster members never enter an offer.
export function outgoingPackages(q: TradeSearchQuery): string[][] {
  const flexible = q.discovery?.flexible;
  if (!flexible) return [[...q.give]];
  const pool = [...flexible.pool].sort(cmpId),
    result: string[][] = [];
  const chosen: string[] = [];
  const visit = (start: number) => {
    if (chosen.length >= flexible.minimum) result.push([...chosen]);
    if (chosen.length === flexible.maximum) return;
    for (let i = start; i < pool.length; i++) {
      chosen.push(pool[i]);
      visit(i + 1);
      chosen.pop();
    }
  };
  visit(0);
  return result;
}

// Reuse the existing exact enumerator for each outgoing subset; optional adjustments vary incoming count by one and index bounds by five.
export function findDiscoveryMatches(
  m: Model,
  q: TradeSearchQuery,
  progress?: (s: SearchStats) => void,
  lineupsRaw?: string,
) {
  const errors = tradeSearchBounds(m, q).errors;
  if (errors.length) throw Error(errors.join(" "));
  const matches: SearchMatch[] = [];
  const stats: SearchStats = {
    teams: 0,
    checked: 0,
    excluded: 0,
    thinTeams: 0,
    matched: 0,
    scored: 0,
  };
  const add = (base: SearchStats, extra: SearchStats) => {
    const next = { ...base };
    for (const [key, value] of Object.entries(extra))
      if (typeof value === "number")
        next[key as keyof SearchStats] =
          (base[key as keyof SearchStats] ?? 0) + value;
    return next;
  };
  // Search every requested incoming size once; near misses extend only one size beyond either endpoint.
  const receive = incomingCountRange(q);
  const first = Math.max(
    1,
    receive.minimum - (q.discovery?.nearMisses ? 1 : 0),
  );
  const last = Math.min(5, receive.maximum + (q.discovery?.nearMisses ? 1 : 0));
  const counts = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  for (const give of outgoingPackages(q))
    for (const count of counts) {
      const child: TradeSearchQuery = {
        ...q,
        give,
        count,
        below: q.below + (q.discovery?.nearMisses ? 5 : 0),
        above: q.above + (q.discovery?.nearMisses ? 5 : 0),
        discovery: { ...q.discovery, flexible: undefined, receive: undefined },
      };
      // Shorter subsets may not satisfy explicit positional/count requirements; skip them without weakening the user's criteria.
      if (tradeSearchBounds(m, child).errors.length) continue;
      const found = findTradeMatches(
        m,
        child,
        (partial) => progress?.(add(stats, partial)),
        lineupsRaw,
      );
      for (const match of found.matches)
        matches.push(
          q.discovery?.flexible
            ? {
                ...match,
                give: [...give],
                key: JSON.stringify([match.teamB, give, match.get]),
              }
            : match,
        );
      Object.assign(stats, add(stats, found.stats));
    }
  return { matches, stats };
}

// Protection covers automatic roster-repair drops too; incoming players are not original protected roster members.
export function violatesProtection(row: SearchRow, q: TradeSearchQuery) {
  const pool = q.discovery?.flexible?.pool;
  return (
    !!pool &&
    row.dropsA.some((id) => !pool.includes(id) && !row.get.includes(id))
  );
}

// Keep failed limits explicit and in their own units; adjustments never silently become exact matches.
export function discoveryFailures(
  row: SearchRow,
  q: TradeSearchQuery,
): string[] {
  const reasons: string[] = [
    ...surfaceFailures(row, q.surface),
    ...managerFailures(row.manager, q.manager),
  ];
  // Receiving a position alone is not an upgrade: its optimized scoring contribution must increase.
  if (
    q.goal === "position" &&
    !(n(row.positionGain) !== null && row.positionGain! > 0)
  )
    reasons.push(
      "Your requested position does not have a positive weekly scoring gain.",
    );
  if (violatesProtection(row, q))
    reasons.push("Requires dropping a protected player.");
  const receive = incomingCountRange(q);
  if (row.get.length < receive.minimum || row.get.length > receive.maximum)
    reasons.push(
      `Adjustment: receive ${row.get.length} players instead of ${receive.minimum === receive.maximum ? receive.minimum : `${receive.minimum}–${receive.maximum}`}.`,
    );
  const lower = row.outgoing - q.below,
    upper = row.outgoing + q.above;
  if (q.indexMode !== "automatic" && row.incoming < lower)
    reasons.push(
      `Incoming index is ${(lower - row.incoming).toFixed(2)} below your minimum.`,
    );
  if (q.indexMode !== "automatic" && row.incoming > upper)
    reasons.push(
      `Incoming index is ${(row.incoming - upper).toFixed(2)} above your maximum.`,
    );
  if (q.usefulness && row.usefulness?.length !== (row.give ?? q.give).length)
    reasons.push("Not every offered player meets your usefulness minimum.");
  for (const [label, value, range] of [
    ["Your", row.own, q.weekly?.own],
    ["Their", row.other, q.weekly?.other],
  ] as const) {
    if (
      !range ||
      matchesWeekly(
        label === "Your"
          ? { own: value, other: null }
          : { own: null, other: value },
        label === "Your" ? { own: range } : { other: range },
      )
    )
      continue;
    if (n(value) === null)
      reasons.push(`${label} weekly scoring is unavailable.`);
    else if (range.minimum !== null && value! < range.minimum)
      reasons.push(
        `${label} weekly gain is ${(range.minimum - value!).toFixed(2)} points/week below your minimum.`,
      );
    else if (range.maximum !== null)
      reasons.push(
        `${label} weekly gain is ${(value! - range.maximum).toFixed(2)} points/week above your maximum.`,
      );
  }
  return reasons;
}

// Balanced ranking rewards gains on both sides; it never adds fantasy points to index values or invents an acceptance probability.
export function compareDiscoveryRows(
  a: SearchRow,
  b: SearchRow,
  ranking = "own",
) {
  // Acceptance ordering is explicit; a private-scoring sort is never silently replaced.
  if (ranking === "acceptance")
    return (
      (b.manager?.range ? b.manager.band! : -Infinity) -
        (a.manager?.range ? a.manager.band! : -Infinity) ||
      compareSearchRows(a, b)
    );
  if (ranking === "own") return compareSearchRows(a, b);
  const usable = (row: SearchRow) => row.own !== null && row.other !== null;
  if (usable(a) !== usable(b)) return usable(a) ? -1 : 1;
  if (ranking === "other")
    return (
      (b.other ?? -Infinity) - (a.other ?? -Infinity) || compareSearchRows(a, b)
    );
  const mutual = (row: SearchRow) =>
    Number(row.legal === true && row.own! > 0 && row.other! > 0);
  return (
    mutual(b) - mutual(a) ||
    Math.min(b.own ?? -Infinity, b.other ?? -Infinity) -
      Math.min(a.own ?? -Infinity, a.other ?? -Infinity) ||
    compareSearchRows(a, b)
  );
}

// Retain only the best five inspected near misses; exact-result pagination and search completeness are unchanged.
export function retainSuggestion(
  rows: SearchRow[],
  row: SearchRow,
  reasons: string[],
  ranking?: string,
) {
  if (
    !reasons.length ||
    row.legal !== true ||
    row.own === null ||
    row.other === null
  )
    return;
  rows.push({ ...row, nearMiss: { reasons, distance: reasons.length } });
  rows.sort(
    (a, b) =>
      a.nearMiss!.distance - b.nearMiss!.distance ||
      compareDiscoveryRows(a, b, ranking),
  );
  rows.splice(5);
}

// Keep explanatory grades, point changes and cautions typed separately from price and acceptance claims.
export interface OpponentIncentive {
  summary: string;
  notes: string[];
  upgrades: UsefulnessEvidence[];
  positions: {
    position: string;
    grade: string;
    afterGrade: string;
    starterGain: number | null;
    backupGain: number | null;
  }[];
}

// Explain a fully evaluated package on demand using existing forecasts, grades, legality and value tests, not a new trade-price model.
export function opponentIncentive(
  m: Model,
  q: TradeSearchQuery,
  row: SearchRow,
  lineupsRaw?: string,
): OpponentIncentive {
  const r = evaluateTrade(
    m,
    {
      teamA: q.teamA,
      teamB: row.teamB,
      give: row.give ?? q.give,
      get: row.get,
    },
    true,
    lineupsRaw,
  );
  if (!r.valid)
    return {
      summary: "Unavailable",
      notes: r.errors,
      positions: [],
      upgrades: [],
    };
  const grades = teamsAssessment(m).get(row.teamB) ?? [];
  // Reassess the legal post-trade ownership snapshot, including required drops, without changing forecasts or replacement pools.
  const own = new Set(r.legalA),
    other = new Set(r.legalB),
    ir = new Set([...r.irA, ...r.irB]);
  const players = m.players.map((p) => {
    const owner = own.has(p.id)
      ? q.teamA
      : other.has(p.id)
        ? row.teamB
        : [q.teamA, row.teamB].includes(p.owner)
          ? "0"
          : p.owner;
    const arrival = owner !== p.owner && owner !== "0";
    return { ...p, owner, slot: ir.has(p.id) ? 21 : arrival ? 20 : p.slot };
  });
  const afterModel: Model = {
    ...m,
    players,
    byId: new Map(players.map((p) => [p.id, p])),
  };
  const afterGrades = teamsAssessment(afterModel).get(row.teamB) ?? [];
  const affected = new Set(
    [...row.get, ...(row.give ?? q.give), ...r.dropsB].map(
      (id) => m.byId.get(id)!.pos,
    ),
  );
  const roleRoster = (ids: string[]) => {
    const ir = new Set(irAssignments(m, ids));
    return ids.filter((id) => !ir.has(id));
  };
  const beforeIds = roleRoster(r.initialB),
    afterIds = roleRoster(r.legalB);
  const before = lineup(m, beforeIds, m.current, false, true, "expected"),
    after = lineup(m, afterIds, m.current, false, true, "expected");
  const original = new Set(before.ids),
    final = new Set(after.ids);
  // Explain distinct starter/backup roles even with usefulness filtering off; missing or dropped arrivals cannot manufacture upgrades.
  const offered = (row.give ?? q.give).filter(
    (id) =>
      afterIds.includes(id) &&
      n(m.byId.get(id)?.expected) !== null &&
      m.byId.get(id)!.available > 0,
  );
  const upgrades = offered.length
    ? packageUsefulness(
        m,
        { ...q, give: offered, usefulness: { minimum: 0 } },
        r.initialB,
        r.legalB,
        r.irB,
        true,
      )
    : [];
  const changes = [...positions, "FLEX"]
    .map((position) => {
      const roleScore = (
        ids: (string | null)[],
        slots: string[],
        roster: string[],
      ) => {
        const selected = ids.filter((_, i) => slots[i] === position);
        // A missing positional forecast is uncertainty, never a zero-point vacancy that creates a fictitious gain.
        const missing = roster.some((id) => {
          const p = m.byId.get(id)!;
          return (
            (p.pos === position ||
              (position === "FLEX" && ["RB", "WR", "TE"].includes(p.pos))) &&
            n(p.expected) === null
          );
        });
        return missing
          ? null
          : sum(
              selected.map((id) => (id ? (m.byId.get(id)!.expected ?? 0) : 0)),
            );
      };
      const backup = (ids: string[], starters: Set<string | null>) => {
        const players = ids
          .map((id) => m.byId.get(id)!)
          .filter((p) => p.pos === position && !starters.has(p.id));
        return players.some((p) => n(p.expected) === null)
          ? null
          : Math.max(0, ...players.map((p) => p.expected!));
      };
      const a = roleScore(before.ids, before.slots, beforeIds),
        b = roleScore(after.ids, after.slots, afterIds);
      const c = backup(beforeIds, original),
        d = backup(afterIds, final);
      return {
        position,
        grade: grades.find((g) => g.position === position)?.grade ?? "n.a.",
        afterGrade:
          afterGrades.find((g) => g.position === position)?.grade ?? "n.a.",
        starterGain: a === null || b === null ? null : b - a,
        backupGain: c === null || d === null ? null : d - c,
      };
    })
    .filter(
      (change) =>
        affected.has(change.position as (typeof positions)[number]) ||
        (change.starterGain !== null && change.starterGain !== 0) ||
        (change.backupGain !== null && change.backupGain !== 0),
    );
  const notes = [
    `Their weekly gain (${lineupBasisLabel(q.lineupBasis)}): ${row.other === null ? "unavailable" : row.other.toFixed(2) + " points/week"}.`,
    `Their surplus received: ${r.outgoing.toFixed(2)}; surplus given: ${r.incoming.toFixed(2)}. Surplus is not a market price.`,
    `Role changes below use healthy modeled Expected PPG and are separate from weekly scoring. Both weekly gains use ${lineupBasisLabel(readLineupBasis(q.lineupBasis))}, with ${m.ignoreByeWeeks ? "byes and temporary injury absences ignored; IR excluded" : "scheduled bye and availability rules"}.`,
    ...(r.legality
      ? []
      : ["Unresolved roster legality prevents a reliable recommendation."]),
    ...r.uncertainty,
    ...(changes.some((c) => (c.starterGain ?? 0) < 0 || (c.backupGain ?? 0) < 0)
      ? [
          "This package weakens at least one modeled starting position or backup role.",
        ]
      : []),
  ];
  return {
    summary:
      !r.legality ||
      row.other === null ||
      changes.some((c) => c.starterGain === null || c.backupGain === null)
        ? "Incomplete evidence"
        : row.other > 0
          ? "Scoring incentive; review value and depth"
          : changes.some((c) => (c.backupGain ?? 0) > 0)
            ? "Depth incentive; review scoring losses"
            : "Limited modeled incentive",
    notes,
    upgrades,
    positions: changes,
  };
}
