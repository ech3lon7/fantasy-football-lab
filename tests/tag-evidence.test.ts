import { expect, it } from "vitest";
import { activeTagExplanations } from "../src/domain/tag-evidence";
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
      expect(
        explanation.rows.find((r) => r.check === "Scoring improvement")!
          .required,
      ).toContain(m.settings.GemMinGap.toFixed(2));
      expect(
        explanation.rows.find((r) => r.check === "ESPN season projected PPG")!
          .actual,
      ).toBe(projection.toFixed(2));
      expect(explanation.window).toContain("ALL earlier");
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
  const distinct = await sample(Array(8).fill(10), [2, 2, 2, 2, 20, 8, 8, 8]);
  expect(distinct.p.gem).toBe("No breakout signal");
  expect(playerSignals(distinct.p)).toContain("Role-growth watch");
  const explanations = activeTagExplanations(distinct.p, distinct.m);
  expect(explanations.some((e) => e.tag === "Watch")).toBe(false);
  expect(
    explanations.find((e) => e.tag === "Role-growth watch")!.window,
  ).toContain("ALL 5 earlier");
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
  }
  expect(activeTagExplanations(sell, m).map((e) => e.tag)).toEqual([
    "SELL HIGH",
    "TD caution",
  ]);
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
    explanation.rows.find((r) => r.check === "Relative scoring gap")!.required,
  ).toBe("At least 20.00%");
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
  expect(JSON.stringify(buy)).not.toMatch(/NaN|Infinity/);
});
