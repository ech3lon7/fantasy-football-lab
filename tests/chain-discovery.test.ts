import { expect, it } from "vitest";
import { fairChainFixture } from "./chain-fixture";
import { evaluate } from "../src/domain/valuation";
import {
  applyChainPreset,
  applyChainStrictness,
  chainPresets,
  chainSearchRounds,
} from "../src/domain/chain-discovery";
import {
  chainErrors,
  chainRecipientEvidence,
  compareChains,
  mergeChainResults,
  discoverTradeChains,
  searchTradeChains,
  type ChainQuery,
} from "../src/domain/trade-chains";

// The known first exchange makes the complete synthetic search small, deterministic and independently inspectable.
const query = (): ChainQuery => ({
  team: "1",
  pool: ["3", "8", "9"],
  mode: "safe",
  maximumLoss: 0,
  minimumGain: 2,
  basis: "best-available",
  depth: "standard",
  pricePolicy: "warnings",
  recipient: { maximumValueLossPct: 0.25, minimumGain: -3.25 },
  first: {
    teams: ["2"],
    offer: { minimum: 1, maximum: 1 },
    receive: { minimum: 1, maximum: 1 },
  },
  second: {
    teams: ["3"],
    offer: { minimum: 1, maximum: 2 },
    receive: { minimum: 1, maximum: 1 },
  },
  discovery: {
    sequences: "both",
    ranking: "own",
    requiredTargets: ["5"],
    pinnedFirst: { teamA: "1", teamB: "2", give: ["3"], get: ["2"] },
  },
});

// Negative recipient gains are explicit, inclusive preferences and their percentages use the same before-lineup total.
it("permits bounded recipient losses without changing their displayed scoring or surplus", () => {
  const row = {
    outgoing: 90,
    incoming: 100,
    give: ["a"],
    get: ["b"],
    other: -1.25,
    otherBefore: 100,
  };
  expect(
    chainRecipientEvidence(row, {
      maximumValueLossPct: 0.1,
      minimumGain: -1.25,
    }),
  ).toMatchObject({
    gain: -1.25,
    gainPct: -0.0125,
    lossPct: 0.1,
    failures: [],
  });
  expect(
    chainRecipientEvidence(
      { ...row, other: -1.25001 },
      { maximumValueLossPct: 0.1, minimumGain: -1.25 },
    ).failures,
  ).toHaveLength(1);
  expect(
    chainRecipientEvidence(row, {
      maximumValueLossPct: 0.099,
      minimumGain: -1.25,
    }).failures,
  ).toHaveLength(1);
});

// Scenario choices and strictness preserve hard selections; coverage keeps recipients nonnegative.
it("applies scenario presets independently of strictness and hard selections", () => {
  expect(chainPresets).toHaveLength(10);
  const q = query();
  q.discovery!.position = "WR";
  for (const p of chainPresets)
    for (const strictness of [
      "conservative",
      "balanced",
      "negotiable",
    ] as const) {
      const applied = applyChainPreset(q, p.id, strictness);
      expect(applied.pool).toBe(q.pool);
      expect(applied.first.teams).toBe(q.first.teams);
      expect(applied.second.teams).toBe(q.second.teams);
      expect(applied.discovery!.position).toBe("WR");
      expect(applied.discovery!.requiredTargets).toBe(
        q.discovery!.requiredTargets,
      );
      expect(applied.discovery!.pinnedFirst).toBe(q.discovery!.pinnedFirst);
      expect(applied.first.offer).toEqual(q.first.offer);
      expect(applied.first.receive).toEqual(q.first.receive);
      expect(applied.recipient!.minimumGain).toBe(
        p.id === "mutual" || p.id === "coverage"
          ? 0
          : { conservative: 0, balanced: -1.5, negotiable: -3.25 }[strictness],
      );
    }
});

// Recovery copies every hard and optional requirement exactly, widening only the authorized numeric limits.
it("never relaxes gains, temporary loss, teams, protection, target, surface or needs requirements", () => {
  const q = query();
  q.first.indexWindow = { below: 2, above: 3 };
  q.first.surface = { metric: "average", minimumGain: 1 };
  q.first.fit = {
    deficit: {
      enabled: true,
      mode: "require",
      match: "all",
      grade: "C+",
      positions: ["QB"],
    },
  };
  q.discovery!.broaden = {
    enabled: true,
    maximumRecipientLoss: 4,
    maximumValueLossPct: 0.35,
    indexExtra: 20,
  };
  const before = JSON.stringify(q),
    rounds = chainSearchRounds(q);
  expect(rounds).toHaveLength(3);
  for (const { query: r } of rounds) {
    expect(r.minimumGain).toBe(q.minimumGain);
    expect(r.maximumLoss).toBe(0);
    expect(r.mode).toBe(q.mode);
    expect(r.pool).toBe(q.pool);
    expect(r.pricePolicy).toBe(q.pricePolicy);
    expect(r.first.teams).toBe(q.first.teams);
    expect(r.second.teams).toBe(q.second.teams);
    expect(r.first.surface).toBe(q.first.surface);
    expect(r.first.fit).toBe(q.first.fit);
    expect(r.discovery!.requiredTargets).toBe(q.discovery!.requiredTargets);
    expect(r.discovery!.pinnedFirst).toBe(q.discovery!.pinnedFirst);
    expect(r.recipient!.minimumGain).toBeGreaterThanOrEqual(-4);
    expect(r.recipient!.maximumValueLossPct).toBeLessThanOrEqual(0.35);
  }
  expect(rounds[2].query.first.indexWindow).toEqual({ below: 22, above: 23 });
  expect(JSON.stringify(q)).toBe(before);
});

// A locked-first search returns both genuinely connected and independent upgrades from the actual search, not hand-created results.
it("finds and separates both sequence types while preserving the source roster and scoring checkpoints", async () => {
  const d = await fairChainFixture(),
    m = evaluate(d, d.settings),
    q = query();
  // Synthetic zero-surplus TE compensation needs an explicit permissive value cap to exercise independent routes.
  q.recipient!.maximumValueLossPct = 1;
  const before = JSON.stringify(m.players),
    result = searchTradeChains(m, q);
  expect(result.chains.some((c) => c.kind === "connected")).toBe(true);
  expect(result.chains.some((c) => c.kind === "sequential")).toBe(true);
  expect(result.stats.limited).toBe(false);
  for (const c of result.chains) {
    expect(c.first.draft).toEqual(q.discovery!.pinnedFirst);
    expect(c.second.row.ownBefore).toBeCloseTo(c.intermediate);
    expect(c.after - c.before).toBeCloseTo(c.gain);
    expect(c.gain).toBeGreaterThanOrEqual(2);
    expect(c.first.row.own).toBeGreaterThanOrEqual(0);
    expect(c.second.draft.get).toContain("5");
    expect(c.first.row.legal && c.second.row.legal).toBe(true);
    if (c.kind === "sequential") {
      expect(c.dependency!.standalone!.after).toBeGreaterThan(
        c.dependency!.standalone!.before,
      );
      expect(c.second.row.own).toBeGreaterThan(0);
    }
  }
  expect(JSON.stringify(m.players)).toBe(before);
  for (const kind of ["connected", "sequential"] as const) {
    const filtered = searchTradeChains(m, {
      ...q,
      discovery: { ...q.discovery!, sequences: kind },
    });
    expect(filtered.chains.length).toBeGreaterThan(0);
    expect(filtered.chains.every((c) => c.kind === kind)).toBe(true);
  }
});

// Empty searches automatically retry within the configured ceiling and retain exact applied-query evidence for every attempt.
it("broadens zero-result searches without lowering the user's gain requirement", async () => {
  const d = await fairChainFixture(),
    m = evaluate(d, d.settings),
    q = query();
  q.recipient!.minimumGain = 100;
  q.discovery!.broaden = {
    enabled: true,
    maximumRecipientLoss: 3.25,
    maximumValueLossPct: 0.25,
    indexExtra: 0,
  };
  const result = discoverTradeChains(m, q);
  expect(result.attempts).toHaveLength(3);
  expect(result.attempts![0].found).toBe(0);
  expect(result.chains.length).toBeGreaterThan(0);
  expect(
    result.chains.every((c) => c.relaxations!.length > 0 && c.gain >= 2),
  ).toBe(true);
  expect(result.stats.evaluated).toBe(
    result.attempts!.reduce((n, a) => n + a.stats.evaluated, 0),
  );
  expect(result.stats.limits!.totalEvaluations).toBe(
    result.attempts!.reduce((n, a) => n + a.stats.limits!.totalEvaluations, 0),
  );
  expect(result.stats.evaluated).toBeLessThanOrEqual(
    result.stats.limits!.totalEvaluations,
  );
  expect(q.recipient!.minimumGain).toBe(100);
});

// Rankings change only ordering; positional/target and pinned ownership mistakes still reject or exclude candidates.
it("validates discovery controls and keeps ranking independent from eligibility", async () => {
  const d = await fairChainFixture(),
    m = evaluate(d, d.settings),
    q = query();
  expect(
    chainErrors(m, {
      ...q,
      recipient: { maximumValueLossPct: 0.25, minimumGain: -3.25 },
    }),
  ).toEqual([]);
  expect(
    chainErrors(m, {
      ...q,
      discovery: {
        ...q.discovery!,
        pinnedFirst: { ...q.discovery!.pinnedFirst!, get: ["5"] },
      },
    }),
  ).not.toEqual([]);
  const results = searchTradeChains(m, q);
  for (const ranking of ["own", "mutual", "appeal"] as const) {
    const sorted = [...results.chains].sort((a, b) =>
      compareChains(a, b, ranking),
    );
    expect(new Set(sorted.map((c) => c.key))).toEqual(
      new Set(results.chains.map((c) => c.key)),
    );
  }
  const qb = searchTradeChains(m, {
    ...q,
    discovery: { ...q.discovery!, position: "QB" },
  });
  expect(qb.chains).toEqual([]);
});

// Deeper searches retain earlier plans, refresh matching evidence and report a deduplicated lower bound rather than adding duplicate counts.
it("merges deeper results without dropping prior discoveries or inflating identical matches", async () => {
  const d = await fairChainFixture(),
    m = evaluate(d, d.settings),
    q = query();
  const first = searchTradeChains(m, q),
    next = searchTradeChains(m, { ...q, depth: "deeper" });
  const merged = mergeChainResults(first, next, "own");
  expect(new Set(merged.chains.map((c) => c.key))).toEqual(
    new Set([...first.chains, ...next.chains].map((c) => c.key)),
  );
  expect(merged.chains.length).toBe(next.chains.length);
  expect(merged.stats.found).toBe(
    Math.max(first.stats.found, next.stats.found),
  );
  expect(merged.stats.evaluated).toBe(
    first.stats.evaluated + next.stats.evaluated,
  );
});

// A manually edited gain or team scope must not prevent strictness from applying or be reset by it.
it("changes strictness on custom settings without resetting hard requirements", () => {
  const q = query();
  q.minimumGain = 7;
  q.maximumLoss = 0;
  q.discovery!.position = "WR";
  const next = applyChainStrictness(q, "negotiable");
  expect(next.recipient).toEqual({
    minimumGain: -3.25,
    maximumValueLossPct: 0.25,
  });
  expect(next.minimumGain).toBe(7);
  expect(next.maximumLoss).toBe(0);
  expect(next.first).toBe(q.first);
  expect(next.pool).toBe(q.pool);
  expect(next.discovery!.position).toBe("WR");
  expect(next.discovery!.pinnedFirst).toBe(q.discovery!.pinnedFirst);
});
