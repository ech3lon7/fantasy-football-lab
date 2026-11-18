import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { positionGradeScale } from "../../../../domain/trade-search";
import { positions } from "../../../../domain/contracts";
import { useFeedback } from "../../../../ui/feel/feedback";
import { ArcSlider } from "./ArcSlider";
import { PhoneFan } from "./PhoneFan";
import { useWheelEffects } from "./useWheelEffects";
import { ChalkDefs, ChalkIcon, ChalkTick } from "./ChalkMarks";
import {
  RING,
  VIEW,
  labelPoint,
  pageSlice,
  polar,
  segmentBounds,
  segmentCenter,
  spoke,
  wedgePath,
} from "./wheel-geometry";
import { formatGain, type CategoryId, type WheelOption } from "./wheel-model";
import type { WheelData } from "./wheel-data";

const BOARD_W = 960;
const BOARD_H = 720;
const shortTeam = (name: string) =>
  name.length > 7 ? `${name.slice(0, 6)}…` : name;

// Fit the 960 x 720 board to the window, never larger than itself. The inline wheel on a phone shows only the 640-wide middle of the
// board (where the ring is), so the ring fills the screen instead of a third of it.
export const PHONE_MAX = 719;
const PHONE_CROP = 160;
function measureFit(inline: boolean) {
  if (typeof window === "undefined") return { fit: 1, phone: false };
  const phone = inline && window.innerWidth <= PHONE_MAX;
  return {
    phone,
    fit: Math.min(
      1,
      // A phone keeps a margin on both sides (the page's own padding), so the wheel never widens the page.
      (window.innerWidth - (phone ? 32 : 16)) / (phone ? BOARD_W - 2 * PHONE_CROP : BOARD_W),
      inline ? 520 / BOARD_H : (window.innerHeight - 16) / BOARD_H,
    ),
  };
}
// The first render already uses the real window size: a 960px board on a phone would widen the page before the first measure ran.
function useFit(inline = false) {
  const [size, setSize] = useState(() => measureFit(inline));
  useEffect(() => {
    const measure = () => setSize(measureFit(inline));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [inline]);
  return size;
}

const focusableSelector =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"], [role="slider"]';

// The filter wheel: Ring 1 holds the categories, choosing one opens its settings (a route-style arc slider for numbers, bubbles
// on the outer arc for toggles, a search list for players). It only sets the filter state the list view also uses.
function DesktopWheel({
  data,
  goalsEditor,
  onClose,
  onListView,
  opener,
  onHandoff,
  inline = false,
  hub,
}: {
  data: WheelData;
  // The existing grade-goal editor, shown as a panel when Grades is chosen.
  goalsEditor: ReactNode;
  onClose: () => void;
  onListView: () => void;
  // The Filters button the wheel collapses back into.
  opener?: RefObject<HTMLElement | null>;
  // The Chain planner hands categories it keeps per trade to its list.
  onHandoff?: (id: CategoryId) => void;
  inline?: boolean;
  hub?: ReactNode;
}) {
  const { categories } = data;
  const count = categories.length;
  const { fit, phone: cropped } = useFit(inline);
  const hatchId = useId().replace(/:/g, "");
  const dialog = useRef<HTMLDivElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const toastRef = useRef<HTMLDivElement>(null);
  const noOpener = useRef<HTMLElement | null>(null);
  const lastInput = useRef<"mouse" | "key" | "touch">("mouse");
  const notify = useFeedback();
  const [undo, setUndo] = useState<unknown>(null);
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [optionId, setOptionId] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [handle, setHandle] = useState<"lo" | "hi">("lo");

  const chosen = categories.find((c) => c.id === category) ?? null;
  // The inline phone wheel swaps its category ring for the selected category's options.
  const inlinePhone = inline && typeof window !== "undefined" && window.innerWidth <= 719;
  const option: WheelOption | null =
    chosen?.options.find((o) => o.id === optionId) ?? null;
  const shown = categories[focus];
  // While a Ring 1 category has focus or the pointer, the inline hub names it with its setting and the live count; otherwise it holds Search.
  const [onRing, setOnRing] = useState(false);
  // Segments can unmount while pointed at (the phone swaps its ring), so a changed level always clears the pointer state.
  useEffect(() => setOnRing(false), [category]);

  const doBack = () => {
    setEditing(false);
    setQuery("");
    if (optionId && (chosen?.options.length ?? 0) > 1) setOptionId(null);
    else {
      setOptionId(null);
      setCategory(null);
      setPage(0);
    }
  };
  // The effects hook is created after the handlers that use its exits, so they reach it through a ref.
  const fxRef = useRef<ReturnType<typeof useWheelEffects> | null>(null);
  const back = () => (fxRef.current ? fxRef.current.erase(doBack) : doBack());
  const closeWheel = () =>
    fxRef.current ? fxRef.current.close(onClose) : onClose();
  const choose = (id: CategoryId) => {
    const next = categories.find((c) => c.id === id)!;
    setCategory(id);
    setFocus(categories.indexOf(next));
    // A category with one setting goes straight to it.
    setOptionId(next.options.length === 1 ? next.options[0].id : null);
    setPage(0);
    setQuery("");
    setEditing(false);
    if (data.finder === "chain" && next.options[0]?.kind === "handoff")
      onHandoff?.(id);
  };

  // Focus the first segment on open, and the right control after each level change.
  // The inline wheel does not take focus when the page first shows it, but it does when a ring closes, so keyboard users land back on the category.
  const firstRun = useRef(true);
  useEffect(() => {
    const first = firstRun.current;
    firstRun.current = false;
    if (inline && !category && first) return;
    dialog.current
      ?.querySelector<HTMLElement>(
        category ? (inlinePhone ? '.gd-wheel-seg[data-option-index="0"]' : ".gd-wheel-pill") : `.gd-wheel-seg[data-index="${focus}"]`,
      )
      ?.focus();
    // Only the level (not each focus move) decides where focus lands.
  }, [category, optionId]);

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    lastInput.current = "key";
    const target = event.target as HTMLElement;
    const typing = target.tagName === "INPUT" || target.tagName === "SELECT";
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (category) back();
      else if (!inline) closeWheel();
    } else if (event.key === "Backspace" && !typing && category) {
      event.preventDefault();
      back();
    } else if (event.key === "Tab" && !inline) {
      // A focus trap: Tab cycles inside the dialog.
      const items = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(focusableSelector) ??
          []),
      ].filter((el) => el.offsetParent !== null || el instanceof SVGElement);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    } else if (
      !category &&
      !typing &&
      /^[1-7]$/.test(event.key) &&
      Number(event.key) <= count
    ) {
      event.preventDefault();
      choose(categories[Number(event.key) - 1].id);
    }
  };
  const segmentKey = (index: number) => (event: KeyboardEvent<SVGGElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const move = (to: number) => {
      event.preventDefault();
      const next = (to + count) % count;
      setFocus(next);
      dialog.current
        ?.querySelector<HTMLElement>(`.gd-wheel-seg[data-index="${next}"]`)
        ?.focus();
      // After the focus move, because the old segment's blur clears this.
      setOnRing(true);
    };
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      move(index + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      move(index - 1);
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(categories[index].id);
    }
  };

  const isPanelToggles =
    option?.kind === "toggles" &&
    (option.id === "roles" ||
      option.id === "listRules" ||
      option.id === "looksBetter");

  // The toggles of an option, paged eight at a time for long lists such as teams.
  const toggles =
    option?.kind === "toggles" && !isPanelToggles
      ? data.getToggles(option.id)
      : [];
  const paged = pageSlice(toggles, page);
  const bubbleCenter = chosen
    ? segmentCenter(categories.indexOf(chosen), count)
    : -90;

  const number =
    option && (option.kind === "slider" || option.kind === "range")
      ? data.getNumber(option.id)
      : null;
  const text = (o: WheelOption, value: number) =>
    o.id === "theirGain" || o.id.includes("Gain")
      ? formatGain(value)
      : String(value);
  const valueText =
    number && option
      ? option.kind === "slider"
        ? text(option, number.lo!)
        : `${number.lo! <= option.min! && option.id !== "giveSize" && option.id !== "getSize" ? "any" : text(option, number.lo!)} to ${number.hi! >= option.max! && option.id !== "giveSize" && option.id !== "getSize" ? "any" : text(option, number.hi!)}`
      : "";
  const stepBy = (delta: number) => {
    if (!number || !option) return;
    const lo = number.lo!;
    const hi = number.hi ?? undefined;
    const clamp = (v: number) =>
      Math.min(option.max!, Math.max(option.min!, v));
    if (option.kind === "slider" || handle === "lo")
      data.setNumber(option.id, clamp(lo + delta * option.step!), hi ?? null);
    else
      data.setNumber(
        option.id,
        lo,
        clamp((hi ?? option.max!) + delta * option.step!),
      );
  };

  const matches = useMemo(() => {
    if (option?.kind !== "players") return [];
    const { players, selected } = data.getPlayers(option.id);
    const q = query.trim().toLowerCase();
    const list = players.filter(
      (p) =>
        selected.includes(p.id) ||
        !q ||
        `${p.name} ${p.pos} ${p.nfl}`.toLowerCase().includes(q),
    );
    return [...list]
      .sort(
        (a, b) =>
          Number(selected.includes(b.id)) - Number(selected.includes(a.id)),
      )
      .slice(0, 8);
  }, [option, query, data]);

  const summary = category
    ? data.summary(category)
    : shown
      ? data.summary(shown.id)
      : "";
  const panel =
    option &&
    (option.kind === "players" ||
      option.kind === "goals" ||
      option.kind === "teamgrade" ||
      option.id === "roles" ||
      option.kind === "handoff");

  const togglesOn = toggles.map((t) => (t.on ? "1" : "0")).join("");
  const fx = useWheelEffects({
    board: dialog,
    fit: fitRef,
    scrim: scrimRef,
    opener: opener ?? noOpener,
    focus,
    category,
    optionId,
    page,
    valueKey: number ? `${optionId}:${number.lo}:${number.hi}` : "",
    togglesOn,
    hides: option?.hides ? (data.hides[option.hides] ?? 0) : undefined,
    matchesKey: matches.map((p) => p.id).join(","),
    cue: notify,
    lastInput,
  });
  fxRef.current = fx;
  // The Undo toast slides up after Clear all and goes away by itself.
  useEffect(() => {
    if (undo === null) return;
    fx.play("toast", toastRef.current, "toast");
    const t = window.setTimeout(() => setUndo(null), 7000);
    return () => window.clearTimeout(t);
  }, [undo]);

  // The hub's category view: its name, its setting and the live count.
  const nameView = (
              <>
      <div className="gd-hub-name">
        {(chosen ?? shown)?.label.toUpperCase()}
      </div>
      <div className="gd-hub-line">{summary}</div>
      {option ? (
        <div className="gd-hub-hides">hides {fx.shownHides}</div>
      ) : (
        <div className="gd-hub-hides">
          {data.visible.toLocaleString()} of{" "}
          {data.total.toLocaleString()}
        </div>
      )}
      {inline && !option && (
        <div className="gd-hub-active">{data.activeCount} filters on</div>
      )}
    </>
  );

  return (
    <div
      ref={scrimRef}
      className={inline ? "gd-wheel-inline" : "gd-wheel-scrim"}
      onMouseDown={(e) => {
        if (!inline && e.target === e.currentTarget) closeWheel();
      }}
    >
      <div
        ref={fitRef}
        className="gd-wheel-fit"
        style={{
          width: (cropped ? BOARD_W - 2 * PHONE_CROP : BOARD_W) * fit,
          height: BOARD_H * fit,
          overflow: cropped ? "hidden" : undefined,
        }}
      >
        <div
          ref={dialog}
          className="gd-wheel-board"
          data-cropped={cropped || undefined}
          role="dialog"
          aria-modal={inline ? undefined : "true"}
          aria-label="Trade filters"
          style={{
            width: BOARD_W,
            height: BOARD_H,
            left: cropped ? -PHONE_CROP * fit : undefined,
            transform: `scale(${fit})`,
            // Read by filter-wheel.css so the fit survives the Reduced-motion rule that clears every transform.
            ["--wheel-fit" as string]: fit,
          }}
          onKeyDown={key}
          onPointerDownCapture={(e) => {
            lastInput.current = e.pointerType === "touch" ? "touch" : "mouse";
          }}
        >
          <div className="gd-wheel-title">Trade filters</div>
          <div className="gd-wheel-sub">
            {option
              ? `play call: ${option.label.toLowerCase()}`
              : "pick a category"}
          </div>
          <div className="gd-wheel-count" role="status" aria-live="polite">
            {data.visible.toLocaleString()} / {data.total.toLocaleString()}
          </div>

          <svg
            className="gd-wheel-svg"
            width="640"
            height="640"
            viewBox={`0 0 ${VIEW} ${VIEW}`}
            role="presentation"
          >
            <ChalkDefs id={hatchId} />
            <defs>
              {/* The rings and spokes are revealed through a mask whose strokes are drawn in, so their broken chalk dashes stay intact. */}
              <mask
                id={`${hatchId}m`}
                maskUnits="userSpaceOnUse"
                x="0"
                y="0"
                width="640"
                height="640"
              >
                <g
                  fill="none"
                  stroke="white"
                  strokeWidth="16"
                  strokeLinecap="round"
                  strokeDasharray="1"
                >
                  <circle
                    className="gd-mask-draw"
                    cx="320"
                    cy="320"
                    r={RING.outer}
                    pathLength={1}
                  />
                  <circle
                    className="gd-mask-draw"
                    cx="321"
                    cy="319"
                    r={RING.outer - 2}
                    pathLength={1}
                  />
                  <circle
                    className="gd-mask-draw"
                    cx="320"
                    cy="320"
                    r={RING.inner}
                    pathLength={1}
                  />
                  {categories.map((_, i) => {
                    const sp = spoke(i, count);
                    return (
                      <line
                        key={i}
                        className="gd-mask-draw"
                        x1={sp.x1}
                        y1={sp.y1}
                        x2={sp.x2}
                        y2={sp.y2}
                        pathLength={1}
                      />
                    );
                  })}
                </g>
              </mask>
              {/* A label is written left to right by widening the clip that shows it. */}
              {categories.map((_, i) => {
                const at = labelPoint(i, count);
                return (
                  <clipPath key={i} id={`${hatchId}c${i}`}>
                    <rect
                      className="gd-write-clip"
                      x={at.x - 70}
                      y={at.y - 28}
                      width="140"
                      height="46"
                    />
                  </clipPath>
                );
              })}
            </defs>
            <g
              className="gd-wheel-rings"
              mask={`url(#${hatchId}m)`}
              fill="none"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle
                className="gd-ring gd-ring-outer"
                cx="320"
                cy="320"
                r={RING.outer}
              />
              <circle
                className="gd-ring-ghost"
                cx="321"
                cy="319"
                r={RING.outer - 2}
              />
              <circle
                className="gd-ring gd-ring-inner"
                cx="320"
                cy="320"
                r={RING.inner}
              />
              {categories.map((_, i) => {
                const s = spoke(i, count);
                return (
                  <line
                    key={i}
                    className="gd-spoke"
                    x1={s.x1}
                    y1={s.y1}
                    x2={s.x2}
                    y2={s.y2}
                  />
                );
              })}
            </g>

            <g
              role="menu"
              aria-label={inlinePhone && chosen ? `${chosen.label} settings` : "Filter categories"}
              className="gd-wheel-ring1"
            >
              {inlinePhone && chosen ? chosen.options.map((item, i) => {
                const optionCount = chosen.options.length;
                const { from, to } = segmentBounds(i, optionCount);
                const at = labelPoint(i, optionCount);
                return <g key={item.id} className="gd-wheel-seg" data-option-index={i} role="menuitem"
                  aria-label={item.label} tabIndex={item.id === optionId || (!optionId && i === 0) ? 0 : -1}
                  onClick={() => { setOptionId(item.id); setPage(0); setQuery(""); setEditing(false); }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOptionId(item.id); }
                    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                      event.preventDefault();
                      const next = (i + (event.key === "ArrowRight" ? 1 : -1) + optionCount) % optionCount;
                      dialog.current?.querySelector<HTMLElement>(`[data-option-index="${next}"]`)?.focus();
                    }
                  }}>
                  <path className="gd-seg-hit" d={wedgePath(RING.inner, RING.outer, from, to)} />
                  <text className="gd-seg-label" x={at.x} y={at.y + 7} textAnchor="middle">{item.label}</text>
                </g>;
              }) : categories.map((c, i) => {
                const { from, to } = segmentBounds(i, count);
                const at = labelPoint(i, count);
                const selected = c.id === category;
                const active = data.active(c.id);
                return (
                  <g
                    key={c.id}
                    className="gd-wheel-seg"
                    data-index={i}
                    data-selected={selected || undefined}
                    data-dim={category && !selected ? true : undefined}
                    role="menuitem"
                    aria-haspopup="true"
                    aria-label={`${c.label}${active ? `, ${active} set` : ""}`}
                    tabIndex={i === focus ? 0 : -1}
                    onFocus={() => setFocus(i)}
                    onBlur={() => setOnRing(false)}
                    onMouseEnter={() => {
                      if (category) return;
                      setFocus(i);
                      setOnRing(true);
                    }}
                    onMouseLeave={() => setOnRing(false)}
                    onClick={() => choose(c.id)}
                    onKeyDown={segmentKey(i)}
                  >
                    <path
                      className="gd-seg-hatch"
                      d={wedgePath(RING.wedgeInner, RING.wedgeOuter, from, to)}
                      fill={`url(#${hatchId})`}
                    />
                    <path
                      className="gd-seg-hit"
                      d={wedgePath(RING.inner, RING.outer, from, to)}
                    />
                    <ChalkIcon kind={c.icon} x={at.x} y={at.y - 33} />
                    <text
                      className="gd-seg-label"
                      clipPath={`url(#${hatchId}c${i})`}
                      x={at.x}
                      y={at.y + 7}
                      textAnchor="middle"
                    >
                      {c.label}
                    </text>
                    {active > 0 && (
                      <text
                        className="gd-seg-set"
                        x={at.x}
                        y={at.y + 31}
                        textAnchor="middle"
                      >
                        {active} set
                      </text>
                    )}
                  </g>
                );
              })}
            </g>

            {option && number && (
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
                onChange={(lo, hi) => data.setNumber(option.id, lo, hi ?? null)}
                onStep={() => setHandle("lo")}
                onEnd={fx.thunk}
              />
            )}

            {option && toggles.length > 0 && (
              <g
                role="menu"
                aria-label={`${option.label} options`}
                className="gd-wheel-bubbles"
              >
                {paged.items.map((t, i) => {
                  const angle =
                    bubbleCenter + (i - (paged.items.length - 1) / 2) * 30;
                  const p = polar(264, angle);
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
                      onClick={() => data.setToggle(option.id, t.key, !t.on)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          data.setToggle(option.id, t.key, !t.on);
                        }
                      }}
                    >
                      <title>{t.label}</title>
                      <circle r="27" />
                      <text y="5" textAnchor="middle">
                        {shortTeam(t.label)}
                      </text>
                      <ChalkTick x={0} y={-30} on={t.on} size={7} />
                    </g>
                  );
                })}
              </g>
            )}
          </svg>

          <div className="gd-wheel-hub">
            {inline && !category ? (
              <>
                {/* The Search, Team, Show all and Reset controls stay in place (so Tab still reaches them) and are covered while a category is pointed at. */}
                <div className="gd-hub-controls" data-away={onRing || undefined}>{hub}</div>
                {onRing && <div className="gd-hub-overlay">{nameView}</div>}
              </>
            ) : panel ? null : option && number ? (
              <>
                <div className="gd-hub-line">{option.hubLine}</div>
                {editing && option.kind === "slider" ? (
                  <input
                    className="gd-hub-input"
                    type="number"
                    aria-label="Exact value"
                    min={option.min}
                    max={option.max}
                    step={option.step}
                    defaultValue={number.lo!}
                    autoFocus
                    onBlur={() => setEditing(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const typed = Number(
                          (e.target as HTMLInputElement).value,
                        );
                        // A value outside the range is clamped, and the box shakes to say so.
                        if (typed < option.min! || typed > option.max!)
                          fx.shake(e.target as Element);
                        data.setNumber(option.id, typed, null);
                        setEditing(false);
                        e.stopPropagation();
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="gd-hub-value"
                    aria-label={`${option.label} value ${valueText}. Click to type an exact value`}
                    onClick={() => option.kind === "slider" && setEditing(true)}
                  >
                    {valueText}
                  </button>
                )}
                <div className="gd-hub-hides">hides {fx.shownHides}{option.hides && data.blocks && ` · also blocks ${(data.blocks[option.hides] ?? 0).toLocaleString()}`}</div>
                <div className="gd-hub-steps">
                  <button
                    type="button"
                    aria-label="Lower"
                    onClick={() => stepBy(-1)}
                  >
                    −
                  </button>
                  {option.kind === "range" && (
                    <button
                      type="button"
                      className="gd-hub-which"
                      aria-pressed={handle === "hi"}
                      onClick={() => setHandle(handle === "lo" ? "hi" : "lo")}
                    >
                      {handle === "lo" ? "min" : "max"}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Raise"
                    onClick={() => stepBy(1)}
                  >
                    +
                  </button>
                </div>
              </>
            ) : toggles.length > 1 && paged.pages > 1 ? (
              <>
                <div className="gd-hub-line">{option!.label}</div>
                <div className="gd-hub-steps">
                  <button
                    type="button"
                    aria-label="Previous page"
                    onClick={() =>
                      setPage((p) => (p + paged.pages - 1) % paged.pages)
                    }
                  >
                    ‹
                  </button>
                  <span className="gd-hub-page">
                    {paged.page + 1}/{paged.pages}
                  </span>
                  <button
                    type="button"
                    aria-label="Next page"
                    onClick={() => setPage((p) => (p + 1) % paged.pages)}
                  >
                    ›
                  </button>
                </div>
                <div className="gd-hub-hides">hides {fx.shownHides}</div>
              </>
            ) : (
              nameView
            )}
          </div>

          {panel && option && (
            <div
              className="gd-wheel-panel"
              role="group"
              aria-label={option.label}
            >
              {option.kind === "players" && (
                <>
                  <input
                    className="gd-panel-input"
                    type="search"
                    aria-label="Search players"
                    placeholder="type a name"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoFocus
                  />
                  <div className="gd-panel-list">
                    {matches.map((p) => {
                      const on = data
                        .getPlayers(option.id)
                        .selected.includes(p.id);
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
                    {!matches.length && (
                      <p className="gd-panel-empty">no players match</p>
                    )}
                  </div>
                </>
              )}
              {isPanelToggles &&
                data.getToggles(option.id).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={t.on}
                    aria-disabled={t.disabled}
                    disabled={t.disabled}
                    className="gd-panel-item"
                    title={t.hint}
                    onClick={() =>
                      !t.disabled && data.setToggle(option.id, t.key, !t.on)
                    }
                  >
                    <span>
                      {t.on ? "✓ " : ""}
                      {t.label}
                    </span>
                    {t.hint && <span className="gd-panel-hint">{t.hint}</span>}
                  </button>
                ))}
              {option.kind === "teamgrade" && (
                <>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={!!data.teamGrade}
                    className="gd-panel-item"
                    onClick={() =>
                      data.setTeamGrade(
                        data.teamGrade
                          ? null
                          : { position: "QB", ceiling: "C+" },
                      )
                    }
                  >
                    <span>
                      {data.teamGrade ? "✓ " : ""}Only teams graded at or below
                    </span>
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
                </>
              )}
              {option.kind === "goals" && (
                <div className="gd-panel-goals">{goalsEditor}</div>
              )}
              {option.kind === "handoff" && (
                <>
                  <p className="gd-panel-empty">
                    These are set per trade. Open the per-trade settings to
                    change them.
                  </p>
                  <button
                    type="button"
                    className="gd-panel-item"
                    onClick={onListView}
                  >
                    open per-trade settings
                  </button>
                </>
              )}
            </div>
          )}

          {chosen && chosen.options.length > 1 && !inlinePhone && (
            <div
              className="gd-wheel-pills"
              role="menu"
              aria-label={`${chosen.label} settings`}
            >
              {chosen.options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="menuitem"
                  className="gd-wheel-pill"
                  aria-current={o.id === optionId ? "true" : undefined}
                  data-on={o.id === optionId}
                  onClick={() => {
                    setOptionId(o.id);
                    setPage(0);
                    setQuery("");
                    setEditing(false);
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}

          {fx.trail.map((c) => (
            <span
              key={c.id}
              className="chalk-particle"
              aria-hidden="true"
              style={{ left: c.x / fit, top: c.y / fit }}
            />
          ))}
          {undo !== null && (
            <div ref={toastRef} className="gd-wheel-toast" role="status">
              cleared ·{" "}
              <button
                type="button"
                onClick={() => {
                  data.restore(undo);
                  setUndo(null);
                }}
              >
                undo
              </button>
            </div>
          )}
          <div className="gd-wheel-foot">
            {!inline && data.showAll && <button type="button" className="gd-foot-link" onClick={data.showAll}>Show all</button>}
            <button
              type="button"
              className="gd-foot-link"
              onClick={back}
              disabled={!category}
            >
              ← back
            </button>
            <button type="button" className="gd-foot-link" onClick={inline ? back : closeWheel}>
              done
            </button>
            {!inline && <button
              type="button"
              className="gd-foot-link"
              onClick={() =>
                fxRef.current ? fxRef.current.close(onListView) : onListView()
              }
            >
              list view
            </button>}
            {!inline && <button
              type="button"
              className="gd-foot-link"
              onClick={() =>
                fxRef.current?.wipe(() => {
                  setUndo(data.snapshot());
                  data.clear();
                })
              }
            >
              {data.showAll ? "Reset to defaults" : "clear all"}
            </button>}
          </div>
        </div>
      </div>
      {fx.puffs.map((p) => {
        const r = (opener ?? noOpener).current?.getBoundingClientRect();
        return (
          <span
            key={p.id}
            className="chalk-particle chalk-puff"
            aria-hidden="true"
            style={{
              position: "fixed",
              left: r ? r.left + r.width / 2 : 0,
              top: r ? r.top + r.height / 2 : 0,
              ["--dx" as string]: `${p.dx}px`,
              ["--dy" as string]: `${p.dy}px`,
            }}
          />
        );
      })}
    </div>
  );
}

// True on phones, where the wheel becomes a half-wheel fan (720px and narrower).
function useIsPhone() {
  const query = "(max-width: 720px)";
  const [phone, setPhone] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const list = window.matchMedia(query);
    const change = () => setPhone(list.matches);
    list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, []);
  return phone;
}

export function FilterWheel(props: Parameters<typeof DesktopWheel>[0]) {
  const phone = useIsPhone();
  return phone && !props.inline ? <PhoneFan {...props} /> : <DesktopWheel {...props} />;
}
