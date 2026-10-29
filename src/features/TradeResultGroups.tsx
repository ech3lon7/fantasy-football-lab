import { Fragment, useState, type ReactNode } from "react";
import {
  tradeResultGroups,
  chainResultGroups,
} from "../domain/trade-result-groups";
import type { Model } from "../domain/valuation";
import type { SearchRow } from "../domain/trade-search";
import type { TradeChain } from "../domain/trade-chains";
import { signed } from "../ui/components";

// Table sections show each target's best offer first; expanding alternatives preserves every original row/action.
export function GroupedTradeRows({
  rows,
  m,
  render,
}: {
  rows: SearchRow[];
  m: Model;
  render: (row: SearchRow) => ReactNode;
}) {
  const [closed, setClosed] = useState<string[]>([]),
    [expanded, setExpanded] = useState<string[]>([]);
  const toggle = (
    key: string,
    values: string[],
    set: (next: string[]) => void,
  ) =>
    set(
      values.includes(key) ? values.filter((x) => x !== key) : [...values, key],
    );
  const columns = rows.some((row) => row.surface) ? 8 : 6;
  return (
    <>
      {tradeResultGroups(m, rows).map((group) => (
        <tbody key={group.team}>
          <tr>
            <th colSpan={columns}>
              <button
                type="button"
                aria-expanded={!closed.includes(group.team)}
                onClick={() => toggle(group.team, closed, setClosed)}
              >
                {closed.includes(group.team) ? "▸" : "▾"}{" "}
                {String(
                  m.dataset.tables.ModelTeams.find(
                    (t) => String(t.TeamID) === group.team,
                  )?.TeamName ?? group.team,
                )}{" "}
                ·{" "}
                {group.targets.reduce(
                  (n, target) => n + target.alternatives.length,
                  0,
                )}{" "}
                loaded offers · {group.targets.length} targets · Best{" "}
                {signed(group.targets[0].alternatives[0].own)} EPPG
              </button>
            </th>
          </tr>
          {!closed.includes(group.team) &&
            group.targets.map((target) => {
              const key = JSON.stringify([group.team, target.target]),
                more = expanded.includes(key),
                best = target.alternatives[0];
              return (
                <Fragment key={key}>
                  {render(best)}
                  {target.alternatives.length > 1 && (
                    <tr>
                      <td colSpan={columns}>
                        <button
                          type="button"
                          aria-expanded={more}
                          onClick={() => toggle(key, expanded, setExpanded)}
                        >
                          {more ? "Hide" : "Show"}{" "}
                          {target.alternatives.length - 1} alternative offers
                          involving{" "}
                          {m.byId.get(target.target)?.name ?? target.target}
                        </button>
                      </td>
                    </tr>
                  )}
                  {/* Keep exact incoming packages together; outgoing variations have their own disclosure. */}
                  {more &&
                    target.packages.map((pack, i) => {
                      const packageKey = key + pack.key,
                        packageOpen = expanded.includes(packageKey);
                      const label = pack.alternatives[0].get
                        .map((id) => m.byId.get(id)?.name ?? id)
                        .join(" + ");
                      return (
                        <Fragment key={pack.key}>
                          {i > 0 && render(pack.alternatives[0])}
                          {pack.alternatives.length > 1 && (
                            <tr>
                              <td colSpan={columns}>
                                <button
                                  type="button"
                                  aria-expanded={packageOpen}
                                  onClick={() =>
                                    toggle(packageKey, expanded, setExpanded)
                                  }
                                >
                                  {packageOpen ? "Hide" : "Show"}{" "}
                                  {pack.alternatives.length - 1} outgoing
                                  alternatives for {label}
                                </button>
                              </td>
                            </tr>
                          )}
                          {packageOpen &&
                            pack.alternatives
                              .slice(1)
                              .map((row) => (
                                <Fragment key={row.key}>{render(row)}</Fragment>
                              ))}
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            })}
        </tbody>
      ))}
    </>
  );
}

// Ordered team-pair groups keep chain direction intact and make repeated plans expandable rather than removing them.
export function GroupedChains({
  chains,
  m,
  render,
}: {
  chains: TradeChain[];
  m: Model;
  render: (chain: TradeChain, i: number) => ReactNode;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const team = (id: string) =>
    String(
      m.dataset.tables.ModelTeams.find((t) => String(t.TeamID) === id)
        ?.TeamName ?? id,
    );
  return (
    <>
      {chainResultGroups(m, chains).map((group) => (
        <details open key={group.key}>
          <summary>
            {team(group.first)} → {team(group.second)} ·{" "}
            {group.routes.reduce(
              (n, route) => n + route.alternatives.length,
              0,
            )}{" "}
            plans
          </summary>
          {group.routes.map((route) => (
            <div key={route.route}>
              {render(
                route.alternatives[0],
                chains.indexOf(route.alternatives[0]),
              )}
              {route.alternatives.length > 1 && (
                <button
                  className="button"
                  aria-expanded={expanded.includes(group.key + route.route)}
                  onClick={() => {
                    const key = group.key + route.route;
                    setExpanded((old) =>
                      old.includes(key)
                        ? old.filter((x) => x !== key)
                        : [...old, key],
                    );
                  }}
                >
                  {expanded.includes(group.key + route.route) ? "Hide" : "Show"}{" "}
                  {route.alternatives.length - 1} similar chain alternatives
                </button>
              )}
              {expanded.includes(group.key + route.route) &&
                route.alternatives
                  .slice(1)
                  .map((chain) => (
                    <Fragment key={chain.key}>
                      {render(chain, chains.indexOf(chain))}
                    </Fragment>
                  ))}
            </div>
          ))}
        </details>
      ))}
    </>
  );
}
