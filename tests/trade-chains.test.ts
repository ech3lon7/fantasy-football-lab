import { it, expect } from "vitest";
import { chainFixture } from "./chain-fixture";
import { evaluate } from "../src/domain/valuation";
import {
  advanceChainRoster,
  chainErrors,
  compareChains,
  evaluateChainLeg,
  searchTradeChains,
  type ChainQuery,
} from "../src/domain/trade-chains";
import {
  applyRosterScenario,
  sourceDataset,
} from "../src/domain/roster-scenarios";
import { initialState } from "../src/domain/contracts";
import {
  readSavedTrades,
  saveTrade,
  summaryFromSearch,
} from "../src/domain/saved-trades";
import { fromTables } from "../src/import/workbook";

// Fixed team scopes make the full two-step solution set small enough to verify by hand.
const query = (patch: Partial<ChainQuery> = {}): ChainQuery => ({
  team: "1",
  pool: ["1", "3"],
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
    offer: { minimum: 1, maximum: 1 },
    receive: { minimum: 1, maximum: 1 },
    teams: ["3"],
  },
  ...patch,
});

// Recompute the two known solutions with both scoring bases, including the exact intermediate baseline rather than adding unrelated deltas.
it.each(["best-available", "marked-starters"] as const)(
  "finds safe and speculative chains under %s with the correct final roster gain",
  async (basis) => {
    const d = await chainFixture(),
      m = evaluate(d, d.settings);
    const before = JSON.stringify(m.players);
    const result = searchTradeChains(m, query({ basis }));
    expect(result.chains).toHaveLength(2);
    expect(result.stats.limited).toBe(false);
    const [safe, speculative] = result.chains;
    expect([
      safe.mode,
      safe.before,
      safe.intermediate,
      safe.after,
      safe.gain,
    ]).toEqual(["safe", 40, 41, 50, 10]);
    expect([
      speculative.mode,
      speculative.before,
      speculative.intermediate,
      speculative.after,
      speculative.gain,
    ]).toEqual(["speculative", 40, 39, 48, 8]);
    for (const chain of result.chains) {
      expect(chain.second.row.ownBefore).toBeCloseTo(chain.first.row.ownAfter!);
      expect(chain.gain).toBeCloseTo(chain.after - chain.before);
      expect(chain.first.row.surplus).toBe("PASS");
      expect(chain.first.row.points).toBe("PASS");
      expect(chain.second.row.surplus).toBe("PASS");
      expect(chain.second.row.points).toBe("PASS");
      expect(chain.first.row.other).toBeLessThan(0);
      expect(chain.second.draft.give).toContain("2");
    }
    expect(JSON.stringify(m.players)).toBe(before);
  },
);

// Modes and both adjustable gain thresholds are enforced inclusively without rounding.
it("enforces safe/speculative selection, temporary loss and final-gain limits", async () => {
  const d = await chainFixture(),
    m = evaluate(d, d.settings);
  expect(
    searchTradeChains(m, query({ mode: "safe" })).chains.map((c) => c.mode),
  ).toEqual(["safe"]);
  expect(
    searchTradeChains(
      m,
      query({ mode: "speculative", maximumLoss: 1 }),
    ).chains.map((c) => c.mode),
  ).toEqual(["speculative"]);
  expect(
    searchTradeChains(m, query({ mode: "speculative", maximumLoss: 0.99 }))
      .chains,
  ).toHaveLength(0);
  expect(searchTradeChains(m, query({ minimumGain: 10 })).chains).toHaveLength(
    1,
  );
  expect(
    searchTradeChains(m, query({ minimumGain: 10.001 })).chains,
  ).toHaveLength(0);
});

// Ownership and both teams' required drops are applied to a copy; valuations and the refreshed free-agent baseline stay unchanged.
it("advances both rosters, preserves frozen values and availability, and excludes departed players", async () => {
  const d = await chainFixture(),
    m = evaluate(d, d.settings);
  const draft = { teamA: "1", teamB: "2", give: ["3"], get: ["2"] };
  const after = advanceChainRoster(m, draft);
  expect(after.byId.get("3")?.owner).toBe("2");
  expect(after.byId.get("2")?.owner).toBe("1");
  expect(m.byId.get("3")?.owner).toBe("1");
  expect(m.byId.get("2")?.owner).toBe("2");
  expect(after.ignoreByeWeeks).toBe(false);
  expect(after.ignoreTemporaryAbsences).toBe(false);
  expect(sourceDataset(after)).toBe(d);
  for (const player of after.players) {
    expect(player.index).toBe(m.byId.get(player.id)?.index);
    expect(player.baseline).toBe(m.byId.get(player.id)?.baseline);
    expect(player.expected).toBe(m.byId.get(player.id)?.expected);
  }
  expect(evaluateChainLeg(after, draft, "best-available").result.valid).toBe(
    false,
  );
  const hypo = applyRosterScenario(m, {
    id: "hypo",
    name: "Hypo",
    season: 2026,
    team: "1",
    sourceHash: d.hash,
    moves: [],
    cursor: 0,
  });
  expect(advanceChainRoster(hypo, draft).ignoreTemporaryAbsences).toBe(true);
});

// Unselected original players are protected from automatic required drops, even when the imported source starts over capacity.
it("rejects chains requiring a protected drop and reflects actual drops in a standalone transition", async () => {
  const d = await chainFixture();
  d.tables.ModelContext[0].BenchSlots = 0;
  const m = evaluate(await fromTables(d.tables, d.settings), d.settings);
  const result = searchTradeChains(m, query());
  expect(result.chains).toHaveLength(0);
  expect(result.stats.rejectedRoster).toBeGreaterThan(0);
  const draft = { teamA: "1", teamB: "2", give: ["3"], get: ["2"] };
  const scored = evaluateChainLeg(m, draft, "best-available");
  expect(scored.leg.row.dropsA).toContain("4");
  const after = advanceChainRoster(m, draft, undefined, scored.result);
  expect(after.byId.get("4")?.owner).toBe("0");
});

// A player need not be newly acquired to feature in the second offer; every original offer must still belong to the selected pool.
it("permits existing tradable players in step two and preserves manual team restrictions", async () => {
  const d = await chainFixture(),
    m = evaluate(d, d.settings);
  const result = searchTradeChains(m, query({ pool: ["1", "3", "4"] }));
  expect(result.chains.some((c) => c.second.draft.give.includes("4"))).toBe(
    true,
  );
  expect(
    result.chains.every(
      (c) => c.first.draft.teamB === "2" && c.second.draft.teamB === "3",
    ),
  ).toBe(true);
  expect(
    chainErrors(m, query({ second: { ...query().second, teams: [] } })).join(
      " ",
    ),
  ).toMatch(/opponent/);
  expect(chainErrors(m, query({ pool: ["1", "2"] })).join(" ")).toMatch(
    /owned/,
  );
});

// Reusing the same counterparty is legal; its second baseline includes everything it surrendered/received in the first trade.
it("allows the same counterparty for both trades", async () => {
  const d = await chainFixture();
  d.tables.ModelPlayers.find((p) => p.PlayerID === 5)!.OnTeamID = 2;
  d.tables.ModelRosters.find((p) => p.PlayerID === 5)!.TeamID = 2;
  const m = evaluate(await fromTables(d.tables, d.settings), d.settings);
  const result = searchTradeChains(
    m,
    query({ second: { ...query().second, teams: ["2"] } }),
  );
  const chain = result.chains.find(
    (c) => c.first.draft.get.includes("2") && c.second.draft.get.includes("5"),
  )!;
  expect(chain).toBeDefined();
  expect(chain.second.row.otherBefore).toBeCloseTo(chain.first.row.otherAfter!);
});

// A saved second leg contains a compact prerequisite, and restoring it keeps scheduled byes and the exact per-week marked roles.
it("round-trips a saved second step with week-specific marked starters and live bye rules", async () => {
  const d = await chainFixture();
  d.tables.ModelPlayers.find((p) => p.PlayerID === 1)!.ProTeamID = 2;
  d.tables.ModelSchedule.push(
    ...d.tables.ModelSchedule.filter((s) => s.ProTeamID === 1).map((s) => ({
      ...s,
      ProTeamID: 2,
      HasGame: s.Week === 8 ? 0 : 1,
      ByeWeek: 8,
    })),
  );
  const source = await fromTables(d.tables, d.settings),
    m = evaluate(source, source.settings);
  const chain = searchTradeChains(
    m,
    query({ mode: "safe", basis: "marked-starters" }),
  ).chains.find((c) => c.first.draft.give.includes("3"))!;
  expect(chain).toBeDefined();
  const after = applyRosterScenario(m, chain.afterFirst);
  const raw = saveTrade(
    initialState(source),
    after,
    chain.second.draft,
    summaryFromSearch(chain.second.row),
  );
  const saved = readSavedTrades(raw).trades[0];
  const restored = applyRosterScenario(
    evaluate(source, source.settings),
    saved.scenario,
  );
  const current = evaluateChainLeg(
    restored,
    saved.draft,
    "marked-starters",
    restored.simulation?.lineupsRaw,
  ).leg.row;
  expect(current.ownBefore).toBeCloseTo(chain.intermediate);
  expect(current.ownAfter).toBeCloseTo(chain.after);
  expect(current.own).toBeCloseTo(chain.second.row.own!);
  expect(restored.ignoreByeWeeks).toBe(false);
  expect(
    saved.scenario?.weeklyLineups?.find((p) => p.week === 8 && p.team === "1")
      ?.assignments[0],
  ).toBeNull();
});

// No unavailable score or zero/negative final target can be converted into an apparently definitive chain.
it("rejects missing data, invalid ranges, and nonpositive final targets", async () => {
  const d = await chainFixture(),
    m = evaluate(d, d.settings);
  expect(chainErrors(m, query({ maximumLoss: NaN })).length).toBeGreaterThan(0);
  expect(chainErrors(m, query({ minimumGain: 0 })).length).toBeGreaterThan(0);
  expect(
    chainErrors(
      m,
      query({ first: { ...query().first, offer: { minimum: 1, maximum: 6 } } }),
    ).length,
  ).toBeGreaterThan(0);
  m.byId.get("1")!.expected = null;
  expect(() => searchTradeChains(m, query())).toThrow(/usable/);
});

// Ranking and price failures remain independent: a desirable scoring move cannot bypass either strict asking-price test.
it("rejects failed price tests and ranks by final gain", async () => {
  const d = await chainFixture(),
    m = evaluate(d, d.settings);
  const rows = searchTradeChains(m, query()).chains;
  expect(compareChains(rows[0], rows[1])).toBeLessThan(0);
  m.byId.get("5")!.positive = 0;
  const result = searchTradeChains(m, query());
  expect(result.chains).toHaveLength(0);
  expect(result.stats.rejectedValue).toBeGreaterThan(0);
});

// Explicit later starter edits supersede the frozen chain checkpoint rather than leaving hidden weekly overrides active.
it("honors manual starter edits made after loading a chain prerequisite", async () => {
  const d = await chainFixture(),
    m = evaluate(d, d.settings);
  const draft = { teamA: "1", teamB: "2", give: ["3"], get: ["2"] };
  const intermediate = advanceChainRoster(m, draft);
  const recipe = intermediate.simulation!.scenario;
  const edited = applyRosterScenario(m, {
    ...recipe,
    moves: [
      ...recipe.moves,
      { kind: "lineup", team: "1", ids: ["1", "4"], assignments: ["1", "4"] },
    ],
    cursor: recipe.moves.length + 1,
  });
  const next = evaluateChainLeg(
    edited,
    { teamA: "1", teamB: "3", give: ["2"], get: ["5"] },
    "marked-starters",
    edited.simulation?.lineupsRaw,
  ).leg.row;
  expect(next.ownBefore).toBe(40);
  expect(next.ownAfter).toBe(50);
});

// All advertised package sizes reach actual price/lineup evaluation, including five-for-five packages.
it.each([1, 2, 3, 4, 5])(
  "supports %i-player outgoing and incoming packages",
  async (count) => {
    const d = await chainFixture();
    d.tables.ModelContext[0].BenchSlots = 20;
    const give = [800, 801, 802, 803, 804].slice(0, count);
    const get = [805, 806, 807, 808, 809].slice(0, count);
    for (const [ids, owner] of [
      [give, 1],
      [get, 2],
    ] as const) {
      for (const id of ids) {
        const sourceID = id - 700;
        d.tables.ModelPlayers.push({
          ...d.tables.ModelPlayers.find((p) => p.PlayerID === sourceID)!,
          PlayerID: id,
          OnTeamID: owner,
        });
        d.tables.ModelHistory.push(
          ...d.tables.ModelHistory.filter((h) => h.PlayerID === sourceID).map(
            (h) => ({ ...h, PlayerID: id }),
          ),
        );
        d.tables.ModelRosters.push({
          PlayerID: id,
          TeamID: owner,
          LineupSlotID: 20,
        });
      }
    }
    const m = evaluate(await fromTables(d.tables, d.settings), d.settings);
    const draft = {
      teamA: "1",
      teamB: "2",
      give: give.map(String),
      get: get.map(String),
    };
    const result = evaluateChainLeg(m, draft, "best-available");
    expect(result.result.valid).toBe(true);
    expect(result.leg.row.surplus).toBe("PASS");
    expect(result.leg.row.points).toBe("PASS");
    const limits = { minimum: count, maximum: count };
    expect(
      chainErrors(
        m,
        query({ pool: draft.give, first: { offer: limits, receive: limits } }),
      ),
    ).toEqual([]);
  },
);

// Beam pruning is explicit, and deeper search expands that work budget rather than presenting a truncated list as exhaustive.
it("reports incomplete coverage when first-step shortlisting is necessary", async () => {
  const d = await chainFixture();
  d.tables.ModelContext[0].BenchSlots = 40;
  const bridge = d.tables.ModelPlayers.find((p) => p.PlayerID === 2)!;
  const history = d.tables.ModelHistory.filter((h) => h.PlayerID === 2);
  for (let i = 0; i < 18; i++) {
    const id = 500 + i;
    d.tables.ModelPlayers.push({
      ...bridge,
      PlayerID: id,
      Player: `Extra bridge ${i}`,
    });
    d.tables.ModelHistory.push(...history.map((h) => ({ ...h, PlayerID: id })));
    d.tables.ModelRosters.push({ PlayerID: id, TeamID: 2, LineupSlotID: 20 });
  }
  const m = evaluate(await fromTables(d.tables, d.settings), d.settings);
  const normal = searchTradeChains(m, query());
  const deeper = searchTradeChains(m, query({ depth: "deeper" }));
  expect(normal.stats.limited).toBe(true);
  expect(normal.stats.firstEligible).toBeGreaterThan(
    normal.stats.firstExplored,
  );
  expect(deeper.stats.firstExplored).toBeGreaterThan(
    normal.stats.firstExplored,
  );
  expect(normal.chains.length).toBeLessThanOrEqual(30);
  const allSafe = searchTradeChains(m, query({ pool: ["3"] }));
  expect(allSafe.stats.firstEligible).toBeGreaterThan(12);
  expect(allSafe.stats.firstExplored).toBe(12);
});

// Arriving actual IR players stay excluded under hypothetical scoring, so chain step two cannot invent an intermediate activation gain.
it("preserves actual IR slots through the ownership checkpoint", async () => {
  const d = await chainFixture();
  d.tables.ModelRosters.find((r) => r.PlayerID === 2)!.LineupSlotID = 21;
  d.tables.ModelPlayers.find((p) => p.PlayerID === 2)!.InjuryStatus =
    "QUESTIONABLE";
  const source = await fromTables(d.tables, d.settings),
    real = evaluate(source, source.settings);
  const m = applyRosterScenario(real, {
    id: "ir",
    name: "IR",
    season: 2026,
    team: "1",
    sourceHash: source.hash,
    moves: [],
    cursor: 0,
  });
  const result = searchTradeChains(m, query({ mode: "speculative" }));
  const chain = result.chains.find((c) => c.first.draft.give.includes("3"))!;
  expect(chain).toBeDefined();
  expect(chain.intermediate).toBe(40);
  const after = applyRosterScenario(real, chain.afterFirst);
  expect(after.byId.get("2")?.slot).toBe(21);
  expect(chain.second.row.ownBefore).toBe(40);
  expect(chain.after).toBe(50);
});
