import { useLayoutEffect, useRef, type RefObject } from "react";
import { MotionRunner, chalkSpecs, motionLevel } from "./chalk-motion";

// How many rows are animated in one go; the rest simply appear. Keeps a long list smooth.
export const MAX_ANIMATED_ROWS = 20;

// Results that move like the chalk board: when a filter or the sort changes (A11) the kept rows slide to their new places, removed
// rows collapse where they were and new rows draw in; while a search streams (A13) new rows slide up and fade in. Every row is a
// direct child of the container with a data-key. Nothing here changes what is listed, only how it arrives.
export function useFlipList(
  container: RefObject<HTMLElement | null>,
  keys: string[],
  streaming: boolean,
) {
  const runner = useRef(new MotionRunner());
  const before = useRef<{
    top: Map<string, number>;
    clones: Map<string, { node: HTMLElement; top: number; height: number }>;
  }>({ top: new Map(), clones: new Map() });

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const level = motionLevel();
    const rows = [...el.querySelectorAll<HTMLElement>(":scope > [data-key]")];
    const box = el.getBoundingClientRect();
    const now = new Map(
      rows.map((r) => [r.dataset.key!, r.getBoundingClientRect().top]),
    );
    const last = before.current;

    if (level !== "off" && last.top.size) {
      let entered = 0;
      let moved = 0;
      for (const row of rows) {
        const key = row.dataset.key!;
        const was = last.top.get(key);
        if (was === undefined) {
          // A new row draws in; only the first twenty of a batch are animated.
          if (entered++ < MAX_ANIMATED_ROWS)
            runner.current.play(
              `in-${key}`,
              row,
              streaming ? chalkSpecs.streamRow : chalkSpecs.rowIn,
              {
                // The stagger is only for Full; Reduced is one fade of 150 ms or less.
                delay:
                  level === "full"
                    ? Math.min(entered, MAX_ANIMATED_ROWS) * (streaming ? 15 : 20)
                    : 0,
              },
            );
        } else if (!streaming) {
          // A kept row slides from where it was (FLIP).
          const dy = was - now.get(key)!;
          // Like new rows, only the first twenty slide; the rest simply land.
          if (Math.abs(dy) > 1 && moved++ < MAX_ANIMATED_ROWS)
            runner.current.play(`move-${key}`, row, chalkSpecs.flipMove, {
              vars: { "--dx": "0px", "--dy": `${dy}px` },
            });
        }
      }
      if (!streaming) {
        // A removed row collapses in place: a copy of it is laid where it was and folded away.
        let left = 0;
        for (const [key, ghost] of last.clones) {
          if (now.has(key) || left++ >= MAX_ANIMATED_ROWS) continue;
          const copy = ghost.node.cloneNode(true) as HTMLElement;
          copy.setAttribute("aria-hidden", "true");
          copy.setAttribute("inert", "");
          copy.removeAttribute("data-key");
          // The copy is decoration: it must never count as a row.
          copy
            .querySelectorAll(".gd-res-row")
            .forEach((n) => n.classList.remove("gd-res-row"));
          Object.assign(copy.style, {
            position: "absolute",
            left: "0",
            right: "0",
            top: `${ghost.top - box.top}px`,
            overflow: "hidden",
            pointerEvents: "none",
          });
          el.appendChild(copy);
          const animation = runner.current.play(
            `out-${key}`,
            copy,
            chalkSpecs.rowOut,
            { vars: { "--h": `${ghost.height}px` } },
          );
          if (animation)
            animation.finished.then(
              () => copy.remove(),
              () => copy.remove(),
            );
          else copy.remove();
        }
      }
    }

    // Remember this layout, and a copy of the first rows, for the next change.
    const clones = new Map<
      string,
      { node: HTMLElement; top: number; height: number }
    >();
    // Copies of rows are only needed to collapse a removed row later, which happens when the filters change, never while a search
    // streams: so none are taken while it runs, and only the rows that can be animated are copied.
    rows.slice(0, streaming ? 0 : MAX_ANIMATED_ROWS).forEach((r) => {
      const rect = r.getBoundingClientRect();
      clones.set(r.dataset.key!, {
        node: r.cloneNode(true) as HTMLElement,
        top: rect.top,
        height: rect.height,
      });
    });
    before.current = { top: now, clones };
    return undefined;
    // The list of keys, not each render, is what changed.
  }, [keys.join("|")]);
}
