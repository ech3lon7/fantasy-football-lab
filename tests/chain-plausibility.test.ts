import { it, expect } from "vitest";
import { fairChainFixture } from "./chain-fixture";
import { fromTables } from "../src/import/workbook";
import { evaluate, type Model } from "../src/domain/valuation";
import { evaluateTrade } from "../src/domain/trades";
import {
  surfaceAppeal,
  type SurfaceEvidence,
} from "../src/domain/surface-appeal";
import { tradeImpact } from "../src/domain/trade-impact";
import {
  chainErrors,
  chainRecipientEvidence,
  searchTradeChains,
  chainBudgets,
  type ChainQuery,
} from "../src/domain/trade-chains";
import {
  defaultChainDependency,
  chainIndexEvidence,
  chainRetradeEvidence,
  chainRetainedEvidence,
  chainDependencyEvidence,
  chainSurfaceFailures,
} from "../src/domain/chain-plausibility";

// A real three-team roster provides cover, a meaningful outgoing starter and a legal standalone counterfactual; no app scoring is mocked.
async function coverageSample() {
  const d = await fairChainFixture();
  d.tables.ModelContext[0].BenchSlots = 20;
  const set = (id: number, points: number) => {
    Object.assign(
      d.tables.ModelPlayers.find((p) => p.PlayerID === id)!,
      {
        ActualPoints: points * 5,
        Actual_PPG: points,
        Last3_PPG: points,
        ESPN_Projected_PPG: points,
        ESPN_Projected_Total: points * 17,
        Current_Week_Projection: points,
      },
    );
    for (const row of d.tables.ModelHistory.filter((h) => h.PlayerID === id))
      row.Points = points;
  };
  set(3, 18);
  set(6, 22);
  const base = d.tables.ModelPlayers.find((p) => p.PlayerID === 6)!;
  d.tables.ModelPlayers.push({
    ...base,
    PlayerID: 14,
    Player: "Synthetic recipient RB reserve",
    ActualPoints: 105,
    Actual_PPG: 21,
    Last3_PPG: 21,
    ESPN_Projected_PPG: 21,
    ESPN_Projected_Total: 357,
    Current_Week_Projection: 21,
  });
  d.tables.ModelRosters.push({ PlayerID: 14, TeamID: 2, LineupSlotID: 20 });
  d.tables.ModelHistory.push(
    ...d.tables.ModelHistory.filter((h) => h.PlayerID === 6).map((h) => ({
      ...h,
      PlayerID: 14,
      Points: 21,
    })),
  );
  const source = await fromTables(d.tables, d.settings),
    m = evaluate(source, source.settings);
  const q: ChainQuery = {
    team: "1",
    pool: ["8", "1"],
    mode: "both",
    maximumLoss: 3,
    minimumGain: 1,
    basis: "best-available",
    depth: "standard",
    pricePolicy: "warnings",
    recipient: { maximumValueLossPct: 1, minimumGain: 0 },
    dependency: { ...defaultChainDependency, route: "retain" },
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
  };
  return { m, q };
}
const target = (m: Model, q: ChainQuery) =>
  searchTradeChains(m, q).chains.find(
    (c) =>
      c.first.draft.give.join() === "8" &&
      c.first.draft.get.join() === "6" &&
      c.second.draft.give.join() === "1" &&
      c.second.draft.get.join() === "5",
  );

// Raw windows and concessions are independent: this actual example fails both a ±5 range and the new automatic 10% concession cap.
it("rejects Higgins-for-Flowers values without borrowing a favorable second leg or applying a hidden premium", async () => {
  const { m } = await coverageSample();
  m.byId.get("1")!.index = 30.54;
  m.byId.get("6")!.index = 42.71;
  const draft = { teamA: "1", teamB: "2", give: ["1"], get: ["6"] };
  const range = chainIndexEvidence(m, draft, { below: 5, above: 5 });
  expect(range.passed).toBe(false);
  expect(range.minimum).toBe(25.54);
  expect(range.maximum).toBe(35.54);
  const recipient = chainRecipientEvidence(
    { outgoing: 30.54, incoming: 42.71, give: ["1"], get: ["6"], other: 1 },
    { maximumValueLossPct: 0.1, minimumGain: 0 },
    0.3,
  );
  expect(recipient.lossPct).toBeCloseTo(0.284944977757);
  expect(recipient.failures).toHaveLength(1);
  m.byId.get("6")!.index = 35.54;
  expect(chainIndexEvidence(m, draft, { below: 5, above: 5 }).passed).toBe(
    true,
  );
  m.byId.get("6")!.index = 35.54000001;
  expect(chainIndexEvidence(m, draft, { below: 5, above: 5 }).passed).toBe(
    false,
  );
  m.byId.get("6")!.index = null;
  expect(
    chainIndexEvidence(m, draft, { below: 5, above: 5 }).incoming,
  ).toBeNull();
});

// Materiality uses a true package share; removing a card or changing package counts is never sufficient proof.
it("requires an inclusive meaningful acquired share and uses a labeled zero-index fallback", async () => {
  const { m } = await coverageSample();
  m.byId.get("6")!.owner = "1";
  const first = { teamA: "1", teamB: "2", give: ["8"], get: ["6"] },
    second = { teamA: "1", teamB: "3", give: ["6", "1"], get: ["5"] };
  m.byId.get("6")!.index = 25;
  m.byId.get("1")!.index = 75;
  expect(
    chainRetradeEvidence(m, first, second, defaultChainDependency).passed,
  ).toBe(true);
  m.byId.get("6")!.index = 24.999999;
  expect(
    chainRetradeEvidence(m, first, second, defaultChainDependency).passed,
  ).toBe(false);
  m.byId.get("6")!.index = 1;
  m.byId.get("1")!.index = 99;
  expect(
    chainRetradeEvidence(m, first, second, defaultChainDependency).share,
  ).toBe(0.01);
  for (const id of second.give) {
    m.byId.get(id)!.index = 0;
    m.byId.get(id)!.available = 10;
  }
  m.byId.get("6")!.value = 10;
  m.byId.get("1")!.value = 30;
  const fallback = chainRetradeEvidence(
    m,
    first,
    second,
    defaultChainDependency,
  );
  expect(fallback.metric).toBe("points");
  expect(fallback.share).toBe(0.25);
  expect(fallback.passed).toBe(true);
  m.byId.get("1")!.value = null;
  expect(
    chainRetradeEvidence(m, first, second, defaultChainDependency).share,
  ).toBeNull();
  m.byId.get("1")!.index = null;
  expect(
    chainRetradeEvidence(m, first, second, defaultChainDependency).metric,
  ).toBe("unavailable");
});

// Interaction deliberately rejects an independent upgrade even when retained lift and final scoring are both positive.
it("distinguishes coverage enabling trade two from unrelated upgrades and unknown counterfactuals", () => {
  const roles = [{ acquired: "6", outgoing: "1", week: 6, slot: "RB" }];
  const supported = chainRetainedEvidence(
    defaultChainDependency,
    roles,
    130,
    132,
    137,
    { before: 130, after: 127 },
  );
  expect([
    supported.actualSecondGain,
    supported.standaloneSecondGain,
    supported.interactionGain,
    supported.retainedLift,
    supported.passed,
  ]).toEqual([5, -3, 8, 10, true]);
  const independent = chainRetainedEvidence(
    defaultChainDependency,
    roles,
    130,
    132,
    137,
    { before: 130, after: 135 },
  );
  expect(independent.retainedLift).toBe(2);
  expect(independent.interactionGain).toBe(0);
  expect(independent.passed).toBe(false);
  const unknown = chainRetainedEvidence(
    defaultChainDependency,
    roles,
    130,
    132,
    137,
    undefined,
    "Invalid standalone ownership",
  );
  expect(unknown.standaloneSecondGain).toBeNull();
  expect(unknown.interactionGain).toBeNull();
  expect(unknown.passed).toBe(false);
  const boundary = chainRetainedEvidence(
    defaultChainDependency,
    roles,
    130,
    132,
    137,
    { before: 130, after: 133 },
  );
  expect(boundary.interactionGain).toBe(2);
  expect(boundary.passed).toBe(true);
  const tooSmall = chainRetainedEvidence(
    defaultChainDependency,
    roles,
    130,
    132,
    137,
    { before: 130, after: 133.0000001 },
  );
  expect(tooSmall.passed).toBe(false);
});

// Keep-and-release uses the actual single-trade evaluator, respects the initial checkpoint, and names the acquisition covering the outgoing RB.
it("finds a retained acquisition with +2 interaction and excludes disconnected alternatives", async () => {
  const { m, q } = await coverageSample();
  const c = target(m, q)!;
  expect(c).toBeDefined();
  expect([c.before, c.intermediate, c.after, c.gain]).toEqual([61, 63, 69, 8]);
  expect(c.dependency?.route).toBe("retain");
  expect(c.dependency?.retained.standaloneSecondGain).toBe(4);
  expect(c.dependency?.retained.interactionGain).toBe(2);
  expect(
    c.dependency?.retained.coverage.some(
      (role) =>
        role.acquired === "6" && role.outgoing === "1" && role.slot === "RB",
    ),
  ).toBe(true);
  const alone = evaluateTrade(m, c.second.draft, false);
  expect(tradeImpact(alone, q.basis)?.own.afterPerWeek).toBe(65);
  expect(
    target(m, {
      ...q,
      dependency: {
        ...defaultChainDependency,
        route: "retain",
        minimumInteractionGain: 2.00001,
      },
    }),
  ).toBeUndefined();
  const unrelated = searchTradeChains(m, { ...q, pool: ["3", "8"] });
  expect(unrelated.stats.rejectedDependency).toBeGreaterThan(0);
  expect(
    unrelated.chains.some(
      (c) =>
        c.first.draft.give.join() === "3" &&
        c.first.draft.get.join() === "6" &&
        c.second.draft.give.join() === "8" &&
        c.second.draft.get.join() === "5",
    ),
  ).toBe(false);
});

// The final allowed evaluation cannot invent an interaction or mislabel unperformed work as a rejected disconnected trade.
it("counts counterfactual evaluations and reports pending dependency work at an exact shared-budget boundary", async () => {
  const { m, q } = await coverageSample();
  for (const p of m.players)
    if ((p.owner === "2" && p.id !== "6") || (p.owner === "3" && p.id !== "5"))
      p.index = null;
  const original = { ...chainBudgets.standard };
  try {
    Object.assign(chainBudgets.standard, { first: 2, second: 2, beam: 1 });
    const short = searchTradeChains(m, q);
    expect(short.stats.evaluated).toBe(4);
    expect(short.stats.dependencyPending).toBe(1);
    expect(short.stats.dependencyEvaluated).toBe(0);
    expect(short.stats.limited).toBe(true);
    expect(short.stats.coverage.stopReasons).toContain(
      "dependency-evaluation-budget",
    );
    Object.assign(chainBudgets.standard, { second: 3 });
    const full = searchTradeChains(m, q);
    expect(full.stats.evaluated).toBe(5);
    expect(full.stats.dependencyEvaluated).toBe(1);
    expect(full.stats.dependencyPending).toBe(0);
    expect(full.stats.found).toBe(1);
    expect(full.stats.limited).toBe(false);
    expect(full.stats.evaluated).toBe(
      full.stats.coverage.first.evaluated +
        full.stats.coverage.followups.evaluated +
        full.stats.dependencyEvaluated,
    );
  } finally {
    Object.assign(chainBudgets.standard, original);
  }
});

// Required surface evidence cannot use the unselected source or substitute a projection for a missing one.
it("supports recipient source comparisons on a nonpositive-own first leg and requires both metrics when selected", async () => {
  const { m } = await coverageSample();
  const draft = { teamA: "1", teamB: "2", give: ["9"], get: ["2"] };
  const result = evaluateTrade(m, draft, false);
  expect(
    tradeImpact(result, "best-available")!.own.expectedPerWeek,
  ).toBeLessThanOrEqual(0);
  const evidence = surfaceAppeal(
    m,
    draft,
    result,
    { metric: "average", minimum: 0, requireValueTests: false },
    "best-available",
  )!;
  expect(
    chainSurfaceFailures(evidence, { metric: "average", minimumGain: 0 }),
  ).toEqual([]);
  const missing = {
    ...evidence,
    projection: { ...evidence.projection, gain: null },
  } as SurfaceEvidence;
  expect(
    chainSurfaceFailures(missing, { metric: "both", minimumGain: 0 }),
  ).toHaveLength(1);
  const flat = { ...evidence, average: { ...evidence.average, gain: 0 } };
  expect(
    chainSurfaceFailures(flat, { metric: "average", minimumGain: 0 }),
  ).toHaveLength(1);
});

// All active controls validate in the domain before worker execution; disabling a step filter makes it irrelevant.
it("validates new defaults, active per-leg filters and materiality controls", async () => {
  const { m, q } = await coverageSample();
  expect(chainErrors(m, q)).toEqual([]);
  expect(
    chainErrors(m, {
      ...q,
      dependency: { ...defaultChainDependency, minimumAcquiredShare: 0 },
    }).length,
  ).toBeGreaterThan(0);
  expect(
    chainErrors(m, {
      ...q,
      dependency: { ...defaultChainDependency, minimumInteractionGain: NaN },
    }).length,
  ).toBeGreaterThan(0);
  expect(
    chainErrors(m, {
      ...q,
      first: { ...q.first, indexWindow: { below: -1, above: 5 } },
    }).length,
  ).toBeGreaterThan(0);
  expect(
    chainErrors(m, {
      ...q,
      second: { ...q.second, surface: { metric: "both", minimumGain: NaN } },
    }).length,
  ).toBeGreaterThan(0);
});

// Either honors a valid direct bridge without claiming that unmeasured retained interaction was zero or that the retained route passed.
it("selects only allowed routes and prefers a meaningful re-trade when both pass", async () => {
  const { m } = await coverageSample();
  m.byId.get("6")!.owner = "1";
  const first = { teamA: "1", teamB: "2", give: ["8"], get: ["6"] },
    second = { teamA: "1", teamB: "3", give: ["6"], get: ["5"] };
  const direct = chainRetradeEvidence(m, first, second, defaultChainDependency),
    retained = chainRetainedEvidence(
      defaultChainDependency,
      [{ acquired: "6", outgoing: "1", week: 6, slot: "RB" }],
      130,
      132,
      137,
      { before: 130, after: 127 },
    );
  expect(
    chainDependencyEvidence(defaultChainDependency, direct, retained).route,
  ).toBe("retrade");
  expect(
    chainDependencyEvidence(
      { ...defaultChainDependency, route: "retain" },
      direct,
      retained,
    ).route,
  ).toBe("retain");
  const noCoverage = chainRetainedEvidence(
    defaultChainDependency,
    [],
    130,
    132,
    137,
  );
  expect(
    chainDependencyEvidence(
      { ...defaultChainDependency, route: "retain" },
      direct,
      noCoverage,
    ).route,
  ).toBeNull();
});
// Identical second offers share one original-checkpoint evaluation across alternative acquired RBs, without changing any forecasts.
it("caches standalone trade-two work across different first-trade acquisitions", async () => {
  const { m, q } = await coverageSample();
  for (const p of m.players)
    if (
      (p.owner === "2" && !["6", "14"].includes(p.id)) ||
      (p.owner === "3" && p.id !== "5")
    )
      p.index = null;
  const r = searchTradeChains(m, q),
    candidates = r.chains.filter(
      (c) =>
        c.first.draft.give.join() === "8" &&
        ["6", "14"].includes(c.first.draft.get.join()) &&
        c.second.draft.give.join() === "1" &&
        c.second.draft.get.join() === "5",
    );
  expect(candidates).toHaveLength(2);
  expect(
    candidates.every((c) => c.dependency?.retained.interactionGain === 2),
  ).toBe(true);
  expect(r.stats.dependencyEvaluated).toBe(1);
});

// Each index window constrains only its own actual leg; disabling it restores the connected target rather than relaxing another gate.
it("applies first and second windows independently before lineup scoring", async () => {
  const { m, q } = await coverageSample();
  expect(target(m, q)).toBeDefined();
  const first = searchTradeChains(m, {
    ...q,
    first: { ...q.first, indexWindow: { below: 0, above: 0 } },
  });
  expect(first.stats.rejectedIndex).toBeGreaterThan(0);
  expect(
    first.plausibilityRejections.some(
      (e) => e.step === 1 && e.indexWindow?.passed === false,
    ),
  ).toBe(true);
  expect(
    target(m, {
      ...q,
      first: { ...q.first, indexWindow: { below: 0, above: 0 } },
    }),
  ).toBeUndefined();
  const second = searchTradeChains(m, {
    ...q,
    second: { ...q.second, indexWindow: { below: 0, above: 0 } },
  });
  expect(
    second.plausibilityRejections.some(
      (e) => e.step === 2 && e.indexWindow?.passed === false,
    ),
  ).toBe(true);
  expect(
    target(m, {
      ...q,
      second: { ...q.second, indexWindow: { below: 0, above: 0 } },
    }),
  ).toBeUndefined();
  expect(
    target(m, {
      ...q,
      first: { ...q.first, indexWindow: { below: 100, above: 100 } },
    }),
  ).toBeDefined();
});
// Actual leg-specific source gates use the recipient's losses and replacements, with missing projections unavailable rather than a zero.
it("enforces independent surface thresholds and unavailable weekly evidence on real legal lineups", async () => {
  const { m, q } = await coverageSample();
  const filtered = {
    ...q,
    first: {
      ...q.first,
      surface: { metric: "average" as const, minimumGain: 14 },
    },
    second: {
      ...q.second,
      surface: { metric: "average" as const, minimumGain: 9 },
    },
  };
  const c = target(m, filtered)!;
  expect(c).toBeDefined();
  expect(c.first.surface?.average.gain).toBe(14);
  expect(c.second.surface?.average.gain).toBe(9);
  const tooHigh = {
    ...filtered,
    second: {
      ...filtered.second,
      surface: { metric: "average" as const, minimumGain: 9.000001 },
    },
  };
  expect(target(m, tooHigh)).toBeUndefined();
  expect(searchTradeChains(m, tooHigh).stats.rejectedSurface).toBeGreaterThan(
    0,
  );
  m.byId.get("14")!.weekly = null;
  const incomplete = searchTradeChains(m, {
    ...q,
    first: { ...q.first, surface: { metric: "both", minimumGain: 0 } },
  });
  expect(incomplete.stats.rejectedSurface).toBeGreaterThan(0);
  expect(
    incomplete.plausibilityRejections.some(
      (e) => e.step === 1 && e.surface?.projection.gain === null,
    ),
  ).toBe(true);
  expect(target(m, q)).toBeDefined();
});
