import { cmpId } from "./contracts";
import type { Model } from "./valuation";
import type { SearchRow } from "./trade-search";
import type { TradeChain } from "./trade-chains";

// Browsing is ephemeral presentation state; it never changes the completed query or recalculates a trade.
export interface TradeBrowseOptions {
  offered: string;
  received: string;
  excluded?: string;
  exact: boolean;
  packages: Record<string, number>;
  offers: Record<string, number>;
}
export const emptyTradeBrowse = (): TradeBrowseOptions => ({
  offered: "",
  received: "",
  excluded: "",
  exact: false,
  packages: {},
  offers: {},
});
export interface TradeResultView {
  totalOffers: number;
  totalPackages: number;
  teams: {
    team: string;
    totalOffers: number;
    totalPackages: number;
    packages: { key: string; totalOffers: number; rowKeys: string[] }[];
  }[];
}
export const tradeResultPageSize = 50;

// Filter the entire ranked result set before paging distinct incoming packages independently for each team.
export function browseTradeResults(
  m: Model,
  rows: SearchRow[],
  options = emptyTradeBrowse(),
  defaultGive: string[] = [],
) {
  const normalize = (text: string) =>
    text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const terms = (text: string) =>
    text.split(",").map(normalize).filter(Boolean);
  const offered = terms(options.offered),
    received = terms(options.received),
    excluded = terms(options.excluded ?? "");
  const playerSearchText = (p: { name: string; nfl?: string; pos?: string }) =>
    normalize(
      `${p.name} ${p.nfl ?? ""} ${p.pos === "D/ST" ? "defense dst d/st" : ""}`,
    );
  const names = new Map(m.players.map((p) => [p.id, playerSearchText(p)]));
  const matches = (ids: string[], tokens: string[]) =>
    !tokens.length ||
    (tokens.every((token) =>
      ids.some((id) => names.get(id)?.includes(token)),
    ) &&
      (!options.exact ||
        (ids.length === tokens.length &&
          ids.every((id) =>
            tokens.some((token) => names.get(id)?.includes(token)),
          ))));
  const hasExcluded = (ids: string[]) =>
    excluded.length > 0 &&
    excluded.some((token) =>
      ids.some((id) => names.get(id)?.includes(token)),
    );
  const teams = new Map<string, Map<string, SearchRow[]>>();
  for (const row of rows) {
    const give = row.give ?? defaultGive;
    if (
      hasExcluded(give) ||
      hasExcluded(row.get) ||
      !matches(give, offered) ||
      !matches(row.get, received)
    )
      continue;
    if (!teams.has(row.teamB)) teams.set(row.teamB, new Map());
    const packages = teams.get(row.teamB)!;
    const key = JSON.stringify([row.teamB, [...row.get].sort(cmpId)]);
    if (!packages.has(key)) packages.set(key, []);
    packages.get(key)!.push(row);
  }
  // Send one best-ranked offer per package initially; alternative pages are fetched only after an explicit expansion.
  const visible: SearchRow[] = [];
  const view: TradeResultView = { totalOffers: 0, totalPackages: 0, teams: [] };
  for (const [team, packages] of teams) {
    const group: TradeResultView["teams"][number] = {
      team,
      totalOffers: 0,
      totalPackages: packages.size,
      packages: [],
    };
    const packageLimit = Math.max(
      1,
      options.packages[team] ?? tradeResultPageSize,
    );
    let index = 0;
    for (const [key, offers] of packages) {
      group.totalOffers += offers.length;
      if (index++ >= packageLimit) continue;
      const page = offers.slice(0, Math.max(1, options.offers[key] ?? 1));
      visible.push(...page);
      group.packages.push({
        key,
        totalOffers: offers.length,
        rowKeys: page.map((row) => row.key),
      });
    }
    view.totalOffers += group.totalOffers;
    view.totalPackages += group.totalPackages;
    view.teams.push(group);
  }
  return { rows: visible, view };
}

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
