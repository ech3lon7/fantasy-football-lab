import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { positionGradeScale } from "../../../../domain/trade-search";
import { positions } from "../../../../domain/contracts";
import { useFeedback } from "../../../../ui/feel/feedback";
import { ArcSlider } from "./ArcSlider";
import { ChalkIcon } from "./ChalkMarks";
import { MotionRunner, chalkSpecs, motionLevel } from "./chalk-motion";
import { polar, wedgePath } from "./wheel-geometry";
import { formatGain, type CategoryId, type WheelOption } from "./wheel-model";
import type { WheelData } from "./wheel-data";

// The phone version of the wheel (A15): a half-wheel fan that rises from the bottom edge. There is only room for one ring at a
// time, so choosing a category swaps Ring 1 for that category's settings; the hub becomes a pill above the fan. Everything is
// reachable by tap and there is no hover-only behaviour. Segments are at least 48px.
const CX = 200;
const CY = 215;
const INNER = 56;
const OUTER = 150;

// The fan's segments share the top half circle equally, from the left edge to the right.
const fanBounds = (i: number, n: number) => ({
  from: -180 + (180 / n) * i + 1.5,
  to: -180 + (180 / n) * (i + 1) - 1.5,
});

export function PhoneFan({
  data,
  goalsEditor,
  onClose,
  onListView,
  opener,
}: {
  data: WheelData;
  goalsEditor: ReactNode;
  onClose: () => void;
  onListView: () => void;
  opener?: RefObject<HTMLElement | null>;
}) {
  const { categories } = data;
  const notify = useFeedback();
  const runner = useRef(new MotionRunner());
  const sheet = useRef<HTMLDivElement>(null);
  const ring = useRef<SVGGElement>(null);
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [optionId, setOptionId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [handle, setHandle] = useState<"lo" | "hi">("lo");

  const chosen = categories.find((c) => c.id === category) ?? null;
  const option: WheelOption | null =
    chosen?.options.find((o) => o.id === optionId) ?? null;
  const number =
    option && (option.kind === "slider" || option.kind === "range")
      ? data.getNumber(option.id)
      : null;
  const toggles =
    option?.kind === "toggles" && option.id !== "roles"
      ? data.getToggles(option.id)
      : [];
  const shownToggles = toggles.slice(page * 8, page * 8 + 8);
  const pages = Math.max(1, Math.ceil(toggles.length / 8));
  const text = (o: WheelOption, v: number) =>
    o.id.includes("Gain") ? formatGain(v) : String(v);

  // The fan rises on open and drops on close; rings swap sideways. At Reduced these are fades, at Off nothing.
  useLayoutEffect(() => {
    runner.current.play("up", sheet.current!, chalkSpecs.fanUp);
    notify("tap");
    return () => runner.current.finishAll();
  }, []);
  const close = (then: () => void) => {
    const a =
      motionLevel() === "off"
        ? null
        : runner.current.play("down", sheet.current!, chalkSpecs.fanDown);
    notify("success");
    if (a) a.finished.then(then, then);
    else then();
  };
  const swap = (apply: () => void) => {
    const a =
      ring.current && motionLevel() !== "off"
        ? runner.current.play("out", ring.current, chalkSpecs.ringOut)
        : null;
    if (a)
      a.finished.then(() => {
        apply();
        requestAnimationFrame(
          () =>
            ring.current &&
            runner.current.play("in", ring.current, chalkSpecs.ringIn),
        );
      }, apply);
    else apply();
  };
  const back = () =>
    swap(() =>
      optionId && (chosen?.options.length ?? 0) > 1
        ? setOptionId(null)
        : (setOptionId(null), setCategory(null), setPage(0), setQuery("")),
    );
  const choose = (id: CategoryId) =>
    swap(() => {
      const c = categories.find((x) => x.id === id)!;
      setCategory(id);
      setOptionId(c.options.length === 1 ? c.options[0].id : null);
      setPage(0);
    });

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (category) back();
      else close(onClose);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  void opener;

  // What the ring shows: the categories, or the chosen category's settings.
  const items = category ? (chosen?.options ?? []) : categories;
  const slot = (i: number) => fanBounds(i, Math.max(1, items.length));
  const step = (delta: number) => {
    if (!number || !option) return;
    const lo = number.lo!;
    const hi = number.hi ?? null;
    const clamp = (v: number) =>
      Math.min(option.max!, Math.max(option.min!, v));
    if (option.kind === "slider" || handle === "lo")
      data.setNumber(option.id, clamp(lo + delta * option.step!), hi);
    else
      data.setNumber(
        option.id,
        lo,
        clamp((hi ?? option.max!) + delta * option.step!),
      );
  };
  const valueText =
    number && option
      ? option.kind === "slider"
        ? text(option, number.lo!)
        : `${text(option, number.lo!)} to ${text(option, number.hi!)}`
      : "";
  const players =
    option?.kind === "players" ? data.getPlayers(option.id) : null;
  const matches = players
    ? players.players
        .filter(
          (p) =>
            players.selected.includes(p.id) ||
            !query.trim() ||
            `${p.name} ${p.pos}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
        )
        .slice(0, 8)
    : [];
  const pill = category
    ? `‹ ${chosen?.label}${option ? ` · ${option.label}` : ""}${valueText ? ` ${valueText}` : ""} · ${data.visible.toLocaleString()} trades`
    : `${data.visible.toLocaleString()} of ${data.total.toLocaleString()} trades`;

  return (
    <div
      className="gd-fan-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(onClose);
      }}
    >
      <div
        ref={sheet}
        className="gd-fan"
        role="dialog"
        aria-modal="true"
        aria-label="Trade filters"
      >
        <button
          type="button"
          className="gd-fan-pill"
          onClick={category ? back : undefined}
          disabled={!category}
          aria-label={category ? `Back. ${pill}` : pill}
        >
          {pill}
        </button>
        <div className="gd-fan-body">
          {panelFor()}
          <svg className="gd-fan-svg" viewBox="0 0 400 230" role="presentation">
            <g ref={ring}>
              <g
                role="menu"
                aria-label={
                  category ? `${chosen?.label} settings` : "Filter categories"
                }
              >
                {!number &&
                  !toggles.length &&
                  items.map((it, i) => {
                    const { from, to } = slot(i);
                    const mid = (from + to) / 2;
                    // Labels sit on the wide outer part of the wedge so neighbouring names never touch; every other one steps in a little.
                    const at = polar(i % 2 ? 112 : 130, mid, CX, CY);
                    const label = "label" in it ? it.label : "";
                    const active = !category
                      ? data.active((it as { id: CategoryId }).id)
                      : 0;
                    return (
                      <g
                        key={(it as { id: string }).id}
                        className="gd-fan-seg"
                        role="menuitem"
                        tabIndex={0}
                        aria-label={`${label}${active ? `, ${active} set` : ""}`}
                        data-on={
                          category
                            ? (it as WheelOption).id === optionId
                            : undefined
                        }
                        onClick={() =>
                          category
                            ? setOptionId((it as WheelOption).id)
                            : choose((it as { id: CategoryId }).id)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            (e.currentTarget as SVGGElement).dispatchEvent(
                              new MouseEvent("click", { bubbles: true }),
                            );
                          }
                        }}
                      >
                        <path
                          className="gd-fan-wedge"
                          d={wedgePath(INNER, OUTER, from, to)}
                          transform={`translate(${CX - 320} ${CY - 320})`}
                        />
                        {!category && (
                          <ChalkIcon
                            kind={(it as { icon: "o" }).icon}
                            x={at.x}
                            y={at.y - 22}
                          />
                        )}
                        <text
                          className="gd-fan-label"
                          x={at.x}
                          y={at.y + 8}
                          textAnchor="middle"
                        >
                          {label}
                        </text>
                        {active > 0 && (
                          <text
                            className="gd-seg-set"
                            x={at.x}
                            y={at.y + 24}
                            textAnchor="middle"
                          >
                            {active} set
                          </text>
                        )}
                      </g>
                    );
                  })}
              </g>
              {number && option && (
                <g
                  transform={`translate(${CX} ${CY + 6}) scale(0.78) translate(-320 -320)`}
                >
                  <ArcSlider
                    key={option.id}
                    label={
                      option.kind === "slider"
                        ? `${option.label} at least`
                        : option.label
                    }
                    min={option.min!}
                    max={option.max!}
                    step={option.step!}
                    lo={number.lo!}
                    hi={option.kind === "range" ? number.hi! : undefined}
                    format={(v) => text(option, v)}
                    endMarks={{
                      start: text(option, option.min!),
                      end: text(option, option.max!),
                    }}
                    onChange={(lo, hi) =>
                      data.setNumber(option.id, lo, hi ?? null)
                    }
                    onStep={() => {
                      setHandle("lo");
                      notify("tap");
                    }}
                    onEnd={() => notify("caution")}
                  />
                </g>
              )}
              {shownToggles.length > 0 && option && (
                <g role="menu" aria-label={`${option.label} options`}>
                  {shownToggles.map((t, i) => {
                    const p = polar(
                      104,
                      -180 + (180 / (shownToggles.length + 0)) * (i + 0.5),
                      CX,
                      CY,
                    );
                    return (
                      <g
                        key={t.key}
                        className="gd-bubble"
                        data-on={t.on}
                        role="menuitemcheckbox"
                        aria-checked={t.on}
                        aria-label={t.label}
                        tabIndex={0}
                        transform={`translate(${p.x} ${p.y})`}
                        onClick={() => {
                          data.setToggle(option.id, t.key, !t.on);
                          notify("select");
                        }}
                      >
                        <circle r="26" />
                        <text y="5" textAnchor="middle">
                          {t.label.length > 7
                            ? `${t.label.slice(0, 6)}…`
                            : t.label}
                        </text>
                      </g>
                    );
                  })}
                </g>
              )}
            </g>
          </svg>
        </div>
        {option?.hides && data.blocks && <div className="gd-hub-hides">hides {(data.hides[option.hides] ?? 0).toLocaleString()} · also blocks {(data.blocks[option.hides] ?? 0).toLocaleString()}</div>}
        {number && option && (
          <div className="gd-fan-steps">
            <button type="button" aria-label="Lower" onClick={() => step(-1)}>
              −
            </button>
            {option.kind === "range" && (
              <button
                type="button"
                aria-pressed={handle === "hi"}
                onClick={() => setHandle(handle === "lo" ? "hi" : "lo")}
              >
                {handle === "lo" ? "min" : "max"}
              </button>
            )}
            <button type="button" aria-label="Raise" onClick={() => step(1)}>
              +
            </button>
          </div>
        )}
        {toggles.length > 8 && (
          <div className="gd-fan-steps">
            <button
              type="button"
              aria-label="Previous page"
              onClick={() => setPage((p) => (p + pages - 1) % pages)}
            >
              ‹
            </button>
            <span>
              {page + 1}/{pages}
            </span>
            <button
              type="button"
              aria-label="Next page"
              onClick={() => setPage((p) => (p + 1) % pages)}
            >
              ›
            </button>
          </div>
        )}
        <div className="gd-fan-foot">
          <button type="button" onClick={() => close(onClose)}>
            done
          </button>
          <button type="button" onClick={() => close(onListView)}>
            list view
          </button>
          {data.showAll && <button type="button" onClick={data.showAll}>Show all</button>}
          <button type="button" onClick={data.clear}>
            {data.showAll ? "Reset to defaults" : "clear all"}
          </button>
        </div>
      </div>
    </div>
  );

  // Lists and editors that do not fit on a circle sit above the fan.
  function panelFor() {
    if (!option) return null;
    if (option.id === "roles")
      return (
        <div className="gd-fan-panel" role="group" aria-label="Roles">
          {data.getToggles("roles").map((t) => (
            <button
              key={t.key}
              type="button"
              role="menuitemcheckbox"
              aria-checked={t.on}
              className="gd-panel-item"
              onClick={() => data.setToggle("roles", t.key, !t.on)}
            >
              {t.on ? "✓ " : ""}
              {t.label}
            </button>
          ))}
        </div>
      );
    if (option.kind === "players")
      return (
        <div className="gd-fan-panel" role="group" aria-label={option.label}>
          <input
            className="gd-panel-input"
            type="search"
            aria-label="Search players"
            placeholder="type a name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {matches.map((p) => {
            const on = players!.selected.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className="gd-panel-item"
                aria-pressed={on}
                onClick={() => data.togglePlayer(option.id, p.id)}
              >
                <span>
                  {on ? "✓ " : ""}
                  {p.name}
                </span>
                <small>{p.pos}</small>
              </button>
            );
          })}
        </div>
      );
    if (option.kind === "teamgrade")
      return (
        <div className="gd-fan-panel" role="group" aria-label={option.label}>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={!!data.teamGrade}
            className="gd-panel-item"
            onClick={() =>
              data.setTeamGrade(
                data.teamGrade ? null : { position: "QB", ceiling: "C+" },
              )
            }
          >
            {data.teamGrade ? "✓ " : ""}Only teams graded at or below
          </button>
          {data.teamGrade && (
            <div className="gd-panel-row">
              <select
                aria-label="Team grade position"
                value={data.teamGrade.position}
                onChange={(e) =>
                  data.setTeamGrade({
                    ...data.teamGrade!,
                    position: e.target.value,
                  })
                }
              >
                {positions.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
              <select
                aria-label="Team grade ceiling"
                value={data.teamGrade.ceiling}
                onChange={(e) =>
                  data.setTeamGrade({
                    ...data.teamGrade!,
                    ceiling: e.target.value,
                  })
                }
              >
                {positionGradeScale.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      );
    if (option.kind === "handoff")
      return (
        <div className="gd-fan-panel" role="group" aria-label={option.label}>
          <p className="gd-panel-empty">These are set per trade.</p>
          <button
            type="button"
            className="gd-panel-item"
            onClick={() => close(onListView)}
          >
            open per-trade settings
          </button>
        </div>
      );
    if (option.kind === "goals")
      return (
        <div
          className="gd-fan-panel gd-panel-goals"
          role="group"
          aria-label={option.label}
        >
          {goalsEditor}
        </div>
      );
    return null;
  }
}
