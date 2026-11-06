import { describe, it, expect } from "vitest";
import { fairChainFixture } from "./chain-fixture";
import { evaluate } from "../src/domain/valuation";
import {
  chainErrors,
  searchTradeChains,
  type ChainQuery,
} from "../src/domain/trade-chains";
import type { PositionalGradeImpactRule } from "../src/domain/chain-position-impact";

describe("Chain planner positional grade impact integration", () => {
  async function setupFixture() {
    const d = await fairChainFixture();
    const m = evaluate(d, d.settings);
    const baseQuery: ChainQuery = {
      team: "1",
      pool: ["3", "8", "9"],
      mode: "both",
      maximumLoss: 3,
      minimumGain: 5,
      basis: "best-available",
      depth: "standard",
      first: {
        offer: { minimum: 1, maximum: 1 },
        receive: { minimum: 1, maximum: 1 },
        teams: ["2"],
      },
      second: {
        offer: { minimum: 2, maximum: 2 },
        receive: { minimum: 1, maximum: 1 },
        teams: ["3"],
      },
    };
    return { m, baseQuery };
  }

  it("preserves identical search results when gradeImpacts is omitted", async () => {
    const { m, baseQuery } = await setupFixture();
    const result = searchTradeChains(m, baseQuery);

    expect(result.chains.length).toBeGreaterThanOrEqual(2);
    expect(result.stats.rejectedGrades ?? 0).toBe(0);
  });

  it("filters Step 1 candidates with first.gradeImpacts and tracks rejectedGrades and plausibilityRejections", async () => {
    const { m, baseQuery } = await setupFixture();

    // In the fixture, giving TE 9 results in a TE downgrade for Team 1,
    // whereas giving RB 3 protects TE (stepDelta = 0).
    const protectTeRule: PositionalGradeImpactRule = {
      id: "protect-te",
      side: "own",
      position: "TE",
      steps: 0, // No drop allowed in TE
    };

    const queryWithGradeImpact: ChainQuery = {
      ...baseQuery,
      first: {
        ...baseQuery.first,
        gradeImpacts: [protectTeRule],
      },
    };

    const unfilteredResult = searchTradeChains(m, baseQuery);
    const filteredResult = searchTradeChains(m, queryWithGradeImpact);

    // Candidates that downgraded TE should be filtered out from Step 1
    expect(filteredResult.chains.length).toBeGreaterThan(0);
    expect(filteredResult.chains.length).toBeLessThan(unfilteredResult.chains.length);
    for (const chain of filteredResult.chains) {
      expect(chain.first.draft.give).not.toContain("9");
      expect(chain.first.draft.give).toContain("3");
    }

    // Rejected candidates increment rejectedGrades and record in plausibilityRejections
    expect(filteredResult.stats.rejectedGrades).toBeGreaterThan(0);
    const step1Rejections = filteredResult.plausibilityRejections.filter(
      (r) => r.step === 1,
    );
    expect(step1Rejections.length).toBeGreaterThan(0);
    expect(
      step1Rejections.some((r) => r.failures.some((f) => f.includes("TE"))),
    ).toBe(true);
  });

  it("rejects all Step 1 candidates when an unsatisfiable gradeImpact is specified", async () => {
    const { m, baseQuery } = await setupFixture();

    const impossibleRule: PositionalGradeImpactRule = {
      id: "impossible-qb",
      side: "own",
      position: "RB",
      steps: 8, // Upgrade RB by 8 steps (impossible)
    };

    const queryWithImpossibleRule: ChainQuery = {
      ...baseQuery,
      first: {
        ...baseQuery.first,
        gradeImpacts: [impossibleRule],
      },
    };

    const result = searchTradeChains(m, queryWithImpossibleRule);
    expect(result.chains.length).toBe(0);
    expect(result.stats.rejectedGrades).toBeGreaterThan(0);
    expect(
      result.plausibilityRejections.some(
        (r) => r.step === 1 && r.failures.some((f) => f.includes("RB")),
      ),
    ).toBe(true);
  });

  it("filters Step 2 candidates with second.gradeImpacts after Stage 1 roster updates", async () => {
    const { m, baseQuery } = await setupFixture();

    // In step 2, receiving WR 5 upgrades WR.
    const upgradeWrRule: PositionalGradeImpactRule = {
      id: "step2-wr-upgrade",
      side: "own",
      position: "WR",
      steps: 1, // Upgrade WR by at least 1 step
    };

    const queryPassingStep2: ChainQuery = {
      ...baseQuery,
      second: {
        ...baseQuery.second,
        gradeImpacts: [upgradeWrRule],
      },
    };

    const passResult = searchTradeChains(m, queryPassingStep2);
    expect(passResult.chains.length).toBeGreaterThan(0);
    for (const chain of passResult.chains) {
      expect(chain.second.positionImpact).toBeDefined();
      const wrImpact = chain.second.positionImpact!.own.find(
        (p) => p.position === "WR",
      );
      expect(wrImpact).toBeDefined();
      expect(wrImpact!.stepDelta).toBeGreaterThanOrEqual(1);
    }

    // Now test a Step 2 rule that cannot be satisfied
    const impossibleStep2Rule: PositionalGradeImpactRule = {
      id: "step2-impossible-rb",
      side: "own",
      position: "RB",
      steps: 8,
    };

    const queryFailingStep2: ChainQuery = {
      ...baseQuery,
      second: {
        ...baseQuery.second,
        gradeImpacts: [impossibleStep2Rule],
      },
    };

    const failResult = searchTradeChains(m, queryFailingStep2);
    expect(failResult.chains.length).toBe(0);
    expect(failResult.stats.rejectedGrades).toBeGreaterThan(0);
    const step2Rejections = failResult.plausibilityRejections.filter(
      (r) => r.step === 2,
    );
    expect(step2Rejections.length).toBeGreaterThan(0);
    expect(
      step2Rejections.some((r) => r.failures.some((f) => f.includes("RB"))),
    ).toBe(true);
  });

  it("validates step.gradeImpacts in chainErrors", async () => {
    const { m, baseQuery } = await setupFixture();

    // Valid rules pass
    const validQuery: ChainQuery = {
      ...baseQuery,
      first: {
        ...baseQuery.first,
        gradeImpacts: [
          { id: "1", side: "own", position: "WR", steps: 1 },
          { id: "2", side: "other", position: "RB", steps: -2 },
        ],
      },
    };
    expect(chainErrors(m, validQuery)).toEqual([]);

    // Invalid side on first step
    const badSideQuery: ChainQuery = {
      ...baseQuery,
      first: {
        ...baseQuery.first,
        gradeImpacts: [
          { id: "1", side: "invalid" as any, position: "WR", steps: 1 },
        ],
      },
    };
    const badSideErrors = chainErrors(m, badSideQuery);
    expect(badSideErrors.some((e) => e.includes("First trade"))).toBe(true);

    // Invalid position (empty string) on second step
    const badPosQuery: ChainQuery = {
      ...baseQuery,
      second: {
        ...baseQuery.second,
        gradeImpacts: [
          { id: "1", side: "own", position: "   ", steps: 1 },
        ],
      },
    };
    const badPosErrors = chainErrors(m, badPosQuery);
    expect(badPosErrors.some((e) => e.includes("Second trade"))).toBe(true);

    // Non-integer steps on first step
    const badStepsQuery: ChainQuery = {
      ...baseQuery,
      first: {
        ...baseQuery.first,
        gradeImpacts: [
          { id: "1", side: "own", position: "WR", steps: 1.5 },
        ],
      },
    };
    const badStepsErrors = chainErrors(m, badStepsQuery);
    expect(badStepsErrors.some((e) => e.includes("First trade"))).toBe(true);
  });
});
