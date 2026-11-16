import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { motion, useBoardMotion } from "./board-motion";

// A panel of the right zone: board-coloured, a dashed chalk border that draws itself clockwise (M9), a yellow Permanent Marker
// heading and chalk body text. Rows of its body may carry data-slide to slide in 8px with a fade, 25 ms apart (first twelve).
export function ChalkPanel({
  label,
  heading,
  children,
  count,
}: {
  label: string;
  heading: ReactNode;
  children: ReactNode;
  // A running total shown after the heading ("3 selected"); it rolls when it changes.
  count?: ReactNode;
}) {
  const id = useId().replace(/:/g, "");
  const root = useRef<HTMLElement>(null);
  const bm = useBoardMotion();
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    bm.play("panel-border", el.querySelector(".gd-chalk-mask-rect"), motion.border);
    bm.play("panel-heading", el.querySelector(".gd-chalk-heading"), motion.heading, { silent: true });
    bm.stagger("panel-row", el.querySelectorAll("[data-slide]"), motion.row, 25, 12);
    return () => bm.finishAll();
  }, []);
  return (
    <section ref={root} className="gd-chalk-panel" role="group" aria-label={label}>
      <svg className="gd-chalk-border" aria-hidden="true" data-motion="M9">
        <defs>
          <mask id={`${id}m`} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
            <rect className="gd-chalk-mask-rect" x="3" y="3" width="calc(100% - 6px)" height="calc(100% - 6px)" rx="14"
              pathLength={1} fill="none" stroke="white" strokeWidth="10" strokeDasharray="1" />
          </mask>
        </defs>
        <g className="gd-chalk-mask" mask={`url(#${id}m)`}>
          <rect className="gd-chalk-border-rect" x="3" y="3" width="calc(100% - 6px)" height="calc(100% - 6px)" rx="14" fill="none" />
        </g>
      </svg>
      <h3 className="gd-chalk-heading" data-motion="M9">
        {heading}
        {count !== undefined && <span className="gd-chalk-count">{count}</span>}
      </h3>
      {children}
    </section>
  );
}
