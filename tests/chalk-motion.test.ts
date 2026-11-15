import { describe, expect, it } from "vitest";
import {
  EASE,
  FULL_MAX_MS,
  REDUCED_MAX_MS,
  MotionRunner,
  chalkSpecs,
  durationOf,
  motionLevel,
  variantFor,
} from "../src/features/next/trade/wheel/chalk-motion";

describe("motion level", () => {
  it("reads the Feel setting from the root and defaults to full", () => {
    expect(motionLevel({ dataset: { animation: "reduced" } })).toBe("reduced");
    expect(motionLevel({ dataset: { animation: "off" } })).toBe("off");
    expect(motionLevel({ dataset: { animation: "full" } })).toBe("full");
    expect(motionLevel({ dataset: {} })).toBe("full");
    expect(motionLevel({ dataset: { animation: "nonsense" } })).toBe("full");
  });
});

describe("the approved easings", () => {
  it("names out, spring and in", () => {
    expect(EASE.out).toBe("cubic-bezier(.2,.8,.2,1)");
    expect(EASE.spring).toBe("cubic-bezier(.2,.9,.3,1.15)");
    expect(EASE.in).toBe("cubic-bezier(.5,0,.75,0)");
  });
});

describe("every interaction's motion (spec section 6.2)", () => {
  const entries = Object.entries(chalkSpecs);

  it("covers A1 to A16", () => {
    const ids = new Set(entries.map(([, spec]) => spec.id));
    for (let i = 1; i <= 16; i++) expect(ids.has(`A${i}`), `A${i}`).toBe(true);
  });

  it("keeps every Full animation to 420 ms or less, except the search scene", () => {
    for (const [name, spec] of entries) {
      if (spec.scene || !spec.full) continue;
      expect(durationOf(spec.full), name).toBeLessThanOrEqual(FULL_MAX_MS);
    }
  });

  it("keeps every Reduced animation to 150 ms or less and to fades only: no drawing, wiping, rotation or particles", () => {
    for (const [name, spec] of entries) {
      if (!spec.reduced) continue;
      expect(durationOf(spec.reduced), name).toBeLessThanOrEqual(
        REDUCED_MAX_MS,
      );
      for (const frame of spec.reduced.keyframes)
        for (const property of Object.keys(frame))
          expect(
            ["opacity", "offset", "easing"],
            `${name}: ${property}`,
          ).toContain(property);
    }
  });

  it("selects the variant for the level, and none at all when Off", () => {
    const spec = chalkSpecs.open;
    expect(variantFor(spec, "full")).toBe(spec.full);
    expect(variantFor(spec, "reduced")).toBe(spec.reduced);
    expect(variantFor(spec, "off")).toBeNull();
  });

  it("maps interactions to the existing cues: tap, select, success and caution only", () => {
    const allowed = new Set(["tap", "select", "success", "caution", null]);
    for (const [name, spec] of entries)
      expect(allowed.has(spec.cue ?? null), name).toBe(true);
    expect(chalkSpecs.open.cue).toBe("tap");
    expect(chalkSpecs.chooseCategory.cue).toBe("select");
    expect(chalkSpecs.clearAll.cue).toBe("caution");
    expect(chalkSpecs.done.cue).toBe("success");
    expect(chalkSpecs.shake.cue).toBe("caution");
  });
});

// A stand-in for an element whose animate() records what it was asked to do.
function fake() {
  const animations: {
    finished: boolean;
    keyframes: unknown;
    options: unknown;
    finish: () => void;
  }[] = [];
  const el = {
    animate(keyframes: unknown, options: unknown) {
      const a = {
        finished: false,
        keyframes,
        options,
        finish() {
          a.finished = true;
        },
      };
      animations.push(a);
      return a;
    },
  };
  return { el: el as unknown as Element, animations };
}

describe("the runner", () => {
  it("plays nothing when motion is Off", () => {
    const { el, animations } = fake();
    expect(
      new MotionRunner(() => "off").play("k", el, chalkSpecs.open),
    ).toBeNull();
    expect(animations).toHaveLength(0);
  });

  it("plays the Reduced variant when asked for Reduced", () => {
    const { el, animations } = fake();
    new MotionRunner(() => "reduced").play("k", el, chalkSpecs.open);
    expect(animations[0].options).toMatchObject({
      duration: chalkSpecs.open.reduced!.options.duration,
    });
  });

  it("finishes the running animation of the same key before starting another, so nothing blocks input", () => {
    const { el, animations } = fake();
    const runner = new MotionRunner(() => "full");
    runner.play("hatch", el, chalkSpecs.hover);
    runner.play("hatch", el, chalkSpecs.hover);
    expect(animations[0].finished).toBe(true);
    expect(animations[1].finished).toBe(false);
  });

  it("finishes everything on demand", () => {
    const { el, animations } = fake();
    const runner = new MotionRunner(() => "full");
    runner.play("a", el, chalkSpecs.hover);
    runner.play("b", el, chalkSpecs.open);
    runner.finishAll();
    expect(animations.every((a) => a.finished)).toBe(true);
  });

  it("does nothing for an element that cannot animate", () => {
    expect(
      new MotionRunner(() => "full").play("k", {} as Element, chalkSpecs.open),
    ).toBeNull();
  });
});
