import type { FeedbackKind } from "../../../../ui/feel/settings";

// Motion for the filter wheel, as data: one spec per interaction of the handoff's section 6.2 (A1 to A16). Each spec holds the Full
// variant, the Reduced variant (fades only, 150 ms at most) and the sound or haptic cue. Off plays nothing. The Web Animations API
// is the only engine; only transform, opacity, stroke-dashoffset, clip-path and a small blur are ever animated.

export type MotionLevel = "full" | "reduced" | "off";

export const EASE = {
  out: "cubic-bezier(.2,.8,.2,1)",
  spring: "cubic-bezier(.2,.9,.3,1.15)",
  in: "cubic-bezier(.5,0,.75,0)",
} as const;

// No interaction animation runs longer than this at Full, except the search scene, which lasts as long as the search.
export const FULL_MAX_MS = 420;
export const REDUCED_MAX_MS = 150;

export interface Variant {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions & { duration: number };
}
export interface MotionSpec {
  id: string;
  full: Variant | null;
  reduced: Variant | null;
  cue: FeedbackKind | null;
  // The play-call scene may run for the whole search.
  scene?: boolean;
}

// The Feel setting is kept on the root by useAnimationRoot; outside the app (tests, previews) motion defaults to Full.
export function motionLevel(
  root: { dataset: { animation?: string } } | undefined = typeof document ===
  "undefined"
    ? undefined
    : document.documentElement,
): MotionLevel {
  const value = root?.dataset.animation;
  return value === "reduced" || value === "off" ? value : "full";
}

export const durationOf = (v: Variant) =>
  Number(v.options.duration) +
  Number(v.options.delay ?? 0) +
  Number(v.options.endDelay ?? 0);

export const variantFor = (
  spec: MotionSpec,
  level: MotionLevel,
): Variant | null =>
  level === "off" ? null : level === "reduced" ? spec.reduced : spec.full;

const v = (
  keyframes: Keyframe[],
  duration: number,
  easing: string = EASE.out,
  more: KeyframeAnimationOptions = {},
): Variant => ({
  keyframes,
  options: { easing, fill: "both", ...more, duration },
});
const fade = (duration: number, out = false): Variant =>
  v(
    out ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }],
    duration,
    "linear",
  );

const spec = (
  id: string,
  full: Variant | null,
  reduced: Variant | null,
  cue: FeedbackKind | null = null,
  scene = false,
): MotionSpec => ({
  id,
  full,
  reduced,
  cue,
  ...(scene ? { scene } : {}),
});

export const chalkSpecs = {
  // A1 Open: the backdrop dims, the frame springs in, rings and spokes draw, labels are written, count marks pop, dust puffs.
  backdrop: spec(
    "A1",
    v([{ opacity: 0 }, { opacity: 1 }], 160, "linear"),
    fade(150),
  ),
  open: spec(
    "A1",
    v(
      [
        { transform: "scale(.92)", opacity: 0 },
        { transform: "scale(1)", opacity: 1 },
      ],
      220,
      EASE.spring,
    ),
    fade(150),
    "tap",
  ),
  drawRing: spec(
    "A1",
    v([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], 420),
    fade(150),
  ),
  drawSpoke: spec(
    "A1",
    v([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], 200),
    fade(150),
  ),
  writeLabel: spec(
    "A1",
    v([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], 120),
    fade(100),
  ),
  popMark: spec(
    "A1",
    v([{ transform: "scale(0)" }, { transform: "scale(1)" }], 120, EASE.spring),
    fade(100),
  ),
  dust: spec(
    "A1",
    v(
      [
        { opacity: 0.9, transform: "translate(0,0) scale(1)" },
        { opacity: 0, transform: "translate(var(--dx),var(--dy)) scale(.4)" },
      ],
      300,
    ),
    null,
  ),
  // A2 Hover or focus a segment: hatch sweeps in, the label wiggles, the previous hatch is smudged off.
  hover: spec(
    "A2",
    v([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], 140),
    fade(80),
    "tap",
  ),
  wiggle: spec(
    "A2",
    v(
      [
        { transform: "rotate(0)" },
        { transform: "rotate(-1.5deg)" },
        { transform: "rotate(1.5deg)" },
        { transform: "rotate(0)" },
      ],
      150,
    ),
    null,
  ),
  smudge: spec(
    "A2",
    v(
      [
        { opacity: 1, filter: "blur(0)" },
        { opacity: 0, filter: "blur(1px)" },
      ],
      100,
      "linear",
    ),
    fade(80, true),
  ),
  // A3 Choose a category: the segment pulses, the others dim, the sub-options draw outward and their pills are written in.
  chooseCategory: spec(
    "A3",
    v(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.04)" },
        { transform: "scale(1)" },
      ],
      160,
    ),
    fade(150),
    "select",
  ),
  dimOthers: spec(
    "A3",
    v([{ opacity: 1 }, { opacity: 0.6 }], 160, "linear"),
    fade(150, true),
  ),
  drawArc: spec(
    "A3",
    v([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], 300),
    fade(150),
  ),
  writePill: spec(
    "A3",
    v(
      [
        { opacity: 0, transform: "translateY(6px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      160,
    ),
    fade(100),
  ),
  // A4 Choose a sub-option pill: the new border is redrawn solid, the old one erased back to dashed.
  pillOn: spec(
    "A4",
    v([{ opacity: 0.4 }, { opacity: 1 }], 200),
    fade(100),
    "select",
  ),
  pillOff: spec(
    "A4",
    v([{ opacity: 1 }, { opacity: 0.6 }, { opacity: 1 }], 150, "linear"),
    fade(100),
  ),
  // A5 Drag the arc slider: the handle squashes each step, the number rolls, the end stops thunk.
  squash: spec(
    "A5",
    v(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.25,.8)" },
        { transform: "scale(1)" },
      ],
      80,
    ),
    null,
    "tap",
  ),
  rollOut: spec(
    "A5",
    v(
      [
        { transform: "translateY(0)", opacity: 1 },
        { transform: "translateY(-14px)", opacity: 0 },
      ],
      120,
    ),
    null,
  ),
  rollIn: spec(
    "A5",
    v(
      [
        { transform: "translateY(14px)", opacity: 0 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      120,
    ),
    null,
  ),
  thunk: spec(
    "A5",
    v(
      [{ transform: "scale(1.1)" }, { transform: "scale(1)" }],
      100,
      EASE.spring,
    ),
    null,
    "caution",
  ),
  trail: spec(
    "A5",
    v(
      [
        { opacity: 0.8, transform: "translate(0,0) scale(1)" },
        { opacity: 0, transform: "translate(var(--dx),var(--dy)) scale(.3)" },
      ],
      400,
    ),
    null,
  ),
  // A6 Toggle an option: a tick or X scribbles in, or is smudged out.
  tickIn: spec(
    "A6",
    v([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], 180),
    fade(100),
    "select",
  ),
  tickOut: spec(
    "A6",
    v(
      [
        { opacity: 1, filter: "blur(0)" },
        { opacity: 0, filter: "blur(1px)" },
      ],
      150,
      "linear",
    ),
    fade(100, true),
    "select",
  ),
  // A7 Rotate a long arc (teams): the arc turns to the next page with a slight overshoot.
  rotate: spec(
    "A7",
    v(
      [{ transform: "rotate(var(--from))" }, { transform: "rotate(0)" }],
      220,
      EASE.spring,
    ),
    null,
    "tap",
  ),
  // A8 Back: an eraser sweeps along the sub-arc and the first ring un-dims.
  eraser: spec(
    "A8",
    v([{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 0 0 100%)" }], 220),
    fade(120, true),
    "tap",
  ),
  unDim: spec(
    "A8",
    v([{ opacity: 0.6 }, { opacity: 1 }], 160, "linear"),
    fade(120),
  ),
  // A9 Players search in the hub: the input is drawn, names are written in.
  drawInput: spec(
    "A9",
    v([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], 200),
    fade(120),
  ),
  writeName: spec(
    "A9",
    v(
      [
        { opacity: 0, transform: "translateX(-6px)" },
        { opacity: 1, transform: "translateX(0)" },
      ],
      150,
    ),
    fade(120),
  ),
  // A10 Clear all: a full-board eraser wipe, the defaults redrawn, an Undo toast slides up.
  clearAll: spec(
    "A10",
    v(
      [{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 0 0 100%)" }],
      350,
      "cubic-bezier(.65,0,.35,1)",
    ),
    fade(150),
    "caution",
  ),
  redraw: spec(
    "A10",
    v([{ opacity: 0 }, { opacity: 1 }], 200, "linear"),
    fade(150),
  ),
  toast: spec(
    "A10",
    v(
      [
        { transform: "translateY(24px)", opacity: 0 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      200,
    ),
    fade(150),
  ),
  // A11 Done: the wheel collapses into the Filters button, the results re-arrange (FLIP), the count tweens.
  done: spec(
    "A11",
    v(
      [
        { transform: "translate(0,0) scale(1)", opacity: 1 },
        { transform: "translate(var(--dx),var(--dy)) scale(.2)", opacity: 0 },
      ],
      260,
      EASE.in,
    ),
    fade(150, true),
    "success",
  ),
  flipMove: spec(
    "A11",
    v(
      [
        { transform: "translate(var(--dx),var(--dy))" },
        { transform: "translate(0,0)" },
      ],
      250,
    ),
    fade(150),
  ),
  rowOut: spec(
    "A11",
    v(
      [
        { opacity: 1, maxHeight: "var(--h)" },
        { opacity: 0, maxHeight: "0px" },
      ],
      180,
      "linear",
    ),
    fade(150, true),
  ),
  rowIn: spec(
    "A11",
    v(
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      200,
    ),
    fade(150),
  ),
  // A12 The play call: an eraser band, a diagram drawn in chalk, a route to each team as it is searched, a morph into the coverage line.
  sweep: spec(
    "A12",
    v(
      [{ transform: "translateX(-100%)" }, { transform: "translateX(100%)" }],
      400,
      "linear",
    ),
    fade(150),
    null,
    true,
  ),
  writeMark: spec(
    "A12",
    v(
      [
        { opacity: 0, transform: "scale(.6)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      180,
    ),
    fade(100),
    null,
    true,
  ),
  drawRoute: spec(
    "A12",
    v([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], 420),
    fade(150),
    "tap",
    true,
  ),
  circleMark: spec(
    "A12",
    v([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], 300),
    fade(100),
    null,
    true,
  ),
  morph: spec(
    "A12",
    v(
      [
        { transform: "scale(1)", opacity: 1 },
        { transform: "scale(.2) translateY(-40px)", opacity: 0 },
      ],
      300,
    ),
    fade(150, true),
    "success",
    true,
  ),
  // A13 Streaming rows slide up and fade in; at most 20 rows a batch.
  streamRow: spec(
    "A13",
    v(
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      180,
    ),
    fade(150),
  ),
  // A14 The filter badge and the hides N numbers: a bump, and numbers that tween.
  bump: spec(
    "A14",
    v([{ transform: "scale(1.15)" }, { transform: "scale(1)" }], 140),
    null,
  ),
  // A15 The phone fan rises from the bottom, rings swap sideways, and it drops on close.
  fanUp: spec(
    "A15",
    v(
      [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }],
      280,
      EASE.spring,
    ),
    fade(150),
  ),
  fanDown: spec(
    "A15",
    v(
      [{ transform: "translateY(0)" }, { transform: "translateY(100%)" }],
      220,
      EASE.in,
    ),
    fade(150, true),
  ),
  ringOut: spec(
    "A15",
    v(
      [
        { transform: "translateX(0)", opacity: 1 },
        { transform: "translateX(-40px)", opacity: 0 },
      ],
      200,
    ),
    fade(150, true),
    "tap",
  ),
  ringIn: spec(
    "A15",
    v(
      [
        { transform: "translateX(40px)", opacity: 0 },
        { transform: "translateX(0)", opacity: 1 },
      ],
      200,
    ),
    fade(150),
  ),
  // A16 Errors and conflicts: the element shakes and a chalk underline is drawn under the message.
  shake: spec(
    "A16",
    v(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-4px)" },
        { transform: "translateX(4px)" },
        { transform: "translateX(-4px)" },
        { transform: "translateX(4px)" },
        { transform: "translateX(-4px)" },
        { transform: "translateX(0)" },
      ],
      240,
      "linear",
    ),
    null,
    "caution",
  ),
  underline: spec(
    "A16",
    v([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], 240),
    fade(100),
  ),
} satisfies Record<string, MotionSpec>;

export type ChalkEffect = keyof typeof chalkSpecs;

// Plays specs at the current motion level. A new play with the same key finishes the one still running, so a quick second
// interaction never waits for the first and nothing blocks input.
export class MotionRunner {
  private running = new Map<string, Animation>();
  constructor(private level: () => MotionLevel = () => motionLevel()) {}

  play(
    key: string,
    el: Element,
    motion: MotionSpec,
    extra: { delay?: number; vars?: Record<string, string> } = {},
  ): Animation | null {
    const variant = variantFor(motion, this.level());
    if (!variant || typeof (el as Element).animate !== "function") return null;
    this.running.get(key)?.finish();
    const target = el as HTMLElement;
    for (const [name, value] of Object.entries(extra.vars ?? {}))
      target.style?.setProperty(name, value);
    const animation = el.animate(variant.keyframes, {
      ...variant.options,
      delay: (variant.options.delay as number | undefined) ?? extra.delay ?? 0,
    });
    this.running.set(key, animation);
    // When it ends the stylesheet takes over again: an effect never leaves an inline override behind.
    if ("onfinish" in animation)
      animation.onfinish = () => {
        if (this.running.get(key) === animation) this.running.delete(key);
        try {
          animation.cancel();
        } catch {
          // Already cancelled.
        }
      };
    return animation;
  }

  finishAll() {
    for (const animation of this.running.values()) animation.finish();
    this.running.clear();
  }
}

// A number that counts to its new value (hides N, the result count); at Reduced and Off it simply swaps.
export function tween(
  from: number,
  to: number,
  level: MotionLevel,
  onUpdate: (value: number) => void,
  ms = 250,
): () => void {
  if (
    level !== "full" ||
    from === to ||
    typeof requestAnimationFrame !== "function"
  ) {
    onUpdate(to);
    return () => {};
  }
  let frame = 0;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - (1 - t) ** 3;
    onUpdate(Math.round(from + (to - from) * eased));
    if (t < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}
