import { describe, expect, it } from "vitest";
import { buildUsefulMoves, FLOOR_MAX_LOSS_OWN, FLOOR_MAX_LOSS_OTHER, type UsefulEvaluation } from "../src/domain/useful-move-search";

// This small deterministic league exposes every package passed to the evaluator.
const roster = { own: ["a", "b", "c"], opponents: { other: ["x", "y"] } };
const impacts = { add: new Map([["own", new Map([["x", 5], ["y", 3]])], ["other", new Map([["a", 3], ["b", 2], ["c", 1]])]]),
  leave: new Map([["own", new Map([["a", 1], ["b", 1], ["c", 0]])], ["other", new Map([["x", 2], ["y", 1]])]]) };

describe("useful trade search", () => {
  it("evaluates every non-protected single trade and streams singles first", async () => {
    const seen: string[] = [], partial: number[] = [];
    const result = await buildUsefulMoves(roster, impacts, ["c"], (offer) => {
      seen.push(`${offer.give.join("")} ${offer.get.join("")}`);
      return { ...offer, legal: true, changed: true, own: .3, other: 1.2 };
    }, (rows) => partial.push(rows.length));
    expect(result.coverage.singles).toBe(4);
    expect(seen.slice(0, 4).sort()).toEqual(["a x", "a y", "b x", "b y"]);
    expect(partial).toEqual([4]);
  });
  it("uses only the legal, lineup-change and maximum-loss floor", async () => {
    expect(FLOOR_MAX_LOSS_OWN).toBe(3);
    expect(FLOOR_MAX_LOSS_OTHER).toBe(2);
    const result = await buildUsefulMoves(roster, impacts, [], (offer) => ({ ...offer,
      legal: offer.get[0] !== "y", changed: offer.give[0] !== "c",
      own: offer.give[0] === "b" ? -3.01 : -.5, other: -2,
    }));
    expect(result.rows.some((r) => r.trade.give.length === 1 && r.trade.give[0] === "a" && r.trade.get[0] === "x")).toBe(true);
    expect(result.rows.every((r) => r.trade.legal && r.trade.changed && r.trade.own >= -3 && r.trade.other >= -2)).toBe(true);
  });
  // The two sides have independent inclusive loss limits.
  it.each([[5, -2.5, false], [5, -2, true], [-3, 1, true]])(
    "uses the approved floor for own %s and other %s", async (own, other, kept) => {
      const result = await buildUsefulMoves({ own: ["a"], opponents: { other: ["x"] } }, impacts, [],
        (offer) => ({ ...offer, legal: true, changed: true, own, other }));
      expect(result.rows.length > 0).toBe(kept);
    },
  );
  it("can extend a single that fails the floor when the larger package qualifies", async () => {
    const result = await buildUsefulMoves(roster, impacts, [], (offer) => ({ ...offer, legal: true, changed: true,
      own: offer.give.length === 1 ? -4 : 1, other: 1 }));
    expect(result.rows.some((r) => r.trade.give.length === 2 && r.trade.get.length === 1)).toBe(true);
  });
  it("keeps the highest optimistic packages when a size exceeds the beam", async () => {
    const own = Array.from({ length: 25 }, (_, i) => `p${i}`);
    const map = { add: new Map([["own", new Map([["x", 10]])], ["other", new Map(own.map((id, i) => [id, i + 1]))]]),
      leave: new Map([["own", new Map(own.map((id) => [id, 0]))], ["other", new Map([["x", 0]])]]) };
    const evaluated: string[][] = [];
    const result = await buildUsefulMoves({ own, opponents: { other: ["x"] } }, map, [], (offer) => {
      if (offer.give.length === 2) evaluated.push(offer.give);
      return { ...offer, legal: true, changed: true, own: 1, other: 1 };
    });
    expect(evaluated).toHaveLength(200);
    expect(result.coverage.beamCutoffsByTeam.other["2:1"]).toBe(100);
    expect(evaluated.some((ids) => ids.includes("p23") && ids.includes("p24"))).toBe(true);
    expect(evaluated.some((ids) => ids.includes("p0") && ids.includes("p1"))).toBe(false);
  });
  it("folds added players that do not materially change either gain", async () => {
    const result = await buildUsefulMoves(roster, impacts, [], (offer) => ({ ...offer, legal: true, changed: true, own: 1, other: 2 }));
    expect(result.rows.some((r) => r.variants.length > 0)).toBe(true);
  });
  // Seed metadata must not change the evaluated trades, gains or order-independent grouping seeds.
  it("keeps trades and gains identical with deterministic seeds across opponent order", async () => {
    const map = { add: new Map(impacts.add), leave: new Map(impacts.leave) };
    map.add.set("second", new Map([["a", 3], ["b", 2], ["c", 1]]));
    map.leave.set("second", new Map([["x", 2], ["y", 1]]));
    const fixture = { own: roster.own, opponents: { other: ["x", "y"], second: ["x", "y"] } };
    const evaluate = (offer: { team: string; give: string[]; get: string[] }): UsefulEvaluation => ({ ...offer, legal: true, changed: true,
      own: offer.give.length + offer.get.length / 10, other: 1 });
    const run = (opponents: typeof fixture.opponents, metadata = true) =>
      buildUsefulMoves({ own: fixture.own, opponents }, map, [], evaluate, undefined, undefined, undefined, metadata);
    const flatten = (result: Awaited<ReturnType<typeof run>>) => result.rows.flatMap((row) => [row.trade, ...row.variants]);
    const identity = (result: Awaited<ReturnType<typeof run>>) => flatten(result).map((row) =>
      [row.team, [...row.give].sort(), [...row.get].sort(), row.own, row.other]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const seeds = (result: Awaited<ReturnType<typeof run>>) => flatten(result).map((row) =>
      [row.team, [...row.give].sort(), [...row.get].sort(), row.seedKey]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const first = await run(fixture.opponents), again = await run(fixture.opponents),
      reversed = await run({ second: ["x", "y"], other: ["x", "y"] }), without = await run(fixture.opponents, false);
    expect(identity(first)).toEqual(identity(without));
    expect(seeds(first)).toEqual(seeds(again));
    expect(seeds(first)).toEqual(seeds(reversed));
    expect(flatten(first).every((row) => !!row.seedKey)).toBe(true);
  });
});






