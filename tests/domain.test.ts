import { describe, it, expect } from "vitest";
import { defaults, settingsSchema, mean, sd } from "../src/domain/contracts";
import { dealGrade } from "../src/domain/trades";
import type { Model } from "../src/domain/valuation";
describe("grade boundaries and units", () => {
  const m = { settings: defaults } as Model;
  it.each([
    [50, "Horrible deal"],
    [80, "Bad deal"],
    [94, "Less than ideal"],
    [95, "Fair deal"],
    [100, "Fair deal"],
    [105, "Fair deal"],
    [106, "Good deal"],
    [120, "Excellent deal"],
    [150, "Steal deal"],
  ])("100 outgoing vs %s incoming", (incoming, grade) =>
    expect(dealGrade(100, incoming as number, m)).toBe(grade),
  );
  it("handles both zero and zero outgoing without infinite percentages", () => {
    expect(dealGrade(0, 0, m)).toContain("Not distinguishable");
    expect(dealGrade(0, 10, m)).toContain("zero outgoing");
  });
  it("does not apply the consolidation premium to grades", () =>
    expect(
      dealGrade(100, 120, {
        settings: { ...defaults, Premium: 0.35 },
      } as Model),
    ).toBe("Excellent deal"));
});
describe("settings and recorded facts", () => {
  it("keeps negative scores and zeros in averages", () =>
    expect(mean([0, -2, 8])).toBe(2));
  it("uses sample standard deviation", () =>
    expect(sd([1, 3])).toBeCloseTo(Math.sqrt(2)));
  it("rejects invalid settings rather than silently resetting", () => {
    expect(
      settingsSchema.safeParse({ ...defaults, PriorGames: 0 }).success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({ ...defaults, Premium: 0.6 }).success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({ ...defaults, GemMinGames: 2.5 }).success,
    ).toBe(false);
  });
});
