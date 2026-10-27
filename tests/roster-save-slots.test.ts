import { expect, it } from "vitest";
import { initialState } from "../src/domain/contracts";
import { evaluate } from "../src/domain/valuation";
import { starterFixture } from "./fixtures";
import {
  saveStarterLineup,
  readStarterLineup,
  starterTemplate,
} from "../src/domain/starter-lineups";
import {
  activeRosterScenario,
  appendScenarioMove,
  appendScenarioTrade,
  applyRosterScenario,
  deleteRosterScenario,
  loadRosterSnapshot,
  readRosterScenarios,
  rosterScenarioDirty,
  scenarioRosterBase,
  rosterScenariosKey,
  saveRosterSnapshot,
  writeRosterScenarios,
  type RosterScenario,
} from "../src/domain/roster-scenarios";

// Save compact synthetic recipes only; no live dataset, clock-dependent assertion or user roster enters fixtures.
async function sample() {
  const d = await starterFixture(),
    m = evaluate(d, d.settings);
  const state = initialState(d);
  state.filters.startingLineups = saveStarterLineup(m, "1", ["100", "1"]);
  const scenario: RosterScenario = {
    id: "a",
    name: "Plan A",
    season: 2026,
    team: "1",
    sourceHash: d.hash,
    moves: [],
    cursor: 0,
  };
  return { d, m, state, scenario };
}

// Each slot freezes exact transactions, both ownership sides, manual starter assignments and undo history; overwrite touches one slot only.
it("restores three independent roster points including both sides of a forced trade and exact starters", async () => {
  const { m, state, scenario } = await sample();
  let working = writeRosterScenarios(state, {
    version: 1,
    active: scenario.id,
    scenarios: [scenario],
  });
  let result = saveRosterSnapshot(state, working, 1, "2026-10-27T14:00:00Z");
  state.filters[rosterScenariosKey] = result.saved;
  const first = activeRosterScenario(result.working)!;
  const traded = appendScenarioTrade(m, first, {
    teamA: "1",
    teamB: "2",
    give: ["100"],
    get: ["200"],
  });
  const tradedModel = applyRosterScenario(m, traded);
  const assignments = starterTemplate(tradedModel, ["1", "200"]).ids;
  const started = appendScenarioMove(traded, {
    kind: "lineup",
    team: "1",
    ids: ["1", "200"],
    assignments,
  });
  working = writeRosterScenarios(state, {
    ...readRosterScenarios(result.working).collection,
    scenarios: [started],
  });
  expect(rosterScenarioDirty(result.saved, working)).toBe(true);
  expect(activeRosterScenario(state.filters[rosterScenariosKey])!.cursor).toBe(
    0,
  );
  result = saveRosterSnapshot(state, working, 2, "2026-10-27T14:01:00Z");
  state.filters[rosterScenariosKey] = result.saved;
  const cut = appendScenarioMove(started, {
    kind: "move",
    player: "200",
    from: "1",
    to: "0",
  });
  const undone = { ...cut, cursor: started.cursor };
  working = writeRosterScenarios(state, {
    ...readRosterScenarios(result.working).collection,
    scenarios: [undone],
  });
  result = saveRosterSnapshot(state, working, 3, "2026-10-27T14:02:00Z");
  state.filters[rosterScenariosKey] = result.saved;
  const slots = readRosterScenarios(result.saved).collection.snapshots!;
  expect(slots.map((s) => s.slot)).toEqual([1, 2, 3]);
  for (const slot of [1, 2, 3] as const) {
    const loadedRaw = loadRosterSnapshot(
      state,
      result.working,
      scenario.id,
      slot,
    );
    const loaded = activeRosterScenario(loadedRaw)!;
    const model = applyRosterScenario(m, loaded);
    expect(model.byId.get("200")!.owner).toBe(slot === 1 ? "2" : "1");
    expect(model.byId.get("100")!.owner).toBe(slot === 1 ? "1" : "2");
    if (slot !== 1)
      expect(
        readStarterLineup(model, "1", model.simulation!.lineupsRaw).assignments,
      ).toEqual(assignments);
    expect(loaded.cursor).toBe(slot === 1 ? 0 : started.cursor);
    expect(loaded.moves).toHaveLength(slot === 3 ? 3 : slot === 2 ? 2 : 0);
    expect(loaded).not.toHaveProperty("snapshots");
  }
  const overwritten = saveRosterSnapshot(
    state,
    loadRosterSnapshot(state, result.working, scenario.id, 2),
    1,
  );
  expect(
    readRosterScenarios(overwritten.saved).collection.snapshots!.filter(
      (s) => s.slot !== 1,
    ),
  ).toEqual(slots.filter((s) => s.slot !== 1));
  expect(m.byId.get("100")!.owner).toBe("1");
});

// Saving B cannot accidentally commit A's staged changes; slot IDs and deletion are isolated per scenario.
it("saves only the active scenario and preserves other scenarios' unsaved drafts and slots", async () => {
  const { state, scenario } = await sample();
  const b = { ...scenario, id: "b", name: "Plan B" };
  state.filters[rosterScenariosKey] = writeRosterScenarios(state, {
    version: 1,
    active: "a",
    scenarios: [scenario, b],
  });
  const aDraft = appendScenarioMove(scenario, {
    kind: "move",
    player: "102",
    from: "0",
    to: "1",
  });
  const bDraft = appendScenarioMove(b, {
    kind: "move",
    player: "103",
    from: "0",
    to: "1",
  });
  const working = writeRosterScenarios(state, {
    version: 1,
    active: "b",
    scenarios: [aDraft, bDraft],
  });
  const savedB = saveRosterSnapshot(state, working, 1);
  state.filters[rosterScenariosKey] = savedB.saved;
  expect(
    readRosterScenarios(savedB.saved).collection.scenarios.find(
      (s) => s.id === "a",
    )!.cursor,
  ).toBe(0);
  expect(rosterScenarioDirty(savedB.saved, savedB.working, "a")).toBe(true);
  expect(rosterScenarioDirty(savedB.saved, savedB.working, "b")).toBe(false);
  const savedA = saveRosterSnapshot(
    state,
    writeRosterScenarios(state, {
      ...readRosterScenarios(savedB.working).collection,
      active: "a",
    }),
    1,
  );
  state.filters[rosterScenariosKey] = savedA.saved;
  expect(readRosterScenarios(savedA.saved).collection.snapshots).toHaveLength(
    2,
  );
  expect(() => loadRosterSnapshot(state, savedA.working, "b", 2)).toThrow(
    "empty",
  );
  const deleted = deleteRosterScenario(state, savedA.working, "a");
  expect(
    readRosterScenarios(deleted.saved).collection.snapshots!.map(
      (s) => s.scenario.id,
    ),
  ).toEqual(["b"]);
});

// Frozen baseline plans make a restored recipe independent of later live starter changes without copying player data.
it("keeps legacy scenarios readable and freezes baseline lineup choices on explicit save", async () => {
  const { m, state, scenario } = await sample();
  const legacy = writeRosterScenarios(state, {
    version: 1,
    active: "a",
    scenarios: [scenario],
  });
  expect(readRosterScenarios(legacy).issue).toBe("");
  expect(activeRosterScenario(legacy)).toEqual(scenario);
  const saved = saveRosterSnapshot(state, legacy, 1);
  const changedLive = saveStarterLineup(m, "1", ["101", "1"]);
  const restored = applyRosterScenario(
    m,
    activeRosterScenario(saved.working),
    changedLive,
  );
  expect(
    readStarterLineup(restored, "1", restored.simulation!.lineupsRaw).ids,
  ).toContain("100");
  expect(
    readStarterLineup(restored, "1", restored.simulation!.lineupsRaw).ids,
  ).not.toContain("101");
  const before = saved.saved;
  expect(() =>
    saveRosterSnapshot(
      { ...state, filters: { ...state.filters, other: "x".repeat(64000) } },
      legacy,
      2,
    ),
  ).toThrow("storage is full");
  expect(saved.saved).toBe(before);
  expect(() => saveRosterSnapshot(state, legacy, 4 as 1)).toThrow();
  const invalid = readRosterScenarios(saved.saved).collection;
  invalid.snapshots!.push(invalid.snapshots![0]);
  expect(readRosterScenarios(JSON.stringify(invalid)).issue).toContain(
    "preserved",
  );
});

// A later roster import may change real ownership, but loading a saved point restores its identities while using fresh forecasts.
it("restores saved ownership after an import without freezing player scoring data", async () => {
  const { m, state, scenario, d } = await sample();
  const working = writeRosterScenarios(state, {
    version: 1,
    active: scenario.id,
    scenarios: [scenario],
  });
  const saved = saveRosterSnapshot(
    state,
    working,
    1,
    "2026-10-27T14:00:00Z",
    scenarioRosterBase(m),
  );
  const fresh = evaluate(d, d.settings);
  Object.assign(fresh.byId.get("100")!, { owner: "2", expected: 42 });
  Object.assign(fresh.byId.get("200")!, { owner: "1" });
  const restored = applyRosterScenario(
    fresh,
    activeRosterScenario(saved.working),
  );
  expect(restored.byId.get("100")!.owner).toBe("1");
  expect(restored.byId.get("200")!.owner).toBe("2");
  expect(restored.byId.get("100")!.expected).toBe(42);
  expect(fresh.byId.get("100")!.owner).toBe("2");
  // Missing identities stay visibly conditional rather than substituting a different player or losing the saved slot.
  const missing = {
    ...activeRosterScenario(saved.working)!,
    baseRoster: [["missing", "1", 20] as [string, string, number]],
  };
  expect(
    applyRosterScenario(fresh, missing).simulation!.issues.join(),
  ).toContain("cannot be fully restored");
});
