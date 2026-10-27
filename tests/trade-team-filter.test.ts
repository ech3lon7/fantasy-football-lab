import { expect, it } from "vitest";
import { initialState } from "../src/domain/contracts";
import { evaluate } from "../src/domain/valuation";
import { fromTables } from "../src/import/workbook";
import { tradeSearchFixture } from "./fixtures";
import {
  findDiscoveryMatches,
  discoveryFailures,
} from "../src/domain/trade-discovery";
import {
  scoreTradeMatch,
  tradeSearchBounds,
  tradeSearchContext,
  type TradeSearchQuery,
} from "../src/domain/trade-search";
import {
  guidedQuery,
  recoveryQueries,
  findTradeRecoveries,
} from "../src/domain/trade-guidance";
import {
  readSavedTrades,
  saveTrade,
  summaryFromSearch,
} from "../src/domain/saved-trades";
import { diagnoseTradeCandidate } from "../src/domain/trade-tools";

// Four synthetic owners exercise subsets without changing the existing shared two-team fixtures.
async function sample() {
  const d = await tradeSearchFixture();
  d.tables.ModelContext[0].TeamCount = 4;
  for (const team of [3, 4]) {
    d.tables.ModelTeams.push({ TeamID: team, TeamName: `Test ${team}` });
    for (const baseID of [200, 2]) {
      const id = team * 1000 + baseID;
      const base = d.tables.ModelPlayers.find((p) => p.PlayerID === baseID)!;
      d.tables.ModelPlayers.push({
        ...base,
        PlayerID: id,
        Player: `Team ${team} ${base.Position}`,
        OnTeamID: team,
      });
      d.tables.ModelHistory.push(
        ...d.tables.ModelHistory.filter((h) => h.PlayerID === baseID).map(
          (h) => ({ ...h, PlayerID: id }),
        ),
      );
      d.tables.ModelRosters.push({
        PlayerID: id,
        TeamID: team,
        LineupSlotID: baseID === 200 ? 0 : 4,
      });
    }
  }
  const dataset = await fromTables(d.tables, d.settings);
  const m = evaluate(dataset, dataset.settings);
  const q: TradeSearchQuery = {
    teamA: "1",
    give: ["101"],
    count: 1,
    below: 5,
    above: 5,
    indexMode: "automatic",
    discovery: {
      receive: { minimum: 1, maximum: 2 },
      flexible: { pool: ["100", "101"], minimum: 1, maximum: 2 },
    },
  };
  return { dataset, m, q };
}

// Scoping owners must be equivalent to filtering the unmodified complete search, including flexible offers and incoming packages.
it("searches only chosen opponents and keeps every matching package and scoring value", async () => {
  const { m, q } = await sample();
  const all = findDiscoveryMatches(m, q).matches;
  expect(new Set(all.map((row) => row.teamB))).toEqual(
    new Set(["2", "3", "4"]),
  );
  const scoped = { ...q, discovery: { ...q.discovery, teams: ["3", "4"] } };
  const matches = findDiscoveryMatches(m, scoped).matches;
  expect(matches).toEqual(all.filter((row) => ["3", "4"].includes(row.teamB)));
  expect(matches.some((row) => row.get.length === 1)).toBe(true);
  expect(matches.some((row) => row.get.length === 2)).toBe(true);
  expect(matches.some((row) => row.give?.length === 2)).toBe(true);
  for (const match of matches)
    expect(scoreTradeMatch(m, scoped, match)).toEqual(
      scoreTradeMatch(m, q, match),
    );
  expect(tradeSearchContext(m, scoped)).not.toBe(tradeSearchContext(m, q));
});

// Empty, stale/self and duplicate scopes never fall back to everybody; conflicting targets have a clear error.
it("rejects invalid team scopes and a target on an excluded owner", async () => {
  const { m, q } = await sample();
  for (const teams of [[], ["1"], ["0"], ["missing"], ["3", "3"]]) {
    const invalid = { ...q, discovery: { ...q.discovery, teams } };
    expect(tradeSearchBounds(m, invalid).errors.join()).toContain(
      "opposing fantasy team",
    );
    expect(() => findDiscoveryMatches(m, invalid)).toThrow();
  }
  const invalidTarget = { ...q, discovery: { teams: ["3"], target: "4200" } };
  expect(tradeSearchBounds(m, invalidTarget).errors.join()).toContain(
    "excluded team",
  );
  expect(
    findDiscoveryMatches(m, {
      ...q,
      discovery: { teams: ["3"], target: "3200" },
    }).matches.every((row) => row.teamB === "3" && row.get.includes("3200")),
  ).toBe(true);
});

// Saved searches, presets, near misses and exact recovery previews all retain the user's opponent restriction.
it("preserves opponent scope through saves, presets, recovery and candidate diagnostics", async () => {
  const { dataset, m, q } = await sample();
  const scoped = {
    ...q,
    discovery: { ...q.discovery, teams: ["3"], nearMisses: true },
    weekly: { own: { minimum: 100, maximum: null } },
  };
  expect(guidedQuery(scoped, "improve").discovery?.teams).toEqual(["3"]);
  for (const option of recoveryQueries(scoped))
    expect(option.query.discovery?.teams).toEqual(["3"]);
  expect(
    findDiscoveryMatches(m, scoped).matches.every((row) => row.teamB === "3"),
  ).toBe(true);
  for (const option of findTradeRecoveries(m, scoped)) {
    expect(option.query.discovery?.teams).toEqual(["3"]);
    const exact = findDiscoveryMatches(m, option.query)
      .matches.map((match) => scoreTradeMatch(m, option.query, match))
      .filter((row) => !discoveryFailures(row, option.query).length);
    expect(option.count).toBe(exact.length);
  }
  const match = findDiscoveryMatches(m, scoped).matches[0];
  const draft = {
    teamA: "1",
    teamB: "3",
    give: match.give ?? q.give,
    get: match.get,
  };
  const raw = saveTrade(
    initialState(dataset),
    m,
    draft,
    summaryFromSearch(scoreTradeMatch(m, scoped, match)),
    scoped,
  );
  expect(readSavedTrades(raw).trades[0].query?.discovery?.teams).toEqual(["3"]);
  expect(
    diagnoseTradeCandidate(
      m,
      { ...q, discovery: { teams: ["2"] } },
      draft,
    ).reasons.join(),
  ).toContain("excluded by Teams to search");
});
