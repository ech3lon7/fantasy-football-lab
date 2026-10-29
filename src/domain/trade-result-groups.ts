import { cmpId } from "./contracts";
import type { Model } from "./valuation";
import type { SearchRow } from "./trade-search";
import type { TradeChain } from "./trade-chains";

// Group identity is private presentation metadata, never an input to the manager acceptance evaluator.
export function primaryTradeTarget(m: Model, ids: string[]) {
  return (
    [...ids].sort(
      (a, b) =>
        (m.byId.get(b)?.index ?? -Infinity) -
          (m.byId.get(a)?.index ?? -Infinity) ||
        (m.byId.get(b)?.expected ?? -Infinity) -
          (m.byId.get(a)?.expected ?? -Infinity) ||
        cmpId(a, b),
    )[0] ?? ""
  );
}

// Preserve the user's selected order through first-best insertion; no match or exact alternative is discarded.
export function tradeResultGroups(m: Model, rows: SearchRow[]) {
  const teams = new Map<string, Map<string, SearchRow[]>>();
  for (const row of rows) {
    if (!teams.has(row.teamB)) teams.set(row.teamB, new Map());
    const targets = teams.get(row.teamB)!,
      key = primaryTradeTarget(m, row.get);
    targets.set(key, [...(targets.get(key) ?? []), row]);
  }
  return [...teams].map(([team, targets]) => ({
    team,
    targets: [...targets].map(([target, alternatives]) => {
      const packages = new Map<string, SearchRow[]>();
      for (const row of alternatives) {
        const key = JSON.stringify([...row.get].sort(cmpId));
        packages.set(key, [...(packages.get(key) ?? []), row]);
      }
      return {
        target,
        alternatives,
        packages: [...packages].map(([key, offers]) => ({
          key,
          alternatives: offers,
        })),
      };
    }),
  }));
}

// Chain groups retain direction and distinguish re-trade from keep-and-release routes.
export function chainResultGroups(m: Model, chains: TradeChain[]) {
  const teams = new Map<
    string,
    { first: string; second: string; routes: Map<string, TradeChain[]> }
  >();
  for (const chain of chains) {
    const first = chain.first.draft.teamB,
      second = chain.second.draft.teamB,
      key = JSON.stringify([first, second]);
    if (!teams.has(key)) teams.set(key, { first, second, routes: new Map() });
    const routes = teams.get(key)!.routes,
      route = JSON.stringify([
        chain.dependency?.route ?? "unknown",
        primaryTradeTarget(m, chain.second.draft.get),
      ]);
    routes.set(route, [...(routes.get(route) ?? []), chain]);
  }
  return [...teams].map(([key, group]) => ({
    key,
    ...group,
    routes: [...group.routes].map(([route, alternatives]) => ({
      route,
      alternatives,
    })),
  }));
}
