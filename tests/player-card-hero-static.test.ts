import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "src/ui/player-hero.css"), "utf8");

// The body of `@keyframes <name> { ... }`, found by balancing braces (keyframes contain nested blocks).
function keyframes(name: string): { pct: number; opacity: number }[] {
  const start = css.indexOf(`@keyframes ${name}`);
  expect(
    start,
    `@keyframes ${name} must exist in player-hero.css`,
  ).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  const body = css.slice(open + 1, end);
  const frames: { pct: number; opacity: number }[] = [];
  for (const m of body.matchAll(/([\d.]+)%\s*\{([^}]*)\}/g)) {
    const opacity = /opacity:\s*([\d.]+)/.exec(m[2]);
    frames.push({
      pct: Number(m[1]),
      opacity: opacity ? Number(opacity[1]) : NaN,
    });
  }
  return frames;
}

describe("photosensitivity of the superstar entrance (WCAG 2.3.1)", () => {
  const frames = keyframes("bloom");
  // Whole-card washes are the local maxima above zero.
  const peaks = frames.filter((f, i) => {
    const before = frames[i - 1]?.opacity ?? 0;
    const after = frames[i + 1]?.opacity ?? 0;
    return f.opacity > 0 && f.opacity >= before && f.opacity >= after;
  });
  const duration = Number(/animation:\s*bloom\s+([\d.]+)s/.exec(css)?.[1]);

  it("reads every bloom keyframe (the parse is not vacuous)", () => {
    expect(frames.length).toBeGreaterThanOrEqual(6);
    expect(frames.every((f) => Number.isFinite(f.opacity))).toBe(true);
    expect(Number.isFinite(duration)).toBe(true);
  });

  it("has at most two whole-card washes", () => {
    expect(peaks.length).toBeGreaterThan(0);
    expect(peaks.length).toBeLessThanOrEqual(2);
  });

  it("keeps every wash below 30% opacity", () => {
    for (const p of peaks) expect(p.opacity).toBeLessThan(0.3);
  });

  it("keeps washes more than half a second apart", () => {
    for (let i = 1; i < peaks.length; i++)
      expect(
        ((peaks[i].pct - peaks[i - 1].pct) / 100) * duration,
      ).toBeGreaterThanOrEqual(0.5);
  });
});

describe("hero styles use the design tokens", () => {
  it("has no literal colours outside custom-property definitions", () => {
    const uses = css
      .split("\n")
      .filter((l) => !/^\s*--[\w-]+:/.test(l))
      .filter((l) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l));
    expect(uses).toEqual([]);
  });

  it("shows entrances only at full motion", () => {
    expect(css).toMatch(/\[data-animation="full"\][^{]*\.fx/);
  });
});
