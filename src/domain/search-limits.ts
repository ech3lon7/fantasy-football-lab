import type { ChainQuery, TradeChain } from "./trade-chains";
import type { TradeSearchQuery } from "./trade-search";

// One search method for Find trades and the Chain planner: today's Balanced limits, shared and editable.
export interface SearchLimits {
  // The least final lineup gain (EPPG per week) a result must reach.
  minimumFinalGain: number;
  // The largest drop a chain may take after its first trade before the second recovers it; 0 means safe chains only.
  maximumTemporaryLoss: number;
  // The largest share of value the other team may give up, as a fraction (0.2 is 20%).
  maximumRecipientValueLoss: number;
  // Index window in raw surplus index points on each side; null means Off (no window), as new searches use today.
  indexWindow: number | null;
}

// The Balanced values the existing strictness presets used, with the index window Off as new searches already do.
export const defaultSearchLimits: SearchLimits = {
  minimumFinalGain: 2,
  maximumTemporaryLoss: 0,
  maximumRecipientValueLoss: 0.2,
  indexWindow: null,
};

// The balanced recipient minimum gain stays fixed; it is not one of the four shared limits.
const recipientMinimumGain = -1.5;

export const searchLimitsKey = "searchLimits";

export type LimitName = keyof SearchLimits;
export const limitLabels: Record<LimitName, string> = {
  minimumFinalGain: "Minimum final gain",
  maximumTemporaryLoss: "Maximum temporary loss",
  maximumRecipientValueLoss: "Maximum recipient value loss",
  indexWindow: "Index window",
};

// Names of the limits that differ from the defaults; drives the "edited" marker on the section and on each limit.
export function editedLimits(limits: SearchLimits): LimitName[] {
  return (Object.keys(defaultSearchLimits) as LimitName[]).filter(
    (k) => limits[k] !== defaultSearchLimits[k],
  );
}

const finite = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);

// Read saved limits, falling back to the defaults for anything missing or malformed so a bad value never breaks a search.
export function readSearchLimits(raw?: string): SearchLimits {
  if (!raw) return { ...defaultSearchLimits };
  try {
    const p: Record<string, unknown> = JSON.parse(raw);
    return {
      minimumFinalGain:
        finite(p.minimumFinalGain) && p.minimumFinalGain >= 0
          ? p.minimumFinalGain
          : defaultSearchLimits.minimumFinalGain,
      maximumTemporaryLoss:
        finite(p.maximumTemporaryLoss) && p.maximumTemporaryLoss >= 0
          ? p.maximumTemporaryLoss
          : defaultSearchLimits.maximumTemporaryLoss,
      maximumRecipientValueLoss:
        finite(p.maximumRecipientValueLoss) &&
        p.maximumRecipientValueLoss >= 0 &&
        p.maximumRecipientValueLoss <= 1
          ? p.maximumRecipientValueLoss
          : defaultSearchLimits.maximumRecipientValueLoss,
      indexWindow:
        p.indexWindow === null
          ? null
          : finite(p.indexWindow) && p.indexWindow > 0
            ? p.indexWindow
            : defaultSearchLimits.indexWindow,
    };
  } catch {
    return { ...defaultSearchLimits };
  }
}

// Store only the limits that differ from the defaults; unedited limits leave no saved value.
export function writeSearchLimits(limits: SearchLimits): string {
  const changed = editedLimits(limits);
  return changed.length
    ? JSON.stringify(Object.fromEntries(changed.map((k) => [k, limits[k]])))
    : "";
}

// Apply the shared limits to a chain query. Price tests become warnings so none ever hides a result.
export function applyLimitsToChainQuery(
  q: ChainQuery,
  limits: SearchLimits,
): ChainQuery {
  const window = limits.indexWindow;
  const leg = (s: ChainQuery["first"]): ChainQuery["first"] => {
    const { indexWindow: _previous, ...rest } = s;
    void _previous;
    return window === null
      ? rest
      : { ...rest, indexWindow: { below: window, above: window } };
  };
  return {
    ...q,
    limits,
    mode: limits.maximumTemporaryLoss > 0 ? "both" : "safe",
    maximumLoss: limits.maximumTemporaryLoss,
    minimumGain: limits.minimumFinalGain,
    pricePolicy: "warnings",
    recipient: {
      maximumValueLossPct: limits.maximumRecipientValueLoss,
      minimumGain: q.recipient?.minimumGain ?? recipientMinimumGain,
    },
    first: leg(q.first),
    second: leg(q.second),
  };
}

// Apply the shared index window to a Find trades query: Off keeps the automatic range, a number sets the strict range.
export function applyLimitsToSearchQuery(
  q: TradeSearchQuery,
  limits: SearchLimits,
): TradeSearchQuery {
  return limits.indexWindow === null
    ? { ...q, indexMode: "automatic" }
    : {
        ...q,
        indexMode: "strict",
        below: limits.indexWindow,
        above: limits.indexWindow,
      };
}

export interface LimitRound {
  limits: SearchLimits;
  // What moved and by how much, in words, for the result tag.
  changes: string[];
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const n1 = (x: number) => x.toFixed(1);

// Widening steps start from the user's own values; each step moves every limit a little further.
export function widenedLimits(limits: SearchLimits): LimitRound[] {
  const rounds: LimitRound[] = [{ limits, changes: [] }];
  for (const step of [1, 2]) {
    const next: SearchLimits = {
      minimumFinalGain: Math.max(0, limits.minimumFinalGain - 0.5 * step),
      maximumTemporaryLoss: limits.maximumTemporaryLoss + 1 * step,
      maximumRecipientValueLoss: Math.min(
        1,
        limits.maximumRecipientValueLoss + 0.05 * step,
      ),
      indexWindow:
        limits.indexWindow === null
          ? null
          : limits.indexWindow * (1 + 0.5 * step),
    };
    const changes: string[] = [];
    if (next.minimumFinalGain !== limits.minimumFinalGain)
      changes.push(
        `Minimum final gain ${n1(limits.minimumFinalGain)} → ${n1(next.minimumFinalGain)} EPPG`,
      );
    changes.push(
      `Maximum temporary loss ${n1(limits.maximumTemporaryLoss)} → ${n1(next.maximumTemporaryLoss)} EPPG`,
    );
    if (next.maximumRecipientValueLoss !== limits.maximumRecipientValueLoss)
      changes.push(
        `Maximum recipient value loss ${pct(limits.maximumRecipientValueLoss)} → ${pct(next.maximumRecipientValueLoss)}`,
      );
    if (next.indexWindow !== null && limits.indexWindow !== null)
      changes.push(
        `Index window ±${n1(limits.indexWindow)} → ±${n1(next.indexWindow)}`,
      );
    rounds.push({ limits: next, changes });
  }
  return rounds;
}

// Order chains: every price test passed first, then price warnings, then widened results; none is hidden.
export function chainPriceRank(c: TradeChain): 0 | 1 | 2 {
  if (c.relaxations && c.relaxations.length) return 2;
  const passes = [c.first.row, c.second.row].every(
    (r) => r.surplus === "PASS" && r.points === "PASS",
  );
  return passes ? 0 : 1;
}

// Stable sort so equal-ranked chains keep the search's own order.
export function orderChainsByPrice(chains: TradeChain[]): TradeChain[] {
  return chains
    .map((c, i) => ({ c, i, rank: chainPriceRank(c) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.c);
}

// Strictness is retired. A saved search or preset that carries it keeps everything else and drops the level.
export function migrateStrictness<T extends { strictness?: unknown }>(
  saved: T,
): Omit<T, "strictness"> {
  const { strictness: _dropped, ...rest } = saved;
  void _dropped;
  return rest;
}
