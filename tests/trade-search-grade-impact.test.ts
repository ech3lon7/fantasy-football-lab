import { describe, it, expect } from "vitest";
import { tradeSearchFixture } from "./fixtures";
import { evaluate } from "../src/domain/valuation";
import { withoutByeWeeks } from "../src/domain/lineups";
import {
  scoreTradeMatch,
  type SearchMatch,
  type TradeSearchQuery,
} from "../src/domain/trade-search";
import type { PositionalGradeImpactRule } from "../src/domain/chain-position-impact";

describe("Trade search positional grade impact integration", () => {
  async function setupModel() {
    const d = await tradeSearchFixture();
    const m = withoutByeWeeks(evaluate(d, d.settings));
    return m;
  }

  it("populates SearchRow.positionImpact and accepts trades meeting upgrade targets", async () => {
    const m = await setupModel();

    // Team 1 gives QB 101 to Team 2 for WR 300
    const match: SearchMatch = {
      key: "trade-wr",
      teamB: "2",
      give: ["101"],
      get: ["300"],
      incoming: m.byId.get("300")!.index!,
      outgoing: m.byId.get("101")!.index!,
      difference: m.byId.get("300")!.index! - m.byId.get("101")!.index!,
    };

    const wrUpgradeRule: PositionalGradeImpactRule = {
      id: "wr-upgrade",
      side: "own",
      position: "WR",
      steps: 2,
    };

    const queryWithUpgrade: TradeSearchQuery = {
      teamA: "1",
      give: ["101"],
      count: 1,
      below: 1000,
      above: 1000,
      indexMode: "automatic",
      gradeImpacts: [wrUpgradeRule],
    };

    const row = scoreTradeMatch(m, queryWithUpgrade, match);

    // Trade should pass and return row
    expect(row).not.toBeNull();
    // positionImpact must be populated
    expect(row!.positionImpact).toBeDefined();
    const wrImpact = row!.positionImpact!.own.find((p) => p.position === "WR");
    expect(wrImpact).toBeDefined();
    expect(wrImpact!.stepDelta).toBeGreaterThanOrEqual(2);
  });

  it("rejects candidate trades that do not achieve the specified upgrade target", async () => {
    const m = await setupModel();

    // Team 1 gives QB 101 to Team 2 for QB 200 (does not upgrade WR at all; WR stepDelta = 0)
    const matchQb: SearchMatch = {
      key: "trade-qb",
      teamB: "2",
      give: ["101"],
      get: ["200"],
      incoming: m.byId.get("200")!.index!,
      outgoing: m.byId.get("101")!.index!,
      difference: m.byId.get("200")!.index! - m.byId.get("101")!.index!,
    };

    const wrUpgradeRule: PositionalGradeImpactRule = {
      id: "wr-upgrade",
      side: "own",
      position: "WR",
      steps: 2,
    };

    const queryWithUpgrade: TradeSearchQuery = {
      teamA: "1",
      give: ["101"],
      count: 1,
      below: 1000,
      above: 1000,
      indexMode: "automatic",
      gradeImpacts: [wrUpgradeRule],
    };

    // When nearMisses is not enabled, scoreTradeMatch should return null for failed candidates
    const rejectedRow = scoreTradeMatch(m, queryWithUpgrade, matchQb);
    expect(rejectedRow).toBeNull();

    // When nearMisses is enabled, candidate is retained with nearMiss explanation
    const queryWithNearMisses: TradeSearchQuery = {
      ...queryWithUpgrade,
      discovery: { nearMisses: true },
    };
    const nearMissRow = scoreTradeMatch(m, queryWithNearMisses, matchQb);
    expect(nearMissRow).not.toBeNull();
    expect(nearMissRow!.nearMiss).toBeDefined();
    expect(nearMissRow!.nearMiss!.reasons.some((r) => r.includes("WR"))).toBe(true);
    expect(nearMissRow!.nearMiss!.distance).toBeGreaterThanOrEqual(1);
    expect(nearMissRow!.positionImpact).toBeDefined();
  });

  it("allows trades where drop budget position is untouched (0 >= -1) but rejects trades exceeding budget", async () => {
    const m = await setupModel();

    const rbBudgetRule: PositionalGradeImpactRule = {
      id: "rb-budget",
      side: "own",
      position: "RB",
      steps: -1, // Drop at most 1 grade step
    };

    // Trade 1: Team 1 gives QB 101 for WR 300. RB is untouched (stepDelta = 0 >= -1).
    const matchUntouched: SearchMatch = {
      key: "trade-untouched-rb",
      teamB: "2",
      give: ["101"],
      get: ["300"],
      incoming: m.byId.get("300")!.index!,
      outgoing: m.byId.get("101")!.index!,
      difference: m.byId.get("300")!.index! - m.byId.get("101")!.index!,
    };

    const queryRbBudget: TradeSearchQuery = {
      teamA: "1",
      give: ["101"],
      count: 1,
      below: 1000,
      above: 1000,
      indexMode: "automatic",
      gradeImpacts: [rbBudgetRule],
    };

    const passedRow = scoreTradeMatch(m, queryRbBudget, matchUntouched);
    expect(passedRow).not.toBeNull();
    const rbImpact = passedRow!.positionImpact!.own.find((p) => p.position === "RB");
    expect(rbImpact).toBeDefined();
    expect(rbImpact!.stepDelta).toBe(0);

    // Trade 2: Team 1 gives their only starting RB (1) for WR 300.
    // RB drops dramatically (> 1 step drop, so stepDelta < -1).
    const matchDropRb: SearchMatch = {
      key: "trade-drop-rb",
      teamB: "2",
      give: ["1"],
      get: ["300"],
      incoming: m.byId.get("300")!.index!,
      outgoing: m.byId.get("1")!.index!,
      difference: m.byId.get("300")!.index! - m.byId.get("1")!.index!,
    };

    const queryGiveRb: TradeSearchQuery = {
      ...queryRbBudget,
      give: ["1"],
    };

    const failedRow = scoreTradeMatch(m, queryGiveRb, matchDropRb);
    expect(failedRow).toBeNull();
  });

  it("leaves search behavior completely unchanged when gradeImpacts is absent or empty", async () => {
    const m = await setupModel();

    const match: SearchMatch = {
      key: "trade-standard",
      teamB: "2",
      give: ["101"],
      get: ["200"],
      incoming: m.byId.get("200")!.index!,
      outgoing: m.byId.get("101")!.index!,
      difference: m.byId.get("200")!.index! - m.byId.get("101")!.index!,
    };

    const baseQuery: TradeSearchQuery = {
      teamA: "1",
      give: ["101"],
      count: 1,
      below: 1000,
      above: 1000,
      indexMode: "automatic",
    };

    const rowWithoutGradeImpacts = scoreTradeMatch(m, baseQuery, match);
    const rowWithEmptyGradeImpacts = scoreTradeMatch(m, { ...baseQuery, gradeImpacts: [] }, match);

    expect(rowWithoutGradeImpacts).not.toBeNull();
    expect(rowWithEmptyGradeImpacts).not.toBeNull();
    expect(rowWithoutGradeImpacts!.grade).toEqual(rowWithEmptyGradeImpacts!.grade);
    expect(rowWithoutGradeImpacts!.own).toEqual(rowWithEmptyGradeImpacts!.own);
    expect(rowWithoutGradeImpacts!.other).toEqual(rowWithEmptyGradeImpacts!.other);
  });

  it("filters candidate trades to only those satisfying all gradeImpacts rules", async () => {
    const m = await setupModel();

    // We have two candidate matches: one gets WR 300, one gets QB 200
    const matchWr: SearchMatch = {
      key: "match-wr",
      teamB: "2",
      give: ["101"],
      get: ["300"],
      incoming: m.byId.get("300")!.index!,
      outgoing: m.byId.get("101")!.index!,
      difference: m.byId.get("300")!.index! - m.byId.get("101")!.index!,
    };
    const matchQb: SearchMatch = {
      key: "match-qb",
      teamB: "2",
      give: ["101"],
      get: ["200"],
      incoming: m.byId.get("200")!.index!,
      outgoing: m.byId.get("101")!.index!,
      difference: m.byId.get("200")!.index! - m.byId.get("101")!.index!,
    };

    const query: TradeSearchQuery = {
      teamA: "1",
      give: ["101"],
      count: 1,
      below: 1000,
      above: 1000,
      indexMode: "automatic",
      gradeImpacts: [
        { id: "wr-upgrade", side: "own", position: "WR", steps: 2 },
      ],
    };

    const candidates = [matchWr, matchQb];
    const scoredRows = candidates
      .map((c) => scoreTradeMatch(m, query, c))
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Only the WR trade satisfies the WR upgrade rule
    expect(scoredRows).toHaveLength(1);
    expect(scoredRows[0].get).toEqual(["300"]);
    expect(scoredRows[0].positionImpact).toBeDefined();
  });
});
