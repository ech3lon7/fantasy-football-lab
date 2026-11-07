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
  type TradeResultView,
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
  if (!mounted) return null;

  const childElements = Children.toArray(children).flatMap((child) =>
    isValidElement(child) && child.type === Fragment
      ? Children.toArray((child.props as { children?: ReactNode }).children)
      : [child],
  );

  return (
    <>
      {childElements.map((elem, rowIdx) => {
        if (!isValidElement(elem)) return null;
        const row = elem as ReactElement<HTMLAttributes<HTMLTableRowElement>>;
        return (
          <tr
            {...row.props}
            key={row.key ?? rowIdx}
            ref={
              rowIdx === 0
                ? (node) => {
                    ref.current = node;
                  }
                : undefined
            }
            className={`trade-result-row ${row.props.className ?? ""}`}
            data-result-depth={depth}
            style={
              { ...row.props.style, "--result-depth": depth } as CSSProperties
            }
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
                    className={`trade-result-cell${index === 0 && rowIdx === 0 ? " trade-result-name" : ""}`}
                  >
                    {column.props.children}
                  </div>
                </div>,
              );
            })}
          </tr>
        );
      })}
    </>
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

// Each team exposes distinct incoming packages; outgoing alternatives and their pages remain independently collapsed.
export function GroupedTradeRows({
  rows,
  view,
  m,
  render,
  busy,
  morePackages,
  moreOffers,
}: {
  rows: SearchRow[];
  view?: TradeResultView;
  m: Model;
  render: (row: SearchRow) => ReactNode;
  busy?: boolean;
  morePackages: (team: string, shown: number) => void;
  moreOffers: (key: string, shown: number) => void;
}) {
  const [opened, setOpened] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const columns = rows.some((row) => row.surface) ? 8 : 6;
  return (
    <>
      {view?.teams.map((group) => {
        const teamOpen = opened.includes(group.team);
        const teamName = String(
          m.dataset.tables.ModelTeams.find(
            (t) => String(t.TeamID) === group.team,
          )?.TeamName ?? group.team,
        );
        const best = byKey.get(group.packages[0]?.rowKeys[0]);
        return (
          <tbody key={group.team}>
            <tr>
              <th colSpan={columns}>
                <button
                  type="button"
                  aria-expanded={teamOpen}
                  onClick={() =>
                    setOpened((old) =>
                      teamOpen
                        ? old.filter((key) => key !== group.team)
                        : [...old, group.team],
                    )
                  }
                >
                  {teamOpen ? "▾" : "▸"} {teamName} · {group.totalPackages}{" "}
                  packages · {group.totalOffers} offers · Best{" "}
                  {signed(best?.own ?? null)} EPPG
                </button>
              </th>
            </tr>
            {group.packages.map((pack) => {
              const first = byKey.get(pack.rowKeys[0]);
              if (!first) return null;
              const open = expanded.includes(pack.key);
              const label = first.get
                .map((id) => m.byId.get(id)?.name ?? id)
                .join(" + ");
              return (
                <Fragment key={pack.key}>
                  <ResultRow open={teamOpen} depth={1}>
                    {render(first)}
                  </ResultRow>
                  {pack.totalOffers > 1 && (
                    <ResultRow open={teamOpen} depth={1}>
                      <tr>
                        <td colSpan={columns}>
                          <button
                            type="button"
                            className="trade-result-toggle"
                            aria-expanded={open}
                            disabled={busy}
                            onClick={() => {
                              setExpanded((old) =>
                                open
                                  ? old.filter((key) => key !== pack.key)
                                  : [...old, pack.key],
                              );
                              // Fetch alternatives lazily; reopening a previously loaded package uses its retained page.
                              if (!open && pack.rowKeys.length === 1)
                                moreOffers(pack.key, 1);
                            }}
                          >
                            {open ? "Hide" : "Show"} {pack.totalOffers - 1}{" "}
                            outgoing alternatives for {label}
                          </button>
                        </td>
                      </tr>
                    </ResultRow>
                  )}
                  {pack.rowKeys.slice(1).map((key) => {
                    const row = byKey.get(key);
                    return row ? (
                      <ResultRow key={key} open={teamOpen && open} depth={2}>
                        {render(row)}
                      </ResultRow>
                    ) : null;
                  })}
                  {open && pack.rowKeys.length < pack.totalOffers && (
                    <ResultRow open={teamOpen} depth={2}>
                      <tr>
                        <td colSpan={columns}>
                          <span>
                            {pack.rowKeys.length} of {pack.totalOffers}{" "}
                            offers{" "}
                          </span>
                          <button
                            type="button"
                            className="subtle"
                            disabled={busy}
                            onClick={() =>
                              moreOffers(pack.key, pack.rowKeys.length)
                            }
                          >
                            Show more offers
                          </button>
                        </td>
                      </tr>
                    </ResultRow>
                  )}
                </Fragment>
              );
            })}
            {group.packages.length < group.totalPackages && (
              <ResultRow open={teamOpen} depth={1}>
                <tr>
                  <td colSpan={columns}>
                    <span>
                      {group.packages.length} of {group.totalPackages}{" "}
                      packages{" "}
                    </span>
                    <button
                      type="button"
                      className="subtle"
                      disabled={busy}
                      onClick={() =>
                        morePackages(group.team, group.packages.length)
                      }
                    >
                      Show more packages
                    </button>
                  </td>
                </tr>
              </ResultRow>
            )}
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
  // Connected and sequential plans share the same opt-in expansion, independent of their search calculations.
  const [opened, setOpened] = useState<string[]>([]),
    [expanded, setExpanded] = useState<string[]>([]);
  const team = (id: string) =>
    String(
      m.dataset.tables.ModelTeams.find((t) => String(t.TeamID) === id)
        ?.TeamName ?? id,
    );
  return (
    <>
      {chainResultGroups(m, chains).map((group) => {
        const groupOpen = opened.includes(group.key);
        return (
          <div className="trade-chain-group" key={group.key}>
            <button
              type="button"
              className="trade-result-toggle"
              aria-expanded={groupOpen}
              onClick={() =>
                setOpened((old) =>
                  groupOpen
                    ? old.filter((key) => key !== group.key)
                    : [...old, group.key],
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
