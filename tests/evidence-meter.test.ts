import { expect, it } from "vitest";
import {
  evidenceComparison,
  evidenceCondition,
} from "../src/domain/evidence-comparison";
import { evidenceMeter } from "../src/domain/evidence-meter";

// Discrete prerequisites get a true/false meter; missing evidence and waived routes stay neutral.
it("meters yes/no requirements without fabricating scores for unknown or waived checks", () => {
  for (const met of [true, false] as const) {
    const comparison = evidenceCondition(
      "Complete history",
      met ? "Complete" : "Incomplete",
      met,
    );
    expect(
      evidenceMeter(comparison, "Watch", "Verified history"),
    ).toMatchObject({
      low: 0,
      high: 1,
      value: met ? 1 : 0,
      playerPosition: met ? 100 : 0,
      thresholdPosition: 100,
      qualifies: met,
      leftLabel: "Not met",
      rightLabel: "Met",
    });
  }
  for (const met of [null, "WAIVED"] as const) {
    expect(
      evidenceMeter(
        evidenceCondition("Percentage requirement", "Unavailable", met),
        "Watch",
        "Growth route",
      ),
    ).toBeNull();
  }
  // Earlier workload enables a valid decline comparison; it is not itself an adverse decline.
  expect(
    evidenceMeter(
      evidenceComparison(
        0,
        12,
        "targets/game",
        ">",
        "Positive earlier workload",
      ),
      "Reduced workload",
      "Sustained workload decline",
    )!.favorableIncreases,
  ).toBe(true);
});

// Player values move on a shared cutoff-based scale; a stronger player cannot silently stretch everyone else's axis.
it("positions factual values and the threshold on a stable positive-evidence scale", () => {
  const strong = evidenceMeter(
    evidenceComparison(16, 20, "PPG"),
    "Gem",
    "Recent window actual PPG",
  )!;
  const weak = evidenceMeter(
    evidenceComparison(16, 8, "PPG"),
    "Gem",
    "Recent window actual PPG",
  )!;
  expect(strong).toMatchObject({
    low: 0,
    high: 32,
    thresholdPosition: 50,
    playerPosition: 62.5,
    qualifies: true,
    favorableIncreases: true,
  });
  expect(weak).toMatchObject({
    low: 0,
    high: 32,
    thresholdPosition: 50,
    playerPosition: 25,
    qualifies: false,
  });
});

// A negative badge can qualify while the player's adverse evidence moves toward red; sample size remains ordinary positive evidence.
it("separates negative-badge qualification from favorable player evidence", () => {
  const bad = evidenceMeter(
    evidenceComparison(0.2, 0.3, "%", "≥", "Relative average decline"),
    "Reduced workload",
    "Sustained workload decline",
  )!;
  const better = evidenceMeter(
    evidenceComparison(0.2, 0.1, "%", "≥", "Relative average decline"),
    "Reduced workload",
    "Sustained workload decline",
  )!;
  expect(bad.favorableIncreases).toBe(false);
  expect(bad.qualifies).toBe(true);
  expect(bad.playerPosition).toBeLessThan(bad.thresholdPosition);
  expect(better.qualifies).toBe(false);
  expect(better.playerPosition).toBeGreaterThan(better.thresholdPosition);
  const sample = evidenceMeter(
    evidenceComparison(5, 6, "games", "≥", "Verified played-game sample"),
    "Reduced workload",
    "Sustained workload decline",
  )!;
  expect(sample.favorableIncreases).toBe(true);
  const declinedGames = evidenceMeter(
    evidenceComparison(
      2,
      3,
      "games",
      "≥",
      "Recent games below the earlier average",
    ),
    "Reduced workload",
    "Sustained workload decline",
  )!;
  expect(declinedGames.favorableIncreases).toBe(false);
});

// Volume and touchdown-rate directions are independent, and a normal sample-size gate must not be inverted for a caution badge.
it.each(["SELL HIGH", "TD caution"])(
  "uses player-favorable directions for %s risk metrics",
  (tag) => {
    const lowVolume = evidenceMeter(
      evidenceComparison(50, 20, "opportunities", "<"),
      tag,
      "Positional volume test",
    )!;
    expect(lowVolume.qualifies).toBe(true);
    expect(lowVolume.favorableIncreases).toBe(true);
    expect(lowVolume.playerPosition).toBeLessThan(lowVolume.thresholdPosition);
    const highRate = evidenceMeter(
      evidenceComparison(0.15, 0.25, "%", ">"),
      tag,
      "Player touchdown rate",
    )!;
    expect(highRate.qualifies).toBe(true);
    expect(highRate.favorableIncreases).toBe(false);
    expect(highRate.playerPosition).toBeLessThan(highRate.thresholdPosition);
    expect(
      evidenceMeter(
        evidenceComparison(4, 5, "games"),
        tag,
        "Played-game sample",
      )!.favorableIncreases,
    ).toBe(true);
    expect(
      evidenceMeter(
        evidenceComparison(0.05, 0.02, "%", "<"),
        "BUY LOW",
        "Player touchdown rate",
      )!.playerPosition,
    ).toBeGreaterThan(50);
  },
);

// Inclusive and strict cutoffs use the exact unrounded operands, even if both rendered values look identical.
it("preserves strict boundaries, percentage units and unrounded qualification", () => {
  for (const [operator, qualifies] of [
    ["≥", true],
    [">", false],
    ["≤", true],
    ["<", false],
  ] as const) {
    const comparison = evidenceComparison(0.2, 0.2, "%", operator);
    expect(comparison.numeric).toEqual({
      threshold: 0.2,
      value: 0.2,
      unit: "%",
      operator,
    });
    expect(
      evidenceMeter(comparison, "Watch", "Workload growth")!.qualifies,
    ).toBe(qualifies);
  }
  const close = evidenceComparison(7, 6.999999, "targets/game");
  expect(close.actual).toBe("7.00 targets/game");
  expect(evidenceMeter(close, "Gem", "Recent workload")!.qualifies).toBe(false);
});

// Missing and nonnumeric evidence stays unavailable; zero and negative scores must retain their actual numeric meaning.
it("handles zero, negative and unavailable data without parsing display strings", () => {
  expect(
    evidenceMeter(
      evidenceComparison(0, 0, "PPG"),
      "Pre-gem",
      "Workload change",
    )!.qualifies,
  ).toBe(true);
  expect(
    evidenceMeter(evidenceComparison(16, -4, "PPG"), "Gem", "Recent PPG"),
  ).toMatchObject({
    value: -4,
    bounded: 0,
    playerPosition: 0,
    outside: "Below display range",
    qualifies: false,
  });
  expect(
    evidenceMeter(evidenceComparison(null, 0, "PPG"), "Gem", "Recent PPG"),
  ).toBeNull();
  expect(
    evidenceMeter(evidenceComparison(2, NaN, "PPG"), "Gem", "Recent PPG"),
  ).toBeNull();
  expect(
    evidenceMeter(
      { required: "≥ 12.00", actual: "20.00", margin: "+8.00" },
      "Gem",
      "Legacy context",
    ),
  ).toBeNull();
});

// Axis clipping never changes the displayed actual value, the decision, or the supplied comparison object.
it("marks out-of-range values without inventing a maximum player score", () => {
  const comparison = evidenceComparison(16, 2000000, "PPG"),
    before = JSON.stringify(comparison);
  const meter = evidenceMeter(comparison, "Gem", "Recent PPG")!;
  expect(meter).toMatchObject({
    high: 32,
    bounded: 32,
    value: 2000000,
    playerPosition: 100,
    qualifies: true,
    outside: "Above display range",
  });
  expect(JSON.stringify(comparison)).toBe(before);
  expect(
    evidenceMeter(
      evidenceComparison(1e308, 1e308, "PPG"),
      "Gem",
      "Invalid range",
    ),
  ).toBeNull();
});

// Available games use the same real remaining-week ceiling for every player rather than a one-game display ceiling.
it("uses the snapshot's remaining horizon for availability", () => {
  const meter = evidenceMeter(
    evidenceComparison(0, 12, "games", ">"),
    "Gem",
    "Availability",
    12,
  )!;
  expect(meter).toMatchObject({
    low: 0,
    high: 12,
    value: 12,
    bounded: 12,
    playerPosition: 100,
    thresholdPosition: 0,
    outside: "",
    qualifies: true,
  });
});
