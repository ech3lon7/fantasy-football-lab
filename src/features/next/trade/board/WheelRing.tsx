import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { ChalkDefs, ChalkIcon } from "../wheel/ChalkMarks";
import { RING, VIEW, labelPoint, segmentBounds, spoke, wedgePath } from "../wheel/wheel-geometry";
import type { CategoryId, WheelCategory } from "../wheel/wheel-model";
import type { WheelData } from "../wheel/wheel-data";

// The wheel itself: the seven category segments with their hatch, label, doodle and "N set" mark, the rings and spokes drawn
// through a mask, and the room for the arc slider. Everything is rendered once; the states are classes and attributes. The hub
// (display-only) sits over the centre as a sibling.
export function WheelRing({
  data,
  category,
  focus,
  onFocus,
  onPoint,
  onChoose,
  onKeyDown,
  slider,
  hub,
}: {
  data: WheelData;
  category: CategoryId | null;
  focus: number;
  onFocus: (index: number) => void;
  // The pointer or focus is on (index) or has left (null) a segment.
  onPoint: (index: number | null) => void;
  onChoose: (id: CategoryId) => void;
  onKeyDown: (index: number) => (event: KeyboardEvent<SVGGElement>) => void;
  slider: ReactNode;
  hub: ReactNode;
}) {
  const { categories } = data;
  const count = categories.length;
  const hatchId = useId().replace(/:/g, "");
  const box = useRef<HTMLDivElement>(null);
  // The size of one design pixel of the 640 x 640 wheel, as a custom property: the hub's text is sized in design pixels so that it
  // scales with the wheel (written on resize only, never per frame).
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = () => el.style.setProperty("--zb-s", String(el.clientWidth / VIEW));
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="gd-zb-wheelbox" ref={box}>
      <svg className="gd-zb-svg" viewBox={`0 0 ${VIEW} ${VIEW}`} role="presentation">
        <ChalkDefs id={hatchId} />
        <defs>
          {/* The rings and spokes are revealed through a mask whose strokes are drawn in, so their broken chalk dashes stay intact. */}
          <mask id={`${hatchId}m`} maskUnits="userSpaceOnUse" x="0" y="0" width="640" height="640">
            <g fill="none" stroke="white" strokeWidth="16" strokeLinecap="round" strokeDasharray="1">
              <circle className="gd-mask-draw" data-mask="ring" data-motion="M1" cx="320" cy="320" r={RING.outer} pathLength={1} />
              <circle className="gd-mask-draw" data-mask="ring" data-motion="M1" cx="321" cy="319" r={RING.outer - 2} pathLength={1} />
              <circle className="gd-mask-draw" data-mask="ring" data-motion="M1" cx="320" cy="320" r={RING.inner} pathLength={1} />
              {categories.map((_, i) => {
                const sp = spoke(i, count);
                return (
                  <line key={i} className="gd-mask-draw" data-mask="spoke" data-motion="M1" x1={sp.x1} y1={sp.y1} x2={sp.x2} y2={sp.y2} pathLength={1} />
                );
              })}
            </g>
          </mask>
        </defs>
        <g className="gd-wheel-rings" mask={`url(#${hatchId}m)`} fill="none" strokeLinecap="round" aria-hidden="true">
          <circle className="gd-ring gd-ring-outer" cx="320" cy="320" r={RING.outer} />
          <circle className="gd-ring-ghost" data-motion="M1" cx="321" cy="319" r={RING.outer - 2} />
          <circle className="gd-ring gd-ring-inner" cx="320" cy="320" r={RING.inner} />
          {categories.map((_, i) => {
            const s = spoke(i, count);
            return <line key={i} className="gd-spoke" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />;
          })}
        </g>

        <g role="menu" aria-label="Filter categories" className="gd-wheel-ring1">
          {categories.map((c: WheelCategory, i) => {
            const { from, to } = segmentBounds(i, count);
            const at = labelPoint(i, count);
            const selected = c.id === category;
            const active = data.active(c.id);
            return (
              <g
                key={c.id}
                className="gd-wheel-seg"
                data-index={i}
                data-motion="M3"
                data-selected={selected || undefined}
                data-dim={category && !selected ? true : undefined}
                role="menuitem"
                aria-haspopup="true"
                aria-label={`${c.label}${active ? `, ${active} set` : ""}`}
                tabIndex={i === focus ? 0 : -1}
                onFocus={() => {
                  onFocus(i);
                  onPoint(i);
                }}
                onBlur={() => onPoint(null)}
                onMouseEnter={() => {
                  onFocus(i);
                  onPoint(i);
                }}
                onMouseLeave={() => onPoint(null)}
                onClick={() => onChoose(c.id)}
                onKeyDown={onKeyDown(i)}
              >
                <path className="gd-seg-hatch" data-motion="M2" d={wedgePath(RING.wedgeInner, RING.wedgeOuter, from, to)} fill={`url(#${hatchId})`} />
                <path className="gd-seg-hit" d={wedgePath(RING.inner, RING.outer, from, to)} />
                <g data-motion="M1"><ChalkIcon kind={c.icon} x={at.x} y={at.y - 33} /></g>
                <text className="gd-seg-label" data-motion="M1 M2" x={at.x} y={at.y + 7} textAnchor="middle">
                  {c.label}
                </text>
                {active > 0 && (
                  <text className="gd-seg-set" data-motion="M1" x={at.x} y={at.y + 31} textAnchor="middle">
                    {active} set
                  </text>
                )}
              </g>
            );
          })}
        </g>
        {slider}
      </svg>
      {hub}
    </div>
  );
}
