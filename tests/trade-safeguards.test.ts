import { expect, it } from "vitest";
import { fairChainFixture } from "./chain-fixture";
import { fromTables } from "../src/import/workbook";
import { initialState, type Dataset } from "../src/domain/contracts";
import { evaluate } from "../src/domain/valuation";
import { evaluateTrade } from "../src/domain/trades";
import {
  scoreTradeMatch,
  tradeSearchBounds,
  tradeSearchContext,
  type TradeSearchQuery,
} from "../src/domain/trade-search";
import {
  discoveryFailures,
  findDiscoveryMatches,
} from "../src/domain/trade-discovery";
import {
  chainBudgets,
  chainErrors,
  evaluateChainLeg,
  searchTradeChains,
  type ChainQuery,
} from "../src/domain/trade-chains";
import {
  defaultDeficitProtection,
  deficitProtectionEvidence,
  deficitProtectionFailures,
} from "../src/domain/trade-safeguards";
import {
  readSavedTrades,
  saveTrade,
  summaryFromSearch,
} from "../src/domain/saved-trades";
import { guidedQuery } from "../src/domain/trade-guidance";

// Change synthetic scores consistently across aggregates, projections and weekly history so the real evaluator remains authoritative.
function setPoints(d: Dataset, id: number, points: number) {
  const p = d.tables.ModelPlayers.find((row) => row.PlayerID === id)!;
  Object.assign(p, {
    ActualPoints: points * 5,
    Actual_PPG: points,
    Last3_PPG: points,
    ScoreSD: 0,
    ESPN_Projected_PPG: points,
    ESPN_Projected_Total: points * 17,
    Current_Week_Projection: points,
  });
  d.tables.ModelHistory.filter((row) => row.PlayerID === id).forEach((row) => {
    row.Points = points;
  });
}

// The recipient's 21-point best WR is weak relative to the other two teams; our offered WR starts on our bench.
async function sample(points = 22, flex = false) {
  const d = await fairChainFixture();
  d.tables.ModelContext[0].BenchSlots = 20;
  d.tables.ModelContext[0].FlexSlots = flex ? 1 : 0;
  setPoints(d, 4, 40);
  setPoints(d, 5, 45);
  const player = d.tables.ModelPlayers.find((row) => row.PlayerID === 4)!;
  d.tables.ModelPlayers.push({
    ...player,
    PlayerID: 14,
    Player: "Offered WR",
    OnTeamID: 1,
  });
  d.tables.ModelHistory.push(
    ...d.tables.ModelHistory.filter((row) => row.PlayerID === 4).map((row) => ({
      ...row,
      PlayerID: 14,
    })),
  );
  d.tables.ModelRosters.push({ PlayerID: 14, TeamID: 1, LineupSlotID: 20 });
  setPoints(d, 14, points);
  const dataset = await fromTables(d.tables, d.settings);
  const m = evaluate(dataset, dataset.settings);
  const q: TradeSearchQuery = {
    teamA: "1",
    give: ["14"],
    count: 1,
    indexMode: "automatic",
    below: 5,
    above: 5,
    lineupBasis: "best-available",
    deficitProtection: { ...defaultDeficitProtection },
  };
  const draft = { teamA: "1", teamB: "2", give: q.give, get: ["2"] };
  const match = findDiscoveryMatches(m, q).matches.find(
    (row) => row.teamB === "2" && row.get.join() === "2",
  )!;
  return { d, m, q, draft, match };
}

// A modest best-player replacement fails even when a second offered player creates a large team-wide improvement.
it("requires net positional improvement, not total team gain or a weaker bench comparison", async () => {
  const { m, q, match } = await sample();
  const before = JSON.stringify(m.players);
  const row = scoreTradeMatch(
    m,
    { ...q, give: ["14", "3"] },
    { ...match, give: ["14", "3"] },
  )!;
  expect(row.other).toBeGreaterThan(2);
  expect(row.deficitProtection?.[0]).toMatchObject({
    position: "WR",
    grade: "F",
    before: 21,
    after: 22,
    gain: 1,
    minimum: 2,
  });
  expect(discoveryFailures(row, q)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("below the required +2.00"),
    ]),
  );
  expect(JSON.stringify(m.players)).toBe(before);
});

// The same positional rule applies to QB/RB/TE, without introducing position-specific forecast formulas.
it.each(["QB", "RB", "TE"] as const)(
  "protects the best %s on a deficit roster",
  async (position) => {
    const { d, q, draft } = await sample();
    for (const row of d.tables.ModelPlayers)
      if (row.Position === "WR") row.Position = position;
    d.tables.ModelContext[0].WRSlots = 0;
    d.tables.ModelContext[0][`${position}Slots`] = 1;
    const dataset = await fromTables(d.tables, d.settings),
      m = evaluate(dataset, dataset.settings);
    const result = evaluateTrade(m, draft, false);
    expect(
      deficitProtectionEvidence(m, draft, result, q.deficitProtection)[0],
    ).toMatchObject({ position, grade: "F", before: 21, after: 22, gain: 1 });
  },
);

// The inclusive +2 boundary passes without rounding; disabled protection preserves the pre-existing result.
it("accepts the exact adjustable boundary and permits disabling the safeguard", async () => {
  const { m, q, match } = await sample(23);
  const row = scoreTradeMatch(m, q, match)!;
  expect(row.deficitProtection?.[0].gain).toBeCloseTo(2, 10);
  expect(discoveryFailures(row, q)).toEqual([]);
  const stricter = {
    ...q,
    deficitProtection: { ...defaultDeficitProtection, minimum: 2.01 },
  };
  expect(
    discoveryFailures(scoreTradeMatch(m, stricter, match)!, stricter),
  ).not.toEqual([]);
  const off = {
    ...q,
    deficitProtection: { ...defaultDeficitProtection, enabled: false },
  };
  expect(scoreTradeMatch(m, off, match)!.deficitProtection).toBeUndefined();
  expect(discoveryFailures(scoreTradeMatch(m, off, match)!, off)).toEqual([]);
  expect(tradeSearchContext(m, q)).not.toBe(tradeSearchContext(m, off));
});

// Best-available positional strength cannot be bypassed by marking the recipient's best player as a reserve.
it("uses the best actual roster option for both scoring-basis selections", async () => {
  const { d, q, draft } = await sample();
  d.tables.ModelRosters.find((row) => row.PlayerID === 2)!.LineupSlotID = 20;
  d.tables.ModelRosters.find((row) => row.PlayerID === 10)!.LineupSlotID = 4;
  const dataset = await fromTables(d.tables, d.settings),
    m = evaluate(dataset, dataset.settings);
  for (const basis of ["best-available", "marked-starters"] as const) {
    const result = evaluateChainLeg(
      m,
      draft,
      basis,
      undefined,
      { maximumValueLossPct: 1, minimumGain: 0 },
      q.deficitProtection,
    );
    expect(result.leg.row.deficitProtection?.[0].gain).toBeCloseTo(1, 10);
    expect(
      deficitProtectionFailures(
        result.leg.row.deficitProtection,
        q.deficitProtection,
      ),
    ).not.toEqual([]);
  }
});

// Full-package evidence includes extra positional starters in FLEX and uses the evaluator's required-drop roster.
it("counts FLEX contributions after required drops and does not protect a spare as the best player", async () => {
  const { d, q, draft } = await sample(24, true);
  setPoints(d, 3, 23);
  d.tables.ModelPlayers.find((row) => row.PlayerID === 3)!.Position = "WR";
  d.tables.ModelContext[0].BenchSlots = 0;
  const dataset = await fromTables(d.tables, d.settings),
    m = evaluate(dataset, dataset.settings);
  const full = { ...draft, give: ["14", "3"] };
  const result = evaluateTrade(m, full, false);
  expect(result.valid).toBe(true);
  if (!result.valid) return;
  expect(result.dropsB.length).toBeGreaterThan(0);
  const evidence = deficitProtectionEvidence(m, full, result, {
    ...defaultDeficitProtection,
    minimum: 5,
  });
  expect(evidence[0]).toMatchObject({
    before: 41,
    after: 47,
    gain: 6,
    failure: null,
  });
  const spare = { ...draft, get: ["10"] };
  expect(
    deficitProtectionEvidence(
      m,
      spare,
      evaluateTrade(m, spare, false),
      q.deficitProtection,
    ),
  ).toEqual([]);
});

// Both chain legs validate independent controls and rejected best-player trades remain visible in rejection diagnostics.
it("enforces each chain leg and reports broader, explicit evaluation limits", async () => {
  const { m, q } = await sample();
  const chain: ChainQuery = {
    team: "1",
    pool: ["14"],
    mode: "both",
    maximumLoss: 50,
    minimumGain: 1,
    basis: "best-available",
    depth: "standard",
    pricePolicy: "warnings",
    recipient: { maximumValueLossPct: 1, minimumGain: 0 },
    first: {
      offer: { minimum: 1, maximum: 1 },
      receive: { minimum: 1, maximum: 1 },
      teams: ["2"],
      deficitProtection: q.deficitProtection,
    },
    second: {
      offer: { minimum: 1, maximum: 1 },
      receive: { minimum: 1, maximum: 1 },
      teams: ["3"],
      deficitProtection: { ...defaultDeficitProtection, minimum: 3 },
    },
  };
  const result = searchTradeChains(m, chain);
  expect(result.stats.rejectedDeficit).toBeGreaterThan(0);
  expect(
    result.plausibilityRejections.some((row) =>
      row.failures.some((reason) => reason.includes("required +2.00")),
    ),
  ).toBe(true);
  expect(result.stats.limits?.totalEvaluations).toBe(16000);
  expect(result.stats.evaluated).toBeLessThan(3200);
  expect(chainBudgets.deeper.first + chainBudgets.deeper.second).toBe(60000);
  expect(
    chainErrors(m, {
      ...chain,
      second: {
        ...chain.second,
        deficitProtection: { ...defaultDeficitProtection, minimum: NaN },
      },
    }),
  ).toEqual(expect.arrayContaining([expect.stringContaining("Second trade:")]));
});

// Saved-trade restoration and guided presets preserve the exact safeguard rather than dropping or weakening it.
it("persists safeguard settings and rejects unavailable evidence or invalid inputs", async () => {
  const { m, q, match, draft } = await sample(23);
  const row = scoreTradeMatch(m, q, match)!;
  const saved = saveTrade(
    initialState(m.dataset),
    m,
    draft,
    summaryFromSearch(row),
    q,
  );
  expect(readSavedTrades(saved).trades[0].query?.deficitProtection).toEqual(
    q.deficitProtection,
  );
  expect(guidedQuery(q, "improve").deficitProtection).toEqual(
    q.deficitProtection,
  );
  expect(deficitProtectionFailures(undefined, q.deficitProtection)).not.toEqual(
    [],
  );
  expect(
    tradeSearchBounds(m, {
      ...q,
      deficitProtection: { ...defaultDeficitProtection, minimum: 0 },
    }).errors,
  ).not.toEqual([]);
  expect(
    tradeSearchBounds(m, {
      ...q,
      deficitProtection: { ...defaultDeficitProtection, ceiling: "Z" },
    }).errors,
  ).not.toEqual([]);
});
