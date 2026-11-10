import { describe, expect, it } from "vitest";
import {
  hapticsSupported,
  readAnimationPref,
  readFlag,
  resolveAnimation,
  toneFor,
  vibrationFor,
  writeAnimationPref,
  writeFlag,
} from "../src/ui/feel/settings";

describe("animation level", () => {
  it("System follows the reduced-motion request", () => {
    expect(resolveAnimation("system", true)).toBe("reduced");
    expect(resolveAnimation("system", false)).toBe("full");
  });
  it("explicit choices ignore the device", () => {
    expect(resolveAnimation("full", true)).toBe("full");
    expect(resolveAnimation("off", false)).toBe("off");
    expect(resolveAnimation("reduced", false)).toBe("reduced");
  });
  it("falls back to System for unknown values and round-trips the rest", () => {
    expect(readAnimationPref("bouncy")).toBe("system");
    for (const pref of ["system", "full", "reduced", "off"] as const)
      expect(readAnimationPref(writeAnimationPref(pref))).toBe(pref);
  });
});

describe("sound and haptics flags", () => {
  it("are off unless explicitly on", () => {
    expect(readFlag(undefined)).toBe(false);
    expect(readFlag("yes")).toBe(false);
    expect(readFlag(writeFlag(true))).toBe(true);
    expect(readFlag(writeFlag(false))).toBe(false);
  });
});

describe("feedback support and patterns", () => {
  it("reports haptics unsupported without the Vibration API", () => {
    expect(hapticsSupported({})).toBe(false);
    expect(hapticsSupported({ vibrate: () => true })).toBe(true);
  });
  it("defines a non-empty tone and vibration for every kind", () => {
    for (const kind of ["tap", "select", "success", "caution"] as const) {
      expect(toneFor(kind).length).toBeGreaterThan(0);
      expect(vibrationFor(kind).length).toBeGreaterThan(0);
    }
  });
});
