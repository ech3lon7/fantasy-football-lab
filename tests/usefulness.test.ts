import { expect, it } from "vitest";
import { opponentIncentive } from "../src/domain/trade-discovery";
import { starterFixture } from "./fixtures";
import { evaluate, type Model } from "../src/domain/valuation";
import {
  scoreTradeMatch,
  findTradeMatches,
  tradeSearchBounds,
  tradeSearchContext,
  type TradeSearchQuery,
} from "../src/domain/trade-search";

// An isolated legal league gives each offered position a known starter and strongest backup, with no private data.
async function sample() {
  const d = await starterFixture();
  Object.assign(d.tables.ModelContext[0], {
    QBSlots: 1,
    WRSlots: 1,
    RBSlots: 0,
    TESlots: 0,
    KSlots: 0,
    DSTSlots: 0,
    FlexSlots: 0,
    BenchSlots: 10,
  });
  const m = evaluate(d, d.settings);
  for (const p of m.players) p.owner = "0";
  for (const [id, pos, expected, owner, slot] of [
    [100, "QB", 20, "1", 20],
    [101, "WR", 15, "1", 20],
    [102, "QB", 15, "2", 0],
    [103, "QB", 10, "2", 20],
    [104, "WR", 10, "2", 4],
    [105, "WR", 8, "2", 20],
    [106, "TE", 2, "2", 20],
  ] as const)
    Object.assign(m.byId.get(String(id))!, {
      pos,
      expected,
      value: expected,
      owner,
      slot,
      index: 50,
    });
  const q: TradeSearchQuery = {
    teamA: "1",
    give: ["100", "101"],
    count: 1,
    below: 500,
    above: 500,
    usefulness: { minimum: 1 },
  };
  return { m, q };
}
// Exercise the real package evaluator so legal repair and departures are part of every assertion.
function score(m: Model, q: TradeSearchQuery, get = ["106"]) {
  return scoreTradeMatch(m, q, {
    key: JSON.stringify(get),
    teamB: "2",
    get,
    incoming: 0,
    outgoing: 0,
    difference: 0,
  });
}

// Optional discovery evidence must not change values, lineup gains or package tests.
it("requires every offer to improve a distinct role and preserves all ordinary trade calculations", async () => {
  const { m, q } = await sample();
  const before = JSON.stringify(m.players);
  const row = score(m, q),
    legacy = score(m, { ...q, usefulness: undefined });
  expect(row.usefulness).toMatchObject([
    { offered: "100", compared: "102", group: "starter", gain: 5 },
    { offered: "101", compared: "104", group: "starter", gain: 5 },
  ]);
  const { usefulness: _fit, ...ordinary } = row;
  expect(_fit).toHaveLength(2);
  expect(ordinary).toEqual(legacy);
  expect(JSON.stringify(m.players)).toBe(before);
  m.byId.get("101")!.expected = 7;
  expect(score(m, q).usefulness).toEqual([]);
});

// A reserve must win a real backup role after all incoming and displaced players compete.
it("counts one strongest backup, accounts for displaced starters, and rejects weak extra players", async () => {
  const { m, q } = await sample();
  Object.assign(m.byId.get("101")!, { pos: "QB", expected: 18, value: 18 });
  const fit = score(m, q).usefulness!;
  expect(fit).toHaveLength(2);
  expect(new Set(fit.map((e) => e.compared)).size).toBe(2);
  expect(fit.find((e) => e.offered === "101")).toMatchObject({
    group: "depth",
    compared: "103",
    competitionPPG: 15,
  });
  m.byId.get("101")!.expected = 15.5;
  expect(score(m, q).usefulness).toEqual([]);
  Object.assign(m.byId.get("107")!, {
    pos: "QB",
    owner: "1",
    expected: 19,
    value: 19,
  });
  expect(score(m, { ...q, give: [...q.give, "107"] }).usefulness).toEqual([]);
});

// Departing players remain the reference: replacing them must be an actual upgrade, not coverage of a manufactured vacancy.
it("keeps the original starter as the comparison when that player is traded away", async () => {
  const { m, q } = await sample();
  expect(
    score(m, q).usefulness!.find((e) => e.offered === "100")!.compared,
  ).toBe("102");
  const changed = score(m, q, ["102"]);
  expect(changed.usefulness!.find((e) => e.offered === "100")!.compared).toBe(
    "102",
  );
  expect(
    score(m, { ...q, usefulness: { minimum: 5 } }, ["102"]).usefulness,
  ).toHaveLength(2);
  expect(
    score(m, { ...q, usefulness: { minimum: 5.000001 } }, ["102"]).usefulness,
  ).toEqual([]);
});

// A full roster before the trade must never become a zero-point upgrade baseline merely because both QBs depart.
it("rejects a downgrade into a slot opened by the trade instead of reporting a vacant role", async () => {
  const { m, q } = await sample();
  m.byId.get("100")!.expected = 17.72;
  m.byId.get("102")!.expected = 20.21;
  const request = { ...q, give: ["100"], count: 2 };
  expect(score(m, request, ["102", "103"]).usefulness).toEqual([]);
  m.byId.get("100")!.expected = 21.21;
  expect(score(m, request, ["102", "103"]).usefulness).toMatchObject([
    { compared: "102", comparedPPG: 20.21, minimum: 1 },
  ]);
  expect(
    score(m, { ...request, usefulness: { minimum: 1.000001 } }, ["102", "103"])
      .usefulness,
  ).toEqual([]);
});

// Surviving starters already occupy roles and cannot be counted again to justify replacing a stronger departing teammate.
it("cannot claim an upgrade over a weaker starter who still starts after the trade", async () => {
  const { m, q } = await sample();
  Object.assign(m.dataset.tables.ModelContext[0], {
    QBSlots: 0,
    WRSlots: 0,
    RBSlots: 2,
  });
  for (const [id, expected] of [
    [100, 17.72],
    [102, 20.21],
    [103, 10],
    [104, 25],
    [105, 8],
  ])
    Object.assign(m.byId.get(String(id))!, {
      pos: "RB",
      expected,
      value: expected,
    });
  expect(score(m, { ...q, give: ["100"] }, ["102"]).usefulness).toEqual([]);
  m.byId.get("100")!.expected = 21.21;
  expect(score(m, { ...q, give: ["100"] }, ["102"]).usefulness).toMatchObject([
    { compared: "102", group: "starter", comparedPPG: 20.21 },
  ]);
});

// Offers that cannot occupy a legal active role, or cannot be compared reliably, never qualify.
it("rejects dropped offers, IR assignments and unavailable comparison forecasts", async () => {
  const { m, q } = await sample();
  m.byId.get("104")!.expected = null;
  expect(score(m, q).usefulness).toEqual([]);
  m.byId.get("104")!.expected = 10;
  // An unrelated position without a FLEX route does not block usable comparisons.
  Object.assign(m.byId.get("110")!, { owner: "2", pos: "RB", expected: null });
  expect(score(m, q).usefulness).toHaveLength(2);
  m.byId.get("110")!.owner = "0";
  Object.assign(m.byId.get("100")!, { injury: "OUT", irEligible: true });
  expect(score(m, q).irB).toContain("100");
  expect(score(m, q).usefulness).toEqual([]);
  Object.assign(m.byId.get("100")!, { injury: "ACTIVE", irEligible: false });
  Object.assign(m.byId.get("101")!, {
    pos: "QB",
    expected: 18,
    value: 18,
    index: 0,
    // Matching schedules remove incidental bye coverage so the ordinary drop tie-break can select this offer.
    nflId: m.byId.get("100")!.nflId,
    droppable: true,
  });
  m.dataset.tables.ModelContext[0].BenchSlots = 1;
  const dropped = score(m, q);
  expect(dropped.dropsB).toContain("101");
  expect(dropped.usefulness).toEqual([]);
});

// Exact boundaries and season-level fit stay separate from missing data and current-week byes.
it("handles inclusive unrounded minimums, known vacancies, byes and disabled/invalid settings", async () => {
  const { m, q } = await sample();
  const single = { ...q, give: ["100"] };
  m.byId.get("102")!.expected = 19;
  m.byId.get("100")!.bye = m.current;
  expect(score(m, single).usefulness).toHaveLength(1);
  m.byId.get("102")!.expected = 19.000001;
  expect(score(m, single).usefulness).toEqual([]);
  m.byId.get("102")!.expected = 20;
  expect(
    score(m, { ...single, usefulness: { minimum: 0 } }).usefulness,
  ).toEqual([]);
  m.byId.get("102")!.owner = "0";
  m.byId.get("103")!.owner = "0";
  expect(score(m, single).usefulness).toMatchObject([
    { compared: null, group: "starter", comparedPPG: 0 },
  ]);
  for (const minimum of [-1, NaN, Infinity])
    expect(
      tradeSearchBounds(m, {
        ...single,
        usefulness: { minimum },
      }).errors.join(),
    ).toContain("usefulness");
  expect(
    tradeSearchBounds(m, { ...single, usefulness: undefined }).errors,
  ).toEqual([]);
  expect(tradeSearchContext(m, single)).not.toBe(
    tradeSearchContext(m, { ...single, usefulness: { minimum: 2 } }),
  );
  expect(tradeSearchContext(m, single)).not.toBe(
    tradeSearchContext(m, { ...single, usefulness: undefined }),
  );
});

// Package size does not alter the once-per-player/role rule or leak changes into scoring and value tests.
it("supports usefulness across all one-through-five package sizes in both directions", async () => {
  const { m, q } = await sample();
  Object.assign(m.dataset.tables.ModelContext[0], {
    QBSlots: 1,
    RBSlots: 1,
    WRSlots: 1,
    TESlots: 1,
    KSlots: 1,
    DSTSlots: 1,
    BenchSlots: 10,
  });
  for (const p of m.players) p.owner = "0";
  for (const [i, pos] of ["QB", "RB", "WR", "TE", "K"].entries()) {
    Object.assign(m.byId.get(String(100 + i))!, {
      pos,
      owner: "1",
      expected: 20,
      value: 20,
    });
    Object.assign(m.byId.get(String(105 + i))!, {
      pos,
      owner: "2",
      expected: 10,
      value: 10,
    });
    Object.assign(m.byId.get(String(110 + i))!, {
      pos: "D/ST",
      owner: "2",
      expected: 2,
      value: 2,
    });
  }
  for (let give = 1; give <= 5; give++)
    for (let get = 1; get <= 5; get++) {
      const request = {
        ...q,
        give: Array.from({ length: give }, (_, i) => String(100 + i)),
        count: get,
      };
      const result = score(
        m,
        request,
        Array.from({ length: get }, (_, i) => String(110 + i)),
      );
      expect(result.usefulness, `${give} for ${get}`).toHaveLength(give);
      expect(new Set(result.usefulness!.map((e) => e.role)).size).toBe(give);
    }
});

// A weaker return cannot borrow a retained teammate's lower score to disguise losing the better same-position player.
it("compares Tuten with the departing Bijan rather than a weaker retained RB", async () => {
  const { m, q } = await sample();
  Object.assign(m.dataset.tables.ModelContext[0], {
    QBSlots: 0,
    WRSlots: 0,
    RBSlots: 2,
  });
  for (const [id, expected, owner, slot] of [
    ["100", 14.71, "1", 20],
    ["102", 19.49, "2", 2],
    ["103", 10, "2", 2],
    ["105", 8, "2", 20],
  ] as const)
    Object.assign(m.byId.get(id)!, {
      pos: "RB",
      expected,
      value: expected,
      owner,
      slot,
    });
  m.byId.get("104")!.owner = "0";
  m.dataset.tables.ModelRosters = m.players
    .filter((p) => p.owner !== "0")
    .map((p) => ({
      PlayerID: Number(p.id),
      TeamID: Number(p.owner),
      LineupSlotID: p.slot,
    }));
  const request: TradeSearchQuery = {
    ...q,
    give: ["100"],
    upgrade: { mode: "starter", minimum: 0 },
  };
  const matches = () => findTradeMatches(m, request).matches;
  // The weaker arrival still improves the retained RB in isolation, but not the RB actually surrendered.
  expect(matches().some((row) => row.get.includes("102"))).toBe(false);
  const downgraded = score(m, request, ["102"]);
  expect(downgraded.upgrades).toEqual([]);
  expect(downgraded.usefulness).toEqual([]);
  expect(opponentIncentive(m, request, downgraded).upgrades).toEqual([]);
  // Disabling fit filters keeps the possible trade and its honest negative scoring impact available for inspection.
  expect(
    findTradeMatches(m, {
      ...request,
      upgrade: undefined,
      usefulness: undefined,
    }).matches.some((row) => row.get.includes("102")),
  ).toBe(true);
  // Matching scores are not an upgrade, and the departing starter's bye cannot lower the comparison floor.
  m.byId.get("100")!.expected = 19.49;
  m.byId.get("102")!.bye = m.current;
  expect(matches().some((row) => row.get.includes("102"))).toBe(false);
  // A genuinely stronger return qualifies against Bijan's original score, independently of bye-week timing.
  m.byId.get("100")!.expected = 20.49;
  expect(
    matches().find((row) => row.get.includes("102"))?.upgrades,
  ).toMatchObject([{ offered: "100", compared: "102", gain: 1 }]);
  expect(score(m, request, ["102"]).usefulness).toMatchObject([
    { offered: "100", compared: "102", gain: 1 },
  ]);
});

// Multi-player packages retain independent real upgrades without reusing the stronger departure as a weaker comparison.
it("reserves the strongest return for the strongest departure and keeps a second genuine upgrade", async () => {
  const { m, q } = await sample();
  Object.assign(m.byId.get("101")!, { pos: "QB", expected: 18, value: 18 });
  Object.assign(m.byId.get("102")!, { expected: 25, value: 25 });
  // QB 100 (20) replaces departing QB 102 (25); QB 101 (18) can still improve original backup 103 (10).
  const row = score(m, q, ["102"]);
  expect(row.usefulness).toEqual([]);
  const details = opponentIncentive(m, q, row);
  expect(details.upgrades).toMatchObject([
    { offered: "101", compared: "103", gain: 8 },
  ]);
  expect(
    opponentIncentive(m, { ...q, give: [...q.give].reverse() }, row).upgrades,
  ).toEqual(details.upgrades);
  // Raising the main return above the departing starter restores both distinct roles with no index or forecast formula changes.
  m.byId.get("100")!.expected = 26;
  const upgraded = score(m, q, ["102"]);
  expect(upgraded.usefulness).toMatchObject([
    { offered: "100", compared: "102", gain: 1 },
    { offered: "101", compared: "103", gain: 8 },
  ]);
});
