import type { SearchRow } from "../trade-search";
import type { LineupBasis } from "../trade-impact";
import type { Model } from "../valuation";
import type { TradeChain } from "../trade-chains";
import {
  priceStatus,
  priceStatusRank,
  resultRowView,
  type PriceStatus,
  type ResultRowView,
} from "./search-rows";
import type { GainSpread, GradeChip } from "./trade-room";

// Merge the grade steps of two consecutive trades by position: the first "before", the last "after", the steps added up.
// A position that ends where it began is not a change and is dropped.
export function combineChips(
  first: GradeChip[],
  second: GradeChip[],
): GradeChip[] {
  const byPosition = new Map<string, GradeChip>();
  for (const c of [...first, ...second]) {
    const seen = byPosition.get(c.position);
    byPosition.set(
      c.position,
      seen
        ? { ...seen, after: c.after, steps: seen.steps + c.steps }
        : { ...c },
    );
  }
  return [...byPosition.values()]
    .filter((c) => c.steps !== 0)
    .map((c) => ({
      ...c,
      text: `${c.position} ${c.before}→${c.after} ${c.steps > 0 ? "+" : ""}${c.steps}`,
      tone: c.steps > 0 ? ("positive" as const) : ("negative" as const),
    }));
}

// The chain's total lineup gain with a range: the two steps' spreads combine as independent values.
// A step without a spread leaves the range unavailable; it is never treated as zero.
export function chainGainSpread(
  first: GainSpread,
  second: GainSpread,
  total: number,
): GainSpread {
  const players = [...first.players, ...second.players];
  const base = {
    gain: total,
    players,
    sharesNflTeam: first.sharesNflTeam || second.sharesNflTeam,
  };
  if (first.spread === null || second.spread === null)
    return {
      ...base,
      spread: null,
      floor: null,
      ceiling: null,
      reason: first.reason || second.reason,
    };
  const spread = Math.sqrt(first.spread ** 2 + second.spread ** 2);
  return {
    ...base,
    spread,
    floor: total - spread,
    ceiling: total + spread,
    reason: "",
  };
}

// The chain's price status: the worse of its two steps; a chain found only after widening is "widened".
export function chainStatus(
  first: Pick<SearchRow, "surplus" | "points">,
  second: Pick<SearchRow, "surplus" | "points">,
  widened: string[],
): PriceStatus {
  const a = priceStatus(first, widened);
  const b = priceStatus(second, widened);
  if (a.kind === "warning" && b.kind === "warning")
    return { ...a, detail: `${a.detail}; ${b.detail}` };
  return priceStatusRank[a.kind] >= priceStatusRank[b.kind] ? a : b;
}

export interface ChainResultView {
  key: string;
  kind: "connected" | "sequential";
  steps: [ResultRowView, ResultRowView];
  gain: GainSpread;
  chips: GradeChip[];
  status: PriceStatus;
}

// Build the view of one chain: each step against the roster it was searched on, then the combined result.
export function chainResultView(
  chain: TradeChain,
  legs: {
    first: { model: Model; plans?: string };
    second: { model: Model; plans?: string };
  },
  team: string,
  basis: LineupBasis,
): ChainResultView {
  const widened = chain.relaxations ?? [];
  const step = (n: 1 | 2): ResultRowView => {
    const leg = n === 1 ? chain.first : chain.second;
    const c = n === 1 ? legs.first : legs.second;
    return resultRowView(
      c.model,
      leg.row,
      {
        teamA: team,
        give: leg.draft.give,
        basis: leg.row.lineupBasis ?? basis,
        lineupsRaw: c.plans,
      },
      widened,
    );
  };
  const one = step(1);
  const two = step(2);
  return {
    key: chain.key,
    kind: chain.kind ?? "connected",
    steps: [one, two],
    gain: chainGainSpread(one.gain, two.gain, chain.gain),
    chips: combineChips(one.ownChips, two.ownChips),
    status: chainStatus(chain.first.row, chain.second.row, widened),
  };
}
