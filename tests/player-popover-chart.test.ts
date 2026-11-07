import { describe, it, expect } from "vitest";
import { isChartClickTarget } from "../src/ui/PlayerName";

describe("isChartClickTarget", () => {
  it("returns true when target is an element with class stock-trend-pill", () => {
    const pill = {
      closest: (sel: string) => (sel === ".stock-trend-pill" ? pill : null),
    };
    expect(isChartClickTarget(pill)).toBe(true);
  });

  it("returns true when target is a child of stock-trend-pill", () => {
    const child = {
      closest: (sel: string) => (sel === ".stock-trend-pill" ? {} : null),
    };
    expect(isChartClickTarget(child)).toBe(true);
  });

  it("returns false when target is not inside stock-trend-pill", () => {
    const boldName = {
      closest: (_sel: string) => null,
    };
    expect(isChartClickTarget(boldName)).toBe(false);
  });

  it("returns false when target is null, undefined, or not an element with closest", () => {
    expect(isChartClickTarget(null)).toBe(false);
    expect(isChartClickTarget(undefined)).toBe(false);
    expect(isChartClickTarget({})).toBe(false);
    expect(isChartClickTarget("some text")).toBe(false);
  });
});
