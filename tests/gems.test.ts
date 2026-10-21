import { expect, it } from "vitest";
import { fixture } from "./fixtures";
import { evaluate, playerSignals } from "../src/domain/valuation";
import { evaluateTrade } from "../src/domain/trades";
import { playedHistory } from "../src/domain/opportunity";
import {
  assessGem,
  defaultGemRules,
  gemVersion,
  parseGemRules,
  parseRoleReviews,
  readGemInputs,
} from "../src/domain/gems";
import {
  decodeGemFilters,
  defaultGemDraft,
  screenGems,
  validateGemDraft,
} from "../src/domain/gem-screening";

// Build verified weekly workload rather than inferring a role from fantasy scores or season aggregates.
async function data(
  counts = [3, 2, 5, 8, 8, 7],
  position = "TE",
  scores = counts.map(() => 10),
) {
  const d = await fixture(scores);
  const p = d.tables.ModelPlayers[0];
  p.Position = position;
  d.tables.ModelHistory.filter((r) => r.PlayerID === 1).forEach((r, i) =>
    Object.assign(r, {
      Targets: position === "RB" ? 2 : counts[i],
      RushAttempts: position === "RB" ? counts[i] - 2 : 0,
      Receptions: 2,
      ReceivingTD: 0,
      RushTD: 0,
    }),
  );
  return d;
}
// Explicit source, coverage and current-week context are independently validated inputs.
function review(d: Awaited<ReturnType<typeof data>>, patch = {}) {
  return {
    PlayerID: "1",
    Week: Number(d.tables.ModelContext[0].CurrentWeek),
    ThroughWeek: Number(d.tables.ModelContext[0].CurrentWeek) - 1,
    Outlook: "Supported ongoing opportunity",
    Source: "Synthetic sourced role report",
    AsOfUTC: new Date().toISOString(),
    Reason: "Synthetic evidence supports an ongoing starting role.",
    ...patch,
  };
}
function options(d: Awaited<ReturnType<typeof data>>, patch = {}) {
  return {
    roleReviews: JSON.stringify({
      version: gemVersion,
      datasetHash: d.hash,
      rows: [review(d, patch)],
    }),
  };
}

// Strange-like consistent volume qualifies only after the ongoing role is reviewed.
it("requires current sourced context even when every workload gate passes", async () => {
  const d = await data(),
    pending = evaluate(d, d.settings).players[0];
  expect(pending.gem).toBe("Watch");
  expect(pending.breakout!.recent).toBeCloseTo(23 / 3);
  expect(pending.breakout!.previous).toBeCloseTo(10 / 3);
  const supported = evaluate(d, d.settings, options(d)).players[0];
  expect(supported.gem).toBe("Gem");
  expect(
    supported.breakout!.checks.every((c) =>
      ["PASS", "SUPPORTED"].includes(c.status),
    ),
  ).toBe(true);
});

// A high mean cannot hide a one-game role collapse, as in the Mayer example.
it("keeps an inconsistent 10,1,9 target window at Watch and exposes the failing floor", async () => {
  const d = await data([7, 4, 3, 10, 1, 9]);
  const p = evaluate(d, d.settings, options(d)).players[0];
  expect(p.gem).toBe("Watch");
  expect(
    p.breakout!.checks.find((c) => c.check === "Each of the last 3 games"),
  ).toMatchObject({ actual: "10, 1, 9", status: "FAIL" });
});

// RBs use carries plus targets but retain the two components for inspection and competition review.
it("recognizes a Braelon-like growing role and flags injured teammates without inventing causation", async () => {
  const d = await data([11, 6, 7, 16, 28, 19], "RB");
  const teammate = d.tables.ModelPlayers.find((p) => p.PlayerID === 103)!;
  teammate.InjuryStatus = "OUT";
  const p = evaluate(d, d.settings, options(d)).players[0];
  expect(p.gem).toBe("Gem");
  expect(p.breakout!.recent).toBe(21);
  expect(p.opportunity.recentTargets).toBe(2);
  expect(p.opportunity.recentCarries).toBe(19);
  expect(p.breakout!.prompts.join()).toContain("does not establish why");
});

// Absolute growth still applies with zero prior work, while percentage growth remains unavailable.
it("handles zero prior volume and exact growth boundaries without rounding", async () => {
  const d = await data([0, 0, 0, 6, 6, 6]);
  let p = evaluate(d, d.settings, options(d)).players[0];
  expect(p.gem).toBe("Gem");
  expect(p.breakout!.growthPct).toBeNull();
  const boundary = await data([4, 4, 4, 6, 6, 6]);
  p = evaluate(boundary, boundary.settings, options(boundary)).players[0];
  expect(p.gem).toBe("Gem");
  const rules = structuredClone(defaultGemRules);
  rules.positions.TE.growth = 2.000001;
  expect(
    evaluate(boundary, boundary.settings, {
      ...options(boundary),
      gemRules: JSON.stringify(rules),
    }).players[0].gem,
  ).toBe("Watch");
});

// Established heavy usage with no role change and projection outperformance alone do not award a Gem.
it("requires developing opportunity instead of high scores or established volume", async () => {
  for (const counts of [
    [8, 8, 8, 8, 8, 8],
    [1, 1, 1, 2, 2, 2],
  ]) {
    const d = await data(counts, "TE", [30, 30, 30, 30, 30, 30]);
    expect(evaluate(d, d.settings, options(d)).players[0].gem).toBe(
      "No breakout signal",
    );
  }
});

// Games played, not calendar weeks, define both windows; zero and negative points stay in history.
it("uses immediately preceding games and preserves zero/negative and injury-shortened scores", async () => {
  const d = await data([2, 3, 2, 5, 8, 8, 7], "TE", [0, -2, 5, 10, 12, 10, 8]);
  const p = evaluate(d, d.settings, options(d)).players[0];
  expect(p.games).toBe(7);
  expect(p.breakout!.previousWeeks).toEqual([2, 3, 4]);
  expect(p.breakout!.recentWeeks).toEqual([5, 6, 7]);
  expect(
    playedHistory(d)
      .get("1")!
      .map((r) => r.Points),
  ).toContain(-2);
  d.tables.ModelHistory.push({
    PlayerID: 1,
    Season: 2026,
    Week: 8,
    Games: 0,
    Points: 0,
    HistoryStatus: "Valid",
  });
  expect(
    evaluate(d, d.settings, options(d)).players[0].breakout!.recentWeeks,
  ).toEqual([5, 6, 7]);
});

// Five games are the minimum; a short promising role is a Watch, not a projection-driven Gem.
it("allows a two-game previous window at five games but not a four-game Gem", async () => {
  const five = await data([2, 3, 6, 6, 6]);
  expect(evaluate(five, five.settings, options(five)).players[0].gem).toBe(
    "Gem",
  );
  const four = await data([2, 6, 6, 6]);
  expect(evaluate(four, four.settings, options(four)).players[0].gem).toBe(
    "Watch",
  );
});

// Unknown counts, duplicate participation and invalid history never become favorable zero workload.
it("marks missing workload and conflicting history insufficient", async () => {
  const d = await data();
  delete d.tables.ModelHistory.find((r) => r.PlayerID === 1)!.Targets;
  expect(evaluate(d, d.settings, options(d)).players[0].gem).toBe(
    "Insufficient data",
  );
  const duplicate = await data();
  duplicate.tables.ModelHistory.push({ ...duplicate.tables.ModelHistory[0] });
  expect(
    evaluate(duplicate, duplicate.settings, options(duplicate)).players[0].gem,
  ).toBe("Insufficient data");
  const zero = await data([0, 0, 0, 6, 6, 6]);
  zero.tables.ModelHistory.find((r) => r.PlayerID === 1)!.Targets = null;
  expect(evaluate(zero, zero.settings, options(zero)).players[0].gem).toBe(
    "Gem",
  );
});

// Availability, stale evidence, stale snapshots and temporary roles cap qualification without inventing missed games.
it("keeps unresolved availability and role reviews conditional", async () => {
  const d = await data();
  for (const patch of [
    { Outlook: "Temporary opportunity" },
    { Outlook: "Unclear" },
    { ThroughWeek: 2 },
    { AsOfUTC: new Date(Date.now() - 8 * 86400000).toISOString() },
  ])
    expect(evaluate(d, d.settings, options(d, patch)).players[0].gem).toBe(
      "Watch",
    );
  d.tables.ModelPlayers[0].InjuryStatus = "QUESTIONABLE";
  expect(evaluate(d, d.settings, options(d)).players[0].gem).toBe("Watch");
  d.tables.ModelPlayers[0].InjuryStatus = "ACTIVE";
  d.sourceUTC = new Date(Date.now() - 2 * 86400000).toISOString();
  expect(evaluate(d, d.settings, options(d)).players[0].gem).toBe("Watch");
});

// Context and configuration validation prevent stale snapshots or malformed imports from silently qualifying Gems.
it("validates review provenance and rule configuration atomically", async () => {
  const d = await data();
  for (const patch of [
    { Source: "" },
    { Reason: "" },
    { ThroughWeek: 99 },
    { Week: 2 },
    { AsOfUTC: "invalid" },
    { AsOfUTC: new Date(Date.now() + 86400000).toISOString() },
  ])
    expect(() => parseRoleReviews([review(d, patch)], d)).toThrow();
  expect(() => parseRoleReviews([review(d), review(d)], d)).toThrow();
  expect(
    readGemInputs(
      d,
      undefined,
      JSON.stringify({
        version: gemVersion,
        datasetHash: "old",
        rows: [review(d)],
      }),
    ).issue,
  ).toContain("snapshot");
  expect(() =>
    parseGemRules(JSON.stringify({ ...defaultGemRules, growthPct: -1 })),
  ).toThrow();
  const bad = evaluate(d, d.settings, { ...options(d), gemRules: "broken" });
  expect(bad.gemIssue).not.toBe("");
  expect(bad.players[0].gem).toBe("Watch");
});

// Classification must not change adaptive forecasts, replacement values, scoring trend or trade math.
it("changes only classification when a review or Gem rule changes", async () => {
  const d = await data(),
    original = evaluate(d, d.settings),
    changed = evaluate(d, d.settings, options(d));
  const metrics = [
    "actual",
    "recent",
    "projected",
    "weight",
    "expected",
    "penalty",
    "value",
    "baseline",
    "vorp",
    "index",
    "trendDelta",
    "arrow",
  ] as const;
  for (const p of original.players)
    for (const metric of metrics)
      expect(changed.byId.get(p.id)![metric]).toEqual(p[metric]);
  const draft = { teamA: "1", teamB: "2", give: ["1"], get: ["2"] };
  expect(evaluateTrade(changed, draft, false)).toEqual(
    evaluateTrade(original, draft, false),
  );
  expect(
    evaluate(d, d.settings, { workbookMode: true }).players[0].breakout,
  ).toBeUndefined();
  expect(playerSignals(changed.players[0])).toContain("Gem");
});

// A separate category can select Gem or Watch without breaking numeric-only searches or legacy threshold preservation.
it("filters primary classification separately and migrates ambiguous saved labels explicitly", async () => {
  const d = await data(),
    gem = evaluate(d, d.settings, options(d)).players[0],
    watch = evaluate(d, d.settings).players[0];
  const q = validateGemDraft(
    {
      ...defaultGemDraft("1"),
      pool: "All",
      signals: [],
      classification: "Gem only",
    },
    ["1", "2"],
  ).query!;
  expect(screenGems([gem, watch], q).matches.map((r) => r.player.gem)).toEqual([
    "Gem",
  ]);
  expect(
    screenGems([gem, watch], { ...q, classification: "Gem + Watch" }).matches,
  ).toHaveLength(2);
  const old = decodeGemFilters(
    {
      gemFilterVersion: "1",
      gemSignals: '["Gem candidate"]',
      gemTrendMin: "2",
      gemIndexMin: "0",
    },
    "1",
  );
  expect(old.issue).toContain("meanings changed");
  expect(old.draft.trendMin).toBe("2");
  expect(old.draft.indexMin).toBe("0");
  const other = { ...gem, pos: "QB" as const };
  expect(assessGem(other, [], d, defaultGemRules, []).classification).toBe(
    "Not applicable",
  );
});

// Freshness expires while the app stays open; it is independent of persisted input identity.
it("expires current Gem evidence at its next freshness deadline", async () => {
  const d = await data();
  const inputs = readGemInputs(d, undefined, options(d).roleReviews);
  expect(inputs.expiresAt).toBeGreaterThan(Date.now());
  const m = evaluate(d, d.settings, options(d));
  const p = m.players[0];
  expect(
    assessGem(
      p,
      playedHistory(d).get(p.id)!,
      d,
      inputs.rules,
      inputs.reviews,
      "",
      inputs.expiresAt! + 1,
    ).classification,
  ).toBe("Watch");
  expect(
    readGemInputs(
      d,
      undefined,
      options(d).roleReviews,
      Date.now() + 8 * 86400000,
    ).expiresAt,
  ).toBeNull();
});
