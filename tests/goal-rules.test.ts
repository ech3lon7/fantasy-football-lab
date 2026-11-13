import { describe, it, expect } from "vitest";
import {
  goalKey,
  goalsSummary,
  isOverall,
  matchNetOption,
  newGoal,
  otherStepOptions,
  ownStepOptions,
  stepOptionsFor,
  withPosition,
  withSide,
  withStepKey,
} from "../src/features/next/trade/goalRules";
import type { PositionalGradeImpactRule } from "../src/domain/chain-position-impact";

const rule = (patch: Partial<PositionalGradeImpactRule> = {}): PositionalGradeImpactRule => ({
  id: "r",
  side: "own",
  position: "WR",
  type: "upgrade",
  steps: 2,
  ...patch,
});

// The positional grade goal rules: step choices per side, switching a goal's team or position, and the one-line summary.
describe("positional grade goal rules", () => {
  it("offers upgrades and drop limits for your team, and depletion for theirs", () => {
    expect(ownStepOptions.map((o) => o.label)).toEqual([
      "Upgrade ≥ 5 steps",
      "Upgrade ≥ 4 steps",
      "Upgrade ≥ 3 steps",
      "Upgrade ≥ 2 steps",
      "Upgrade ≥ 1 step",
      "No drop (≥ 0)",
      "Drop at most 1 step",
      "Drop at most 2 steps",
      "Drop at most 3 steps",
      "Drop at most 4 steps",
      "Drop at most 5 steps",
    ]);
    expect(otherStepOptions.some((o) => o.type === "deplete")).toBe(true);
    expect(ownStepOptions.some((o) => o.type === "deplete")).toBe(false);
  });

  it("offers matching your overall steps only for their overall goal", () => {
    expect(stepOptionsFor(rule({ side: "other", position: "OVERALL" }))[0]).toBe(matchNetOption);
    expect(stepOptionsFor(rule({ side: "other", position: "RB" })).includes(matchNetOption)).toBe(false);
    expect(stepOptionsFor(rule()).includes(matchNetOption)).toBe(false);
    expect(isOverall("overall")).toBe(true);
  });

  it("keeps a unique key for their drop limits so they differ from upgrades", () => {
    expect(goalKey(rule({ side: "other", type: "drop_limit", steps: -2 }))).toBe("limit:-2");
    expect(goalKey(rule({ side: "other", type: "deplete", steps: -2 }))).toBe("-2");
    expect(goalKey(rule({ type: "match_net", steps: 0 }))).toBe("match_net");
    expect(goalKey(rule())).toBe("2");
  });

  it("applies a chosen step option with its type", () => {
    const next = withStepKey(rule({ side: "other" }), "limit:-3");
    expect(next).toMatchObject({ type: "drop_limit", steps: -3 });
    expect(withStepKey(rule(), "no such option")).toEqual(rule());
  });

  it("repairs a goal that a team or position change would make impossible", () => {
    const matching = rule({ side: "other", position: "OVERALL", type: "match_net", steps: 0 });
    expect(withSide(matching, "own")).toMatchObject({ side: "own", type: "upgrade", steps: 2 });
    expect(withPosition(matching, "WR")).toMatchObject({ position: "WR", type: "upgrade", steps: 1 });
    expect(withPosition(matching, "OVERALL")).toEqual(matching);
  });

  it("starts a new goal at your first position without one", () => {
    const added = newGoal([rule({ position: "QB" }), rule({ position: "RB" })], ["QB", "RB", "WR"]);
    expect(added).toMatchObject({ side: "own", position: "WR", type: "upgrade", steps: 2 });
    expect(added.id.length).toBeGreaterThan(0);
    // With every position taken it falls back to Overall.
    const full = newGoal(["QB", "RB", "WR", "OVERALL"].map((position) => rule({ position })), ["QB", "RB", "WR"]);
    expect(full.position).toBe("QB");
  });

  it("summarises goals in one line", () => {
    expect(goalsSummary([])).toBe("None");
    expect(
      goalsSummary([
        rule(),
        rule({ side: "own", position: "RB", type: "drop_limit", steps: -3 }),
        rule({ side: "other", position: "OVERALL", type: "match_net", steps: 0 }),
      ]),
    ).toBe("Your WR +2 · Your RB no worse than −3 · their overall matches yours");
  });
});
