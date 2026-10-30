import {
  Fragment,
  Children,
  cloneElement,
  isValidElement,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  tradeResultGroups,
  chainResultGroups,
} from "../domain/trade-result-groups";
import type { Model } from "../domain/valuation";
import type { SearchRow } from "../domain/trade-search";
import type { TradeChain } from "../domain/trade-chains";
import { signed } from "../ui/components";

// Retain closing content for its 250ms transition; hidden controls become inert immediately and reduced motion skips animation.
function useResultReveal(open: boolean) {
  const [mounted, setMounted] = useState(open);
  const ref = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open && !mounted) {
      setMounted(true);
      return;
    }
    if (!mounted || !ref.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (!open) setMounted(false);
      return;
    }
    const host = ref.current;
    const parts =
      host.tagName === "TR"
        ? Array.from(
            host.querySelectorAll<HTMLElement>(
              ":scope > td > .trade-row-reveal",
            ),
          )
        : [host];
    const animations = parts.map((part) => {
      const height = `${part.scrollHeight}px`;
      part.style.overflow = "hidden";
      return part.animate(
        open
          ? [
              { height: "0px", opacity: 0 },
              { height, opacity: 1 },
            ]
          : [
              { height, opacity: 1 },
              { height: "0px", opacity: 0 },
            ],
        { duration: 250, easing: "ease-in-out", fill: "both" },
      );
    });
    const names = host.querySelector<HTMLElement>(
      ".trade-result-name, .trade-chain-level",
    );
    if (names)
      animations.push(
        names.animate(
          open
            ? [
                { transform: "translateX(-8px)" },
                { transform: "translateX(0)" },
              ]
            : [
                { transform: "translateX(0)" },
                { transform: "translateX(-8px)" },
              ],
          { duration: 250, easing: "ease-in-out" },
        ),
      );
    let active = true;
    void Promise.all(animations.map((animation) => animation.finished))
      .then(() => {
        if (!active) return;
        for (const part of parts) part.style.overflow = "";
        for (const animation of animations) animation.cancel();
        if (!open) setMounted(false);
      })
      .catch(() => {});
    return () => {
      active = false;
      for (const animation of animations) animation.cancel();
      for (const part of parts) part.style.overflow = "";
    };
  }, [open, mounted]);
  return { mounted, ref };
}

// Animate actual table cells without nested tables or shifted numeric columns; indent only identifying content and disclosure controls.
function ResultRow({
  open,
  depth,
  children,
}: {
  open: boolean;
  depth: number;
  children: ReactNode;
}) {
  const { mounted, ref } = useResultReveal(open);
  if (!mounted || !isValidElement(children)) return null;
  const row = children as ReactElement<HTMLAttributes<HTMLTableRowElement>>;
  return (
    <tr
      {...row.props}
      ref={(node) => {
        ref.current = node;
      }}
      className={`trade-result-row ${row.props.className ?? ""}`}
      data-result-depth={depth}
      style={{ ...row.props.style, "--result-depth": depth } as CSSProperties}
      inert={!open}
      aria-hidden={!open}
    >
      {Children.map(row.props.children, (cell, index) => {
        if (!isValidElement(cell)) return cell;
        const column = cell as ReactElement<
          HTMLAttributes<HTMLTableCellElement>
        >;
        return cloneElement(
          column,
          {},
          <div className="trade-row-reveal">
            <div
              className={`trade-result-cell${index === 0 ? " trade-result-name" : ""}`}
            >
              {column.props.children}
            </div>
          </div>,
        );
      })}
    </tr>
  );
}

// Chain sections use the same transition lifecycle and independent disclosure state, with a guide for each revealed nesting level.
function ResultBlock({
  open,
  depth = 0,
  children,
}: {
  open: boolean;
  depth?: number;
  children: ReactNode;
}) {
  const { mounted, ref } = useResultReveal(open);
  if (!mounted) return null;
  return (
    <div
      ref={(node) => {
        ref.current = node;
      }}
      inert={!open}
      aria-hidden={!open}
      className={`trade-chain-reveal${depth ? " trade-chain-nested" : ""}`}
    >
      <div className="trade-chain-level">{children}</div>
    </div>
  );
}

// Table sections retain every offer/action; each nested layer moves names 24px right while multiple targets can remain open.
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
      {tradeResultGroups(m, rows).map((group) => {
        const teamOpen = !closed.includes(group.team);
        return (
          <tbody key={group.team}>
            <tr>
              <th colSpan={columns}>
                <button
                  type="button"
                  aria-expanded={teamOpen}
                  onClick={() => toggle(group.team, closed, setClosed)}
                >
                  {teamOpen ? "▾" : "▸"}{" "}
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
            {group.targets.map((target) => {
              const key = JSON.stringify([group.team, target.target]),
                more = expanded.includes(key);
              return (
                <Fragment key={key}>
                  <ResultRow open={teamOpen} depth={1}>
                    {render(target.alternatives[0])}
                  </ResultRow>
                  {target.alternatives.length > 1 && (
                    <ResultRow open={teamOpen} depth={1}>
                      <tr>
                        <td colSpan={columns}>
                          <button
                            type="button"
                            className="trade-result-toggle"
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
                    </ResultRow>
                  )}
                  {target.packages.map((pack, i) => {
                    const packageKey = key + pack.key,
                      packageOpen = expanded.includes(packageKey);
                    const label = pack.alternatives[0].get
                      .map((id) => m.byId.get(id)?.name ?? id)
                      .join(" + ");
                    return (
                      <Fragment key={pack.key}>
                        {i > 0 && (
                          <ResultRow open={teamOpen && more} depth={2}>
                            {render(pack.alternatives[0])}
                          </ResultRow>
                        )}
                        {pack.alternatives.length > 1 && (
                          <ResultRow open={teamOpen && more} depth={2}>
                            <tr>
                              <td colSpan={columns}>
                                <button
                                  type="button"
                                  className="trade-result-toggle"
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
                          </ResultRow>
                        )}
                        {pack.alternatives.slice(1).map((row) => (
                          <ResultRow
                            key={row.key}
                            open={teamOpen && more && packageOpen}
                            depth={3}
                          >
                            {render(row)}
                          </ResultRow>
                        ))}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        );
      })}
    </>
  );
}

// Ordered team-pair groups keep chain direction and all saved/loadable variants while animating only these result disclosures.
export function GroupedChains({
  chains,
  m,
  render,
}: {
  chains: TradeChain[];
  m: Model;
  render: (chain: TradeChain, i: number) => ReactNode;
}) {
  const [closed, setClosed] = useState<string[]>([]),
    [expanded, setExpanded] = useState<string[]>([]);
  const team = (id: string) =>
    String(
      m.dataset.tables.ModelTeams.find((t) => String(t.TeamID) === id)
        ?.TeamName ?? id,
    );
  return (
    <>
      {chainResultGroups(m, chains).map((group) => {
        const groupOpen = !closed.includes(group.key);
        return (
          <div className="trade-chain-group" key={group.key}>
            <button
              type="button"
              className="trade-result-toggle"
              aria-expanded={groupOpen}
              onClick={() =>
                setClosed((old) =>
                  groupOpen
                    ? [...old, group.key]
                    : old.filter((key) => key !== group.key),
                )
              }
            >
              {groupOpen ? "▾" : "▸"} {team(group.first)} → {team(group.second)}{" "}
              ·{" "}
              {group.routes.reduce(
                (n, route) => n + route.alternatives.length,
                0,
              )}{" "}
              plans
            </button>
            <ResultBlock open={groupOpen} depth={1}>
              {group.routes.map((route) => {
                const key = group.key + route.route,
                  more = expanded.includes(key);
                return (
                  <div key={route.route}>
                    {render(
                      route.alternatives[0],
                      chains.indexOf(route.alternatives[0]),
                    )}
                    {route.alternatives.length > 1 && (
                      <button
                        type="button"
                        className="trade-result-toggle"
                        aria-expanded={more}
                        onClick={() =>
                          setExpanded((old) =>
                            more ? old.filter((x) => x !== key) : [...old, key],
                          )
                        }
                      >
                        {more ? "Hide" : "Show"} {route.alternatives.length - 1}{" "}
                        similar chain alternatives
                      </button>
                    )}
                    <ResultBlock open={more} depth={1}>
                      {route.alternatives.slice(1).map((chain) => (
                        <div key={chain.key}>
                          {render(chain, chains.indexOf(chain))}
                        </div>
                      ))}
                    </ResultBlock>
                  </div>
                );
              })}
            </ResultBlock>
          </div>
        );
      })}
    </>
  );
}
