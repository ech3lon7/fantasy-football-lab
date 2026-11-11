import { cmpId, type Draft } from "../contracts";
import { roster } from "../lineups";
import { tradeImpact, type LineupBasis } from "../trade-impact";
import { evaluateTrade } from "../trades";
import type { Model } from "../valuation";
import { lineupGainSpread, type GainSpread } from "./trade-room";

export type CounterKind =
  "swap-receive" | "swap-send" | "add-receive" | "add-send";

export interface Counter {
  kind: CounterKind;
  // For example "Receive Marcus Bell instead of Isaiah Crane".
  description: string;
  draft: Draft;
  // Lineup change in Expected PPG per remaining week for each team.
  ownGain: number;
  otherGain: number | null;
  ownRange: GainSpread;
  // True when the other team's lineup improves too, so it is more likely to be acceptable.
  helpsBoth: boolean;
}

export interface CounterResults {
  // The offer the counters start from, with both lineups' change; null when it is not a valid trade.
  base: { ownGain: number | null; otherGain: number | null } | null;
  counters: Counter[];
}

const maxSide = 5;

// Alternatives that differ from the offer by one swap or one added player and still help the owner's lineup.
// Counters that help both teams come first, then the larger gain for the owner, then a fixed order.
export function counterOffers(
  m: Model,
  draft: Draft,
  basis?: LineupBasis,
  lineupsRaw?: string,
  limit = 12,
): CounterResults {
  const read = (d: Draft) => {
    const result = evaluateTrade(m, d, true, lineupsRaw);
    return result.valid ? tradeImpact(result, basis) : null;
  };
  const start = read(draft);
  if (!start) return { base: null, counters: [] };
  const name = (id: string) => m.byId.get(id)?.name ?? id;
  const mine = roster(m, draft.teamA).filter((id) => !draft.give.includes(id));
  const theirs = roster(m, draft.teamB).filter((id) => !draft.get.includes(id));
  const options: { kind: CounterKind; description: string; next: Draft }[] = [];
  for (const out of draft.get)
    for (const id of theirs)
      options.push({
        kind: "swap-receive",
        description: `Receive ${name(id)} instead of ${name(out)}`,
        next: { ...draft, get: draft.get.map((g) => (g === out ? id : g)) },
      });
  for (const out of draft.give)
    for (const id of mine)
      options.push({
        kind: "swap-send",
        description: `Send ${name(id)} instead of ${name(out)}`,
        next: { ...draft, give: draft.give.map((g) => (g === out ? id : g)) },
      });
  if (draft.get.length < maxSide)
    for (const id of theirs)
      options.push({
        kind: "add-receive",
        description: `Also receive ${name(id)}`,
        next: { ...draft, get: [...draft.get, id] },
      });
  if (draft.give.length < maxSide)
    for (const id of mine)
      options.push({
        kind: "add-send",
        description: `Also send ${name(id)}`,
        next: { ...draft, give: [...draft.give, id] },
      });
  const counters: Counter[] = [];
  for (const o of options) {
    const impact = read(o.next);
    const ownGain = impact?.own.expectedPerWeek ?? null;
    // A counter must still help the owner; an unscorable lineup never counts as help.
    if (!impact || ownGain === null || !(ownGain > 0)) continue;
    const otherGain = impact.other.expectedPerWeek;
    counters.push({
      kind: o.kind,
      description: o.description,
      draft: o.next,
      ownGain,
      otherGain,
      ownRange: lineupGainSpread(m, impact.own, ownGain),
      helpsBoth: otherGain !== null && otherGain > 0,
    });
  }
  counters.sort(
    (a, b) =>
      Number(b.helpsBoth) - Number(a.helpsBoth) ||
      b.ownGain - a.ownGain ||
      cmpId(a.draft.get.join(","), b.draft.get.join(",")) ||
      cmpId(a.draft.give.join(","), b.draft.give.join(",")),
  );
  return {
    base: {
      ownGain: start.own.expectedPerWeek,
      otherGain: start.other.expectedPerWeek,
    },
    counters: counters.slice(0, limit),
  };
}
