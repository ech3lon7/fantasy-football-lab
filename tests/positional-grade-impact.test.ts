import { describe, it, expect } from "vitest";
import {
  chainPositionImpact,
  evaluateGradeImpacts,
  gradeStepDelta,
  netGradeStepDelta,
  type ChainPositionImpact,
  type PositionalGradeImpactRule,
} from "../src/domain/chain-position-impact";
import { positionGradeScale } from "../src/domain/trade-safeguards";
import { starterFixture } from "./fixtures";
import { evaluate } from "../src/domain/valuation";
import { withoutByeWeeks } from "../src/domain/lineups";
import { evaluateTrade } from "../src/domain/trades";

describe("positional grade impact domain engine", () => {
  it("calculates signed grade step delta between grades", () => {
    // Upgrading C+ (index 6) to B (index 8) is +2
    expect(gradeStepDelta("C+", "B")).toBe(2);
    // Downgrading B (index 8) to C+ (index 6) is -2
    expect(gradeStepDelta("B", "C+")).toBe(-2);
    // Unchanged grade is 0
    expect(gradeStepDelta("B", "B")).toBe(0);
    // Grade unavailable returns null
    expect(gradeStepDelta("n.a.", "B")).toBeNull();
    expect(gradeStepDelta("B", "n.a.")).toBeNull();
  });

  it("evaluates own team upgrade rule (steps > 0): passes when stepDelta >= steps, fails otherwise", () => {
    const rule: PositionalGradeImpactRule = {
      id: "own-upgrade-wr",
      side: "own",
      position: "WR",
      steps: 2,
    };

    const passingImpact: ChainPositionImpact = {
      own: [
        {
          position: "WR",
          before: "C+",
          after: "B",
          drop: 0,
          stepDelta: 2,
        },
      ],
      other: [],
    };
    const passResult = evaluateGradeImpacts(passingImpact, [rule]);
    expect(passResult.passes).toBe(true);
    expect(passResult.failures).toEqual([]);

    const failingImpact: ChainPositionImpact = {
      own: [
        {
          position: "WR",
          before: "C+",
          after: "B−",
          drop: 0,
          stepDelta: 1,
        },
      ],
      other: [],
    };
    const failResult = evaluateGradeImpacts(failingImpact, [rule]);
    expect(failResult.passes).toBe(false);
    expect(failResult.failures.length).toBeGreaterThan(0);

    // steps === 0 requires stepDelta >= 0 (no drop)
    const zeroRule: PositionalGradeImpactRule = {
      id: "own-no-drop",
      side: "own",
      position: "WR",
      steps: 0,
    };
    expect(
      evaluateGradeImpacts(
        {
          own: [{ position: "WR", before: "B", after: "B", drop: 0, stepDelta: 0 }],
          other: [],
        },
        [zeroRule],
      ).passes,
    ).toBe(true);
    expect(
      evaluateGradeImpacts(
        {
          own: [{ position: "WR", before: "B", after: "B−", drop: 1, stepDelta: -1 }],
          other: [],
        },
        [zeroRule],
      ).passes,
    ).toBe(false);
  });

  it("evaluates own team drop budget (steps < 0): passes when stepDelta >= steps, fails when stepDelta < steps", () => {
    // Sacrifice budget of at most 2 steps drop (steps: -2)
    const rule: PositionalGradeImpactRule = {
      id: "own-budget-rb",
      side: "own",
      position: "RB",
      steps: -2,
    };

    // Drops by 1 step (stepDelta = -1 >= -2): should pass
    const passingImpact: ChainPositionImpact = {
      own: [
        {
          position: "RB",
          before: "B",
          after: "B−",
          drop: 1,
          stepDelta: -1,
        },
      ],
      other: [],
    };
    const passResult = evaluateGradeImpacts(passingImpact, [rule]);
    expect(passResult.passes).toBe(true);
    expect(passResult.failures).toEqual([]);

    // Drops by 3 steps (stepDelta = -3 < -2): should fail
    const failingImpact: ChainPositionImpact = {
      own: [
        {
          position: "RB",
          before: "B",
          after: "C",
          drop: 3,
          stepDelta: -3,
        },
      ],
      other: [],
    };
    const failResult = evaluateGradeImpacts(failingImpact, [rule]);
    expect(failResult.passes).toBe(false);
    expect(failResult.failures.length).toBeGreaterThan(0);
  });

  it("evaluates other team upgrade rule (steps > 0): passes when stepDelta >= steps", () => {
    const rule: PositionalGradeImpactRule = {
      id: "other-upgrade-te",
      side: "other",
      position: "TE",
      steps: 1,
    };

    // Upgraded by 1 step: passes
    const passingImpact: ChainPositionImpact = {
      own: [],
      other: [
        {
          position: "TE",
          before: "C",
          after: "C+",
          drop: 0,
          stepDelta: 1,
        },
      ],
    };
    const passResult = evaluateGradeImpacts(passingImpact, [rule]);
    expect(passResult.passes).toBe(true);
    expect(passResult.failures).toEqual([]);

    // Unchanged (stepDelta = 0 < 1): fails
    const failingImpact: ChainPositionImpact = {
      own: [],
      other: [
        {
          position: "TE",
          before: "C",
          after: "C",
          drop: 0,
          stepDelta: 0,
        },
      ],
    };
    const failResult = evaluateGradeImpacts(failingImpact, [rule]);
    expect(failResult.passes).toBe(false);
    expect(failResult.failures.length).toBeGreaterThan(0);

    // steps === 0 requires stepDelta >= 0 (no drop allowed for other team)
    const otherZeroRule: PositionalGradeImpactRule = {
      id: "other-no-drop",
      side: "other",
      position: "TE",
      steps: 0,
    };
    expect(
      evaluateGradeImpacts(
        {
          own: [],
          other: [{ position: "TE", before: "C", after: "C", drop: 0, stepDelta: 0 }],
        },
        [otherZeroRule],
      ).passes,
    ).toBe(true);
    expect(
      evaluateGradeImpacts(
        {
          own: [],
          other: [{ position: "TE", before: "C", after: "C−", drop: 1, stepDelta: -1 }],
        },
        [otherZeroRule],
      ).passes,
    ).toBe(false);
  });

  it("evaluates other team depletion rule (steps < 0): passes when stepDelta <= steps", () => {
    // Deplete opponent QB by at least 2 steps (steps: -2)
    const rule: PositionalGradeImpactRule = {
      id: "other-deplete-qb",
      side: "other",
      position: "QB",
      steps: -2,
    };

    // Opponent drops by 3 steps (stepDelta = -3 <= -2): passes
    const passingImpact: ChainPositionImpact = {
      own: [],
      other: [
        {
          position: "QB",
          before: "A−",
          after: "B−",
          drop: 3,
          stepDelta: -3,
        },
      ],
    };
    const passResult = evaluateGradeImpacts(passingImpact, [rule]);
    expect(passResult.passes).toBe(true);
    expect(passResult.failures).toEqual([]);

    // Opponent only drops by 1 step (stepDelta = -1 > -2): fails
    const failingImpact: ChainPositionImpact = {
      own: [],
      other: [
        {
          position: "QB",
          before: "A−",
          after: "B+",
          drop: 1,
          stepDelta: -1,
        },
      ],
    };
    const failResult = evaluateGradeImpacts(failingImpact, [rule]);
    expect(failResult.passes).toBe(false);
    expect(failResult.failures.length).toBeGreaterThan(0);
  });

  it("fails rule when position is missing or grade is unavailable ('n.a.')", () => {
    const rule: PositionalGradeImpactRule = {
      id: "missing-or-na",
      side: "own",
      position: "K",
      steps: 1,
    };

    // Position exists but grade is n.a. (stepDelta is null)
    const naImpact: ChainPositionImpact = {
      own: [
        {
          position: "K",
          before: "n.a.",
          after: "n.a.",
          drop: null,
          stepDelta: null,
        },
      ],
      other: [],
    };
    const naResult = evaluateGradeImpacts(naImpact, [rule]);
    expect(naResult.passes).toBe(false);
    expect(naResult.failures[0]).toContain("grade unavailable");

    // Position missing completely from impact
    const missingImpact: ChainPositionImpact = {
      own: [],
      other: [],
    };
    const missingResult = evaluateGradeImpacts(missingImpact, [rule]);
    expect(missingResult.passes).toBe(false);
    expect(missingResult.failures[0]).toContain("grade unavailable");

    // Empty or undefined rules should pass
    expect(evaluateGradeImpacts(missingImpact)).toEqual({
      passes: true,
      failures: [],
    });
    expect(evaluateGradeImpacts(missingImpact, [])).toEqual({
      passes: true,
      failures: [],
    });
  });

  it("evaluates multiple simultaneous rules across own and other teams (conjunction)", () => {
    const rules: PositionalGradeImpactRule[] = [
      { id: "1", side: "own", position: "WR", steps: 2 },
      { id: "2", side: "own", position: "FLEX", steps: -2 },
      { id: "3", side: "other", position: "WR", steps: -2 },
      { id: "4", side: "other", position: "FLEX", steps: 2 },
    ];

    // All rules pass:
    // own WR: +2 (>= 2)
    // own FLEX: -1 (>= -2)
    // other WR: -3 (<= -2)
    // other FLEX: +2 (>= 2)
    const passingImpact: ChainPositionImpact = {
      own: [
        { position: "WR", before: "C+", after: "B", drop: 0, stepDelta: 2 },
        { position: "FLEX", before: "B", after: "B−", drop: 1, stepDelta: -1 },
      ],
      other: [
        { position: "WR", before: "B+", after: "C", drop: 4, stepDelta: -3 },
        { position: "FLEX", before: "C", after: "C+", drop: 0, stepDelta: 2 },
      ],
    };
    const allPass = evaluateGradeImpacts(passingImpact, rules);
    expect(allPass.passes).toBe(true);
    expect(allPass.failures).toEqual([]);

    // One rule fails: own WR only +1 (< 2)
    const oneFailImpact: ChainPositionImpact = {
      own: [
        { position: "WR", before: "C+", after: "B−", drop: 0, stepDelta: 1 },
        { position: "FLEX", before: "B", after: "B−", drop: 1, stepDelta: -1 },
      ],
      other: passingImpact.other,
    };
    const oneFail = evaluateGradeImpacts(oneFailImpact, rules);
    expect(oneFail.passes).toBe(false);
    expect(oneFail.failures).toHaveLength(1);
    expect(oneFail.failures[0]).toContain("Your WR");

    // Multiple rules fail: own WR +1 (< 2) and other WR -1 (> -2, not depleted enough)
    const multiFailImpact: ChainPositionImpact = {
      own: oneFailImpact.own,
      other: [
        { position: "WR", before: "B+", after: "B", drop: 1, stepDelta: -1 },
        { position: "FLEX", before: "C", after: "C+", drop: 0, stepDelta: 2 },
      ],
    };
    const multiFail = evaluateGradeImpacts(multiFailImpact, rules);
    expect(multiFail.passes).toBe(false);
    expect(multiFail.failures).toHaveLength(2);
    expect(multiFail.failures.some((f) => f.includes("Your WR"))).toBe(true);
    expect(multiFail.failures.some((f) => f.includes("Their WR"))).toBe(true);
  });

  it("evaluates real trade positional impact, stepDelta, and targetPositions for untouched positions", async () => {
    const d = await starterFixture();
    const m = withoutByeWeeks(evaluate(d, d.settings));
    const draft = { teamA: "1", teamB: "2", give: ["101"], get: ["200"] };
    const result = evaluateTrade(m, draft, false);
    if (!result.valid) throw Error(result.errors.join());

    // Evaluate without targetPositions: only affected positions are assessed
    const defaultImpact = chainPositionImpact(m, draft, result);
    expect(defaultImpact.own.length).toBeGreaterThan(0);
    expect(defaultImpact.other.length).toBeGreaterThan(0);
    for (const change of [...defaultImpact.own, ...defaultImpact.other]) {
      expect(typeof change.position).toBe("string");
      if (change.stepDelta !== null) {
        const first = positionGradeScale.findIndex((g) => g === change.before);
        const last = positionGradeScale.findIndex((g) => g === change.after);
        expect(change.stepDelta).toBe(last - first);
      }
    }

    // Now include an untouched position (RB) via targetPositions
    const impactWithTarget = chainPositionImpact(m, draft, result, ["RB"]);
    const ownRb = impactWithTarget.own.find((p) => p.position === "RB");
    expect(ownRb).toBeDefined();
    expect(ownRb!.before).toBe(ownRb!.after);
    expect(ownRb!.stepDelta).toBe(0);

    // A drop budget rule on the untouched position must pass without "grade unavailable"
    const rbDropBudget: PositionalGradeImpactRule = {
      id: "rb-budget",
      side: "own",
      position: "RB",
      steps: -1,
    };
    const budgetEval = evaluateGradeImpacts(impactWithTarget, [rbDropBudget]);
    expect(budgetEval.passes).toBe(true);
    expect(budgetEval.failures).toEqual([]);
  });
  describe("netGradeStepDelta", () => {
    it("sums step counts across position changes", () => {
      expect(
        netGradeStepDelta([
          { position: "RB", before: "C+", after: "B", drop: 0, stepDelta: 2 },
          { position: "WR", before: "A-", after: "B+", drop: 2, stepDelta: -2 },
        ]),
      ).toBe(0);

      expect(
        netGradeStepDelta([
          { position: "RB", before: "C+", after: "B", drop: 0, stepDelta: 2 },
          { position: "WR", before: "B", after: "B-", drop: 1, stepDelta: -1 },
        ]),
      ).toBe(1);

      expect(
        netGradeStepDelta([
          { position: "RB", before: "B", after: "C", drop: 3, stepDelta: -3 },
          { position: "WR", before: "B", after: "B+", drop: 0, stepDelta: 1 },
        ]),
      ).toBe(-2);

      expect(netGradeStepDelta([])).toBe(0);
      expect(netGradeStepDelta(null)).toBe(0);
      expect(netGradeStepDelta(undefined)).toBe(0);
    });
  });

  describe("loss limit (drop cap) and overall net step goals", () => {
    it("evaluates other team loss limit (type: drop_limit): passes when stepDelta >= steps, fails when loss exceeds limit", () => {
      // Opponent loss limit of at most 2 steps drop (steps: -2, type: "drop_limit")
      const rule: PositionalGradeImpactRule = {
        id: "other-loss-limit-rb",
        side: "other",
        position: "RB",
        steps: -2,
        type: "drop_limit",
      };

      // Drops by 1 step (-1 >= -2): passes
      expect(
        evaluateGradeImpacts(
          {
            own: [],
            other: [{ position: "RB", before: "B", after: "B−", drop: 1, stepDelta: -1 }],
          },
          [rule],
        ).passes,
      ).toBe(true);

      // Drops by 2 steps (-2 >= -2): passes
      expect(
        evaluateGradeImpacts(
          {
            own: [],
            other: [{ position: "RB", before: "B", after: "C+", drop: 2, stepDelta: -2 }],
          },
          [rule],
        ).passes,
      ).toBe(true);

      // Drops by 3 steps (-3 < -2): fails
      const fail = evaluateGradeImpacts(
        {
          own: [],
          other: [{ position: "RB", before: "B", after: "C", drop: 3, stepDelta: -3 }],
        },
        [rule],
      );
      expect(fail.passes).toBe(false);
      expect(fail.failures[0]).toContain("loss limit");
    });

    it("evaluates overall net step goals for own team", () => {
      // Overall net upgrade of >= +2 steps
      const upgradeRule: PositionalGradeImpactRule = {
        id: "own-overall-upgrade",
        side: "own",
        position: "OVERALL",
        steps: 2,
        type: "upgrade",
      };

      // Net +3 steps: passes
      expect(
        evaluateGradeImpacts(
          {
            own: [
              { position: "RB", before: "C+", after: "B+", drop: 0, stepDelta: 3 },
              { position: "WR", before: "B", after: "B", drop: 0, stepDelta: 0 },
            ],
            other: [],
          },
          [upgradeRule],
        ).passes,
      ).toBe(true);

      // Net +1 step: fails
      const fail = evaluateGradeImpacts(
        {
          own: [
            { position: "RB", before: "C+", after: "B", drop: 0, stepDelta: 2 },
            { position: "WR", before: "B", after: "B−", drop: 1, stepDelta: -1 },
          ],
          other: [],
        },
        [upgradeRule],
      );
      expect(fail.passes).toBe(false);
      expect(fail.failures[0]).toContain("overall");
    });

    it("evaluates overall net step loss limit for other team", () => {
      // Opponent overall loss limited to at most 1 step drop
      const limitRule: PositionalGradeImpactRule = {
        id: "other-overall-loss-limit",
        side: "other",
        position: "OVERALL",
        steps: -1,
        type: "drop_limit",
      };

      // Net 0 steps (RB -1, WR +1): passes
      expect(
        evaluateGradeImpacts(
          {
            own: [],
            other: [
              { position: "RB", before: "B", after: "B−", drop: 1, stepDelta: -1 },
              { position: "WR", before: "C", after: "C+", drop: 0, stepDelta: 1 },
            ],
          },
          [limitRule],
        ).passes,
      ).toBe(true);

      // Net -2 steps (RB -2, WR 0): fails
      const fail = evaluateGradeImpacts(
        {
          own: [],
          other: [
            { position: "RB", before: "B", after: "C+", drop: 2, stepDelta: -2 },
            { position: "WR", before: "C", after: "C", drop: 0, stepDelta: 0 },
          ],
        },
        [limitRule],
      );
      expect(fail.passes).toBe(false);
      expect(fail.failures[0]).toContain("overall");
    });

    it("evaluates other team matching your overall net step improvement (type: 'match_net')", () => {
      const matchRule: PositionalGradeImpactRule = {
        id: "match-overall-steps",
        side: "other",
        position: "OVERALL",
        steps: 0,
        type: "match_net",
      };

      // Both gain +2 net steps: passes
      const equalGain = evaluateGradeImpacts(
        {
          own: [
            { position: "TE", before: "B", after: "A", drop: 0, stepDelta: 2 },
          ],
          other: [
            { position: "RB", before: "C", after: "B-", drop: 0, stepDelta: 2 },
          ],
        },
        [matchRule],
        "Chorizo",
      );
      expect(equalGain.passes).toBe(true);
      expect(equalGain.failures).toHaveLength(0);

      // Both net 0 steps: passes
      const equalZero = evaluateGradeImpacts(
        {
          own: [
            { position: "TE", before: "B", after: "A", drop: 0, stepDelta: 2 },
            { position: "WR", before: "A", after: "B", drop: 2, stepDelta: -2 },
          ],
          other: [
            { position: "RB", before: "C", after: "B-", drop: 0, stepDelta: 2 },
            { position: "TE", before: "B", after: "C", drop: 2, stepDelta: -2 },
          ],
        },
        [matchRule],
        "Chorizo",
      );
      expect(equalZero.passes).toBe(true);

      // Mismatch: we gain +2, they gain +1: fails
      const mismatch = evaluateGradeImpacts(
        {
          own: [
            { position: "TE", before: "B", after: "A", drop: 0, stepDelta: 2 },
          ],
          other: [
            { position: "RB", before: "C", after: "C+", drop: 0, stepDelta: 1 },
          ],
        },
        [matchRule],
        "Chorizo",
      );
      expect(mismatch.passes).toBe(false);
      expect(mismatch.failures[0]).toContain(
        "Chorizo overall step delta (+1) does not match your overall step delta (+2)",
      );
    });
  });
});
