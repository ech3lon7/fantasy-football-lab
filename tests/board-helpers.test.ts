import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fitFontSize, HUB_FONT_MAX, HUB_FONT_MIN } from "../src/features/next/trade/board/fit-text";
import { isOutside } from "../src/features/next/trade/board/outside";

describe("hub value auto-fit", () => {
  it("keeps 48px when the text fits", () => {
    expect(fitFontSize(80, 120)).toBe(HUB_FONT_MAX);
  });
  it("shrinks in proportion to the overflow", () => {
    expect(fitFontSize(200, 120)).toBe(HUB_FONT_MIN);
    expect(fitFontSize(160, 120)).toBe(36);
  });
  it("never goes below 28px, and an unmeasured or empty text keeps 48px", () => {
    expect(fitFontSize(1000, 120)).toBe(HUB_FONT_MIN);
    expect(fitFontSize(0, 120)).toBe(HUB_FONT_MAX);
    expect(fitFontSize(100, 0)).toBe(HUB_FONT_MAX);
  });
});

describe("click outside", () => {
  const zone = (inside: unknown[]) => ({ contains: (node: Node) => inside.includes(node) });
  class FakeNode {}
  const globalWithNode = globalThis as unknown as { Node?: unknown };
  const originalNode = globalWithNode.Node;
  beforeAll(() => { globalWithNode.Node = FakeNode; });
  afterAll(() => { globalWithNode.Node = originalNode; });
  const a = new FakeNode() as unknown as Node;
  const b = new FakeNode() as unknown as Node;
  const c = new FakeNode() as unknown as Node;
  it("is inside any zone that contains the target", () => {
    expect(isOutside(a, [zone([a]), zone([b])])).toBe(false);
    expect(isOutside(b, [null, zone([b])])).toBe(false);
  });
  it("is outside when no zone contains the target, and ignores a missing target", () => {
    expect(isOutside(c, [zone([a]), zone([b])])).toBe(true);
    expect(isOutside(null, [zone([a])])).toBe(false);
  });
});
