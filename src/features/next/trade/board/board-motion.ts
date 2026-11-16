import { useMemo } from "react";
import { useFeedback } from "../../../../ui/feel/feedback";
import type { FeedbackKind } from "../../../../ui/feel/settings";
import {
  EASE,
  MotionRunner,
  chalkSpecs,
  fade,
  motionLevel,
  spec,
  tween,
  v,
  type MotionSpec,
} from "../wheel/chalk-motion";

// The motion of the polished chalk board, M1 to M26 of docs/filter-wheel-polish-proposal.md section 2.7, with the keyframes, easings
// and durations of docs/filter-wheel-motion-reference.md. Only transform, opacity, stroke-dashoffset, clip-path and a small blur are
// animated, always through the Web Animations API. Reduced is a fade of 150 ms or less; Off plays nothing.

const draw = (ms: number, easing: string = EASE.out) =>
  v([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], ms, easing);
const writeFrames: Keyframe[] = [
  { opacity: 0, transform: "translateX(-10px)" },
  { opacity: 1, transform: "none" },
];
const streamFrames = (px = 8): Keyframe[] => [
  { opacity: 0, transform: `translateY(${px}px)` },
  { opacity: 1, transform: "none" },
];
const wipeFrames: Keyframe[] = [{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 0 0 100%)" }];

export const motion = {
  // M1 The tab is first shown (mp-rise, mp-draw, mp-drawl, mp-write, mp-pop, mp-puff).
  rise: spec("M1", v([{ opacity: 0, transform: "scale(.92)" }, { opacity: 1, transform: "none" }], 260, EASE.spring), fade(150), "tap"),
  ring: spec("M1", draw(420), fade(150)),
  ghost: spec("M1", v([{ opacity: 0 }, { opacity: 1 }], 200, "linear"), fade(100)),
  spoke: spec("M1", draw(160), fade(100)),
  write: spec("M1", v(writeFrames, 140), fade(100)),
  pop: spec(
    "M1",
    v(
      [
        { opacity: 0, transform: "scale(0)", offset: 0 },
        { opacity: 1, transform: "scale(1.25)", offset: 0.7 },
        { opacity: 1, transform: "scale(1)", offset: 1 },
      ],
      160,
      "linear",
    ),
    fade(100),
  ),
  puff: spec(
    "M1",
    v(
      [
        { opacity: 0, transform: "translate(0,0) scale(.4)", offset: 0 },
        { opacity: 0.9, transform: "translate(calc(var(--dx) * .3),calc(var(--dy) * .3)) scale(.8)", offset: 0.3 },
        { opacity: 0, transform: "translate(var(--dx),var(--dy)) scale(1.3)", offset: 1 },
      ],
      320,
      "linear",
    ),
    null,
  ),
  fadeIn200: spec("M1", v([{ opacity: 0 }, { opacity: 1 }], 200, "linear"), fade(150)),
  // M2 Hover or focus a segment: the hatch sweeps in from the inner edge, the label wiggles, the old hatch smudges off.
  hatch: spec("M2", v([{ opacity: 0, transform: "scale(.8)" }, { opacity: 1, transform: "none" }], 140), fade(80), "tap"),
  wiggle: { ...chalkSpecs.wiggle, id: "M2" } as MotionSpec,
  smudge: { ...chalkSpecs.smudge, id: "M2" } as MotionSpec,
  // M3 Choose a segment.
  pulse: spec("M3", v([{ transform: "scale(1)" }, { transform: "scale(1.04)" }, { transform: "scale(1)" }], 160), fade(150), "select"),
  dim: spec("M3", v([{ opacity: 1 }, { opacity: 0.55 }], 160, "linear"), v([{ opacity: 1 }, { opacity: 0.55 }], 150, "linear")),
  arrow: spec("M3", draw(260), fade(150)),
  option: spec("M3", v(writeFrames, 140), fade(100)),
  // M4 Another segment while one is open: the old options and arrow are erased first.
  eraseOld: spec("M4", v(wipeFrames, 180), fade(120, true)),
  // M5 Toggle an option.
  tickIn: spec("M5", draw(180), fade(100), "select"),
  tickOut: spec("M5", v([{ opacity: 1, filter: "blur(0)" }, { opacity: 0, filter: "blur(1px)" }], 150, "linear"), fade(100, true), "select"),
  tweenBump: spec("M5", v([{ transform: "scale(1.15)" }, { transform: "scale(1)" }], 140), null),
  // M6 A Gains choice: the new pill is drawn solid, the old one erased back to dashed, the route redrawn.
  pillOn: spec("M6", draw(200), fade(100), "select"),
  pillOff: spec("M6", v([{ opacity: 1 }, { opacity: 0 }], 150, "linear"), fade(100, true)),
  route: spec("M6", draw(300), fade(150)),
  // M7 Drag a slider handle or step it.
  squash: spec("M7", v([{ transform: "scale(1)" }, { transform: "scale(1.25,.8)" }, { transform: "scale(1)" }], 80), null, "tap"),
  roll: spec("M7", v([{ transform: "translateY(14px)", opacity: 0 }, { transform: "none", opacity: 1 }], 120), null),
  thunk: spec("M7", v([{ transform: "scale(1.1)" }, { transform: "scale(1)" }], 100, EASE.spring), null, "caution"),
  trail: spec(
    "M7",
    v(
      [
        { opacity: 0.8, transform: "translate(0,0) scale(1)" },
        { opacity: 0, transform: "translate(var(--dx),var(--dy)) scale(.3)" },
      ],
      400,
    ),
    null,
  ),
  // M8 MIN / MAX switch.
  ringPulse: spec("M8", v([{ transform: "scale(1)" }, { transform: "scale(1.15)" }, { transform: "scale(1)" }], 160), fade(100), "tap"),
  // M9 Open a panel.
  border: spec("M9", draw(320), fade(150), "select"),
  heading: spec("M9", v(writeFrames, 140), fade(100)),
  row: spec("M9", v(streamFrames(8), 180), fade(100)),
  // M10 Type in a panel search (FLIP).
  rowsOut: spec("M10", v([{ opacity: 1 }, { opacity: 0 }], 100, "linear"), fade(100, true)),
  rowsMove: spec("M10", v([{ transform: "translate(var(--dx),var(--dy))" }, { transform: "none" }], 180), null),
  rowsIn: spec("M10", v([{ opacity: 0 }, { opacity: 1 }], 120, "linear"), fade(100)),
  // M11 Hover or focus a player row.
  underline: spec("M11", v([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], 120), fade(100)),
  lift: spec("M11", v([{ transform: "none" }, { transform: "translateY(-2px)" }], 120), null),
  // M12 Select or unselect a player.
  hatchSweep: spec("M12", v([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], 180), fade(100), "select"),
  // M13 Grade goals.
  goalIn: spec("M13", v(writeFrames, 160), fade(100), "select"),
  goalRoll: spec("M13", v([{ transform: "translateY(14px)", opacity: 0 }, { transform: "none", opacity: 1 }], 120), fade(100), "tap"),
  goalOut: spec("M13", v(wipeFrames, 180), fade(120, true), "tap"),
  // M14 Back, Esc, Backspace or a click outside.
  wipe: spec("M14", v(wipeFrames, 220), fade(120, true), "tap"),
  unDim: spec("M14", v([{ opacity: 0.55 }, { opacity: 1 }], 160, "linear"), v([{ opacity: 0.55 }, { opacity: 1 }], 150, "linear")),
  // M15 Team chooser.
  teamWrite: spec("M15", v(writeFrames, 140), fade(100), "select"),
  teamCircle: spec("M15", draw(200), fade(100)),
  teamErase: spec("M15", v([{ opacity: 1 }, { opacity: 0 }], 160, "linear"), fade(150, true)),
  // M16 Search press.
  searchCircle: spec("M16", draw(200), fade(100), "select"),
  searchSquash: spec("M16", v([{ transform: "scale(1)" }, { transform: "scale(.94)" }, { transform: "scale(1)" }], 100), null),
  labelMorph: spec("M16", v([{ opacity: 0 }, { opacity: 1 }], 150, "linear"), fade(100)),
  // M17 and M18 The play call and its end.
  counterRoll: spec("M17", v([{ transform: "translateY(10px)", opacity: 0 }, { transform: "none", opacity: 1 }], 120), fade(100), "tap"),
  countTap: spec("M18", v([{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }], 140), null, "success"),
  // M19 Cancel.
  routesErase: spec("M19", v(wipeFrames, 260), fade(150, true), "caution"),
  // M20 Show all / Reset to defaults.
  sweepBand: spec("M20", v([{ transform: "translateX(-520px)", opacity: 1 }, { transform: "translateX(620px)", opacity: 1 }], 350, "cubic-bezier(.65,0,.35,1)"), fade(150), "caution"),
  writeValues: spec("M20", v([{ opacity: 0 }, { opacity: 1 }], 200, "linear"), fade(150), "tap"),
  // M21 Counts roll.
  countRoll: spec("M21", v([{ transform: "translateY(10px)", opacity: 0 }, { transform: "none", opacity: 1 }], 120), fade(100)),
  // M23 Shortcut.
  boardTap: spec("M23", v([{ transform: "scale(1)" }, { transform: "scale(1.01)" }, { transform: "scale(1)" }], 160), fade(100), "tap"),
  // M25 Phones: the panel rises and drops.
  panelUp: spec("M25", v([{ transform: "translateY(100%)" }, { transform: "none" }], 280, EASE.spring), fade(150), "select"),
  panelDown: spec("M25", v([{ transform: "none" }, { transform: "translateY(100%)" }], 220, EASE.in), fade(150, true), "tap"),
  // M26 Errors.
  shake: { ...chalkSpecs.shake, id: "M26" } as MotionSpec,
  errorLine: spec("M26", draw(240), fade(100), "caution"),
} satisfies Record<string, MotionSpec>;

export type Notify = (kind: FeedbackKind) => void;

// One per board: runs specs through a shared runner (a new interaction finishes the running one with the same key, so nothing waits)
// and sounds the cue.
export class BoardMotion {
  readonly runner = new MotionRunner();
  constructor(private readonly notify: Notify) {}

  level = motionLevel;

  play(
    key: string,
    el: Element | null | undefined,
    m: MotionSpec,
    extra: { delay?: number; vars?: Record<string, string>; silent?: boolean } = {},
  ) {
    if (!el) return null;
    // The cue is the sound of the interaction, once per play; a staggered list or a pointer hover can ask for silence.
    if (m.cue && !extra.silent) this.notify(m.cue);
    return this.runner.play(key, el, m, { delay: extra.delay, vars: extra.vars });
  }

  // Plays a spec on every element of a list, each one `step` ms after the one before (written in one by one); at Reduced the
  // stagger is dropped so the whole thing is one fade of 150 ms or less.
  stagger(key: string, els: Iterable<Element>, m: MotionSpec, step: number, first = 12, base = 0) {
    const full = this.level() === "full";
    let i = 0;
    for (const el of els) {
      if (i >= first) break;
      this.play(`${key}-${i}`, el, m, { delay: full ? base + i * step : 0, silent: i > 0 });
      i++;
    }
  }

  cue(kind: FeedbackKind) {
    this.notify(kind);
  }

  // A number that counts to its new value in 250 ms, written straight into the element (never into React state).
  tweenText(el: HTMLElement | null, from: number, to: number, format: (n: number) => string, key = "tween") {
    if (!el) return () => {};
    const stop = tween(
      from,
      to,
      this.level(),
      (value) => {
        el.textContent = format(value);
      },
      250,
    );
    if (from !== to) this.play(key, el, motion.tweenBump);
    return stop;
  }

  // A few chalk particles that fly away from a point and are removed again: the open puffs and the slider trail.
  dust(host: HTMLElement | null, at: { x: number; y: number }, m: MotionSpec, count: number, reach = 18) {
    if (!host || this.level() !== "full") return;
    // At most eight crumbs are alive at once.
    const room = Math.max(0, 8 - host.querySelectorAll(".chalk-particle").length);
    for (let i = 0; i < Math.min(count, room); i++) {
      const dot = document.createElement("span");
      dot.className = "chalk-particle";
      dot.setAttribute("aria-hidden", "true");
      dot.style.left = `${at.x}px`;
      dot.style.top = `${at.y}px`;
      host.appendChild(dot);
      const angle = Math.random() * Math.PI * 2;
      const far = reach * (0.4 + Math.random() * 0.6);
      const animation = this.runner.play(`dust-${performance.now()}-${i}`, dot, m, {
        vars: { "--dx": `${Math.cos(angle) * far}px`, "--dy": `${Math.sin(angle) * far}px` },
      });
      if (animation) animation.finished.then(() => dot.remove(), () => dot.remove());
      else dot.remove();
    }
  }

  // Finish whatever is still running (a new interaction, or the board going away).
  finishAll() {
    this.runner.finishAll();
  }
}

export function useBoardMotion() {
  const notify = useFeedback();
  return useMemo(() => new BoardMotion(notify), [notify]);
}
