import { describe, expect, it } from "vitest";
import {
  angleToValue,
  arcPath,
  arrowHead,
  pageSlice,
  pointerAngle,
  polar,
  segmentBounds,
  segmentCenter,
  segmentEdges,
  snapValue,
  spoke,
  valueToAngle,
  wedgePath,
} from "../src/features/next/trade/wheel/wheel-geometry";

const near = (a: number, b: number, digits = 1) =>
  expect(a).toBeCloseTo(b, digits);

describe("wheel geometry follows the Chalk Playbook board", () => {
  it("puts the first of six segments at the top and splits the circle as the board does", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => segmentEdges(6)[i])).toEqual([
      -118, -62, 0, 62, 118, 180, 242,
    ]);
    expect([0, 1, 2, 3, 4, 5].map((i) => segmentCenter(i, 6))).toEqual([
      -90, -31, 31, 90, 149, 211,
    ]);
    expect(segmentBounds(0, 6)).toEqual({ from: -118, to: -62 });
    expect(segmentBounds(3, 6)).toEqual({ from: 62, to: 118 });
  });

  it("with seven segments (the Chain planner) the top one stays 56 degrees and the other six share the rest", () => {
    const edges = segmentEdges(7);
    expect(edges[0]).toBe(-118);
    expect(edges[1]).toBe(-62);
    expect(edges[7]).toBeCloseTo(242, 6);
    expect(segmentCenter(0, 7)).toBe(-90);
    expect(edges[2] - edges[1]).toBeCloseTo((360 - 56) / 6, 6);
  });

  it("matches the board's selected wedge corners (outer 184, inner 86, centre 320,320)", () => {
    const a = polar(184, -118);
    const b = polar(184, -62);
    near(a.x, 233.6);
    near(a.y, 157.5);
    near(b.x, 406.4);
    near(b.y, 157.5);
    const c = polar(86, -62);
    near(c.x, 360.4);
    near(c.y, 244.1);
    const path = wedgePath(86, 184, -118, -62);
    expect(path).toMatch(
      /^M233\.6 157\.5 A184 184 0 0 1 406\.4 157\.5 L360\.4 244\.1 A86 86 0 0 0 279\.6 244\.1 Z$/,
    );
  });

  it("matches the board's spokes between the inner and outer circle", () => {
    const s = spoke(0, 6);
    near(s.x1, 239.3);
    near(s.y1, 168.1);
    near(s.x2, 281.5);
    near(s.y2, 247.6);
  });

  it("draws the slider track from -150 to -30 degrees at radius 214", () => {
    expect(arcPath(214, -150, -30)).toMatch(
      /^M134\.7 213 A214 214 0 0 1 505\.3 213$/,
    );
  });
});

describe("value and angle", () => {
  it("maps -2 to +1 onto -150 to -30 degrees", () => {
    expect(valueToAngle(-2, -2, 1)).toBe(-150);
    expect(valueToAngle(1, -2, 1)).toBe(-30);
    near(valueToAngle(0.5, -2, 1), -50, 6);
    const handle = polar(214, valueToAngle(0.5, -2, 1));
    near(handle.x, 457.6);
    near(handle.y, 156.1);
  });

  it("round-trips every half step", () => {
    for (let v = -2; v <= 1; v += 0.5)
      near(angleToValue(valueToAngle(v, -2, 1), -2, 1, 0.5), v, 9);
  });

  it("snaps to half steps and clamps to the range", () => {
    expect(snapValue(0.3, -2, 1, 0.5)).toBe(0.5);
    expect(snapValue(0.2, -2, 1, 0.5)).toBe(0);
    expect(snapValue(-9, -2, 1, 0.5)).toBe(-2);
    expect(snapValue(9, -2, 1, 0.5)).toBe(1);
    expect(snapValue(Number.NaN, -2, 1, 0.5)).toBe(1);
  });

  it("turns an angle beyond either end into that end's value", () => {
    expect(angleToValue(-170, -2, 1, 0.5)).toBe(-2);
    expect(angleToValue(0, -2, 1, 0.5)).toBe(1);
  });

  it("reads a pointer position as an angle around the centre", () => {
    near(pointerAngle(320, 100, 320, 320), -90, 6);
    near(pointerAngle(540, 320, 320, 320), 0, 6);
    near(pointerAngle(320, 540, 320, 320), 90, 6);
  });

  it("points the arrowhead at +1 along the track", () => {
    expect(arrowHead(214, -30, 14)).toMatch(/^M[\d. -]+ L[\d. -]+ L[\d. -]+$/);
  });
});

describe("rotating long lists", () => {
  it("shows at most eight at a time and says how many pages there are", () => {
    const teams = Array.from({ length: 11 }, (_, i) => i);
    expect(pageSlice(teams, 0).items).toHaveLength(8);
    expect(pageSlice(teams, 1).items).toEqual([8, 9, 10]);
    expect(pageSlice(teams, 0).pages).toBe(2);
    expect(pageSlice(teams, 5).page).toBe(1);
    expect(pageSlice([1, 2, 3], 0).pages).toBe(1);
  });
});
