import { it, expect } from "vitest";
import { chainFixture, fairChainFixture } from "./chain-fixture";
import { evaluate } from "../src/domain/valuation";
import {
  advanceChainRoster,
  applyChainPreset,
  chainPresets,
  chainFitEvidence,
  defaultChainFit,
  chainErrors,
  chainBudgets,
  chainRecipientEvidence,
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
import { defaultChainDependency } from "../src/domain/chain-plausibility";
import { fromTables } from "../src/import/workbook";

// Fixed team scopes make the full two-step solution set small enough to verify by hand.
const query = (patch: Partial<ChainQuery> = {}): ChainQuery => ({
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
  ...patch,
});

// Recompute the two known solutions with both scoring bases, including the exact intermediate baseline rather than adding unrelated deltas.
it.each(["best-available", "marked-starters"] as const)(
  "finds safe and speculative chains under %s with the correct final roster gain",
  async (basis) => {
    const d = await fairChainFixture(),
      m = evaluate(d, d.settings);
    const before = JSON.stringify(m.players);
    const result = searchTradeChains(m, query({ basis }));
    expect(result.chains.length).toBeGreaterThanOrEqual(2);
    expect(result.stats.limited).toBe(false);
    const safe = result.chains.find(
      (c) =>
        c.first.draft.give[0] === "3" &&
        c.first.draft.get[0] === "2" &&
        c.second.draft.get[0] === "5" &&
        c.second.draft.give.includes("8"),
    )!;
    const speculative = result.chains.find(
      (c) =>
        c.first.draft.give[0] === "9" &&
        c.first.draft.get[0] === "2" &&
        c.second.draft.get[0] === "5",
    )!;
    expect([
      safe.mode,
      safe.before,
      safe.intermediate,
      safe.after,
      safe.gain,
    ]).toEqual(["safe", 61, 62, 67, 6]);
    expect([
      speculative.mode,
      speculative.before,
      speculative.intermediate,
      speculative.after,
      speculative.gain,
    ]).toEqual(["speculative", 61, 61, 66, 5]);
    for (const chain of result.chains) {
      expect(chain.second.row.ownBefore).toBeCloseTo(chain.first.row.ownAfter!);
      expect(chain.gain).toBeCloseTo(chain.after - chain.before);
      expect(chain.first.row.surplus).toBe("PASS");
      expect(chain.first.row.points).toBe("PASS");
      expect(chain.second.row.surplus).toBe("PASS");
      expect(chain.second.row.points).toBe("PASS");
      expect(chain.first.row.other).toBeGreaterThanOrEqual(1);
      expect(chain.second.row.other).toBeGreaterThanOrEqual(1);
      expect(chain.first.recipient.failures).toEqual([]);
      expect(chain.second.recipient.failures).toEqual([]);
    }
    expect(JSON.stringify(m.players)).toBe(before);
  },
);

// Modes and both adjustable gain thresholds are enforced inclusively without rounding.
it("enforces safe/speculative selection, temporary loss and final-gain limits", async () => {
  const d = await fairChainFixture(),
    m = evaluate(d, d.settings);
  expect(
    searchTradeChains(m, query({ mode: "safe" })).chains.every(
      (c) => c.mode === "safe",
    ),
  ).toBe(true);
  expect(
    searchTradeChains(
      m,
      query({ mode: "speculative", maximumLoss: 1 }),
    ).chains.every((c) => c.mode === "speculative"),
  ).toBe(true);
  expect(
    searchTradeChains(m, query({ minimumGain: 6 })).chains.length,
  ).toBeGreaterThan(0);
  expect(
    searchTradeChains(m, query({ minimumGain: 6.001 })).chains,
  ).toHaveLength(0);
});

// A losing bridge remains possible only within the selected loss budget; its recipient still has to improve independently.
it("enforces the temporary-loss boundary for a mutually beneficial speculative bridge", async () => {
  const d = await fairChainFixture();
  const p = d.tables.ModelPlayers.find((p) => p.PlayerID === 8)!;
  Object.assign(p, {
    ActualPoints: 97.5,
    Actual_PPG: 19.5,
    Last3_PPG: 19.5,
    ESPN_Projected_PPG: 19.5,
    ESPN_Projected_Total: 19.5 * 17,
  });
  d.tables.ModelHistory.filter((h) => h.PlayerID === 8).forEach((h) => {
    h.Points = 19.5;
  });
  const m = evaluate(await fromTables(d.tables, d.settings), d.settings);
  const at = searchTradeChains(
    m,
    query({ mode: "speculative", maximumLoss: 0.5, minimumGain: 4.5 }),
  );
  const target = at.chains.find(
    (c) =>
      c.first.draft.give.includes("9") &&
      c.first.draft.get.includes("2") &&
      c.second.draft.get.includes("5"),
  );
  expect(target?.first.row.own).toBe(-0.5);
  expect(target?.gain).toBe(4.5);
  expect(target?.first.row.other).toBeGreaterThan(0);
  expect(
    searchTradeChains(
      m,
      query({ mode: "speculative", maximumLoss: 0.499, minimumGain: 4.5 }),
    ).chains.some((c) => c.key === target!.key),
  ).toBe(false);
});

// Ownership and both teams' required drops are applied to a copy; valuations and the refreshed free-agent baseline stay unchanged.
it("advances both rosters, preserves frozen values and availability, and excludes departed players", async () => {
  const d = await fairChainFixture(),
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
  const d = await fairChainFixture();
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
  const d = await fairChainFixture(),
    m = evaluate(d, d.settings);
  const result = searchTradeChains(
    m,
    query({ pool: ["1", "3", "4", "8", "9"] }),
  );
  expect(
    result.chains.some((c) =>
      c.second.draft.give.some((id) => ["3", "8", "9"].includes(id)),
    ),
  ).toBe(true);
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
  const d = await fairChainFixture();
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
  const d = await fairChainFixture();
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
  const d = await fairChainFixture(),
    m = evaluate(d, d.settings);
  expect(chainErrors(m, query({ maximumLoss: NaN })).length).toBeGreaterThan(0);
  expect(chainErrors(m, query({ minimumGain: 0 })).length).toBeGreaterThan(0);
  expect(
    chainErrors(
      m,
      query({ first: { ...query().first, offer: { minimum: 1, maximum: 6 } } }),
    ).length,
  ).toBeGreaterThan(0);
  m.byId.get("3")!.expected = null;
  expect(() => searchTradeChains(m, query())).toThrow(/usable/);
});

// Ranking and price failures remain independent: a desirable scoring move cannot bypass either strict asking-price test.
it("rejects failed price tests and ranks by final gain", async () => {
  const d = await fairChainFixture(),
    m = evaluate(d, d.settings);
  const rows = searchTradeChains(m, query()).chains;
  expect(compareChains(rows[0], rows[1])).toBeLessThan(0);
  m.settings.Premium = 100;
  const result = searchTradeChains(m, query());
  expect(result.chains).toHaveLength(0);
  expect(result.stats.rejectedValue).toBeGreaterThan(0);
});

// Explicit later starter edits supersede the frozen chain checkpoint rather than leaving hidden weekly overrides active.
it("honors manual starter edits made after loading a chain prerequisite", async () => {
  const d = await fairChainFixture(),
    m = evaluate(d, d.settings);
  const draft = { teamA: "1", teamB: "2", give: ["3"], get: ["2"] };
  const intermediate = advanceChainRoster(m, draft);
  const recipe = intermediate.simulation!.scenario;
  const edited = applyRosterScenario(m, {
    ...recipe,
    moves: [
      ...recipe.moves,
      {
        kind: "lineup",
        team: "1",
        ids: ["1", "4", "9"],
        assignments: ["1", "4", "9"],
      },
    ],
    cursor: recipe.moves.length + 1,
  });
  const next = evaluateChainLeg(
    edited,
    { teamA: "1", teamB: "3", give: ["2"], get: ["5"] },
    "marked-starters",
    edited.simulation?.lineupsRaw,
  ).leg.row;
  expect(next.ownBefore).toBe(61);
  expect(next.ownAfter).toBe(67);
});

// All advertised package sizes reach actual price/lineup evaluation, including five-for-five packages.
it.each([1, 2, 3, 4, 5])(
  "supports %i-player outgoing and incoming packages",
  async (count) => {
    const d = await fairChainFixture();
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

// Deferred first trades are revisited when active branches finish; a display cap alone is not incomplete exploration.
it("exhausts deferred bridges when their follow-ups fit the shared budget", async () => {
  const d = await fairChainFixture();
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
  expect(normal.stats.limited).toBe(false);
  expect(normal.stats.firstExplored).toBe(normal.stats.firstEligible);
  expect(normal.stats.coverage.followups.deferred).toBe(0);
  expect(normal.stats.coverage.followups.unfinished).toBe(0);
  expect(normal.stats.coverage.stopReasons).toEqual([]);
  expect(deeper.stats.found).toBe(normal.stats.found);
  expect(deeper.chains.map((c) => c.key)).toEqual(
    normal.chains.map((c) => c.key),
  );
  expect(normal.chains.length).toBeLessThanOrEqual(30);
  const allSafe = searchTradeChains(m, query({ pool: ["3"] }));
  expect(allSafe.stats.firstEligible).toBeGreaterThan(12);
  expect(allSafe.stats.firstExplored).toBe(allSafe.stats.firstEligible);
});

// Arriving actual IR players stay excluded under hypothetical scoring, so chain step two cannot invent an intermediate activation gain.
it("preserves actual IR slots through the ownership checkpoint", async () => {
  const d = await fairChainFixture();
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
  expect(chain.intermediate).toBe(61);
  const after = applyRosterScenario(real, chain.afterFirst);
  expect(after.byId.get("2")?.slot).toBe(21);
  expect(chain.second.row.ownBefore).toBe(61);
  expect(chain.after).toBe(67);
});

// Previously accepted losing-counterparty chains now fail independently of their attractive final gain and one-sided PASS labels.
it("rejects the old unfair chains and reports captured recipient reasons", async () => {
  const d = await chainFixture(),
    m = evaluate(d, d.settings);
  const r = searchTradeChains(
    m,
    query({
      pool: ["1", "3"],
      second: {
        offer: { minimum: 1, maximum: 1 },
        receive: { minimum: 1, maximum: 1 },
        teams: ["3"],
      },
    }),
  );
  expect(r.chains).toEqual([]);
  expect(r.stats.rejectedRecipient).toBeGreaterThan(0);
  expect(
    r.recipientRejections.some(
      (e) => e.step === 1 && e.evidence.failures.length > 0,
    ),
  ).toBe(true);
  expect(r.recipientRejections.length).toBeLessThanOrEqual(10);
});

// Each leg must pass in its own context: positive recipient scoring cannot excuse excessive second-step surplus loss.
it("enforces recipient value protection on the follow-up as well as the first trade", async () => {
  const d = await fairChainFixture(),
    m = evaluate(d, d.settings);
  const r = searchTradeChains(
    m,
    query({
      second: {
        offer: { minimum: 1, maximum: 1 },
        receive: { minimum: 1, maximum: 1 },
        teams: ["3"],
      },
    }),
  );
  expect(r.chains).toEqual([]);
  expect(
    r.recipientRejections.some(
      (e) => e.step === 2 && !e.evidence.scored && e.evidence.lossPct > 0.1,
    ),
  ).toBe(true);
});

// Full-precision limits are inclusive, scale-invariant, and never reinterpret zero/unknown recipient benefit as a successful bargain.
it("rejects a 23.95-for-52 concession and checks recipient boundary values", async () => {
  const d = await fairChainFixture(),
    m = evaluate(d, d.settings);
  const row = evaluateChainLeg(
    m,
    { teamA: "1", teamB: "2", give: ["3"], get: ["2"] },
    "best-available",
  ).leg.row;
  const fleece = chainRecipientEvidence({
    ...row,
    outgoing: 23.95,
    incoming: 52,
    other: 5,
  });
  expect(fleece.lossPct).toBeCloseTo((52 - 23.95) / 52);
  expect(fleece.failures.join(" ")).toMatch(/loss exceeds/);
  expect(
    chainRecipientEvidence({ ...row, outgoing: 90, incoming: 100, other: 1 })
      .failures,
  ).toEqual([]);
  expect(
    chainRecipientEvidence({
      ...row,
      outgoing: 89.999,
      incoming: 100,
      other: 1,
    }).failures,
  ).toHaveLength(1);
  expect(
    chainRecipientEvidence({ ...row, outgoing: 9, incoming: 10, other: 1 })
      .lossPct,
  ).toBe(0.1);
  for (const other of [null, -1])
    expect(
      chainRecipientEvidence(
        { ...row, outgoing: 100, incoming: 100, other },
        { maximumValueLossPct: 0, minimumGain: 0 },
      ).failures,
    ).toHaveLength(1);
  expect(
    chainRecipientEvidence({ ...row, outgoing: 0, incoming: 0, other: 1 })
      .lossPct,
  ).toBe(0);
  expect(
    chainRecipientEvidence({ ...row, other: 0.999 }).failures,
  ).toHaveLength(1);
  // Either unequal direction uses the existing premium once; receiving a larger package is not itself an unfair concession.
  for (const [outgoing, incoming, give, get] of [
    [100, 130, ["a"], ["b", "c"]],
    [130, 100, ["a", "b"], ["c"]],
  ] as const) {
    const evidence = chainRecipientEvidence(
      { ...row, outgoing, incoming, give: [...give], get: [...get], other: 1 },
      { maximumValueLossPct: 0.1, minimumGain: 1 },
      0.3,
    );
    expect(evidence.receivedComparableIndex).toBe(130);
    expect(evidence.surrenderedComparableIndex).toBe(130);
    expect(evidence.lossPct).toBe(0);
    expect(evidence.failures).toEqual([]);
  }
  for (const recipient of [
    { maximumValueLossPct: NaN, minimumGain: 1 },
    { maximumValueLossPct: 1.01, minimumGain: 1 },
    { maximumValueLossPct: 0.1, minimumGain: -1 },
  ])
    expect(chainErrors(m, query({ recipient })).join(" ")).toMatch(/recipient/);
});

// A wide pool and several attractive but unusable stars previously exhausted the budget before trying balanced incoming packages.
it("reaches every package size and finds valid chains with a ten-player pool and six opponents", async () => {
  const d = await fairChainFixture();
  const add = (id: number, owner: number, pos: string, points: number) => {
    const base = d.tables.ModelPlayers.find((p) => p.Position === pos)!;
    d.tables.ModelPlayers.push({
      ...base,
      PlayerID: id,
      Player: `Budget synthetic ${id}`,
      OnTeamID: owner,
      ActualPoints: points * 5,
      Actual_PPG: points,
      Last3_PPG: points,
      ESPN_Projected_PPG: points,
      ESPN_Projected_Total: points * 17,
    });
    d.tables.ModelRosters.push({
      PlayerID: id,
      TeamID: owner,
      LineupSlotID: 20,
    });
    for (let week = 1; week <= 5; week++)
      d.tables.ModelHistory.push({
        PlayerID: id,
        Season: 2026,
        Week: week,
        Points: points,
        Games: 1,
        HistoryStatus: "Valid",
        SourceRefreshUTC: d.sourceUTC,
      });
  };
  d.tables.ModelContext[0].BenchSlots = 20;
  for (let team = 4; team <= 7; team++)
    d.tables.ModelTeams.push({ TeamID: team, TeamName: `Budget Team ${team}` });
  d.tables.ModelContext[0].TeamCount = d.tables.ModelTeams.length;
  for (let team = 2; team <= 7; team++) add(900 + team, team, "K", 100);
  const pool = ["3", "8", "9"];
  for (let id = 14; id <= 20; id++) {
    add(id, 1, "RB", 10);
    pool.push(String(id));
  }
  const m = evaluate(await fromTables(d.tables, d.settings), d.settings);
  const range = { minimum: 1, maximum: 3 },
    teams = ["2", "3", "4", "5", "6", "7"];
  const r = searchTradeChains(
    m,
    query({
      pool,
      mode: "safe",
      first: { offer: range, receive: range, teams },
      second: { offer: range, receive: range, teams },
    }),
  );
  expect(r.chains.length).toBeGreaterThan(0);
  expect(r.stats.firstExplored).toBeGreaterThan(0);
  expect(r.stats.rejectedRecipientBeforeScoring).toBeGreaterThan(0);
  for (const count of [1, 2, 3]) {
    const sizes = Object.keys(r.stats.firstEvaluatedBySize);
    expect(sizes.some((size) => size.startsWith(`${count}-for-`))).toBe(true);
    expect(sizes.some((size) => size.endsWith(`-for-${count}`))).toBe(true);
  }
  for (const chain of r.chains)
    for (const leg of [chain.first, chain.second])
      expect(leg.recipient.failures).toEqual([]);
  expect(r.stats.bestFinalGain).toBeGreaterThanOrEqual(r.chains[0].gain);
});

// The explicit zero minimum permits a flat recipient, while null and even tiny losses remain failures.
it("permits a flat recipient only at an explicit zero minimum", () => {
  const row = {
    give: ["a"],
    get: ["b"],
    outgoing: 100,
    incoming: 100,
    other: 0,
  };
  expect(
    chainRecipientEvidence(row, { maximumValueLossPct: 0, minimumGain: 0 })
      .failures,
  ).toEqual([]);
  expect(
    chainRecipientEvidence(
      { ...row, other: -0.000001 },
      { maximumValueLossPct: 0, minimumGain: 0 },
    ).failures,
  ).toHaveLength(1);
  expect(chainRecipientEvidence(row).failures).toHaveLength(1);
});

// Applying a preset preserves every independently configured option, including disabled targeting and explicit empty team scopes.
it("applies five presets without overwriting mode, sizes, teams, fit, pool or depth", () => {
  const original = query({
    mode: "speculative",
    maximumLoss: 7,
    depth: "deeper",
    first: {
      ...query().first,
      teams: [],
      fit: { surplus: defaultChainFit("surplus") },
    },
  });
  expect(
    chainPresets.map((p) => [
      p.minimumGain,
      p.maximumValueLossPct,
      p.recipientGain,
      p.pricePolicy,
    ]),
  ).toEqual([
    [2, 0.1, 0, "warnings"],
    [3, 0.1, 0.1, "warnings"],
    [4, 0.1, 0.25, "warnings"],
    [5, 0.1, 0.5, "required"],
    [8, 0.1, 1, "required"],
  ]);
  for (const preset of chainPresets) {
    const applied = applyChainPreset(original, preset.id);
    expect(applied.first).toBe(original.first);
    expect(applied.second).toBe(original.second);
    expect(applied.pool).toBe(original.pool);
    expect(applied.mode).toBe("speculative");
    expect(applied.depth).toBe("deeper");
    expect(applied.maximumLoss).toBe(7);
    expect(applied.minimumGain).toBe(preset.minimumGain);
    expect(applied.first.fit!.surplus!.enabled).toBe(false);
  }
});

// Advisory prices can expose useful but expensive packages; legality, protected drops and recipient limits still apply.
it("keeps price failures visible in advisory discovery and rejects them when required", async () => {
  const d = await fairChainFixture(),
    m = evaluate(d, d.settings);
  const q = query({
    minimumGain: 1,
    recipient: { maximumValueLossPct: 1, minimumGain: 0 },
  });
  const strict = searchTradeChains(m, { ...q, pricePolicy: "required" });
  const warnings = searchTradeChains(m, { ...q, pricePolicy: "warnings" });
  expect(
    warnings.chains.some((c) =>
      [c.first, c.second].some(
        (l) => l.row.surplus !== "PASS" || l.row.points !== "PASS",
      ),
    ),
  ).toBe(true);
  expect(
    strict.chains.every((c) =>
      [c.first, c.second].every(
        (l) => l.row.surplus === "PASS" && l.row.points === "PASS",
      ),
    ),
  ).toBe(true);
  expect(
    warnings.chains.every((c) =>
      [c.first, c.second].every(
        (l) =>
          l.row.legal &&
          !l.recipient.failures.length &&
          !l.row.dropsA.includes("4"),
      ),
    ),
  ).toBe(true);
});

// Disabled targeting must reproduce ordinary chain discovery exactly; Prefer never becomes an implicit exclusion.
it("works without fit targeting and distinguishes Prefer from Require for an unavailable position", async () => {
  const d = await fairChainFixture(),
    m = evaluate(d, d.settings),
    original = query();
  const baseline = searchTradeChains(m, original);
  const rule = {
    ...defaultChainFit("surplus"),
    enabled: true,
    positions: ["QB" as const],
  };
  const search = (enabled: boolean, mode: "prefer" | "require") =>
    searchTradeChains(m, {
      ...original,
      first: {
        ...original.first,
        fit: { surplus: { ...rule, enabled, mode } },
      },
    });
  expect(search(false, "require").chains.map((c) => c.key)).toEqual(
    baseline.chains.map((c) => c.key),
  );
  expect(search(true, "prefer").chains.map((c) => c.key)).toEqual(
    baseline.chains.map((c) => c.key),
  );
  const required = search(true, "require");
  expect(required.chains).toHaveLength(0);
  expect(required.stats.rejectedFit).toBeGreaterThan(0);
});

// Package positions are deduplicated; inclusive thresholds, Any/All and manual overrides use actual direction-specific players.
it("checks inclusive fit grades, automatic positions and Any/All without using an unrelated position", async () => {
  const d = await fairChainFixture(),
    m = evaluate(d, d.settings);
  const grades = new Map([
    [
      "2",
      [
        { position: "RB", grade: "C+", status: "Available" },
        { position: "TE", grade: "B+", status: "Available" },
        { position: "WR", grade: "A", status: "Available" },
      ],
    ],
  ]) as Parameters<typeof chainFitEvidence>[3];
  const draft = { teamA: "1", teamB: "2", give: ["3", "8"], get: ["2"] };
  const deficit = { ...defaultChainFit("deficit"), enabled: true };
  const any = chainFitEvidence(m, draft, { deficit }, grades)[0];
  expect(any.matched).toBe(true);
  expect(any.positions.map((p) => p.qualifies)).toEqual([true, false]);
  expect(
    chainFitEvidence(
      m,
      draft,
      { deficit: { ...deficit, match: "all" } },
      grades,
    )[0].matched,
  ).toBe(false);
  expect(
    chainFitEvidence(
      m,
      draft,
      { deficit: { ...deficit, positions: ["RB"], match: "all" } },
      grades,
    )[0].matched,
  ).toBe(true);
  expect(
    chainFitEvidence(
      m,
      draft,
      { deficit: { ...deficit, positions: ["QB"] } },
      grades,
    )[0].matched,
  ).toBe(false);
  expect(
    chainFitEvidence(
      m,
      draft,
      { surplus: { ...defaultChainFit("surplus"), enabled: true } },
      grades,
    )[0].positions.map((p) => p.position),
  ).toEqual(["WR"]);
});

// The second counterparty can be the first; grades must describe the advanced roster, not the original imported ownership.
it("recomputes follow-up fit after trade one and records grade evidence on both legs", async () => {
  const d = await fairChainFixture();
  // A second spare RB lets both legs use RBs, so trade one's changed league median affects the next recipient's actual grade.
  const spare = d.tables.ModelPlayers.find((p) => p.PlayerID === 3)!;
  d.tables.ModelPlayers.push({
    ...spare,
    PlayerID: 99999,
    Player: "Second spare RB",
    ActualPoints: 90,
    Actual_PPG: 18,
    Last3_PPG: 18,
    ESPN_Projected_PPG: 18,
    ESPN_Projected_Total: 306,
  });
  d.tables.ModelRosters.push({ PlayerID: 99999, TeamID: 1, LineupSlotID: 20 });
  d.tables.ModelHistory.push(
    ...d.tables.ModelHistory.filter((h) => h.PlayerID === 3).map((h) => ({
      ...h,
      PlayerID: 99999,
      Points: 18,
    })),
  );
  const m = evaluate(await fromTables(d.tables, d.settings), d.settings);
  const q = query({
    pool: ["3", "8", "9", "99999"],
    pricePolicy: "warnings",
    first: {
      ...query().first,
      fit: {
        surplus: {
          ...defaultChainFit("surplus"),
          enabled: true,
          mode: "require",
          grade: "F",
        },
      },
    },
    second: {
      ...query().second,
      teams: ["3"],
      fit: {
        deficit: {
          ...defaultChainFit("deficit"),
          enabled: true,
          mode: "require",
          grade: "C+",
        },
      },
    },
  });
  const result = searchTradeChains(m, q);
  expect(result.chains.length).toBeGreaterThan(0);
  for (const c of result.chains) {
    const after = advanceChainRoster(m, c.first.draft);
    expect(c.first.fit).toEqual(
      chainFitEvidence(m, c.first.draft, q.first.fit),
    );
    expect(c.second.fit).toEqual(
      chainFitEvidence(after, c.second.draft, q.second.fit),
    );
  }
  expect(
    result.chains.some(
      (c) =>
        JSON.stringify(c.second.fit) !==
        JSON.stringify(chainFitEvidence(m, c.second.draft, q.second.fit)),
    ),
  ).toBe(true);
});

// Low-ID bench filler previously exhausted the bounded prefix before any useful bridge was tried; no acceptance condition is relaxed here.
it("reaches scoring and surplus offers before low-ID filler exhausts the chain budget", async () => {
  const d = await fairChainFixture();
  d.tables.ModelContext[0].BenchSlots = 20;
  const base = d.tables.ModelPlayers.find((p) => p.PlayerID === 3)!;
  const history = d.tables.ModelHistory.filter((h) => h.PlayerID === 3);
  const pool = ["3", "8", "9"];
  for (let i = 0; i < 9; i++) {
    const id = -100 - i;
    pool.push(String(id));
    d.tables.ModelPlayers.push({
      ...base,
      PlayerID: id,
      Player: `Synthetic low-score QB ${i}`,
      Position: "QB",
      ActualPoints: 5,
      Actual_PPG: 1,
      Last3_PPG: 1,
      ESPN_Projected_PPG: 1,
      ESPN_Projected_Total: 17,
      Current_Week_Projection: 1,
    });
    d.tables.ModelRosters.push({ PlayerID: id, TeamID: 1, LineupSlotID: 20 });
    d.tables.ModelHistory.push(
      ...history.map((h) => ({ ...h, PlayerID: id, Points: 1 })),
    );
  }
  const m = evaluate(await fromTables(d.tables, d.settings), d.settings);
  const original = { ...chainBudgets.standard };
  // Scale the finite budget down for the tiny league; restore it even on assertion failure.
  try {
    Object.assign(chainBudgets.standard, { first: 24, beam: 6, second: 120 });
    const result = searchTradeChains(
      m,
      query({
        pool,
        pricePolicy: "warnings",
        recipient: { maximumValueLossPct: 1, minimumGain: 1 },
        first: { ...query().first, offer: { minimum: 1, maximum: 2 } },
      }),
    );
    const bridge = result.chains.find(
      (c) =>
        c.first.draft.give.join() === "3" &&
        c.first.draft.get.join() === "2" &&
        c.second.draft.give.includes("2") &&
        c.second.draft.give.includes("8") &&
        c.second.draft.get.join() === "5",
    );
    expect(bridge?.gain).toBe(6);
    expect(result.stats.evaluated).toBeLessThanOrEqual(144);
    expect(result.stats.limited).toBe(true);
    for (const c of result.chains)
      for (const leg of [c.first, c.second]) {
        expect(leg.row.legal).toBe(true);
        expect(leg.recipient.failures).toEqual([]);
        expect(leg.row.other).toBeGreaterThanOrEqual(1);
        expect(leg.row.dropsA).not.toContain("4");
      }
  } finally {
    Object.assign(chainBudgets.standard, original);
  }
});

// The audit's counterexample isolates bridge diversity: 30 immediately stronger WR returns cannot replace the needed RB bridge.
async function deferredBridgeSample() {
  const d = await fairChainFixture();
  d.tables.ModelContext[0].BenchSlots = 50;
  const set = (id: number, position: string, points: number) => {
    Object.assign(
      d.tables.ModelPlayers.find((p) => p.PlayerID === id)!,
      {
        Position: position,
        ActualPoints: points * 5,
        Actual_PPG: points,
        Last3_PPG: points,
        ScoreSD: 0,
        ESPN_Projected_PPG: points,
        ESPN_Projected_Total: points * 17,
        Current_Week_Projection: points,
      },
    );
    for (const row of d.tables.ModelHistory.filter((h) => h.PlayerID === id))
      row.Points = points;
  };
  set(2, "RB", 23);
  set(7, "RB", 20);
  set(12, "TE", 21);
  d.tables.ModelRosters.find((r) => r.PlayerID === 2)!.LineupSlotID = 2;
  d.tables.ModelRosters.find((r) => r.PlayerID === 6)!.LineupSlotID = 20;
  const base = d.tables.ModelPlayers.find((p) => p.PlayerID === 10)!;
  const history = d.tables.ModelHistory.filter((h) => h.PlayerID === 10);
  for (let i = 0; i < 30; i++) {
    const id = 500 + i;
    d.tables.ModelPlayers.push({
      ...base,
      PlayerID: id,
      Player: `Synthetic decoy ${i}`,
      ActualPoints: 120,
      Actual_PPG: 24,
      Last3_PPG: 24,
      ESPN_Projected_PPG: 24,
      ESPN_Projected_Total: 408,
      Current_Week_Projection: 24,
    });
    d.tables.ModelRosters.push({ PlayerID: id, TeamID: 2, LineupSlotID: 20 });
    d.tables.ModelHistory.push(
      ...history.map((row) => ({ ...row, PlayerID: id, Points: 24 })),
    );
  }
  const source = await fromTables(d.tables, d.settings);
  return {
    m: evaluate(source, source.settings),
    q: query({
      pool: ["3", "8"],
      mode: "safe",
      recipient: { maximumValueLossPct: 0.3, minimumGain: 1 },
    }),
  };
}

// Preserve recipient and price predicates while proving the previously missed +6 chain survives Standard's active window.
it("finds the +6 EPPG RB bridge behind higher-immediate-gain dead ends", async () => {
  const { m, q } = await deferredBridgeSample();
  const r = searchTradeChains(m, q);
  const c = r.chains.find(
    (c) =>
      c.first.draft.give.join() === "8" &&
      c.first.draft.get.join() === "2" &&
      [...c.second.draft.give].sort().join() === "2,3" &&
      c.second.draft.get.join() === "5",
  )!;
  expect(c).toBeDefined();
  expect([c.before, c.intermediate, c.after, c.gain]).toEqual([61, 64, 67, 6]);
  for (const leg of [c.first, c.second]) {
    expect([leg.row.surplus, leg.row.points]).toEqual(["PASS", "PASS"]);
    expect(leg.row.other).toBe(2);
    expect(leg.recipient.failures).toEqual([]);
    expect(leg.row.dropsA).toEqual([]);
  }
  expect(r.stats.firstEligible).toBe(31);
  expect(r.stats.firstExplored).toBe(31);
  expect(r.stats.limited).toBe(false);
  expect(r.stats.evaluated).toBe(188);
});

// With one resident branch and exactly enough global evaluations, completed branches must release their work and admit every deferred bridge.
it("reassigns unused work and exhausts deferred branches at the exact evaluation boundary", async () => {
  const { m, q } = await deferredBridgeSample(),
    original = { ...chainBudgets.standard };
  try {
    Object.assign(chainBudgets.standard, { first: 80, second: 108, beam: 1 });
    const r = searchTradeChains(m, q);
    expect(r.stats.found).toBe(2);
    expect(r.stats.evaluated).toBe(188);
    expect(r.stats.coverage.first.evaluated).toBe(64);
    expect(r.stats.coverage.followups.evaluated).toBe(124);
    expect(r.stats.coverage.followups.completed).toBe(31);
    expect(r.stats.coverage.unusedEvaluations).toBe(0);
    expect(r.stats.coverage.stopReasons).toEqual([]);
    expect(r.stats.limited).toBe(false);
  } finally {
    Object.assign(chainBudgets.standard, original);
  }
});

// A broad connected-only search exceeds the retained display cap without claiming that unsearched chains remain.
it("separates a full connected search from the 30-result display cap", async () => {
  const d = await fairChainFixture(),
    m = evaluate(d, d.settings);
  const sizes = { minimum: 1, maximum: 2 };
  const r = searchTradeChains(
    m,
    query({
      minimumGain: 1,
      pricePolicy: "warnings",
      dependency: { ...defaultChainDependency, route: "retrade" },
      recipient: { maximumValueLossPct: 0.3, minimumGain: 0 },
      first: { offer: sizes, receive: sizes, teams: ["2"] },
      second: { offer: sizes, receive: sizes, teams: ["3"] },
    }),
  );
  expect(r.stats.found).toBeGreaterThan(30);
  expect(r.chains.every((chain) => chain.dependency?.route === "retrade")).toBe(
    true,
  );
  expect(r.chains).toHaveLength(30);
  expect(r.stats.resultCapped).toBe(true);
  expect(r.stats.limited).toBe(false);
  expect(r.stats.coverage.followups.completed).toBe(r.stats.firstEligible);
  expect(r.stats.coverage.stopReasons).toEqual([]);
});

// An unfinished branch remains resumable until the actual global limit; diagnostics distinguish it from deferred first trades and display caps.
it("reports exact unfinished work when evaluations or candidate scans run out", async () => {
  const { m, q } = await deferredBridgeSample(),
    original = { ...chainBudgets.standard };
  try {
    Object.assign(chainBudgets.standard, { first: 80, second: 1, beam: 1 });
    const r = searchTradeChains(m, q);
    expect(r.stats.evaluated).toBe(81);
    expect(r.stats.limited).toBe(true);
    expect(r.stats.coverage.stopReasons).toEqual([
      "followup-evaluation-budget",
    ]);
    expect(r.stats.coverage.followups.unfinished).toBe(1);
    expect(r.stats.coverage.followups.deferred).toBeGreaterThan(0);
    expect(r.stats.coverage.unusedEvaluations).toBe(0);
    Object.assign(chainBudgets.standard, { scans: 1, first: 80, second: 1 });
    const scanned = searchTradeChains(m, q);
    expect(scanned.stats.coverage.first.complete).toBe(false);
    expect(scanned.stats.coverage.stopReasons).toContain("first-scan-budget");
    expect(scanned.stats.scanned).toBeLessThanOrEqual(2);
    expect(scanned.stats.coverage.unusedEvaluations).toBeGreaterThan(0);
  } finally {
    Object.assign(chainBudgets.standard, original);
  }
});
