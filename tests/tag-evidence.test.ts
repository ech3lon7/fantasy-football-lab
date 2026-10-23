import { expect, it } from "vitest";
import { activeTagExplanations } from "../src/domain/tag-evidence";
import { evidenceComparison } from "../src/domain/evidence-comparison";
import { evaluate, playerSignals } from "../src/domain/valuation";
import { fixture } from "./fixtures";

// Derive real labels from aligned synthetic scores/workload; never force a label merely to satisfy an explanation test.
async function sample(scores: number[], counts: number[], projection = 10) {
  const d = await fixture(scores);
  Object.assign(d.tables.ModelPlayers[0], {
    Position: "WR",
    Targets: counts.reduce((a, b) => a + b, 0),
    RushAttempts: 0,
    ReceivingTD: 0,
    ESPN_Projected_PPG: projection,
    ESPN_Projected_Total: projection * 17,
  });
  d.tables.ModelHistory.filter((h) => h.PlayerID === 1).forEach((h, i) =>
    Object.assign(h, {
      Targets: counts[i],
      RushAttempts: 0,
      ReceivingTD: 0,
      RushTD: 0,
    }),
  );
  const m = evaluate(d, d.settings),
    p = m.byId.get("1")!;
  return { d, m, p };
}

// Exact inclusive scoring/projection boundaries must agree with the engine, including genuine zero and negative scoring.
it("explains only active scoring watches using the selected thresholds and season projection", async () => {
  for (const [scores, projection, active] of [
    [[10, 10, 12, 12, 12], 12, true],
    [[10, 10, 12, 12, 12], 12.000001, false],
    [[10, 10, 11.999999, 11.999999, 11.999999], 10, false],
    [[-2, -2, 0, 0, 0], 0, true],
  ] as const) {
    const { m, p } = await sample([...scores], [0, 0, 0, 0, 0], projection);
    const before = JSON.stringify(p);
    const explanation = activeTagExplanations(p, m).find(
      (e) => e.tag === "Scoring breakout watch",
    );
    expect(!!explanation).toBe(active);
    if (explanation) {
      // Scoring explanations retain the actual scores and weeks, including zero and negative played games.
      expect(
        explanation.rows.find((r) => r.check === "Recent played-game evidence")!
          .actual,
      ).toContain(`2026 W3: ${scores[2].toFixed(2)} points`);
      expect(
        explanation.rows.find(
          (r) => r.check === "Earlier played-game evidence",
        )!.actual,
      ).toContain(`2026 W1: ${scores[0].toFixed(2)} points`);
      expect(
        explanation.rows.find((r) => r.check === "Scoring improvement")!
          .required,
      ).toContain(m.settings.GemMinGap.toFixed(2));
      expect(
        explanation.rows.find((r) => r.check === "ESPN season projected PPG")!
          .actual,
      ).toBe(projection.toFixed(2));
      expect(explanation.window).toContain("ALL earlier");
      // The recent-scoring minimum displays the actual ESPN season forecast, including a genuine zero forecast.
      expect(
        explanation.rows.find((r) => r.check === "Recent actual PPG")!
          .comparisons![0],
      ).toMatchObject({
        required: `≥ ${projection.toFixed(2)} PPG`,
        actual: `${p.recent!.toFixed(2)} PPG`,
        margin: "+0.00 PPG; at threshold",
      });
      expect(explanation.limitations).toContain(
        "No workload-growth requirement",
      );
    }
    expect(JSON.stringify(p)).toBe(before);
  }
  const { d } = await sample([10, 10, 12, 12, 12], [0, 0, 0, 0, 0], 12);
  const m = evaluate(d, { ...d.settings, GemMinGap: 3 });
  expect(
    activeTagExplanations(m.byId.get("1")!, m).some(
      (e) => e.tag === "Scoring breakout watch",
    ),
  ).toBe(false);
});

// Separate workload windows cannot be presented as interchangeable explanations for primary Watch and Role-growth watch.
it("describes Watch's early sample and OR routes while Role-growth uses all earlier games", async () => {
  const short = await sample([10, 10, 10], [7, 7, 7]);
  expect(short.p.gem).toBe("Watch");
  const early = activeTagExplanations(short.p, short.m).find(
    (e) => e.tag === "Watch",
  )!;
  expect(early.window).toContain("without requiring growth");
  expect(
    early.rows.find((r) => r.check === "Recent played-game evidence")!.actual,
  ).toContain("2026 W3: 10.00 points; 7.00 targets");
  expect(early.rows.some((r) => r.check === "Positive workload change")).toBe(
    false,
  );
  const growing = await sample([10, 10, 10, 10, 10], [2, 2, 5, 5, 5]);
  expect(growing.p.gem).toBe("Watch");
  const watch = activeTagExplanations(growing.p, growing.m).find(
    (e) => e.tag === "Watch",
  )!;
  expect(
    watch.rows.find((r) => r.check === "Level OR growth route")!.actual,
  ).toContain("150.00%");
  expect(watch.window).toContain("immediately preceding");
  // A failed workload-level alternative cannot erase the passing absolute AND percentage growth route.
  expect(
    watch.rows.find((r) => r.check === "Level OR growth route")!.comparisons,
  ).toMatchObject([
    {
      required: "≥ 7.00 targets/game",
      actual: "5.00 targets/game",
      margin: "−2.00 targets/game; below minimum",
      note: expect.stringContaining("OR"),
    },
    {
      required: "≥ 2.00 targets/game",
      actual: "3.00 targets/game",
      margin: "+1.00 targets/game; above minimum",
      note: expect.stringContaining("AND"),
    },
    {
      required: "≥ 25.00%",
      actual: "150.00%",
      margin: "+125.00 percentage points; above minimum",
    },
  ]);
  const zero = await sample(Array(5).fill(10), [0, 0, 2, 2, 2]);
  expect(
    activeTagExplanations(zero.p, zero.m)
      .find((e) => e.tag === "Watch")!
      .rows.find((r) => r.check === "Level OR growth route")!.comparisons![2]
      .margin,
  ).toBe("Not required");
  const distinct = await sample(Array(8).fill(10), [2, 2, 2, 2, 20, 8, 8, 8]);
  expect(distinct.p.gem).toBe("No breakout signal");
  expect(playerSignals(distinct.p)).toContain("Role-growth watch");
  const explanations = activeTagExplanations(distinct.p, distinct.m);
  expect(explanations.some((e) => e.tag === "Watch")).toBe(false);
  expect(
    explanations.find((e) => e.tag === "Role-growth watch")!.window,
  ).toContain("ALL 5 earlier");
  const role = explanations.find((e) => e.tag === "Role-growth watch")!;
  expect(
    role.rows.find((r) => r.check === "Workload increase")!.comparisons,
  ).toMatchObject([
    { required: "≥ 2.00 targets/game", actual: "2.40 targets/game" },
    { required: "≥ 1.12 targets/game", actual: "2.40 targets/game" },
  ]);
});

// Independent cautions can coexist with Gem; the decline explanation must reuse the classifier's exact evidence verbatim.
it("reuses sustained-decline evidence and does not invent explanations for inactive data or injury tags", async () => {
  const { m, p } = await sample(Array(5).fill(16), [14, 13, 8, 11, 11], 16);
  expect(p.gem).toBe("Gem");
  const explanations = activeTagExplanations(p, m);
  expect(explanations.map((e) => e.tag)).toEqual(["Reduced workload"]);
  expect(explanations[0].rows[0]).toMatchObject({
    required: p.breakout!.reducedWorkload!.required,
    actual: p.breakout!.reducedWorkload!.actual,
  });
  // Decline averages, relative loss, sustained-game support and sample size appear as separate AND requirements.
  expect(explanations[0].rows[0].comparisons).toMatchObject([
    {
      required: "≥ 2.00 targets/game",
      actual: "3.50 targets/game",
      margin: "+1.50 targets/game; above minimum",
    },
    { required: "≥ 20.00%", actual: "25.93%" },
    {
      required: "≥ 2 games",
      actual: "3 games",
      margin: "+1 games; above minimum",
    },
    { required: "≥ 5 games", actual: "5 games" },
  ]);
  const empty = await sample(Array(5).fill(10), [0, 0, 0, 0, 0]);
  expect(activeTagExplanations(empty.p, empty.m)).toEqual([]);
  const missing = {
    ...empty.p,
    injury: "OUT",
    status: "Insufficient data",
    gem: "Insufficient data",
  };
  expect(activeTagExplanations(missing, empty.m)).toEqual([]);
});

// Regression explanations read the actual positional sample and strict volume/rate cutoffs used to assign Buy Low/Sell High.
it("explains BUY LOW SELL HIGH and TD caution with exact peer statistics and no price claims", async () => {
  const { d } = await sample(Array(5).fill(10), Array(5).fill(20));
  for (const raw of d.tables.ModelPlayers.filter((p) => p.Position === "WR")) {
    const id = raw.PlayerID,
      targets = id === 1 ? 20 : id === 2 ? 4 : 8;
    const tds = id === 1 ? 0 : id === 2 ? 6 : 1;
    Object.assign(raw, {
      Targets: targets * 5,
      RushAttempts: 0,
      ReceivingTD: tds,
    });
    d.tables.ModelHistory.filter((h) => h.PlayerID === id).forEach((h, i) =>
      Object.assign(h, {
        Targets: targets,
        RushAttempts: 0,
        RushTD: 0,
        ReceivingTD: i === 0 ? tds : 0,
      }),
    );
  }
  const m = evaluate(d, d.settings),
    buy = m.byId.get("1")!,
    sell = m.byId.get("2")!;
  expect(buy.regression).toBe("BUY LOW");
  expect(sell.regression).toBe("SELL HIGH");
  expect(playerSignals(sell)).toContain("TD caution");
  for (const p of [buy, sell]) {
    const explanation = activeTagExplanations(p, m).find(
      (e) => e.tag === p.regression,
    )!;
    const g = p.regressionEvidence!;
    const expected =
      g.meanRate + (p.regression === "BUY LOW" ? -0.5 : 1.5) * g.rateSD;
    expect(
      explanation.rows.find((r) => r.check === "Player touchdown rate")!
        .required,
    ).toContain((expected * 100).toFixed(2) + "%");
    expect(
      explanation.rows.find((r) => r.check === "Positional volume test")!
        .required,
    ).toContain("52.00");
    expect(explanation.limitations).toContain("not a market-price judgment");
    expect(explanation.window).toContain("owned or available");
    // Model-derived peer cutoffs and strict directions remain numerical, including the TD-caution duplicate evidence.
    expect(
      explanation.rows.find((r) => r.check === "Positional volume test")!
        .comparisons![0],
    ).toMatchObject({
      required: `${p === buy ? "≥" : "<"} 52.00 opportunities`,
      actual: `${p.opportunities!.toFixed(2)} opportunities`,
      margin:
        p === buy
          ? "+48.00 opportunities; above minimum"
          : "+32.00 opportunities; below maximum",
    });
    expect(
      explanation.rows.find((r) => r.check === "Player touchdown rate")!
        .comparisons![0].required,
    ).toBe(`${p === buy ? "<" : ">"} ${(expected * 100).toFixed(2)}%`);
    // Regression tags show the same aligned per-game opportunities and touchdowns as their cumulative tests.
    expect(
      explanation.rows.find((r) => r.check === "Season played-game evidence")!
        .actual,
    ).toContain(
      `2026 W1: ${p.id === "1" ? "10.00 points; 20.00 targets; 0.00 TDs" : "15.00 points; 4.00 targets; 6.00 TDs"}`,
    );
  }
  expect(activeTagExplanations(sell, m).map((e) => e.tag)).toEqual([
    "SELL HIGH",
    "TD caution",
  ]);
  expect(
    activeTagExplanations(sell, m)
      .find((e) => e.tag === "TD caution")!
      .rows.find((r) => r.check === "Player touchdown rate")!.comparisons,
  ).toEqual(
    activeTagExplanations(sell, m)
      .find((e) => e.tag === "SELL HIGH")!
      .rows.find((r) => r.check === "Player touchdown rate")!.comparisons,
  );
});

// Projection comparisons keep nulls unavailable rather than silently fabricating zero thresholds or percentages.
it("shows actual versus projected scoring with the engine's settings and preserves unavailable evidence", async () => {
  const { m, p } = await sample([16, 16, 16, 16, 16], [0, 0, 0, 0, 0], 10);
  expect(playerSignals(p)).toContain("Projection-gap watch");
  const explanation = activeTagExplanations(p, m).find(
    (e) => e.tag === "Projection-gap watch",
  )!;
  expect(
    explanation.rows.find((r) => r.check === "Season scoring gap")!.actual,
  ).toBe("6.00 PPG");
  expect(
    explanation.rows.find((r) => r.check === "Season played-game evidence")!
      .actual,
  ).toContain("2026 W1: 16.00 points; 0.00 targets");
  expect(
    explanation.rows.find((r) => r.check === "Relative scoring gap")!.required,
  ).toBe("At least 20.00%");
  expect(
    explanation.rows.find((r) => r.check === "Season scoring gap")!
      .comparisons![0],
  ).toMatchObject({
    required: "≥ 2.00 PPG",
    actual: "6.00 PPG",
    margin: "+4.00 PPG; above minimum",
  });
  expect(
    explanation.rows.find((r) => r.check === "Relative scoring gap")!
      .comparisons![0],
  ).toMatchObject({
    required: "≥ 20.00%",
    actual: "60.00%",
    margin: "+40.00 percentage points; above minimum",
  });
  const unavailable = {
    ...p,
    regression: "BUY LOW",
    regressionEvidence: undefined,
  };
  const buy = activeTagExplanations(unavailable, m).find(
    (e) => e.tag === "BUY LOW",
  )!;
  expect(
    buy.rows.find((r) => r.check === "Positional volume test")!.required,
  ).toContain("Unavailable");
  expect(
    buy.rows.find((r) => r.check === "Positional volume test")!.comparisons![0],
  ).toMatchObject({ required: "Unavailable", margin: "Unavailable" });
  expect(JSON.stringify(buy)).not.toMatch(/NaN|Infinity/);
});

// Watch's prior workload window excludes older games, while scoring/role trends include every earlier played game.
it("restores distinct numerical game trails and labels each point value with the actual season/week", async () => {
  const { d, m, p } = await sample(
    [1, 2, 3, 4, 5, 6, 7, 8],
    [2, 2, 2, 2, 2, 8, 9, 10],
    5,
  );
  expect(p.gem).toBe("Watch");
  const before = JSON.stringify(m.players);
  const explanations = activeTagExplanations(p, m);
  const watch = explanations.find((e) => e.tag === "Watch")!;
  const recent = watch.rows.find(
    (r) => r.check === "Recent played-game evidence",
  )!;
  const earlier = watch.rows.find(
    (r) => r.check === "Earlier played-game evidence",
  )!;
  expect(recent.actual).toBe(
    "2026 W6: 6.00 points; 8.00 targets | 2026 W7: 7.00 points; 9.00 targets | 2026 W8: 8.00 points; 10.00 targets",
  );
  expect(recent.required).toContain("points are context");
  expect(earlier.actual).toContain("2026 W3: 3.00 points; 2.00 targets");
  expect(earlier.actual).toContain("2026 W5: 5.00 points; 2.00 targets");
  expect(earlier.actual).not.toContain("W1:");
  for (const tag of ["Role-growth watch", "Scoring breakout watch"]) {
    const evidence = explanations
      .find((e) => e.tag === tag)!
      .rows.find((r) => r.check === "Earlier played-game evidence")!;
    expect(evidence.actual).toContain("2026 W1: 1.00 points");
    expect(evidence.actual).not.toContain("W6:");
  }
  expect(JSON.stringify(m.players)).toBe(before);
  // Byes/nonparticipation and other seasons do not become additional evidence, even when scores are recorded.
  d.tables.ModelHistory.push(
    {
      PlayerID: 1,
      Season: 2026,
      Week: 9,
      Games: 0,
      Points: 99,
      HistoryStatus: "Valid",
    },
    {
      PlayerID: 1,
      Season: 2025,
      Week: 1,
      Games: 1,
      Points: 99,
      HistoryStatus: "Valid",
    },
  );
  expect(JSON.stringify(activeTagExplanations(p, m))).not.toContain(
    "99.00 points",
  );
});

// Missing weekly counts stay unavailable; explicit recorded nulls are zero, and season-only sources never invent weekly attribution.
it("preserves missing versus zero counts and discloses season-total regression sources", async () => {
  const { d, m, p } = await sample([16, 16, 16, 16, 16], [0, 0, 0, 0, 0], 10);
  const rows = d.tables.ModelHistory.filter((h) => h.PlayerID === 1);
  rows[0].Targets = null;
  delete rows[1].Targets;
  const evidence = activeTagExplanations(p, m).find(
    (e) => e.tag === "Projection-gap watch",
  )!;
  const season = evidence.rows.find(
    (r) => r.check === "Season played-game evidence",
  )!.actual;
  expect(season).toContain("2026 W1: 16.00 points; 0.00 targets");
  expect(season).toContain("2026 W2: 16.00 points; Unavailable targets");
  const fallback = {
    ...p,
    regression: "BUY LOW",
    opportunity: {
      ...p.opportunity,
      source: "Aligned season totals; weekly role trend unavailable",
    },
  };
  const buy = activeTagExplanations(fallback, m).find(
    (e) => e.tag === "BUY LOW",
  )!;
  expect(
    buy.rows.find((r) => r.check === "Game-by-game evidence")!.actual,
  ).toBe("Unavailable");
  expect(buy.rows.some((r) => r.check === "Season played-game evidence")).toBe(
    false,
  );
});

// Display clearance must explain strict equality, near-boundary precision and nulls without assigning a different label.
it("formats numeric margins in the passing direction without hiding strict or missing boundaries", () => {
  expect(evidenceComparison(7, 7, "targets/game", "<").margin).toBe(
    "+0.00 targets/game; equal — strict limit not met",
  );
  expect(evidenceComparison(0, 0, "PPG").margin).toBe(
    "+0.00 PPG; at threshold",
  );
  expect(evidenceComparison(7, 6.999999, "targets/game").margin).toBe(
    "−<0.01 targets/game; below minimum",
  );
  expect(evidenceComparison(0.2, 0.25, "%").margin).toBe(
    "+5.00 percentage points; above minimum",
  );
  expect(evidenceComparison(null, 0, "PPG")).toMatchObject({
    required: "Unavailable",
    actual: "0.00 PPG",
    margin: "Unavailable",
  });
  expect(evidenceComparison(2, undefined, "PPG")).toMatchObject({
    actual: "Unavailable",
    margin: "Unavailable",
  });
  expect(evidenceComparison(Infinity, 2, "PPG").required).toBe("Unavailable");
});

// Consecutive overlapping scoring windows and count floors retain their actual games and existing PASS results.
it("provides Gem comparisons for both scoring windows and preserves exact 20 percent decline boundaries", async () => {
  const { m, p } = await sample([10, 18, 20, 22], [7, 7, 7, 7], 16);
  expect(p.gem).toBe("Gem");
  const checks = p.breakout!.checks;
  expect(checks.filter((c) => c.status === "PASS")).toHaveLength(10);
  expect(
    checks.find((c) => c.check === "Recent window actual PPG")!.comparisons![0],
  ).toMatchObject({
    required: "≥ 16.00 PPG",
    actual: "20.00 PPG",
    margin: "+4.00 PPG; above minimum",
  });
  expect(
    checks.find((c) => c.check === "Previous window actual PPG")!
      .comparisons![0],
  ).toMatchObject({ actual: "16.00 PPG", margin: "+0.00 PPG; at threshold" });
  expect(
    checks.find((c) => c.check === "Recent window scoring support")!
      .comparisons![0].actual,
  ).toBe("3 games");
  expect(
    checks.find((c) => c.check === "Previous window scoring support")!
      .comparisons![0].actual,
  ).toBe("2 games");
  expect(
    checks.find((c) => c.check === "Previous window scoring support")!.actual,
  ).toContain("2026 W1: 10.00");
  const before = JSON.stringify(m);
  activeTagExplanations(p, m);
  expect(JSON.stringify(m)).toBe(before);
  const exact = await sample(Array(6).fill(16), [14, 13, 13, 10, 11, 11], 16);
  expect(playerSignals(exact.p)).toContain("Reduced workload");
  expect(exact.p.breakout!.reducedWorkload!.comparisons![1]).toMatchObject({
    actual: "20.00%",
    margin: "+0.00 percentage points; at threshold",
  });
});
