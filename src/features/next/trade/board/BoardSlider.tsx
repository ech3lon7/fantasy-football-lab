import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  RING,
  SLIDER_FROM,
  SLIDER_TO,
  angleToValue,
  arcPath,
  arrowHead,
  pointerAngle,
  polar,
  snapValue,
  valueToAngle,
} from "../wheel/wheel-geometry";

// The route-style arc slider of the Chalk Playbook board (the same geometry as the pop-up wheel's ArcSlider), drawn once with its
// route and handle rings marked for the board's motion: the route is a pathLength 1 stroke so it can be redrawn (M6), a handle
// squashes at each step (M7) and its ring pulses when it becomes the active one (M8). The end labels sit outside the ring.
export function BoardSlider({
  label,
  min,
  max,
  step,
  lo,
  hi,
  format,
  onChange,
  endMarks,
  onStep,
  onEnd,
  active,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  lo: number;
  // Present for a range; absent for a single minimum.
  hi?: number;
  format: (value: number) => string;
  onChange: (lo: number, hi: number | undefined) => void;
  endMarks: { start: string; end: string };
  // Called when a handle lands on a new step (the handle that moved, the angle, and the direction), and when it hits an end.
  onStep?: (which: "lo" | "hi", value: number, angle: number, direction: 1 | -1) => void;
  onEnd?: (which: "lo" | "hi") => void;
  // The handle the card's − and + act on.
  active?: "lo" | "hi";
}) {
  const svgRef = useRef<SVGGElement>(null);
  const dragging = useRef<"lo" | "hi" | null>(null);
  const range = hi !== undefined;
  const loAngle = valueToAngle(lo, min, max);
  const hiAngle = valueToAngle(hi ?? max, min, max);

  const angleAt = useCallback((event: { clientX: number; clientY: number }) => {
    const svg = svgRef.current?.ownerSVGElement;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return pointerAngle(local.x, local.y);
  }, []);

  const apply = (which: "lo" | "hi", value: number) => {
    const next = snapValue(value, min, max, step);
    const current = which === "lo" ? lo : (hi ?? max);
    if (next === current) return;
    if (which === "lo") onChange(range ? Math.min(next, hi!) : next, hi);
    else onChange(lo, Math.max(next, lo));
    onStep?.(which, next, valueToAngle(next, min, max), next > current ? 1 : -1);
    if (next === min || next === max) onEnd?.(which);
  };

  const move = (event: PointerEvent) => {
    const angle = angleAt(event);
    if (angle === null || !dragging.current) return;
    apply(dragging.current, angleToValue(angle, min, max, step));
  };
  const down = (event: PointerEvent) => {
    const angle = angleAt(event);
    if (angle === null) return;
    const value = angleToValue(angle, min, max, step);
    dragging.current =
      range && Math.abs(value - (hi ?? max)) < Math.abs(value - lo) ? "hi" : "lo";
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    apply(dragging.current, value);
  };
  const up = (event: PointerEvent) => {
    dragging.current = null;
    (event.currentTarget as Element).releasePointerCapture?.(event.pointerId);
  };

  // The mouse wheel nudges the main handle one step; it needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      apply(
        range && event.shiftKey ? "hi" : "lo",
        (range && event.shiftKey ? (hi ?? max) : lo) + (event.deltaY < 0 ? step : -step),
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  const key = (which: "lo" | "hi") => (event: KeyboardEvent) => {
    const current = which === "lo" ? lo : (hi ?? max);
    const delta: Record<string, number> = {
      ArrowRight: step,
      ArrowUp: step,
      ArrowLeft: -step,
      ArrowDown: -step,
      PageUp: step * 4,
      PageDown: -step * 4,
    };
    if (event.key === "Home") apply(which, min);
    else if (event.key === "End") apply(which, max);
    else if (event.key in delta) apply(which, current + delta[event.key]);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const track = arcPath(RING.slider, SLIDER_FROM, SLIDER_TO);
  const routeFrom = range ? loAngle : SLIDER_FROM;
  const routeTo = range ? hiAngle : loAngle;
  // The end labels sit outside the track, well clear of the ring and its segment labels.
  const start = polar(RING.slider + 30, SLIDER_FROM);
  const end = polar(RING.slider + 38, SLIDER_TO);
  const handle = (which: "lo" | "hi", angle: number, value: number, name: string) => {
    const p = polar(RING.slider, angle);
    return (
      <g
        key={which}
        className="gd-arc-handle"
        data-handle={which}
        data-active={range && active === which ? "true" : undefined}
        data-motion="M7"
        role="slider"
        tabIndex={0}
        aria-label={name}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${name} ${format(value)}`}
        aria-orientation="horizontal"
        transform={`translate(${p.x} ${p.y})`}
        onKeyDown={key(which)}
      >
        <circle className="gd-arc-handle-o" data-motion="M8" r="14" />
      </g>
    );
  };

  return (
    <g ref={svgRef} className="gd-arc-slider" fill="none" strokeLinecap="round">
      <path className="gd-arc-track" d={track} />
      <path
        className="gd-arc-route"
        data-motion="M6 M7"
        pathLength={1}
        d={arcPath(RING.slider, routeFrom, Math.max(routeFrom + 0.01, routeTo))}
      />
      {!range && (
        <path className="gd-arc-arrow" d={arrowHead(RING.slider, SLIDER_TO, 14)} strokeLinejoin="round" />
      )}
      <path
        className="gd-arc-hit"
        d={track}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <g className="gd-arc-x" aria-hidden="true">
        <path d={`M${start.x - 8} ${start.y - 8} l16 16 M${start.x + 8} ${start.y - 8} l-16 16`} />
      </g>
      <text className="gd-arc-end" x={start.x - 2} y={start.y + 34} textAnchor="middle" aria-hidden="true">
        {endMarks.start}
      </text>
      <text className="gd-arc-end gd-arc-end-hi" x={end.x} y={end.y + 2} textAnchor="middle" aria-hidden="true">
        {endMarks.end}
      </text>
      {handle("lo", loAngle, lo, range ? `${label} minimum` : label)}
      {range && handle("hi", hiAngle, hi!, `${label} maximum`)}
    </g>
  );
}
