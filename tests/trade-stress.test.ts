import { expect, it } from "vitest";
import { initialState } from "../src/domain/contracts";
import { evaluate } from "../src/domain/valuation";
import { evaluateTrade } from "../src/domain/trades";
import { forHypotheticalScoring } from "../src/domain/lineups";
import { tradeImpact } from "../src/domain/trade-impact";
import {
  evaluateStressTest,
  type StressRecipe,
} from "../src/domain/trade-stress";
import {
  readSavedTrades,
  saveTrade,
  savedTradesKey,
  summaryFromTrade,
} from "../src/domain/saved-trades";
import { starterFixture } from "./fixtures";

// A single-QB synthetic league makes scoring changes independently calculable without real league data.
async function sample() {
  const dataset = await starterFixture();
  Object.assign(dataset.tables.ModelContext[0], {
    RBSlots: 0,
    WRSlots: 0,
    TESlots: 0,
    KSlots: 0,
    DSTSlots: 0,
    FlexSlots: 0,
    BenchSlots: 3,
  });
  const model = forHypotheticalScoring(evaluate(dataset, dataset.settings));
  const incoming = model.byId.get("200")!;
  Object.assign(incoming, { expected: 35, value: 35, penalty: 0 });
  const draft = { teamA: "1", teamB: "2", give: ["101"], get: ["200"] };
  const recipe = (player: string, ppg: number): StressRecipe => ({
    version: 1,
    adjustments: [{ player, ppg }],
  });
  return { model, draft, recipe };
}

// Current-model equality and source immutability prevent optional sensitivity from leaking into normal trades/search.
it("preserves normal scoring, facts and valuations while reproducing the baseline", async () => {
  const { model, draft, recipe } = await sample();
  const snapshot = JSON.stringify(model.players);
  const current = tradeImpact(
    evaluateTrade(model, draft, false),
    "best-available",
  )!;
  const result = evaluateStressTest(model, draft, recipe("200", 35));
  expect(result.errors).toEqual([]);
  expect(result.baseline!.own.gain).toBeCloseTo(current.own.expectedPerWeek!);
  expect(result.scenario).toEqual(result.baseline);
  expect(result.baseline!.own).toEqual({ before: 30, after: 35, gain: 5 });
  expect(JSON.stringify(model.players)).toBe(snapshot);
  expect(
    tradeImpact(evaluateTrade(model, draft, false), "best-available"),
  ).toEqual(current);
});

// The same assumed incoming score must reduce their before total and our after total, with both rosters reoptimized.
it("applies assumptions on both sides and exposes a gain-to-loss change and verifiable break-even", async () => {
  const { model, draft, recipe } = await sample();
  const result = evaluateStressTest(model, draft, recipe("200", 25));
  expect(result.scenario!.own).toEqual({ before: 30, after: 25, gain: -5 });
  expect(result.scenario!.other).toEqual({ before: 25, after: 30, gain: 5 });
  expect(result.conclusion).toContain("becomes a loss");
  expect(result.breakEven).toMatchObject({
    player: "200",
    direction: "at least",
  });
  expect(result.breakEven!.ppg).toBeCloseTo(30, 5);
  expect(
    evaluateStressTest(model, draft, recipe("200", 29.9)).scenario!.own.gain,
  ).toBeLessThan(0);
  expect(
    evaluateStressTest(model, draft, recipe("200", 30.1)).scenario!.own.gain,
  ).toBeGreaterThan(0);
  const outgoing = evaluateStressTest(model, draft, recipe("101", 40));
  expect(outgoing.scenario!.own).toEqual({ before: 40, after: 35, gain: -5 });
  expect(outgoing.breakEven!.direction).toBe("at most");
  expect(outgoing.breakEven!.ppg).toBeCloseTo(35, 5);
});

// Multiple assumptions stay explicit; zero/negative scores remain numeric and cannot force inferior starters into a lineup.
it("supports both-side packages, zeros and negative scoring without a misleading multi-player threshold", async () => {
  const { model, draft } = await sample();
  const result = evaluateStressTest(model, draft, {
    version: 1,
    adjustments: [
      { player: "101", ppg: 40 },
      { player: "200", ppg: 0 },
    ],
  });
  expect(result.errors).toEqual([]);
  expect(result.scenario!.own).toEqual({ before: 40, after: 20, gain: -20 });
  expect(result.scenario!.other.before).toBe(0);
  expect(result.breakEven).toBeUndefined();
  const negative = evaluateStressTest(model, draft, {
    version: 1,
    adjustments: [{ player: "200", ppg: -5 }],
  });
  expect(negative.errors).toEqual([]);
  expect(negative.scenario!.own.after).toBe(20);
});

// Required drops must change when the assumed player becomes the more useful retained starter.
it("recalculates required drops and retains unresolved legality as conditional", async () => {
  const { model, recipe } = await sample();
  Object.assign(model.dataset.tables.ModelContext[0], { BenchSlots: 0 });
  // Only QB identities belong in this narrow fixture's legal rosters.
  model.players = model.players.filter(
    (p) => p.pos === "QB" || p.owner === "0",
  );
  model.byId = new Map(model.players.map((p) => [p.id, p]));
  const draft = { teamA: "1", teamB: "2", give: ["100", "101"], get: ["200"] };
  const result = evaluateStressTest(model, draft, recipe("100", 40));
  expect(result.errors).toEqual([]);
  expect(result.baseline!.dropsB).toEqual(["100"]);
  expect(result.scenario!.dropsB).toEqual(["101"]);
  model.byId.get("100")!.droppable = false;
  model.byId.get("101")!.droppable = false;
  const conflict = evaluateStressTest(model, draft, recipe("100", 40));
  expect(conflict.scenario!.legal).toBe(false);
  expect(conflict.conclusion).toContain("conditional");
  expect(conflict.breakEven).toBeUndefined();
});

// Hypothetical availability remains identical before/after; IR is never made eligible by a scoring override.
it("preserves scheduled/hypothetical policies and refuses to invent a threshold for excluded IR", async () => {
  const { model, draft, recipe } = await sample();
  Object.assign(model.byId.get("200")!, {
    injury: "INJURY_RESERVE",
    slot: 21,
    irEligible: true,
  });
  const result = evaluateStressTest(model, draft, recipe("200", 50));
  expect(result.errors).toEqual([]);
  expect(result.scenario!.own.after).toBe(20);
  expect(result.breakEven!.ppg).toBeNull();
  const scheduled = {
    ...model,
    ignoreByeWeeks: false,
    ignoreTemporaryAbsences: false,
  };
  expect(
    evaluateStressTest(scheduled, draft, recipe("200", 50)).baseline!.own.gain,
  ).toBeCloseTo(
    tradeImpact(evaluateTrade(scheduled, draft, false), "best-available")!.own
      .expectedPerWeek!,
  );
});

// Bad evidence or malformed overrides must produce unavailable results rather than replace missing facts with zeros.
it("rejects unknown players, duplicates, nonfinite assumptions and unusable baseline data", async () => {
  const { model, draft, recipe } = await sample();
  for (const input of [
    recipe("102", 20),
    recipe("200", NaN),
    recipe("200", Infinity),
    { version: 1, adjustments: [] },
    {
      version: 1,
      adjustments: [
        { player: "200", ppg: 1 },
        { player: "200", ppg: 2 },
      ],
    },
  ])
    expect(
      evaluateStressTest(model, draft, input).errors.length,
    ).toBeGreaterThan(0);
  model.byId.get("101")!.value = null;
  expect(
    evaluateStressTest(model, draft, recipe("101", 40)).baseline,
  ).toBeUndefined();
});

// Recipes round-trip through the existing saved-trade payload without replacing normal summaries or older saved records.
it("saves/restores assumptions, preserves them on search saves, and permits explicit clearing", async () => {
  const { model, draft, recipe } = await sample();
  const state = initialState(model.dataset);
  const summary = summaryFromTrade(evaluateTrade(model, draft));
  const stress = recipe("200", 25);
  state.filters[savedTradesKey] = saveTrade(
    state,
    model,
    draft,
    summary,
    undefined,
    undefined,
    stress,
  );
  expect(
    readSavedTrades(state.filters[savedTradesKey]).trades[0],
  ).toMatchObject({ stressTest: stress, original: summary });
  state.filters[savedTradesKey] = saveTrade(state, model, draft, summary);
  expect(
    readSavedTrades(state.filters[savedTradesKey]).trades[0].stressTest,
  ).toEqual(stress);
  state.filters[savedTradesKey] = saveTrade(
    state,
    model,
    draft,
    summary,
    undefined,
    undefined,
    null,
  );
  expect(
    readSavedTrades(state.filters[savedTradesKey]).trades[0].stressTest,
  ).toBeUndefined();
  expect(() =>
    saveTrade(
      state,
      model,
      draft,
      summary,
      undefined,
      undefined,
      recipe("102", 20),
    ),
  ).toThrow("belong");
});
