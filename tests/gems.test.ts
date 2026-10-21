import { expect, it } from "vitest";
import { fixture } from "./fixtures";
import { evaluate, playerSignals } from "../src/domain/valuation";
import { assessGem } from "../src/domain/gems";
import { playedHistory } from "../src/domain/opportunity";
import {
  decodeGemFilters,
  encodeGemFilters,
  screenGems,
  validateGemDraft,
} from "../src/domain/gem-screening";

// Supply verified weekly workload only: no role reviews, supplemental sources, CSVs or manual assertions.
async function data(
  counts = [3, 2, 5, 8, 8, 7],
  position = "TE",
  scores = counts.map(() => 10),
) {
  const d = await fixture(scores);
  d.tables.ModelPlayers[0].Position = position;
  d.tables.ModelHistory.filter((h) => h.PlayerID === 1).forEach((h, i) =>
    Object.assign(h, {
      Targets: position === "RB" ? 2 : counts[i],
      RushAttempts: position === "RB" ? counts[i] - 2 : 0,
      Receptions: 2,
      ReceivingTD: 0,
      RushTD: 0,
    }),
  );
  return d;
}

// Initial evaluation alone must qualify Gems when all imported-data gates pass.
it("automatically awards Gems with no manual role confirmation", async () => {
  const d = await data(),
    p = evaluate(d, d.settings).players[0];
  expect(p.gem).toBe("Gem");
  expect(p.breakout!.recent).toBeCloseTo(23 / 3);
  expect(p.breakout!.previous).toBeCloseTo(10 / 3);
  expect(p.breakout!.checks).toHaveLength(5);
  expect(p.breakout!.checks.every((c) => c.status === "PASS")).toBe(true);
});

// A single weak workload game and unchanged production cannot be hidden by a high scoring average.
it("retains workload floor and developing-role requirements", async () => {
  const inconsistent = await data([7, 4, 3, 10, 1, 9]);
  const p = evaluate(inconsistent, inconsistent.settings).players[0];
  expect(p.gem).toBe("Watch");
  expect(
    p.breakout!.checks.find((c) => c.check === "Each of the last 3 games"),
  ).toMatchObject({ actual: "10, 1, 9", status: "FAIL" });
  for (const counts of [
    [8, 8, 8, 8, 8, 8],
    [1, 1, 1, 2, 2, 2],
  ]) {
    const d = await data(
      counts,
      "TE",
      counts.map(() => 30),
    );
    expect(evaluate(d, d.settings).players[0].gem).toBe("No breakout signal");
  }
});

// Missing current context creates automatic warnings, never a human-review prerequisite or an expiry veto.
it("recognizes a growing RB despite missing commentary and warns about stale data and injured competition", async () => {
  const d = await data([11, 6, 7, 16, 28, 19], "RB");
  d.tables.ModelPlayers.find((p) => p.PlayerID === 103)!.InjuryStatus = "OUT";
  d.sourceUTC = new Date(Date.now() - 2 * 86400000).toISOString();
  const p = evaluate(d, d.settings).players[0];
  expect(p.gem).toBe("Gem");
  expect(p.breakout!.recent).toBe(21);
  expect(p.opportunity.recentCarries).toBe(19);
  expect(p.opportunity.recentTargets).toBe(2);
  expect(p.breakout!.warnings.join()).toContain("does not establish");
  expect(p.breakout!.warnings.join()).toContain("Stale or undated snapshot");
  d.sourceUTC = null;
  expect(evaluate(d, d.settings).players[0].gem).toBe("Gem");
});

// Inclusive growth boundaries retain precision and handle a zero prior denominator without inventing a percentage.
it("handles zero prior workload, growth boundaries and five-game minimums", async () => {
  const zero = await data([0, 0, 0, 6, 6, 6]);
  const p = evaluate(zero, zero.settings).players[0];
  expect(p.gem).toBe("Gem");
  expect(p.breakout!.growthPct).toBeNull();
  for (const [counts, position, label] of [
    [[4, 4, 4, 6, 6, 6], "TE", "Gem"],
    [[4.000001, 4.000001, 4.000001, 6, 6, 6], "TE", "Watch"],
    [[24, 24, 24, 27, 27, 27], "RB", "Watch"],
    [[2, 3, 6, 6, 6], "TE", "Gem"],
    [[2, 6, 6, 6], "TE", "Watch"],
  ] as const) {
    const d = await data([...counts], position);
    expect(evaluate(d, d.settings).players[0].gem).toBe(label);
  }
});

// Zero and negative scoring games remain played games; nonparticipation does not shift the workload windows.
it("uses the immediately preceding played games and retains zero and negative scores", async () => {
  const d = await data([2, 3, 2, 5, 8, 8, 7], "TE", [0, -2, 5, 10, 12, 10, 8]);
  d.tables.ModelHistory.push({
    PlayerID: 1,
    Season: 2026,
    Week: 8,
    Games: 0,
    Points: 0,
    HistoryStatus: "Valid",
  });
  const p = evaluate(d, d.settings).players[0];
  expect(p.games).toBe(7);
  expect(p.breakout!.previousWeeks).toEqual([2, 3, 4]);
  expect(p.breakout!.recentWeeks).toEqual([5, 6, 7]);
  expect(
    playedHistory(d)
      .get("1")!
      .map((r) => r.Points),
  ).toContain(-2);
});

// Invalid or absent evidence stays unknown; an explicitly present null counting stat is a legitimate zero.
it("does not invent missing workload or accept conflicting history", async () => {
  const missing = await data();
  delete missing.tables.ModelHistory.find((h) => h.PlayerID === 1)!.Targets;
  expect(evaluate(missing, missing.settings).players[0].gem).toBe(
    "Insufficient data",
  );
  const duplicate = await data();
  duplicate.tables.ModelHistory.push({ ...duplicate.tables.ModelHistory[0] });
  expect(evaluate(duplicate, duplicate.settings).players[0].gem).toBe(
    "Insufficient data",
  );
  const zero = await data([0, 0, 0, 6, 6, 6]);
  zero.tables.ModelHistory.find((h) => h.PlayerID === 1)!.Targets = null;
  expect(evaluate(zero, zero.settings).players[0].gem).toBe("Gem");
});

// Player availability is read automatically; injuries cannot be resolved by unsupported assumptions.
it("keeps injury and no-remaining-game cases conditional and excludes unsupported positions", async () => {
  const d = await data();
  d.tables.ModelPlayers[0].InjuryStatus = "QUESTIONABLE";
  expect(evaluate(d, d.settings).players[0].gem).toBe("Watch");
  d.tables.ModelPlayers[0].InjuryStatus = "ACTIVE";
  const p = evaluate(d, d.settings).players[0];
  expect(
    assessGem({ ...p, available: 0 }, playedHistory(d).get("1")!, d)
      .classification,
  ).toBe("Watch");
  expect(assessGem({ ...p, pos: "QB" }, [], d).classification).toBe(
    "Not applicable",
  );
});

// Breakout classification must not change forecasts, consistency adjustments, replacement baselines or surplus values.
it("preserves the core valuation model and Excel parity mode", async () => {
  const d = await data(),
    app = evaluate(d, d.settings),
    workbook = evaluate(d, d.settings, { workbookMode: true });
  for (const p of app.players) {
    const prior = workbook.byId.get(p.id)!;
    for (const key of [
      "actual",
      "recent",
      "projected",
      "expected",
      "penalty",
      "value",
      "baseline",
      "vorp",
      "index",
    ] as const)
      expect(p[key]).toEqual(prior[key]);
  }
  expect(app.analysisVersion).toContain("automatic-breakout-2");
  expect(workbook.players[0].breakout).toBeUndefined();
});

// Saved searches migrate without a review/Apply requirement and keep both numeric-only and classification filtering.
it("automatically migrates saved searches and preserves numeric thresholds", async () => {
  const restored = decodeGemFilters(
    {
      gemFilterVersion: "1",
      gemSignals: '["Gem candidate","Opportunity watch"]',
      gemPool: "All",
      gemPos: "TE",
      gemTrendMin: "2",
      gemIndexMin: "10",
      gemIndexMax: "40",
    },
    "1",
  );
  expect(restored.issue).toBe("");
  expect(restored.draft.signals).toEqual(["Gem", "Watch"]);
  expect(restored.draft).toMatchObject({
    trendMin: "2",
    indexMin: "10",
    indexMax: "40",
    position: "TE",
  });
  const d = await data(),
    p = { ...evaluate(d, d.settings).players[0], trendDelta: 2, index: 20 };
  const q = validateGemDraft(
    { ...restored.draft, classification: "Gem only" },
    ["1"],
  ).query!;
  expect(
    screenGems([p, { ...p, id: "other", gem: "Watch" }], q).matches,
  ).toHaveLength(1);
  expect(decodeGemFilters(encodeGemFilters(q), "1").issue).toBe("");
  const cleared = decodeGemFilters(
    { gemFilterVersion: "2", gemSignals: "[]", gemTrendMin: "2" },
    "1",
  );
  expect(cleared.issue).toBe("");
  expect(cleared.draft.signals).toEqual([]);
  expect(playerSignals(p)).toContain("Gem");
});
