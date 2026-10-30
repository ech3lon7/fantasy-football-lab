import { expect, it } from "vitest";
import { surfaceFixture } from "./surface-fixture";
import { evaluate } from "../src/domain/valuation";
import { evaluateTrade } from "../src/domain/trades";
import {
  surfaceAppeal,
  surfaceFailures,
  type SurfaceFilter,
} from "../src/domain/surface-appeal";
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
import { guidedQuery, recoveryQueries } from "../src/domain/trade-guidance";
import { applyRosterScenario } from "../src/domain/roster-scenarios";
import { initialState } from "../src/domain/contracts";
import {
  readSavedTrades,
  saveTrade,
  summaryFromSearch,
} from "../src/domain/saved-trades";
import { fromTables } from "../src/import/workbook";

// Score a fixed source-disagreement trade through the same discovery entry points used by the worker and diagnostics.
async function sample() {
  const d = await surfaceFixture(),
    m = evaluate(d, d.settings);
  const q: TradeSearchQuery = {
    teamA: "1",
    give: ["1"],
    count: 1,
    below: 0,
    above: 0,
    indexMode: "automatic",
    discovery: { teams: ["2"] },
    surface: { metric: "both", minimum: 0, requireValueTests: false },
  };
  const match = findDiscoveryMatches(m, q).matches.find((r) =>
    r.get.includes("2"),
  )!;
  return {
    d,
    m,
    q,
    match,
    draft: { teamA: "1", teamB: "2", give: ["1"], get: ["2"] },
  };
}

// A source-based match can disagree with modeled recipient scoring and both asking-price tests without changing the model numbers.
it.each(["best-available", "marked-starters"] as const)(
  "keeps surface gains independent from modeled gains and optional value gates under %s",
  async (basis) => {
    const { m, q, match } = await sample();
    q.lineupBasis = basis;
    const source = JSON.stringify(m.players);
    const row = scoreTradeMatch(m, q, match);
    expect(row.own).toBeCloseTo(12.5);
    expect(row.other).toBeCloseTo(-2.5);
    expect(row.surplus).toBe("FAIL");
    expect(row.points).toBe("FAIL");
    expect(row.surface?.average).toMatchObject({
      before: 22,
      after: 30,
      gain: 8,
    });
    expect(row.surface?.projection).toMatchObject({
      before: 27,
      after: 30,
      gain: 3,
    });
    expect(discoveryFailures(row, q)).toEqual([]);
    expect(
      surfaceFailures(row, { ...q.surface!, requireValueTests: true }).join(
        " ",
      ),
    ).toMatch(/value tests/);
    const ordinary = scoreTradeMatch(m, { ...q, surface: undefined }, match);
    expect(ordinary.surface).toBeUndefined();
    expect(row.own).toBe(ordinary.own);
    expect(row.other).toBe(ordinary.other);
    expect(JSON.stringify(m.players)).toBe(source);
  },
);

// Two offered RBs cannot both count in one RB slot; passing a package's raw sum is not evidence of recipient lineup gain.
it("does not add unused bench points into apparent lineup gains", async () => {
  const { m, q, draft } = await sample();
  draft.give = ["1", "3"];
  const r = evaluateTrade(m, draft, false);
  const evidence = surfaceAppeal(m, draft, r, q.surface!);
  expect(evidence?.average.after).toBe(30);
  expect(evidence?.projection.after).toBe(30);
  expect(evidence?.average.afterIds.filter((id) => id !== null)).toEqual(["1"]);
});

// Missing eligible source data stays unavailable; choosing Average alone does not require missing projection evidence to pass.
it("distinguishes missing projection/history from genuine zero and negative source points", async () => {
  const { m, q, match } = await sample();
  m.byId.get("2")!.weekly = null;
  let row = scoreTradeMatch(m, q, match);
  expect(row.surface?.projection.gain).toBeNull();
  expect(row.surface?.projection.missing).toContain("2");
  expect(surfaceFailures(row, q.surface).join(" ")).toMatch(/unavailable/);
  expect(surfaceFailures(row, { ...q.surface!, metric: "average" })).toEqual(
    [],
  );
  // Use a fresh model because cached surface forks intentionally bind to immutable model snapshots.
  const d = await surfaceFixture();
  d.tables.ModelPlayers.find((p) => p.PlayerID === 2)!.Current_Week_Projection =
    0;
  const zero = evaluate(await fromTables(d.tables, d.settings), d.settings);
  row = scoreTradeMatch(zero, q, match);
  expect(row.surface?.projection.before).toBe(15);
  expect(row.surface?.projection.gain).toBe(15);
  d.tables.ModelPlayers.find((p) => p.PlayerID === 2)!.Current_Week_Projection =
    -2;
  const negative = evaluate(await fromTables(d.tables, d.settings), d.settings);
  row = scoreTradeMatch(negative, q, match);
  expect(row.surface?.projection.before).toBe(13);
  expect(row.surface?.projection.gain).toBe(17);
});

// A zero minimum still means a genuine improvement, while positive numeric thresholds are inclusive and no rounding changes eligibility.
it("enforces positive surface/model gains and threshold boundaries", async () => {
  const { m, q, match } = await sample();
  const row = scoreTradeMatch(m, q, match);
  expect(surfaceFailures(row, { ...q.surface!, minimum: 3 })).toEqual([]);
  expect(surfaceFailures(row, { ...q.surface!, minimum: 3.001 }).length).toBe(
    1,
  );
  expect(surfaceFailures(row, { ...q.surface!, minimum: 8.001 }).length).toBe(
    2,
  );
  expect(surfaceFailures({ ...row, own: 0 }, q.surface).join(" ")).toMatch(
    /positive modeled/,
  );
  expect(
    surfaceFailures({ ...row, legal: false }, q.surface).join(" "),
  ).toMatch(/legal/);
  const flat = {
    ...row,
    surface: { ...row.surface!, average: { ...row.surface!.average, gain: 0 } },
  };
  expect(surfaceFailures(flat, q.surface).join(" ")).toMatch(/positive gain/);
  expect(
    surfaceFailures(flat, { ...q.surface!, metric: "projection" }),
  ).toEqual([]);
});

// ESPN's matchup view keeps real byes even when the user's long-term hypothetical model ignores them.
it("separates bye-neutral averages from the imported week's real projection availability", async () => {
  const { d, q } = await sample();
  const p = d.tables.ModelPlayers.find((p) => p.PlayerID === 1)!;
  p.ProTeamID = 2;
  d.tables.ModelSchedule.push(
    ...d.tables.ModelSchedule.filter((s) => s.ProTeamID === 1).map((s) => ({
      ...s,
      ProTeamID: 2,
      HasGame: s.Week === 6 ? 0 : 1,
      ByeWeek: 6,
    })),
  );
  const data = await fromTables(d.tables, d.settings),
    real = evaluate(data, data.settings);
  const m = applyRosterScenario(real, {
    id: "surface",
    name: "Surface",
    team: "1",
    sourceHash: data.hash,
    season: 2026,
    moves: [],
    cursor: 0,
  });
  const match = findDiscoveryMatches(m, q).matches.find((r) =>
    r.get.includes("2"),
  )!;
  const row = scoreTradeMatch(m, q, match);
  expect(row.surface?.average.gain).toBe(8);
  expect(row.surface?.projection.after).toBe(15);
  expect(row.surface?.projection.gain).toBe(-12);
  expect(m.ignoreByeWeeks).toBe(true);
});

// Historical surface calculations remain auditable, but saved search restoration drops the retired restrictions.
it("retains historical calculations and removes retired saved-query restrictions", async () => {
  const { m, q, match, d, draft } = await sample();
  const preset = guidedQuery({ ...q, surface: undefined }, "surface");
  expect(preset.surface).toEqual(q.surface);
  expect(preset.weekly?.own?.minimum).toBe(1);
  expect(preset.weekly?.other).toBeUndefined();
  expect(preset.discovery?.ranking).toBe("own");
  expect(preset.indexMode).toBe("automatic");
  const row = scoreTradeMatch(m, q, match);
  const raw = saveTrade(initialState(d), m, draft, summaryFromSearch(row), q);
  expect(readSavedTrades(raw).trades[0].query?.surface).toBeUndefined();
  const invalid: SurfaceFilter = { ...q.surface!, minimum: NaN };
  expect(
    tradeSearchBounds(m, { ...q, surface: invalid }).errors.join(" "),
  ).toMatch(/surface/);
  expect(tradeSearchContext(m, q)).not.toBe(
    tradeSearchContext(m, { ...q, surface: undefined }),
  );
  expect(tradeSearchContext(m, q)).not.toBe(
    tradeSearchContext(m, { ...q, surface: invalid }),
  );
  for (const option of recoveryQueries({
    ...q,
    weekly: { own: { minimum: 20, maximum: null } },
  }))
    expect(option.query.surface).toEqual(q.surface);
  expect(guidedQuery(q, "explore").surface).toBeUndefined();
});
