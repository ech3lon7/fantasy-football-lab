import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { RING, polar, segmentCenter, snapValue } from "../wheel/wheel-geometry";
import { formatGain, type CategoryId, type WheelOption } from "../wheel/wheel-model";
import type { WheelData } from "../wheel/wheel-data";
import { BoardSlider } from "./BoardSlider";
import { Hub } from "./Hub";
import { LeftRail, type RailProps } from "./LeftRail";
import { RightZone } from "./RightZone";
import { CountText, RollText } from "./RollText";
import { WheelRing } from "./WheelRing";
import { motion, useBoardMotion } from "./board-motion";
import { isOutside } from "./outside";

// The width at which the board lays out as three columns (rail 240, wheel, right zone 360, two 24px gaps); narrower it is stacked.
const COLUMNS_MIN = 1248;

export type BoardRail = Omit<RailProps, "activeCount" | "onShowAll" | "onReset" | "part">;

// The Find trades board: a chalkboard with a left rail, the wheel and a right zone. The rail holds the team, SEARCH, the filters-on
// count, show all and reset; the hub is display-only; every option and panel of the open category opens in the right zone. It only
// reads and writes the filter state through `data`. Every interaction is animated (M1 to M26), see board-motion.ts.
export function WheelBoard({
  data,
  goalsEditor,
  rail,
  searched,
  onShowAll,
  onReset,
  scene,
  notice,
}: {
  data: WheelData;
  goalsEditor: ReactNode;
  rail: BoardRail;
  // False before any search: the count reads "—" and the hides lines read "hides —".
  searched: boolean;
  onShowAll: () => void;
  onReset: () => void;
  // The play-call scene and the notice toast render inside the board.
  scene?: ReactNode;
  notice?: ReactNode;
}) {
  const bm = useBoardMotion();
  const { categories } = data;
  const count = categories.length;
  const wrap = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const dust = useRef<HTMLDivElement>(null);
  const lastInput = useRef<"mouse" | "key" | "touch">("mouse");
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [optionId, setOptionId] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const [pointed, setPointed] = useState<number | null>(null);
  const [handle, setHandle] = useState<"lo" | "hi">("lo");
  const [query, setQuery] = useState("");
  const [arrow, setArrow] = useState("");
  const [columns, setColumns] = useState(() => typeof window !== "undefined" && window.innerWidth - 16 >= COLUMNS_MIN);
  const firstRun = useRef(true);
  const previousCategory = useRef<CategoryId | null>(null);
  const previousPointed = useRef<number | null>(null);

  const chosen = categories.find((c) => c.id === category) ?? null;
  const option: WheelOption | null = chosen?.options.find((o) => o.id === optionId) ?? null;
  const number = option && (option.kind === "slider" || option.kind === "range") ? data.getNumber(option.id) : null;

  // The board is a size container: three columns only when it is at least 1248px wide.
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = () => setColumns(el.clientWidth >= COLUMNS_MIN);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const q = (selector: string) => board.current?.querySelector<HTMLElement>(selector) ?? null;
  const qa = (selector: string) => [...(board.current?.querySelectorAll<HTMLElement>(selector) ?? [])];
  const segment = (index: number) => q(`.gd-wheel-seg[data-index="${index}"]`);

  // --- M1: the tab is first shown. ---
  useLayoutEffect(() => {
    bm.play("m1-rise", stage.current, motion.rise);
    qa('[data-mask="ring"]').forEach((el, i) => bm.play(`m1-ring-${i}`, el, motion.ring, { delay: 120, silent: true }));
    bm.play("m1-ghost", q(".gd-ring-ghost"), motion.ghost, { delay: 480, silent: true });
    bm.stagger("m1-spoke", qa('[data-mask="spoke"]'), motion.spoke, 40, 12, 320);
    bm.stagger("m1-label", qa(".gd-seg-label"), motion.write, 40, 12, 520);
    bm.stagger("m1-mark", qa(".gd-seg-set"), motion.pop, 40, 12, 760);
    bm.stagger("m1-rail", qa('[data-zone="rail"] [data-motion~="M1"]'), motion.write, 40, 12, 200);
    bm.play("m1-hub", q(".gd-zb-hub"), motion.fadeIn200, { delay: 700, silent: true });
    const ring = q(".gd-zb-wheelbox");
    const host = dust.current;
    if (ring && host) {
      const rect = ring.getBoundingClientRect();
      const at = host.getBoundingClientRect();
      bm.dust(host, { x: rect.left + rect.width / 2 - at.left, y: rect.top + rect.height * 0.1 - at.top }, motion.puff, 6, 60);
    }
    return () => bm.finishAll();
  }, []);

  // --- M2: hover or focus a segment: the hatch sweeps in, the label wiggles, the one before smudges off. ---
  const point = (index: number | null) => {
    setPointed(index);
    const before = previousPointed.current;
    previousPointed.current = index;
    if (index === null) return;
    const quiet = lastInput.current === "mouse";
    if (before !== null && before !== index)
      bm.play("m2-smudge", segment(before)?.querySelector(".gd-seg-hatch"), motion.smudge, { silent: true });
    bm.play("m2-hatch", segment(index)?.querySelector(".gd-seg-hatch"), motion.hatch, { silent: quiet });
    bm.play("m2-wiggle", segment(index)?.querySelector(".gd-seg-label"), motion.wiggle, { delay: 120, silent: true });
  };

  // --- Going back one level (M14, and M25 on a phone); the old content is erased first. ---
  // The level the user is on, mirrored synchronously so that two quick presses of Back go up two levels, not one.
  const nav = useRef<{ category: CategoryId | null; optionId: string | null }>({ category, optionId });
  nav.current = { category, optionId };
  // A step that waits for an animation: a newer step first finishes the one still waiting, so nothing is lost or blocked.
  const pending = useRef<(() => void) | null>(null);
  const after = (animation: Animation | null, run: () => void) => {
    pending.current?.();
    let ran = false;
    const go = () => {
      if (ran) return;
      ran = true;
      if (pending.current === go) pending.current = null;
      run();
    };
    if (!animation) return go();
    pending.current = go;
    animation.finished.then(go, go);
  };
  const doBack = () => {
    setQuery("");
    const now = nav.current;
    const open = categories.find((c) => c.id === now.category);
    if (now.optionId && (open?.options.length ?? 0) > 1) {
      nav.current = { ...now, optionId: null };
      setOptionId(null);
    } else {
      nav.current = { category: null, optionId: null };
      setOptionId(null);
      setCategory(null);
    }
  };
  const back = () => {
    pending.current?.();
    if (!nav.current.category) return;
    const zone = q(".gd-zr-content");
    if (!columns && zone) {
      // On a phone the panel drops away.
      after(bm.play("m25-down", q(".gd-zr"), motion.panelDown), doBack);
      return;
    }
    bm.play("m14-arrow", q(".gd-zb-arrow path"), motion.wipe, { silent: true });
    qa(".gd-wheel-seg[data-dim]").forEach((el, i) => bm.play(`m14-undim-${i}`, el, motion.unDim, { silent: true }));
    after(bm.play("m14-wipe", zone, motion.wipe), doBack);
  };

  // --- M3 / M4: choose a segment. ---
  const choose = (id: CategoryId) => {
    const next = categories.find((c) => c.id === id)!;
    // A Back that is still being erased finishes first, so choosing never lands on a category that is on its way out.
    pending.current?.();
    const current = nav.current.category;
    const apply = () => {
      const first = next.options.length === 1 ? next.options[0].id : null;
      nav.current = { category: id, optionId: first };
      setCategory(id);
      setFocus(categories.indexOf(next));
      // A category with one setting goes straight to it.
      setOptionId(first);
      setQuery("");
    };
    if (current && current !== id) {
      // M4: the old options and the arrow are erased first.
      bm.play("m4-arrow", q(".gd-zb-arrow path"), motion.eraseOld, { silent: true });
      after(bm.play("m4-erase", q(".gd-zr-content"), motion.eraseOld), apply);
      return;
    }
    if (current === id) return;
    apply();
  };
  const selectOption = (id: string) => {
    setOptionId(id);
    setQuery("");
  };

  // The arrow from the chosen segment to the right zone (on columns), then the effects that follow a change of category.
  useLayoutEffect(() => {
    if (!category || !columns) {
      setArrow("");
      return;
    }
    const seg = segment(categories.findIndex((c) => c.id === category));
    const svg = (seg as unknown as SVGGElement | null)?.ownerSVGElement;
    const matrix = svg?.getScreenCTM();
    const host = stage.current?.getBoundingClientRect();
    const zone = q(".gd-zr")?.getBoundingClientRect();
    if (!seg || !svg || !matrix || !host || !zone) return;
    const angle = segmentCenter(categories.findIndex((c) => c.id === category), count);
    const from = polar(RING.outer + 16, angle);
    const point = svg.createSVGPoint();
    point.x = from.x;
    point.y = from.y;
    const start = point.matrixTransform(matrix);
    const sx = start.x - host.left;
    const sy = start.y - host.top;
    const ex = zone.left - host.left - 10;
    const ey = zone.top - host.top + 36;
    const wheelBox = q(".gd-zb-wheelbox")?.getBoundingClientRect();
    const middle = wheelBox ? wheelBox.left + wheelBox.width / 2 - host.left : sx;
    // A segment on the left of the wheel sends its arrow over the top of the ring, so it never crosses the wheel.
    const over = wheelBox && sx < middle - 20 ? wheelBox.top - host.top - 34 : null;
    const curve = over === null
      ? `M${sx} ${sy} C${sx + 90} ${sy - 30} ${ex - 90} ${ey + 20} ${ex} ${ey}`
      : `M${sx} ${sy} C${sx - 40} ${over} ${ex - 120} ${over} ${ex} ${ey}`;
    setArrow(`${curve} M${ex - 12} ${ey - 9} L${ex} ${ey} L${ex - 14} ${ey + 8}`);
  }, [category, optionId, columns]);
  useLayoutEffect(() => {
    if (!arrow) return;
    bm.play("m3-arrow", q(".gd-zb-arrow path"), motion.arrow, { silent: true });
  }, [arrow]);

  useLayoutEffect(() => {
    const was = previousCategory.current;
    previousCategory.current = category;
    if (category && category !== was) {
      const index = categories.findIndex((c) => c.id === category);
      bm.play("m3-pulse", segment(index), motion.pulse);
      qa(".gd-wheel-seg").filter((el) => el.dataset.index !== String(index)).forEach((el, i) => bm.play(`m3-dim-${i}`, el, motion.dim, { silent: true }));
      bm.stagger("m3-option", qa(".gd-zr-options .gd-zpill"), motion.option, 40, 12, 120);
      if (!columns) {
        bm.play("m25-up", q(".gd-zr"), motion.panelUp);
        q(".gd-zr")?.scrollIntoView({ block: "nearest", behavior: bm.level() === "full" ? "smooth" : "auto" });
      }
    }
    // Focus: into the zone when a category opens, back onto its segment when it closes (but not when the board first shows).
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (category) q(".gd-zr-options [role=menuitem], .gd-zr-content input, .gd-zr-content button")?.focus({ preventScroll: true });
    else if (was) segment(focus)?.focus({ preventScroll: true });
  }, [category]);

  // M6: a new option of a number filter redraws the slider route.
  useLayoutEffect(() => {
    if (!number) return;
    bm.play("m6-route", q(".gd-arc-route"), motion.route, { silent: true });
  }, [optionId]);

  // --- Click or tap outside the wheel, the right zone and the rail closes the open category (the same as Back). ---
  useEffect(() => {
    if (!category) return;
    const onDown = (event: PointerEvent) => {
      const zones = [q(".gd-zb-wheelbox"), q(".gd-zr"), q('[data-zone="rail"]')];
      if (isOutside(event.target, zones)) back();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  });

  // --- M23: Shift+Space (or the changed shortcut) focuses the wheel: a short chalk tap and the focused segment's hatch. ---
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const onShortcut = () => {
      lastInput.current = "key";
      bm.play("m23-tap", stage.current, motion.boardTap);
      point(focus);
    };
    el.addEventListener("zb-shortcut", onShortcut);
    return () => el.removeEventListener("zb-shortcut", onShortcut);
  });

  // --- Keys. ---
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    lastInput.current = "key";
    const target = event.target as HTMLElement;
    const typing = target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA";
    if (event.key === "Escape") {
      if (category) {
        event.preventDefault();
        event.stopPropagation();
        back();
      }
    } else if (event.key === "Backspace" && !typing && category) {
      event.preventDefault();
      back();
    } else if (!category && !typing && /^[1-7]$/.test(event.key) && Number(event.key) <= count) {
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
      segment(next)?.focus();
    };
    if (event.key === "ArrowRight" || event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(categories[index].id);
    }
  };

  // --- The number filter: slider, steps, exact value. ---
  const text = (o: WheelOption, value: number) => (o.id === "theirGain" || o.id.includes("Gain") ? formatGain(value) : String(value));
  const open = (o: WheelOption, value: number | null, end: "lo" | "hi") =>
    value === null || (end === "lo" ? value <= o.min! : value >= o.max!) && o.id !== "giveSize" && o.id !== "getSize" ? "any" : text(o, value);
  const valueText =
    number && option
      ? option.kind === "slider"
        ? text(option, number.lo!)
        : `${open(option, number.lo, "lo")} to ${open(option, number.hi, "hi")}`
      : "";
  // One step of a handle: it squashes, a few chalk particles trail behind it, and a sound ticks; an end stop thunks (M7).
  const stepped = (which: "lo" | "hi") => {
    const g = q(`.gd-arc-handle[data-handle="${which}"]`);
    bm.play(`m7-squash-${which}`, g, motion.squash);
    const rect = g?.getBoundingClientRect();
    const host = dust.current?.getBoundingClientRect();
    if (rect && host) bm.dust(dust.current, { x: rect.left + rect.width / 2 - host.left, y: rect.top + rect.height / 2 - host.top }, motion.trail, 3, 22);
  };
  const ended = (which: "lo" | "hi") => bm.play(`m7-thunk-${which}`, q(`.gd-arc-handle[data-handle="${which}"]`), motion.thunk);
  const stepBy = (delta: 1 | -1) => {
    if (!number || !option) return;
    const lo = number.lo!;
    const hi = number.hi ?? undefined;
    const clamp = (v: number) => Math.min(option.max!, Math.max(option.min!, v));
    const which = option.kind === "slider" ? "lo" : handle;
    const before = which === "lo" ? lo : (hi ?? option.max!);
    const next = clamp(before + delta * option.step!);
    if (next === before) return void ended(which);
    if (which === "lo") data.setNumber(option.id, next, hi ?? null);
    else data.setNumber(option.id, lo, next);
    stepped(which);
    if (next === option.min || next === option.max) ended(which);
  };
  const exact = (typed: number) => {
    if (!option || !number) return false;
    const clamped = Math.min(option.max!, Math.max(option.min!, typed));
    const next = snapValue(clamped, option.min!, option.max!, option.step!);
    const which = option.kind === "slider" ? "lo" : handle;
    if (which === "lo") data.setNumber(option.id, next, number.hi ?? null);
    else data.setNumber(option.id, number.lo!, next);
    stepped(which);
    return clamped !== typed;
  };
  const pickHandle = (which: "lo" | "hi") => {
    setHandle(which);
    bm.play("m8-ring", q(`.gd-arc-handle[data-handle="${which}"] .gd-arc-handle-o`), motion.ringPulse);
  };

  // --- M20: show all and reset wipe the board's values and write the new ones in. ---
  const changeAll = (run: () => void) => {
    run();
    bm.play("m20-band", q(".gd-zb-eraser"), motion.sweepBand);
    for (const [i, el] of [...qa(".gd-seg-set"), ...qa(".gd-wheel-count"), ...qa(".gd-rail-count")].entries())
      bm.play(`m20-write-${i}`, el, motion.writeValues, { delay: bm.level() === "full" ? 350 : 0, silent: i > 0 });
  };

  // The count taps when a search finishes (M18).
  const wasRunning = useRef(rail.running);
  useLayoutEffect(() => {
    if (wasRunning.current && !rail.running) bm.play("m18-count", q(".gd-wheel-count"), motion.countTap, { silent: true });
    wasRunning.current = rail.running;
  }, [rail.running]);

  // --- The hub: what is shown while a category is open or pointed at. ---
  const hubCategory = chosen ?? (pointed !== null ? categories[pointed] : null);
  const hubIdle = !hubCategory;
  const hideKeys = (option ? [option] : (hubCategory?.options ?? [])).map((o) => o.hides).filter(Boolean) as string[];
  const hideCount = hideKeys.reduce((n, k) => n + (data.hides[k] ?? 0), 0);
  const blockCount = data.blocks ? hideKeys.reduce((n, k) => n + (data.blocks![k] ?? 0), 0) : null;
  const hidesLine: ReactNode = !hubCategory ? "" : !searched ? "hides —" : (
    <>
      hides <CountText value={hideCount} motionId={number ? "M7" : "M5"} />
      {blockCount !== null && (
        <>
          {" "}· also blocks <CountText value={blockCount} motionId={number ? "M7" : "M5"} />
        </>
      )}
    </>
  );
  const hubValue = !hubCategory ? "" : number ? valueText : data.summary(hubCategory.id);
  const hubLine = option?.hubLine;

  const sliderNode = option && number && (
    <BoardSlider
      key={option.id}
      label={option.kind === "slider" ? `${option.label} at least` : option.label}
      min={option.min!}
      max={option.max!}
      step={option.step!}
      lo={number.lo!}
      hi={option.kind === "range" ? number.hi! : undefined}
      format={(v) => text(option, v)}
      endMarks={{ start: text(option, option.min!), end: text(option, option.max!) }}
      onChange={(lo, hi) => data.setNumber(option.id, lo, hi ?? null)}
      onStep={(which) => {
        setHandle(which);
        stepped(which);
      }}
      onEnd={ended}
      active={handle}
    />
  );

  const countText = searched ? `${data.visible.toLocaleString()} / ${data.total.toLocaleString()}` : "—";
  const railProps: RailProps = { ...rail, activeCount: data.activeCount, onShowAll: () => changeAll(onShowAll), onReset: () => changeAll(onReset) };

  return (
    <div className="gd-zb-wrap" ref={wrap} data-columns={columns || undefined}>
      <div
        ref={board}
        className="gd-zb"
        role="dialog"
        aria-label="Trade filters"
        onKeyDown={key}
        onPointerDownCapture={(e) => {
          lastInput.current = e.pointerType === "touch" ? "touch" : "mouse";
        }}
      >
        <div className="gd-zb-stage" ref={stage} data-motion="M1 M23">
          <div className="gd-zb-head">
            <div>
              <div className="gd-wheel-title">Trade filters</div>
              <div className="gd-wheel-sub">{option ? `play call: ${option.label.toLowerCase()}` : "pick a category"}</div>
            </div>
            <div className="gd-wheel-count" role="status" aria-live="polite" data-motion="M18">
              <RollText text={countText} />
            </div>
          </div>
          <div className="gd-zb-grid">
            <div className="gd-zb-rail" data-zone="rail">
              <LeftRail {...railProps} part="all" />
            </div>
            <div className="gd-zb-wheelzone" data-zone="wheel">
              <WheelRing
                data={data}
                category={category}
                focus={focus}
                onFocus={setFocus}
                onPoint={point}
                onChoose={choose}
                onKeyDown={segmentKey}
                slider={sliderNode}
                hub={
                  <Hub
                    idle={hubIdle}
                    name={hubCategory?.label.toUpperCase() ?? ""}
                    line={hubLine}
                    value={hubValue}
                    hides={hidesLine}
                    onBack={category ? back : undefined}
                  />
                }
              />
            </div>
            <RightZone
              data={data}
              category={chosen}
              option={option}
              onOption={selectOption}
              valueText={valueText}
              handle={handle}
              onHandle={pickHandle}
              onStep={stepBy}
              onExact={exact}
              goalsEditor={goalsEditor}
              query={query}
              setQuery={setQuery}
            />
          </div>
          <svg className="gd-zb-arrow" aria-hidden="true" data-motion="M3 M9 M14 M4">
            {arrow && <path d={arrow} pathLength={1} className="gd-zb-arrow-path" />}
          </svg>
          <div className="gd-zb-eraser" data-motion="M20" aria-hidden="true" />
          <div className="gd-zb-dust" ref={dust} data-motion="M1 M7" aria-hidden="true" />
          {scene}
          {notice}
        </div>
      </div>
    </div>
  );
}
