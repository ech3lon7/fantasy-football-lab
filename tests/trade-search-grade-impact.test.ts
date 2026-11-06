import { describe, it, expect } from "vitest";
import { tradeSearchFixture } from "./fixtures";
import { evaluate } from "../src/domain/valuation";
import { withoutByeWeeks } from "../src/domain/lineups";
import {
  scoreTradeMatch,
  type SearchMatch,
  type TradeSearchQuery,
} from "../src/domain/trade-search";
import { discoveryFailures } from "../src/domain/trade-discovery";
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

    // positionImpact must be populated on the scored row
    expect(row.positionImpact).toBeDefined();
    const wrImpact = row.positionImpact!.own.find((p) => p.position === "WR");
    expect(wrImpact).toBeDefined();
    expect(wrImpact!.stepDelta).toBeGreaterThanOrEqual(2);

    // Candidate trade satisfies the grade impact rule
    const failures = discoveryFailures(row, queryWithUpgrade);
    expect(failures).toEqual([]);
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

    const row = scoreTradeMatch(m, queryWithUpgrade, matchQb);
    expect(row.positionImpact).toBeDefined();

    // discoveryFailures reports the unmet WR upgrade requirement
    const failures = discoveryFailures(row, queryWithUpgrade);
    expect(failures.some((r) => r.includes("WR"))).toBe(true);
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
    const rbImpact = passedRow.positionImpact!.own.find((p) => p.position === "RB");
    expect(rbImpact).toBeDefined();
    expect(rbImpact!.stepDelta).toBe(0);
    expect(discoveryFailures(passedRow, queryRbBudget)).toEqual([]);

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
    const failures = discoveryFailures(failedRow, queryGiveRb);
    expect(failures.some((r) => r.includes("RB"))).toBe(true);
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

    expect(rowWithoutGradeImpacts.positionImpact).toBeUndefined();
    expect(rowWithEmptyGradeImpacts.positionImpact).toBeUndefined();
    expect(rowWithoutGradeImpacts.grade).toEqual(rowWithEmptyGradeImpacts.grade);
    expect(rowWithoutGradeImpacts.own).toEqual(rowWithEmptyGradeImpacts.own);
    expect(rowWithoutGradeImpacts.other).toEqual(rowWithEmptyGradeImpacts.other);
    expect(discoveryFailures(rowWithoutGradeImpacts, baseQuery)).toEqual(
      discoveryFailures(rowWithEmptyGradeImpacts, { ...baseQuery, gradeImpacts: [] }),
    );
  });

  it("filters candidate trades to only those satisfying all gradeImpacts rules", async () => {
    const m = await setupModel();

    // Two candidate matches: one gets WR 300, one gets QB 200
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
      .filter((r) => discoveryFailures(r, query).length === 0);

    // Only the WR trade satisfies the WR upgrade rule
    expect(scoredRows).toHaveLength(1);
    expect(scoredRows[0].get).toEqual(["300"]);
    expect(scoredRows[0].positionImpact).toBeDefined();
  });

  it("evaluates side: 'other' rules to filter candidates based on opponent positional grade impact", async () => {
    const m = await setupModel();

    // Trade 1: Team 1 gives QB 101 (Bench QB, 30 PPG) to Team 2 for WR 300.
    // Team 2 upgrades their QB position.
    const matchGiveQb: SearchMatch = {
      key: "trade-give-qb",
      teamB: "2",
      give: ["101"],
      get: ["300"],
      incoming: m.byId.get("300")!.index!,
      outgoing: m.byId.get("101")!.index!,
      difference: m.byId.get("300")!.index! - m.byId.get("101")!.index!,
    };

    // Scenario A: Opponent upgrade requirement (Team 2 must upgrade QB by at least 1 step)
    const opponentUpgradeQuery: TradeSearchQuery = {
      teamA: "1",
      give: ["101"],
      count: 1,
      below: 1000,
      above: 1000,
      indexMode: "automatic",
      gradeImpacts: [
        { id: "opp-qb-upgrade", side: "other", position: "QB", steps: 1 },
      ],
    };

    // Trade giving QB 101 upgrades Team 2's QB
    const rowUpgrade = scoreTradeMatch(m, opponentUpgradeQuery, matchGiveQb);
    expect(rowUpgrade.positionImpact).toBeDefined();
    const oppQbImpact = rowUpgrade.positionImpact!.other.find((p) => p.position === "QB");
    expect(oppQbImpact).toBeDefined();
    expect(oppQbImpact!.stepDelta).toBeGreaterThanOrEqual(1);
    expect(discoveryFailures(rowUpgrade, opponentUpgradeQuery)).toEqual([]);

    // Trade giving RB 1 does not upgrade Team 2's QB (stepDelta is 0 < 1)
    const matchGiveRb: SearchMatch = {
      key: "trade-give-rb",
      teamB: "2",
      give: ["1"],
      get: ["300"],
      incoming: m.byId.get("300")!.index!,
      outgoing: m.byId.get("1")!.index!,
      difference: m.byId.get("300")!.index! - m.byId.get("1")!.index!,
    };
    const queryGiveRb: TradeSearchQuery = {
      ...opponentUpgradeQuery,
      give: ["1"],
    };
    const rowNoOpponentUpgrade = scoreTradeMatch(m, queryGiveRb, matchGiveRb);
    expect(rowNoOpponentUpgrade.positionImpact).toBeDefined();
    const failures = discoveryFailures(rowNoOpponentUpgrade, queryGiveRb);
    expect(failures.some((r) => r.includes("QB") && r.includes("Their"))).toBe(true);
  });
});
