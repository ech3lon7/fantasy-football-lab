import { useLayoutEffect, useRef, type RefObject } from "react";
import { motion, useBoardMotion } from "./board-motion";

const MAX_ANIMATED = 12;

// A list that rearranges like chalk when its keys change (M10, typing in a panel search): the rows that stay slide to their new
// place (FLIP, 180 ms), new rows fade in (120 ms) and the rows that drop out fade away (100 ms) from a copy that is laid where they
// were. Every row is a direct child of the container with a data-key. The first render only records positions.
export function useChalkFlip(container: RefObject<HTMLElement | null>, keys: string[]) {
  const bm = useBoardMotion();
  const before = useRef<{ top: Map<string, number>; ghosts: Map<string, { node: HTMLElement; top: number; height: number }> }>({
    top: new Map(),
    ghosts: new Map(),
  });
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const rows = [...el.querySelectorAll<HTMLElement>(":scope > [data-key]")];
    const box = el.getBoundingClientRect();
    const now = new Map(rows.map((r) => [r.dataset.key!, r.getBoundingClientRect().top]));
    const last = before.current;
    if (last.top.size && bm.level() !== "off") {
      let entered = 0;
      let moved = 0;
      for (const row of rows) {
        const key = row.dataset.key!;
        const was = last.top.get(key);
        if (was === undefined) {
          if (entered++ < MAX_ANIMATED) bm.play(`flip-in-${key}`, row, motion.rowsIn, { silent: true });
        } else {
          const dy = was - now.get(key)!;
          if (Math.abs(dy) > 1 && moved++ < MAX_ANIMATED)
            bm.play(`flip-move-${key}`, row, motion.rowsMove, { vars: { "--dx": "0px", "--dy": `${dy}px` }, silent: true });
        }
      }
      let left = 0;
      for (const [key, ghost] of last.ghosts) {
        if (now.has(key) || left++ >= MAX_ANIMATED) continue;
        const copy = ghost.node.cloneNode(true) as HTMLElement;
        copy.setAttribute("aria-hidden", "true");
        copy.setAttribute("inert", "");
        copy.removeAttribute("data-key");
        // The copy is decoration: it must never count as a row.
        copy.classList.replace("gd-prow", "gd-prow-ghost");
        Object.assign(copy.style, {
          position: "absolute",
          left: "0",
          right: "0",
          top: `${ghost.top - box.top + el.scrollTop}px`,
          pointerEvents: "none",
        });
        el.appendChild(copy);
        const animation = bm.play(`flip-out-${key}`, copy, motion.rowsOut, { silent: true });
        if (animation) animation.finished.then(() => copy.remove(), () => copy.remove());
        else copy.remove();
      }
    }
    const ghosts = new Map<string, { node: HTMLElement; top: number; height: number }>();
    rows.slice(0, 40).forEach((r) => {
      const rect = r.getBoundingClientRect();
      ghosts.set(r.dataset.key!, { node: r.cloneNode(true) as HTMLElement, top: rect.top, height: rect.height });
    });
    before.current = { top: now, ghosts };
  }, [keys.join("|")]);
}
