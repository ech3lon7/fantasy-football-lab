import { it, expect } from "vitest";
import { fixture } from "./fixtures";
import { evaluate } from "../src/domain/valuation";
import { contentHash, fromTables, preflight } from "../src/import/workbook";
import { evaluateTrade } from "../src/domain/trades";
it("makes actual influence grow with completed games", async () => {
  const d = await fixture(),
    m = evaluate(d, d.settings),
    p = m.byId.get("1")!;
  expect(p.weight).toBe(5 / 9);
  expect(p.expected).toBeCloseTo((5 / 9) * 20 + (4 / 9) * 15);
  const shorter = await fixture([20]);
  expect(
    evaluate(shorter, shorter.settings).byId.get("1")!.weight,
  ).toBeLessThan(p.weight);
});
it("preserves zero and negative games and actual-only fallbacks", async () => {
  const d = await fixture([0, -2, 8, 0, -1]);
  const p = d.tables.ModelPlayers[0];
  p.ProjectionRecords = 0;
  const m = evaluate(d, d.settings);
  expect(m.byId.get("1")!.actual).toBe(1);
  expect(m.byId.get("1")!.expected).toBeCloseTo(0.75 + (0.25 * 7) / 3);
  expect(m.byId.get("1")!.games).toBe(5);
  p.GamesPlayed = 3;
  p.Season_Games = 3;
  expect(evaluate(d, d.settings).byId.get("1")!.expected).toBeNull();
});
it("prefers steadier scoring when averages and recent means match", async () => {
  const steady = await fixture([20, 20, 20, 20, 20, 20]),
    volatile = await fixture([10, 20, 30, 10, 20, 30]);
  const a = evaluate(steady, steady.settings).byId.get("1")!,
    b = evaluate(volatile, volatile.settings).byId.get("1")!;
  expect(a.expected).toBeCloseTo(b.expected!);
  expect(a.value!).toBeGreaterThan(b.value!);
});
it("keeps baseline eligibility and missing pools explicit", async () => {
  const d = await fixture();
  d.tables.ModelPlayers.filter(
    (p) => p.Position === "RB" && p.OnTeamID === 0,
  ).forEach((p, i) => {
    if (i < 2) p.InjuryStatus = "OUT";
  });
  let m = evaluate(d, d.settings);
  expect(m.pools.find((p) => p.position === "RB")!.candidates).toHaveLength(1);
  expect(m.byId.get("1")!.baselineStatus).toContain("CONDITIONAL");
  d.tables.ModelPlayers.filter(
    (p) => p.Position === "RB" && p.OnTeamID === 0,
  ).forEach((p) => (p.OnTeamID = 2));
  m = evaluate(d, d.settings);
  expect(m.byId.get("1")!.baseline).toBeNull();
  expect(
    evaluateTrade(m, { teamA: "1", teamB: "2", give: ["1"], get: ["2"] }, false)
      .valid,
  ).toBe(true);
});
it("rejects duplicate selections and unknown ownership", async () => {
  const d = await fixture(),
    m = evaluate(d, d.settings);
  expect(
    evaluateTrade(m, { teamA: "1", teamB: "2", give: ["1", "1"], get: ["2"] })
      .valid,
  ).toBe(false);
  d.tables.ModelPlayers[0].OnTeamID = null;
  await expect(fromTables(d.tables, d.settings)).rejects.toThrow("ownership");
});
it("has no infinite trend percentage when earlier scoring is zero", async () => {
  const d = await fixture([0, 0, 1, 1, 1]),
    p = evaluate(d, d.settings).byId.get("1")!;
  expect(p.arrow).toBe("↑");
  expect(p.trendPct).toBeNull();
});
it("keeps package surplus invariant when normalization changes", async () => {
  const d = await fixture(),
    a = evaluate(d, d.settings),
    one = evaluateTrade(
      a,
      { teamA: "1", teamB: "2", give: ["1"], get: ["2"] },
      false,
    );
  d.tables.ModelPlayers.push({
    ...d.tables.ModelPlayers[0],
    PlayerID: 999,
    Player: "Elite synthetic",
    Position: "WR",
    OnTeamID: 2,
    Actual_PPG: 200,
    Last3_PPG: 200,
    ESPN_Projected_PPG: 200,
  });
  const b = evaluate(d, d.settings),
    two = evaluateTrade(
      b,
      { teamA: "1", teamB: "2", give: ["1"], get: ["2"] },
      false,
    );
  expect(a.byId.get("1")!.index).not.toBe(b.byId.get("1")!.index);
  if (one.valid && two.valid) {
    expect(one.outgoing).toBe(two.outgoing);
    expect(one.surplusTest).toBe(two.surplusTest);
  } else throw Error("Expected valid trades");
});
it("hashes canonical content independently of JSON key order", async () => {
  const d = await fixture();
  const reordered = JSON.parse(
    JSON.stringify(d.tables, Object.keys(d.tables).reverse()),
  );
  expect(await contentHash(d.tables, d.settings)).toBe(d.hash);
  const settings = Object.fromEntries(
    Object.entries(d.settings).reverse(),
  ) as typeof d.settings;
  expect(await contentHash(d.tables, settings)).toBe(d.hash);
  expect(reordered).toBeDefined();
});
it("rejects invalid ZIP data before attempting to parse", () =>
  expect(() => preflight(new Uint8Array([1, 2, 3]))).toThrow("ZIP"));
