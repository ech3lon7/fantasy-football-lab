import { expect, it } from "vitest";
import { chainGradeFailures, gradeImpactFailures } from "../src/domain/chain-position-impact";
import { migrateLegacyChainStep, migrateLegacyTradeQuery } from "../src/domain/trade-query-migration";

// Old protected-grade limits must preserve their per-affected-position behavior, not become a net-grade test.
it("migrates both-side grade limits to equivalent affected-position goals", () => {
  const result = migrateLegacyChainStep({ offer: { minimum: 1, maximum: 2 }, receive: { minimum: 1, maximum: 2 }, gradeLimit: { side: "both", maximumDrop: 1 } });
  expect(result.step.gradeLimit).toBeUndefined();
  expect(result.step.gradeImpacts).toHaveLength(2);
  const impact = { own: [{ position: "QB", before: "B", after: "C", drop: 3, stepDelta: -3 }], other: [{ position: "WR", before: "B", after: "B-", drop: 1, stepDelta: -1 }] };
  expect(gradeImpactFailures(impact, result.step.gradeImpacts).length > 0).toBe(chainGradeFailures(impact, { side: "both", maximumDrop: 1 }).length > 0);
});

// Retained criteria become filters and removed legacy controls are disclosed explicitly.
it("migrates a saved find query and lists its removed controls", () => {
  const result = migrateLegacyTradeQuery({ teamA: "1", give: ["a"], count: 1, below: 5, above: 5, indexMode: "strict", goal: "surface", weekly: { other: { minimum: 0, maximum: 3 } } });
  expect(result.filters.mustGive).toEqual(["a"]);
  expect(result.filters.theirGain).toBe(0);
  expect(result.ignored).toContain("index window");
  expect(result.ignored).toContain("goal");
  expect(result.ignored).toContain("their maximum gain");
});
