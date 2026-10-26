import { expect, it } from "vitest";
import { initialState, type Workspace } from "../src/domain/contracts";
import { evaluate } from "../src/domain/valuation";
import { evaluateTrade } from "../src/domain/trades";
import {
  activeRosterScenario,
  appendScenarioMove,
  appendScenarioTrade,
  applyRosterScenario,
  readRosterScenarios,
  rosterScenariosKey,
  selectMyTeam,
  sourceDataset,
  scenarioTeamImpact,
  scenarioLineupBoard,
  writeRosterScenarios,
  type RosterScenario,
} from "../src/domain/roster-scenarios";
import {
  readStarterLineup,
  saveStarterLineup,
  starterTemplate,
} from "../src/domain/starter-lineups";
import {
  readSavedTrades,
  reconcileSavedTrades,
  saveTrade,
  savedTradesKey,
  summaryFromTrade,
} from "../src/domain/saved-trades";
import {
  scoreTradeMatch,
  searchLineupDetails,
  type TradeSearchQuery,
} from "../src/domain/trade-search";
import { findDiscoveryMatches } from "../src/domain/trade-discovery";
import { available, lineup, roster } from "../src/domain/lineups";
import {
  diagnoseTradeCandidate,
  poolIndexRanges,
  tradeDebugReport,
} from "../src/domain/trade-tools";
import { starterFixture } from "./fixtures";

// Use a fresh synthetic snapshot for each test; no real workbook, ownership or credentials enter fixtures.
async function sample() {
  const d = await starterFixture(),
    m = evaluate(d, d.settings);
  const scenario: RosterScenario = {
    id: "scenario-1",
    name: "Two moves ahead",
    team: "1",
    season: 2026,
    sourceHash: d.hash,
    moves: [],
    cursor: 0,
  };
  return { d, m, scenario, state: initialState(d) };
}

// A forced exchange updates both rosters atomically, clears only departed starter slots and changes the next search's ownership.
it("forces a completed trade for both teams and supports a subsequent trade in either direction", async () => {
  const { d, m, scenario } = await sample();
  const original = structuredClone(d);
  const draft = { teamA: "1", teamB: "2", give: ["1"], get: ["2"] };
  const beforeA = starterTemplate(m, ["100", "1"]);
  const beforeB = starterTemplate(m, ["200", "2"]);
  const plans = saveStarterLineup(
    m,
    "2",
    ["200", "2"],
    saveStarterLineup(m, "1", ["100", "1"], undefined, beforeA.ids),
    beforeB.ids,
  );
  const recipe = appendScenarioTrade(m, scenario, draft);
  expect(recipe.cursor).toBe(1);
  expect(recipe.moves).toHaveLength(1);
  const projected = applyRosterScenario(m, recipe, plans);
  expect(projected.byId.get("1")!.owner).toBe("2");
  expect(projected.byId.get("2")!.owner).toBe("1");
  expect(projected.byId.get("1")!.slot).toBe(20);
  expect(projected.byId.get("2")!.slot).toBe(20);
  const a = readStarterLineup(projected, "1", projected.simulation!.lineupsRaw);
  const b = readStarterLineup(projected, "2", projected.simulation!.lineupsRaw);
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
  expect(a.ids).toEqual(["100"]);
  expect(b.ids).toEqual(["200"]);
  expect(a.assignments![beforeA.slots.indexOf("RB")]).toBeNull();
  expect(b.assignments![beforeB.slots.indexOf("WR")]).toBeNull();
  for (const [teamA, give, target] of [
    ["1", "2", "1"],
    ["2", "1", "2"],
  ]) {
    const q: TradeSearchQuery = {
      teamA,
      give: [give],
      count: 1,
      below: 0,
      above: 0,
      indexMode: "automatic",
      discovery: { target },
    };
    const match = findDiscoveryMatches(projected, q).matches[0];
    expect(match.get).toEqual([target]);
    expect(match.teamB).toBe(teamA === "1" ? "2" : "1");
    expect(scoreTradeMatch(projected, q, match).own).not.toBeNull();
  }
  for (const cursor of [0, 1]) {
    const replay = applyRosterScenario(m, { ...recipe, cursor }, plans);
    expect(replay.byId.get("1")!.owner).toBe(cursor ? "2" : "1");
    expect(replay.byId.get("2")!.owner).toBe(cursor ? "1" : "2");
  }
  const restored = activeRosterScenario(
    writeRosterScenarios(initialState(d), {
      version: 1,
      active: recipe.id,
      scenarios: [recipe],
    }),
  );
  expect(restored).toEqual(recipe);
  expect(d).toEqual(original);
  expect(projected.players.map((p) => [p.index, p.expected, p.value])).toEqual(
    m.players.map((p) => [p.index, p.expected, p.value]),
  );
  const saved = readSavedTrades(
    saveTrade(
      initialState(d),
      projected,
      { teamA: "1", teamB: "2", give: ["2"], get: ["1"] },
      summaryFromTrade(
        evaluateTrade(projected, {
          teamA: "1",
          teamB: "2",
          give: ["2"],
          get: ["1"],
        }),
      ),
    ),
  ).trades[0];
  expect(saved.scenario?.moves[0].kind).toBe("trade");
});

// Refresh conflicts cannot apply one half; a fully reflected real trade is idempotent, and invalid selections never append a step.
it("keeps forced trades atomic through refresh conflicts and validates ownership without price gates", async () => {
  const { m, scenario } = await sample();
  const draft = { teamA: "1", teamB: "2", give: ["1"], get: ["2"] };
  const recipe = appendScenarioTrade(m, scenario, draft);
  expect(() =>
    appendScenarioTrade(m, scenario, { ...draft, get: ["1"] }),
  ).toThrow();
  expect(() =>
    appendScenarioTrade(m, scenario, { ...draft, give: [] }),
  ).toThrow();
  expect(() =>
    appendScenarioTrade(m, scenario, { ...draft, give: ["1", "1"] }),
  ).toThrow();
  expect(() =>
    appendScenarioTrade(m, { ...scenario, season: 2025 }, draft),
  ).toThrow("current season");
  m.byId.get("2")!.owner = "0";
  const partial = applyRosterScenario(m, recipe);
  expect(partial.byId.get("1")!.owner).toBe("1");
  expect(partial.byId.get("2")!.owner).toBe("0");
  expect(partial.simulation!.issues.join()).toContain("No players were moved");
  m.byId.get("1")!.owner = "2";
  m.byId.get("2")!.owner = "1";
  const complete = applyRosterScenario(m, recipe);
  expect(complete.byId.get("1")!.owner).toBe("2");
  expect(complete.byId.get("2")!.owner).toBe("1");
  expect(complete.simulation!.issues.join()).not.toContain(
    "No players were moved",
  );
  // Even an unavailable valuation can be forced: acceptance and scoring verdicts do not gate a hypothetical ownership move.
  m.byId.get("1")!.owner = "1";
  m.byId.get("2")!.owner = "2";
  m.byId.get("1")!.value = null;
  expect(appendScenarioTrade(m, scenario, draft).moves).toHaveLength(1);
});

// Larger exchanges still use one transaction and report roster-capacity conflicts instead of silently dropping anyone.
it("applies unequal forced packages without automatic drops or partial undo", async () => {
  const { m, scenario } = await sample();
  const draft = { teamA: "1", teamB: "2", give: ["1"], get: ["2", "200"] };
  Object.assign(m.dataset.tables.ModelContext[0], {
    BenchSlots: 0,
    TESlots: 0,
    KSlots: 0,
    DSTSlots: 0,
    FlexSlots: 0,
  });
  const recipe = appendScenarioTrade(m, scenario, draft);
  const projected = applyRosterScenario(m, recipe);
  expect(recipe.cursor).toBe(1);
  expect(projected.byId.get("1")!.owner).toBe("2");
  expect(projected.byId.get("2")!.owner).toBe("1");
  expect(projected.byId.get("200")!.owner).toBe("1");
  expect(
    projected.players.some(
      (p) => m.byId.get(p.id)!.owner !== "0" && p.owner === "0",
    ),
  ).toBe(false);
  expect(projected.simulation!.issues.join()).toContain(
    "unresolved roster/position limit",
  );
});

// Hypotheticals ignore temporary absences and known byes; actual IR and missing data stay excluded.
it("ignores hypothetical temporary absences and byes while retaining IR and missing schedule restrictions", async () => {
  const { m, scenario } = await sample();
  Object.assign(m.byId.get("100")!, { expected: 40, value: 40 });
  const projected = applyRosterScenario(m, scenario);
  expect(m.ignoreByeWeeks).toBeUndefined();
  expect(projected.ignoreByeWeeks).toBe(true);
  expect(available(m, m.byId.get("100")!, 8)).toBe(false);
  expect(available(projected, projected.byId.get("100")!, 8)).toBe(true);
  expect(
    scenarioLineupBoard(projected, "1", 8, "optimized").roles.find(
      (r) => r.slot === "QB",
    )!.id,
  ).toBe("100");
  expect(scenarioTeamImpact(m, projected, "1").gain).toBe(0);
  // Missing schedules stay unavailable; temporary injury return scenarios do not reduce roster-potential scoring.
  expect(
    available(
      projected,
      { ...projected.byId.get("100")!, nflId: "missing", bye: 0 },
      8,
    ),
  ).toBe(false);
  projected.current = 8;
  Object.assign(projected.byId.get("100")!, {
    out: true,
    injury: "OUT",
    irEligible: true,
  });
  expect(available(projected, projected.byId.get("100")!, 8)).toBe(true);
  expect(
    lineup(projected, roster(projected, "1"), 8, false, false, "expected").ids,
  ).toContain("100");
  projected.byId.get("100")!.out = false;
  projected.byId.get("100")!.opportunity = {
    ...projected.byId.get("100")!.opportunity,
    returnWeek: 9,
  };
  expect(available(projected, projected.byId.get("100")!, 8)).toBe(true);
  projected.byId.get("100")!.opportunity = {
    ...projected.byId.get("100")!.opportunity,
    returnWeek: null,
  };
  Object.assign(projected.byId.get("100")!, { slot: 21, irEligible: true });
  expect(
    lineup(projected, roster(projected, "1"), 8, false, false, "expected").ids,
  ).not.toContain("100");
  expect(
    lineup(projected, roster(projected, "1"), 9, false, false, "expected").ids,
  ).not.toContain("100");
  Object.assign(projected.byId.get("100")!, { slot: 20, injury: "IR" });
  expect(available(projected, projected.byId.get("100")!, 9)).toBe(false);
  Object.assign(projected.byId.get("100")!, { injury: "SUSPENDED", out: true });
  expect(available(projected, projected.byId.get("100")!, 8)).toBe(false);
});

// Search, loaded trades and detailed lineups must share the same bye-free gain for both fantasy teams.
it("uses bye-free hypothetical trade gains while live search keeps its scheduled-week gain", async () => {
  const { m, scenario } = await sample();
  m.current = 8;
  m.weeks = m.weeks.filter((week) => week >= 8);
  Object.assign(m.byId.get("100")!, { expected: 40, value: 40 });
  const projected = applyRosterScenario(m, scenario);
  const q: TradeSearchQuery = {
    teamA: "1",
    give: ["100"],
    count: 1,
    below: 1000,
    above: 1000,
    discovery: { target: "200" },
  };
  const match = findDiscoveryMatches(projected, q).matches[0];
  const hypothetical = scoreTradeMatch(projected, q, match);
  const live = scoreTradeMatch(m, q, match);
  expect(hypothetical.own).toBe(-10);
  expect(hypothetical.other).toBe(30);
  expect(live.own).toBe(-9);
  expect(hypothetical.warnings.join()).not.toContain("bye this week");
  expect(live.warnings.join()).toContain("bye this week");
  const draft = {
    teamA: "1",
    teamB: match.teamB,
    give: q.give,
    get: match.get,
  };
  const manual = evaluateTrade(projected, draft, false);
  if (!manual.valid) throw Error(manual.errors.join());
  expect(hypothetical.own).toBe(manual.potentialA.expectedPerWeek);
  expect(hypothetical.other).toBe(manual.potentialB.expectedPerWeek);
  expect(manual.potentialA.weekly.every((w) => w.expectedGain === -10)).toBe(
    true,
  );
  expect(searchLineupDetails(projected, q, match).own.source).toContain(
    "byes ignored",
  );
  // Returning to live leaves both original values and the bye schedule untouched.
  expect(scoreTradeMatch(m, q, match).own).toBe(live.own);
  expect(
    projected.players.map((p) => [p.index, p.available, p.expected]),
  ).toEqual(m.players.map((p) => [p.index, p.available, p.expected]));
});

// Saved assignments stay visible on byes, while the unchanged scoring engine excludes unavailable starters.
it("keeps optimized and marked board roles distinct and preserves live starter choices", async () => {
  const { m, scenario } = await sample();
  const best = scenarioLineupBoard(m, "1", 8, "optimized");
  const marked = scenarioLineupBoard(m, "1", 8, "marked");
  expect(best.roles.find((r) => r.slot === "QB")!.id).toBe("101");
  expect(marked.roles.find((r) => r.slot === "QB")!.id).toBe("100");
  expect(marked.reserves).not.toContain("100");
  expect(marked.ids).toContain("100");
  expect(marked.expected).toBe(m.byId.get("1")!.expected);
  const transfer = appendScenarioMove(scenario, {
    kind: "move",
    player: "200",
    from: "2",
    to: "1",
  });
  const recipe = appendScenarioMove(transfer, {
    kind: "lineup",
    team: "1",
    ids: ["1", "200"],
  });
  const projected = applyRosterScenario(m, recipe);
  const after = scenarioLineupBoard(
    projected,
    "1",
    m.current,
    "marked",
    projected.simulation!.lineupsRaw,
  );
  expect(after.roles.find((r) => r.slot === "QB")!.id).toBe("200");
  expect(after.reserves).toContain("100");
  expect(after.reserves).toContain("101");
  expect(m.byId.get("200")!.owner).toBe("2");
  m.byId.get("101")!.expected = null;
  expect(
    scenarioLineupBoard(m, "1", m.current, "optimized").expected,
  ).toBeNull();
});

// A manually chosen FLEX on bye stays assigned through another card edit, undo/redo and weekly board changes.
it("retains a bye-week FLEX starter instead of returning it to the bench", async () => {
  const { m, scenario } = await sample();
  Object.assign(m.byId.get("103")!, { owner: "1", expected: 10, value: 10 });
  Object.assign(m.byId.get("104")!, {
    owner: "1",
    expected: 15,
    value: 15,
    nflId: 2,
    bye: 8,
  });
  const before = saveStarterLineup(m, "1", ["1", "101", "103"]);
  const chosen = appendScenarioMove(scenario, {
    kind: "lineup",
    team: "1",
    ids: ["1", "101", "104"],
  });
  const projected = applyRosterScenario(m, chosen, before);
  const board = scenarioLineupBoard(
    projected,
    "1",
    8,
    "marked",
    projected.simulation!.lineupsRaw,
  );
  expect(board.roles.find((r) => r.slot === "FLEX")!.id).toBe("104");
  expect(board.reserves).toContain("103");
  expect(board.reserves).not.toContain("104");
  expect(board.expected).toBe(
    m.byId.get("1")!.expected! + m.byId.get("101")!.expected! + 15,
  );
  // Editing another role uses all displayed assignments, so it cannot silently clear the bye-week FLEX choice.
  const edited = appendScenarioMove(chosen, {
    kind: "lineup",
    team: "1",
    ids: [...board.ids.filter((id) => id !== "101"), "100"],
  });
  for (const recipe of [edited, { ...edited, cursor: 1 }]) {
    const next = applyRosterScenario(m, recipe, before);
    for (const week of [8, 9])
      expect(
        scenarioLineupBoard(
          next,
          "1",
          week,
          "marked",
          next.simulation!.lineupsRaw,
        ).roles.find((r) => r.slot === "FLEX")!.id,
      ).toBe("104");
  }
  expect(
    scenarioLineupBoard(projected, "1", 8, "optimized").roles.find(
      (r) => r.slot === "FLEX",
    )!.id,
  ).toBe("104");
});

// Ownership moves and cuts are an overlay; all player values, recorded facts and real replacement pools remain identical.
// Explicit card placement must beat PPG sorting, retain holes and survive every saved-recipe lifecycle.
it("pins a higher-scoring RB in FLEX without swapping the other starter", async () => {
  const { m, scenario, state } = await sample();
  Object.assign(m.byId.get("103")!, { owner: "1", expected: 10, value: 10 });
  Object.assign(m.byId.get("104")!, {
    owner: "1",
    expected: 35,
    value: 35,
    nflId: 2,
    bye: 8,
  });
  const template = starterTemplate(m, ["1", "101", "103"]);
  const flex = template.slots.indexOf("FLEX"),
    rb = template.slots.indexOf("RB"),
    qb = template.slots.indexOf("QB");
  const assignments = template.ids.map((id, i) => (i === flex ? "104" : id));
  const chosen = appendScenarioMove(scenario, {
    kind: "lineup",
    team: "1",
    ids: assignments.filter((id): id is string => id !== null),
    assignments,
  });
  // Persisted scenario recipes and saved starter plans both retain the ordered slot vector.
  const stored = writeRosterScenarios(state, {
    version: 1,
    active: chosen.id,
    scenarios: [chosen],
  });
  const projected = applyRosterScenario(m, activeRosterScenario(stored));
  for (const week of [8, 9]) {
    const board = scenarioLineupBoard(
      projected,
      "1",
      week,
      "marked",
      projected.simulation!.lineupsRaw,
    );
    expect(board.roles[flex].id).toBe("104");
    expect(board.roles[rb].id).toBe("1");
    expect(board.reserves).toContain("103");
    expect(board.expected).toBe(
      m.byId.get("1")!.expected! + m.byId.get("101")!.expected! + 35,
    );
  }
  const cleared = [...assignments];
  cleared[rb] = null;
  cleared[qb] = "100";
  const edited = appendScenarioMove(chosen, {
    kind: "lineup",
    team: "1",
    ids: cleared.filter((id): id is string => id !== null),
    assignments: cleared,
  });
  for (const cursor of [2, 1, 2]) {
    const next = applyRosterScenario(m, { ...edited, cursor });
    const board = scenarioLineupBoard(
      next,
      "1",
      9,
      "marked",
      next.simulation!.lineupsRaw,
    );
    expect(board.roles[flex].id).toBe("104");
    expect(board.roles[rb].id).toBe(cursor === 1 ? "1" : null);
  }
  // Wrong-slot and missing-slot vectors fail explicitly instead of being repaired by silently moving players.
  const wrong = [...assignments];
  [wrong[qb], wrong[flex]] = [wrong[flex], wrong[qb]];
  expect(() =>
    saveStarterLineup(m, "1", ["1", "101", "104"], undefined, wrong),
  ).toThrow("ineligible");
  expect(() =>
    saveStarterLineup(
      m,
      "1",
      ["1", "101", "104"],
      undefined,
      assignments.slice(1),
    ),
  ).toThrow("slot assignments");
  // No assignment vector means legacy saved plans continue using their previous scoring behavior.
  expect(
    readStarterLineup(m, "1", saveStarterLineup(m, "1", ["1", "101", "104"]))
      .assignments,
  ).toBeUndefined();
});

it("projects moves, cuts, undo and redo without changing live valuations", async () => {
  const { d, m, scenario } = await sample(),
    original = structuredClone(d);
  const moved = appendScenarioMove(scenario, {
    kind: "move",
    player: "200",
    from: "2",
    to: "1",
  });
  const cut = appendScenarioMove(moved, {
    kind: "move",
    player: "101",
    from: "1",
    to: "0",
  });
  const projected = applyRosterScenario(m, cut);
  expect(projected.byId.get("200")!.owner).toBe("1");
  expect(projected.byId.get("101")!.owner).toBe("0");
  expect(
    projected.dataset.tables.ModelRosters.find((r) => r.PlayerID === "200")
      ?.TeamID,
  ).toBe("1");
  expect(sourceDataset(projected)).toBe(d);
  expect(d).toEqual(original);
  expect(m.byId.get("200")!.owner).toBe("2");
  expect(
    projected.players.map((p) => [
      p.actual,
      p.expected,
      p.value,
      p.index,
      p.vorp,
    ]),
  ).toEqual(
    m.players.map((p) => [p.actual, p.expected, p.value, p.index, p.vorp]),
  );
  expect(projected.pools).toEqual(m.pools);
  expect(scenarioTeamImpact(m, projected, "1").gain).toBeCloseTo(-10);
  expect(
    applyRosterScenario(m, { ...cut, cursor: 1 }).byId.get("101")!.owner,
  ).toBe("1");
  expect(
    applyRosterScenario(m, { ...cut, cursor: 0 }).byId.get("200")!.owner,
  ).toBe("2");
  const branched = appendScenarioMove(
    { ...cut, cursor: 1 },
    { kind: "move", player: "1", from: "1", to: "2" },
  );
  expect(branched.moves).toHaveLength(2);
  expect(branched.moves[1]).toMatchObject({ player: "1" });
});

// Refresh updates live forecasts and replays the recipe, flagging ownership conflicts instead of silently moving someone else’s player.
it("reapplies updated data and warns about conflicts, season changes and protected cuts", async () => {
  const { m, scenario } = await sample();
  const recipe = appendScenarioMove(scenario, {
    kind: "move",
    player: "200",
    from: "2",
    to: "1",
  });
  m.dataset.hash = "refreshed";
  m.byId.get("200")!.expected = 45;
  const refreshed = applyRosterScenario(m, recipe);
  expect(refreshed.simulation?.rebased).toBe(true);
  expect(refreshed.byId.get("200")!.expected).toBe(45);
  m.byId.get("200")!.owner = "0";
  const conflict = applyRosterScenario(m, recipe);
  expect(conflict.byId.get("200")!.owner).toBe("0");
  expect(conflict.simulation!.issues.join()).toContain("changed ownership");
  expect(
    applyRosterScenario(m, {
      ...recipe,
      season: 2025,
    }).simulation!.issues.join(),
  ).toContain("different season");
  m.byId.get("101")!.droppable = false;
  expect(
    applyRosterScenario(
      m,
      appendScenarioMove(scenario, {
        kind: "move",
        player: "101",
        from: "1",
        to: "0",
      }),
    ).simulation!.issues.join(),
  ).toContain("undroppable");
  m.dataset.tables.ModelContext[0].QBLimit = 1;
  expect(applyRosterScenario(m, scenario).simulation!.issues.join()).toContain(
    "unresolved roster/position limit",
  );
});

// Simulation starter choices are ordered moves and never overwrite the real saved lineup.
it("keeps simulated manual starters independent and round-trips bounded named scenarios", async () => {
  const { m, scenario, state } = await sample();
  const realPlans = saveStarterLineup(m, "1", ["100", "1"]);
  const recipe = appendScenarioMove(scenario, {
    kind: "lineup",
    team: "1",
    ids: ["101", "1"],
  });
  const projected = applyRosterScenario(m, recipe, realPlans);
  expect(
    readStarterLineup(projected, "1", projected.simulation!.lineupsRaw).ids,
  ).toEqual(["1", "101"]);
  expect(readStarterLineup(m, "1", realPlans).ids).toEqual(["1", "100"]);
  const raw = writeRosterScenarios(state, {
    version: 1,
    active: recipe.id,
    scenarios: [recipe],
  });
  expect(activeRosterScenario(raw)).toEqual(recipe);
  expect(state.filters[rosterScenariosKey]).toBeUndefined();
  expect(readRosterScenarios("broken").issue).toContain("preserved");
  expect(() =>
    writeRosterScenarios(
      { ...state, filters: { other: "x".repeat(64000) } },
      { version: 1, active: recipe.id, scenarios: [recipe] },
    ),
  ).toThrow("storage is full");
});

// The explicit My team choice drives outgoing ownership; opponent browsing is merely a separate stored filter.
it("remembers My team independently from the browsed team and legacy drafts", async () => {
  const { d, state } = await sample();
  state.filters.browsedTeam = "2";
  state.draft = { teamA: "2", teamB: "1", give: ["200"], get: ["101"] };
  const chosen = selectMyTeam(state, d, "1");
  expect(chosen).toMatchObject({
    preferredTeam: "1",
    filters: { browsedTeam: "2" },
    draft: { teamA: "1", teamB: "2", give: [], get: [] },
  });
  expect(selectMyTeam(chosen, d, "missing")).toBe(chosen);
});

// A saved hypothetical trade freezes a recipe, survives real-ownership cleanup and is independent of later edits to the named scenario.
it("preserves an independent scenario snapshot with each saved hypothetical trade", async () => {
  const { d, m, scenario, state } = await sample();
  const recipe = appendScenarioMove(scenario, {
    kind: "move",
    player: "102",
    from: "0",
    to: "1",
  });
  const projected = applyRosterScenario(m, recipe);
  const draft = { teamA: "1", teamB: "2", give: ["102"], get: ["200"] };
  const raw = saveTrade(
    state,
    projected,
    draft,
    summaryFromTrade(evaluateTrade(projected, draft)),
  );
  const record = readSavedTrades(raw).trades[0];
  recipe.moves.length = 0;
  expect(record.scenario!.moves).toHaveLength(1);
  const w: Workspace = {
    owner: "local",
    dataset: d,
    state: { ...state, filters: { [savedTradesKey]: raw } },
    datasetRevision: 0,
    stateRevision: 0,
    pendingDataset: false,
    pendingState: false,
    requestId: "test",
    stateRequestId: "test",
  };
  expect(
    readSavedTrades(reconcileSavedTrades(w)!.state.filters[savedTradesKey])
      .trades,
  ).toHaveLength(1);
  const restored = applyRosterScenario(m, record.scenario);
  expect(evaluateTrade(restored, draft).valid).toBe(true);
});

// Allen-like starters on a current bye still carry future value; the primary result counts the actual remaining available weeks.
it("uses symmetric weekly optimized gains while retaining zero direct impact for a benched outgoing star", async () => {
  const { m } = await sample();
  m.byId.get("100")!.expected = 30;
  m.byId.get("101")!.expected = 10;
  m.byId.get("200")!.expected = 10;
  m.dataset.tables.ModelSchedule.filter((r) => r.ProTeamID === 2).forEach(
    (r) => {
      r.HasGame = r.Week === m.current ? 0 : 1;
    },
  );
  const raw = saveStarterLineup(m, "1", ["1", "101"]);
  const q: TradeSearchQuery = {
    teamA: "1",
    give: ["100"],
    count: 1,
    below: 500,
    above: 500,
  };
  const match = {
    key: "bye",
    teamB: "2",
    get: ["200"],
    incoming: 0,
    outgoing: 0,
    difference: 0,
  };
  const result = evaluateTrade(
    m,
    { ...q, teamB: "2", get: match.get },
    true,
    raw,
  );
  if (!result.valid) throw Error(result.errors.join());
  expect(result.directA.expectedPerWeek).toBe(0);
  expect(result.potentialA.weekly[0].expectedGain).toBe(0);
  expect(result.potentialA.weekly[1].expectedGain).toBe(-20);
  expect(result.potentialA.expectedPerWeek).toBeCloseTo(
    (-20 * (m.weeks.length - 1)) / m.weeks.length,
  );
  expect(scoreTradeMatch(m, q, match, raw).own).toBe(
    result.potentialA.expectedPerWeek,
  );
  const details = searchLineupDetails(m, q, match, raw);
  expect(details.own.expectedPerWeek).toBe(result.potentialA.expectedPerWeek);
  expect(details.ownMarked.expectedPerWeek).toBe(0);
});

// Raw pool extrema include all allowed outgoing counts, and the reported Allen/Williams/Tuten package must match Gibbs within ±5.
it("shows exact pool ranges and diagnoses the 95.97 versus 100 example", async () => {
  const { m } = await sample();
  [38, 36, 21.97].forEach((index, i) => {
    m.byId.get(["100", "1", "101"][i])!.index = index;
  });
  m.byId.get("200")!.index = 100;
  const q: TradeSearchQuery = {
    teamA: "1",
    give: ["100"],
    count: 1,
    below: 5,
    above: 5,
    discovery: {
      flexible: { pool: ["100", "1", "101"], minimum: 1, maximum: 3 },
    },
  };
  expect(poolIndexRanges(m, q)).toEqual({
    minimum: 21.97,
    maximum: 95.97,
    counts: [
      { count: 1, minimum: 21.97, maximum: 38 },
      { count: 2, minimum: 57.97, maximum: 74 },
      { count: 3, minimum: 95.97, maximum: 95.97 },
    ],
  });
  const draft = {
    teamA: "1",
    teamB: "2",
    give: ["100", "1", "101"],
    get: ["200"],
  };
  expect(
    findDiscoveryMatches(m, q).matches.some(
      (r) => r.teamB === "2" && r.get.join() === "200" && r.give?.length === 3,
    ),
  ).toBe(true);
  expect(diagnoseTradeCandidate(m, q, draft).reasons).toEqual([]);
  const narrow = { ...q, above: 4 };
  expect(diagnoseTradeCandidate(m, narrow, draft).reasons.join()).toContain(
    "outside",
  );
  expect(
    diagnoseTradeCandidate(
      m,
      {
        ...q,
        discovery: { flexible: { ...q.discovery!.flexible!, maximum: 2 } },
      },
      draft,
    ).reasons.join(),
  ).toContain("offer sizes");
  expect(
    diagnoseTradeCandidate(
      m,
      { ...q, weekly: { own: { minimum: 1000, maximum: null } } },
      draft,
    ).reasons.join(),
  ).toContain("weekly gain");
  const report = tradeDebugReport(
    m,
    q,
    draft,
    undefined,
    { query: narrow },
    { status: "complete" },
  );
  expect(report.currentQuery.above).toBe(5);
  expect(report.lastAppliedSearch).toEqual({ query: narrow });
  const serialized = JSON.stringify(report);
  expect(serialized).not.toMatch(
    /ModelHistory|access_token|refresh_token|cookie|workspace.owner/,
  );
  m.byId.get("100")!.index = null;
  expect(poolIndexRanges(m, q)).toBeNull();
});

// Temporary OUT players contribute in hypotheticals on both teams; actual IR stays excluded and all scoring consumers agree.
it("shares full hypothetical Expected-PPG totals across boards, trades, search and summaries", async () => {
  const { m, scenario } = await sample();
  Object.assign(m.byId.get("100")!, {
    expected: 40,
    value: 20,
    injury: "OUT",
    out: true,
    irEligible: true,
  });
  Object.assign(m.byId.get("200")!, {
    expected: 35,
    value: 35,
    injury: "OUT",
    out: true,
    irEligible: true,
  });
  Object.assign(m.byId.get("102")!, {
    owner: "1",
    slot: 21,
    expected: 100,
    value: 100,
    injury: "OUT",
    out: true,
    irEligible: true,
  });
  Object.assign(m.byId.get("103")!, {
    owner: "2",
    slot: 20,
    expected: 100,
    value: 100,
    injury: "INJURY_RESERVE",
    out: true,
    irEligible: true,
  });
  const original = m.players.map((p) => [
    p.id,
    p.owner,
    p.injury,
    p.expected,
    p.value,
    p.index,
  ]);
  const projected = applyRosterScenario(m, scenario);
  const draft = { teamA: "1", teamB: "2", give: ["100"], get: ["200"] };
  const result = evaluateTrade(projected, draft, false);
  if (!result.valid) throw Error(result.errors.join());
  const q: TradeSearchQuery = {
    teamA: "1",
    give: draft.give,
    count: 1,
    below: 0,
    above: 0,
    indexMode: "automatic",
    discovery: { target: "200" },
  };
  const match = findDiscoveryMatches(projected, q).matches[0];
  const row = scoreTradeMatch(projected, q, match);
  for (const [team, direct, potential, excluded] of [
    ["1", result.directA, result.potentialA, "102"],
    ["2", result.directB, result.potentialB, "103"],
  ] as const) {
    const before = scenarioLineupBoard(projected, team, m.current, "optimized");
    const cardSum = before.ids.reduce(
      (total, id) => total + projected.byId.get(id)!.expected!,
      0,
    );
    expect(before.expected).toBe(cardSum);
    expect(scenarioTeamImpact(m, projected, team).gain).toBe(0);
    expect(scenarioTeamImpact(m, projected, team).after).toBeCloseTo(
      cardSum,
      12,
    );
    for (const week of potential.weekly) {
      expect(week.beforeExpected).toBeCloseTo(cardSum, 12);
      expect(week.beforeIds).not.toContain(excluded);
      expect(week.ids).not.toContain(excluded);
    }
    expect(direct.weekly[0].beforeIds).toContain(team === "1" ? "100" : "200");
  }
  expect(row.ownBefore).toBeCloseTo(
    scenarioLineupBoard(projected, "1", m.current, "optimized").expected!,
    12,
  );
  expect(row.otherBefore).toBeCloseTo(
    scenarioLineupBoard(projected, "2", m.current, "optimized").expected!,
    12,
  );
  expect(row.own).toBe(result.potentialA.expectedPerWeek);
  expect(row.other).toBe(result.potentialB.expectedPerWeek);
  const debug = tradeDebugReport(projected, q, draft, undefined, null, "test");
  expect(debug.availabilityPolicy).toBe(
    "byes-and-temporary-injuries-ignored-ir-excluded",
  );
  expect(projected.analysisVersion).toContain("hypothetical-potential-2");
  expect(available(m, m.byId.get("100")!, m.current)).toBe(false);
  expect(
    m.players.map((p) => [
      p.id,
      p.owner,
      p.injury,
      p.expected,
      p.value,
      p.index,
    ]),
  ).toEqual(original);
});

// IR exclusions cannot hide usable temporary absences or make missing active forecasts look like zero points.
it("ignores missing IR forecasts but keeps missing eligible-player scores unavailable", async () => {
  const { m, scenario } = await sample();
  Object.assign(m.byId.get("101")!, {
    slot: 21,
    expected: null,
    value: null,
    injury: "OUT",
    out: true,
    irEligible: true,
  });
  const projected = applyRosterScenario(m, scenario);
  expect(
    scenarioLineupBoard(projected, "1", m.current, "optimized").expected,
  ).not.toBeNull();
  expect(scenarioTeamImpact(m, projected, "1").after).not.toBeNull();
  Object.assign(projected.byId.get("100")!, {
    expected: null,
    value: null,
    injury: "OUT",
    out: true,
  });
  expect(
    scenarioLineupBoard(projected, "1", m.current, "optimized").expected,
  ).toBeNull();
  expect(scenarioTeamImpact(m, projected, "1").after).toBeNull();
});
