import { expect, it } from "vitest";
import { fixture } from "./fixtures";
import { evaluate, playerSignals } from "../src/domain/valuation";
import { assessGem } from "../src/domain/gems";
import { playedHistory } from "../src/domain/opportunity";
import {
  decodeGemFilters,
  defaultGemDraft,
  encodeGemFilters,
  screenGems,
  validateGemDraft,
} from "../src/domain/gem-screening";

// The overlapping Gem windows must pair each score/workload value with its real week instead of unlabeled lists.
it("labels individual scoring and workload evidence by week in both Gem windows", async () => {
  const d = await data([7, 8, 9, 10], "WR", [16, 17, 18, 19]);
  const p = evaluate(d, d.settings).players[0];
  expect(p.gem).toBe("Gem");
  const checks = p.breakout!.checks;
  expect(
    checks.find((c) => c.check === "Recent window scoring support")!.actual,
  ).toBe(
    "2026 W2: 17.00, 2026 W3: 18.00, 2026 W4: 19.00 points; 3/3 meet the floor",
  );
  expect(
    checks.find((c) => c.check === "Previous window scoring support")!.actual,
  ).toBe(
    "2026 W1: 16.00, 2026 W2: 17.00, 2026 W3: 18.00 points; 3/3 meet the floor",
  );
  expect(
    checks.find((c) => c.check === "Recent window workload support")!.actual,
  ).toBe(
    "2026 W2: 8.00, 2026 W3: 9.00, 2026 W4: 10.00 targets; 3/3 meet the floor",
  );
});

// Sustained-decline boundaries must honor both average thresholds and require two individual lower-workload games.
it("detects sustained positional declines and rejects one-game dips or insufficient reductions", async () => {
  for (const [counts, position, status] of [
    [[14, 13, 8, 11, 11], "WR", "PASS"],
    [[10, 10, 10, 8, 8, 8], "WR", "PASS"],
    [[14, 13, 13, 10, 11, 11], "WR", "PASS"],
    [[15, 15, 15, 12, 12, 12], "RB", "PASS"],
    [[10, 10, 10, 8, 8, 8], "TE", "PASS"],
    [[10, 10, 10, 6, 6, 12], "WR", "PASS"],
    [[10, 10, 10, 0, 10, 10], "WR", "FAIL"],
    [[20, 20, 20, 17, 17, 17], "WR", "FAIL"],
    [[10, 10, 10, 8, 8, 8], "RB", "FAIL"],
    [[10, 10, 10, 8.000001, 8.000001, 8.000001], "WR", "FAIL"],
    [[0, 0, 0, 0, 0, 0], "TE", "FAIL"],
  ] as const) {
    const d = await data([...counts], position);
    const p = evaluate(d, d.settings).players[0];
    expect(p.breakout!.reducedWorkload?.status).toBe(status);
    expect(playerSignals(p).includes("Reduced workload")).toBe(
      status === "PASS",
    );
  }
});

// Missing participation/count evidence cannot become a positive decline flag, and unsupported positions remain excluded.
it("requires complete five-game workload evidence for a decline signal", async () => {
  const short = await data([14, 13, 8, 8], "WR");
  expect(
    evaluate(short, short.settings).players[0].breakout!.reducedWorkload
      ?.status,
  ).toBe("UNKNOWN");
  const missing = await data([14, 13, 8, 11, 11], "WR");
  delete missing.tables.ModelHistory.find(
    (h) => h.PlayerID === 1 && h.Week === 5,
  )!.Targets;
  expect(
    evaluate(missing, missing.settings).players[0].breakout!.reducedWorkload
      ?.status,
  ).toBe("UNKNOWN");
  const duplicate = await data([14, 13, 8, 11, 11], "WR");
  duplicate.tables.ModelHistory.push({ ...duplicate.tables.ModelHistory[0] });
  expect(
    playerSignals(evaluate(duplicate, duplicate.settings).players[0]),
  ).not.toContain("Reduced workload");
  const d = await data(),
    p = evaluate(d, d.settings).players[0];
  expect(assessGem({ ...p, pos: "QB" }, [], d).reducedWorkload).toBeNull();
});

// Scoring, injury and nonparticipation do not invent role causes or silently exclude verified low-scoring games.
it("includes zero, negative and injured played games but excludes nonparticipation from decline windows", async () => {
  const d = await data([14, 13, 8, 11, 11], "WR", [20, 20, 0, -1, 10]);
  // Make the zero-participation week completed so exclusion is tested independently of the current-week cutoff.
  d.tables.ModelContext[0].CurrentWeek = 7;
  d.tables.ModelPlayers[0].InjuryStatus = "QUESTIONABLE";
  d.tables.ModelHistory.push({
    PlayerID: 1,
    Season: 2026,
    Week: 6,
    Games: 0,
    Points: 0,
    Targets: 0,
    HistoryStatus: "Valid",
  });
  const p = evaluate(d, d.settings).players[0];
  expect(playerSignals(p)).toContain("Reduced workload");
  expect(p.breakout!.recentWeeks).toEqual([3, 4, 5]);
  expect(p.breakout!.reducedWorkload!.actual).toContain("3/3 recent games");
});

// The additional signal is selectable and persistent without changing primary classification, defaults or valuation formulas.
it("screens reduced workloads independently and preserves existing classification and value", async () => {
  const d = await data([14, 13, 8, 11, 11], "WR");
  const p = evaluate(d, d.settings).players[0],
    prior = evaluate(d, d.settings, { workbookMode: true }).players[0];
  expect(p.gem).toBe("No breakout signal");
  expect(p.breakout!.checks).toHaveLength(10);
  for (const key of [
    "expected",
    "penalty",
    "value",
    "baseline",
    "vorp",
    "index",
  ] as const)
    expect(p[key]).toEqual(prior[key]);
  const draft = {
    ...defaultGemDraft("1"),
    pool: "All",
    position: "WR",
    signals: ["Reduced workload"],
  };
  const query = validateGemDraft(draft, ["1"]).query!;
  expect(screenGems([p], query).matches).toHaveLength(1);
  expect(decodeGemFilters(encodeGemFilters(query), "1").draft).toEqual(draft);
  expect(defaultGemDraft("1").signals).not.toContain("Reduced workload");
});

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

// Four stable games at each inclusive positional boundary qualify without growth, ownership or a manual review.
it("automatically confirms scoring and workload for RB, WR and TE after four played games", async () => {
  for (const [position, workload, points] of [
    ["RB", 18, 16],
    ["WR", 7, 16],
    ["TE", 6, 11],
  ] as const) {
    const d = await data(
      Array(4).fill(workload),
      position,
      Array(4).fill(points),
    );
    for (const owner of [0, 1, 2]) {
      d.tables.ModelPlayers[0].OnTeamID = owner;
      const p = evaluate(d, d.settings).players[0];
      expect(p.gem).toBe("Gem");
      expect(p.breakout!.checks).toHaveLength(10);
      expect(p.breakout!.checks.every((c) => c.status === "PASS")).toBe(true);
      expect(p.breakout!.checks[0].actual).toContain(
        "previous-window weeks 1, 2, 3",
      );
      expect(p.breakout!.explanation).toContain("growth is not required");
    }
  }
});

// Both overlapping windows need their means and two separate games of scoring/workload support.
it("rejects a single strong window, one-game spikes and values just below inclusive means", async () => {
  for (const [counts, scores, check] of [
    [[2, 7, 7, 7], [16, 16, 16, 16], "Previous window targets / game"],
    [[7, 7, 7, 7], [0, 16, 16, 16], "Previous window actual PPG"],
    [[7, 7, 7, 7], [0, 0, 48, 0], "Recent window scoring support"],
    [[0, 0, 21, 0], [16, 16, 16, 16], "Recent window workload support"],
    [[7, 7, 7, 7], [16, 16, 16, 15.999999], "Recent window actual PPG"],
    [[7, 7, 7, 6.999999], [16, 16, 16, 16], "Recent window targets / game"],
  ] as const) {
    const d = await data([...counts], "WR", [...scores]);
    const p = evaluate(d, d.settings).players[0];
    expect(p.gem).not.toBe("Gem");
    expect(p.breakout!.checks.find((c) => c.check === check)?.status).toBe(
      "FAIL",
    );
  }
  const short = await data([7, 7, 7], "WR", [16, 16, 16]);
  expect(evaluate(short, short.settings).players[0].gem).toBe("Watch");
  expect(
    evaluate(short, short.settings).players[0].breakout!.checks[0].status,
  ).toBe("FAIL");
});

// A weak played game stays in both windows; two good games may still support an adequate average.
it("retains zero and negative scores and excludes nonparticipation from confirmation windows", async () => {
  for (const scores of [
    [20, 0, 28, 20],
    [20, -1, 29, 20],
  ]) {
    const d = await data([9, 0, 12, 9], "WR", scores);
    d.tables.ModelHistory.push({
      PlayerID: 1,
      Season: 2026,
      Week: 5,
      Games: 0,
      Points: 0,
      Targets: 0,
      HistoryStatus: "Valid",
    });
    const p = evaluate(d, d.settings).players[0];
    expect(p.games).toBe(4);
    expect(p.gem).toBe("Gem");
    expect(p.breakout!.recentWeeks).toEqual([2, 3, 4]);
    expect(
      playedHistory(d)
        .get("1")!
        .map((r) => r.Points),
    ).toEqual(scores);
  }
});

// A formerly workload-only Gem becomes Watch; its existing opportunity boundaries stay intact.
it("preserves Watch growth and short-history eligibility without awarding workload-only Gems", async () => {
  for (const [counts, position, label] of [
    [[3, 2, 5, 8, 8, 7], "TE", "Watch"],
    [[0, 0, 0, 6, 6, 6], "TE", "Watch"],
    [[4, 4, 4, 6, 6, 6], "TE", "Watch"],
    [[4.000001, 4.000001, 4.000001, 6, 6, 6], "TE", "Watch"],
    [[24, 24, 24, 27, 27, 27], "RB", "Watch"],
    [[2, 6, 6, 6], "TE", "Watch"],
    [[8, 8, 8, 8, 8, 8], "TE", "No breakout signal"],
    [[1, 1, 1, 2, 2, 2], "TE", "No breakout signal"],
  ] as const) {
    const d = await data([...counts], position);
    expect(evaluate(d, d.settings).players[0].gem).toBe(label);
  }
});

// Warnings remain informative and automatic; they do not become manual review or expiration gates.
it("warns about stale data and injured competition without vetoing a confirmed Gem", async () => {
  const d = await data([18, 18, 18, 18], "RB", [16, 16, 16, 16]);
  d.tables.ModelPlayers.find((p) => p.PlayerID === 103)!.InjuryStatus = "OUT";
  d.sourceUTC = new Date(Date.now() - 2 * 86400000).toISOString();
  const p = evaluate(d, d.settings).players[0];
  expect(p.gem).toBe("Gem");
  expect(p.breakout!.recent).toBe(18);
  expect(p.opportunity.recentCarries).toBe(16);
  expect(p.opportunity.recentTargets).toBe(2);
  expect(p.breakout!.warnings.join()).toContain("does not establish");
  expect(p.breakout!.warnings.join()).toContain("Stale or undated snapshot");
  d.sourceUTC = null;
  expect(evaluate(d, d.settings).players[0].gem).toBe("Gem");
});

// Re-evaluation adds the newest played game and drops the Gem label when confirmation no longer passes.
it("automatically removes Gem after a new weak game without changing saved selections", async () => {
  const before = await data([7, 7, 7, 7], "WR", [16, 16, 16, 16]);
  const after = await data([7, 7, 7, 7, 0], "WR", [16, 16, 16, 16, 0]);
  expect(evaluate(before, before.settings).players[0].gem).toBe("Gem");
  expect(evaluate(after, after.settings).players[0].gem).not.toBe("Gem");
});

// Invalid or absent evidence stays unknown; an explicitly present null counting stat is a legitimate zero.
it("does not invent missing workload or accept conflicting history", async () => {
  const missing = await data([6, 6, 6, 6], "TE", [11, 11, 11, 11]);
  delete missing.tables.ModelHistory.find((h) => h.PlayerID === 1)!.Targets;
  expect(evaluate(missing, missing.settings).players[0].gem).toBe(
    "Insufficient data",
  );
  const duplicate = await data([6, 6, 6, 6], "TE", [11, 11, 11, 11]);
  duplicate.tables.ModelHistory.push({ ...duplicate.tables.ModelHistory[0] });
  expect(evaluate(duplicate, duplicate.settings).players[0].gem).toBe(
    "Insufficient data",
  );
  // Explicit null carries are zero, while targets alone can supply the required RB workload.
  const zero = await data([18, 18, 18, 18], "RB", [16, 16, 16, 16]);
  zero.tables.ModelHistory.filter((h) => h.PlayerID === 1).forEach((h) =>
    Object.assign(h, { Targets: 18, RushAttempts: null }),
  );
  expect(evaluate(zero, zero.settings).players[0].gem).toBe("Gem");
  // Older missing usage affects the unchanged decline window, not valid last-four-game Gem evidence.
  const older = await data([7, 7, 7, 7, 7, 7], "WR", [16, 16, 16, 16, 16, 16]);
  delete older.tables.ModelHistory.find((h) => h.PlayerID === 1)!.Targets;
  const p = evaluate(older, older.settings).players[0];
  expect(p.gem).toBe("Gem");
  expect(p.breakout!.reducedWorkload?.status).toBe("UNKNOWN");
});

// Player availability is read automatically; injuries cannot be resolved by unsupported assumptions.
it("keeps injury and no-remaining-game cases conditional and excludes unsupported positions", async () => {
  const d = await data([3, 2, 7, 7, 7, 7], "TE", [11, 11, 11, 11, 11, 11]);
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
  expect(app.analysisVersion).toContain("automatic-breakout-3");
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
  const d = await data([6, 6, 6, 6], "TE", [11, 11, 11, 11]),
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
