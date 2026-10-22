import { expect, it } from "vitest";
import { starterFixture } from "./fixtures";
import { evaluate } from "../src/domain/valuation";
import { cmpId } from "../src/domain/contracts";
import { teamsAssessment } from "../src/domain/lineups";
import { evaluateTrade } from "../src/domain/trades";
import { saveStarterLineup } from "../src/domain/starter-lineups";
import {
  gradeAtOrBelow,
  positionGradeScale,
  searchLineupDetails,
  compareSearchRows,
  findTradeMatches,
  scoreTradeMatch,
  tradeSearchBounds,
  tradeSearchContext,
  offeredUpgrades,
  matchesWeekly,
  type SearchRow,
  type TradeSearchQuery,
} from "../src/domain/trade-search";

// Use a small synthetic multi-owner model to exercise combination boundaries without private league data.
async function matchingModel() {
  const d = await starterFixture(),
    m = evaluate(d, d.settings);
  m.dataset.tables.ModelTeams.push({ TeamID: 3, TeamName: "Test C" });
  for (const p of m.players) p.owner = "0";
  m.byId.get("1")!.owner = "1";
  m.byId.get("1")!.index = 45.31;
  for (const [i, id] of [
    "100",
    "101",
    "102",
    "103",
    "104",
    "105",
    "106",
    "107",
  ].entries()) {
    const p = m.byId.get(id)!;
    p.owner = i < 6 ? "2" : "3";
    p.index = [0, 0, 10.45, 34.86, 40.31, 50.31, 45.31, 45.31][i];
  }
  return m;
}
const query: TradeSearchQuery = {
  teamA: "1",
  give: ["1"],
  count: 1,
  below: 5,
  above: 5,
};

// Signed bounds are inclusive and both teams' enabled ranges must pass using the exact unrounded averages.
it("filters weekly gains with independent inclusive minimums and maximums", () => {
  const row = { own: 20, other: -5 };
  expect(
    matchesWeekly(row, {
      own: { minimum: 20, maximum: 20 },
      other: { minimum: -5, maximum: -5 },
    }),
  ).toBe(true);
  expect(matchesWeekly(row, { own: { minimum: 20.001, maximum: null } })).toBe(
    false,
  );
  expect(matchesWeekly(row, { own: { minimum: null, maximum: 19.999 } })).toBe(
    false,
  );
  expect(
    matchesWeekly(row, {
      own: { minimum: 0, maximum: null },
      other: { minimum: 0, maximum: null },
    }),
  ).toBe(false);
  expect(matchesWeekly(row, { other: { minimum: null, maximum: -5 } })).toBe(
    true,
  );
  expect(
    matchesWeekly({ own: 0, other: 0 }, { own: { minimum: 0, maximum: 0 } }),
  ).toBe(true);
});

// Unknown averages are excluded only for a bounded side; a blank range is not a fabricated zero requirement.
it("preserves unavailable versus zero weekly gains and unbounded/disabled ranges", () => {
  const row = { own: null, other: 0 };
  expect(matchesWeekly(row)).toBe(true);
  expect(matchesWeekly(row, { own: { minimum: null, maximum: null } })).toBe(
    true,
  );
  expect(matchesWeekly(row, { own: { minimum: -100, maximum: null } })).toBe(
    false,
  );
  expect(matchesWeekly(row, { other: { minimum: 0, maximum: null } })).toBe(
    true,
  );
  expect(
    matchesWeekly(
      { own: Infinity, other: 0 },
      { own: { minimum: 0, maximum: null } },
    ),
  ).toBe(false);
});

// Validate enabled limits and keep malformed numeric edits distinct from a valid unbounded search context.
it("validates weekly ranges and invalidates searches on every active bound change", async () => {
  const m = await matchingModel();
  const q: TradeSearchQuery = {
    ...query,
    weekly: { own: { minimum: -20, maximum: 5 } },
  };
  expect(tradeSearchBounds(m, q).errors).toEqual([]);
  expect(
    tradeSearchBounds(m, {
      ...q,
      weekly: { other: { minimum: 10, maximum: 5 } },
    }).errors.join(),
  ).toContain("Their minimum weekly gain");
  for (const value of [NaN, Infinity])
    expect(
      tradeSearchBounds(m, {
        ...q,
        weekly: { own: { minimum: value, maximum: null } },
      }).errors.join(),
    ).toContain("finite numbers or blank");
  const first = tradeSearchContext(m, q);
  for (const weekly of [
    { own: { minimum: -19, maximum: 5 } },
    { own: { minimum: -20, maximum: 6 } },
    { other: { minimum: -20, maximum: 5 } },
  ])
    expect(tradeSearchContext(m, { ...q, weekly })).not.toBe(first);
  expect(
    tradeSearchContext(m, {
      ...q,
      weekly: { own: { minimum: NaN, maximum: null } },
    }),
  ).not.toBe(
    tradeSearchContext(m, {
      ...q,
      weekly: { own: { minimum: null, maximum: null } },
    }),
  );
  expect(tradeSearchContext(m, { ...query, weekly: undefined })).toBe(
    tradeSearchContext(m, query),
  );
});

// Verify existing evaluator weekly averages rather than horizon totals, while retaining the original matching set and scoring.
it("screens authoritative weekly averages without changing index matching, weeks or scoring", async () => {
  const d = await starterFixture(),
    m = evaluate(d, d.settings);
  const q: TradeSearchQuery = {
    ...query,
    give: ["101"],
    below: 500,
    above: 500,
  };
  const matches = findTradeMatches(m, q).matches;
  const filteredQuery = {
    ...q,
    weekly: {
      own: { minimum: 2, maximum: null },
      other: { minimum: 0, maximum: null },
    },
  };
  expect(findTradeMatches(m, filteredQuery).matches).toEqual(matches);
  const rows = matches.map((match) => scoreTradeMatch(m, q, match));
  const qb = rows.find((row) => row.get[0] === "200")!,
    wr = rows.find((row) => row.get[0] === "2")!;
  expect(qb.ownTotal).toBe(0);
  expect(wr.own).toBe(15);
  expect(wr.ownTotal).toBe(180);
  expect(matchesWeekly(wr, filteredQuery.weekly)).toBe(true);
  expect(matchesWeekly(qb, filteredQuery.weekly)).toBe(false);
  expect(matchesWeekly(wr, { own: { minimum: null, maximum: 10 } })).toBe(
    false,
  );
  for (const match of matches)
    expect(scoreTradeMatch(m, filteredQuery, match)).toEqual(
      scoreTradeMatch(m, q, match),
    );
  expect(m.weeks).toHaveLength(12);
});

// Independently enumerate all small subsets as an oracle for pruning, ties, zeros and exact package sizes.
it("matches exhaustive combinations for every incoming count without cross-owner packages or permutations", async () => {
  const m = await matchingModel();
  for (let count = 1; count <= 5; count++) {
    const q = { ...query, count, below: 200, above: 200 };
    const expected: string[] = [];
    for (const team of ["2", "3"]) {
      const pool = m.players
        .filter((p) => p.owner === team && p.index !== null)
        .sort((a, b) => a.index! - b.index! || cmpId(a.id, b.id));
      for (let mask = 0; mask < 2 ** pool.length; mask++) {
        const chosen = pool.filter((_, i) => mask & (1 << i));
        if (chosen.length === count)
          expected.push(
            JSON.stringify([team, chosen.map((p) => p.id).sort(cmpId)]),
          );
      }
    }
    const found = findTradeMatches(m, q).matches.map((x) => x.key);
    expect(found.sort()).toEqual(expected.sort());
    expect(new Set(found).size).toBe(found.length);
  }
});

// Build current-roster comparisons with an explicitly stronger starting QB and a weaker positional reserve.
async function upgradeModel() {
  const d = await starterFixture(),
    m = evaluate(d, d.settings);
  m.byId.get("200")!.expected = 25;
  Object.assign(m.byId.get("102")!, { owner: "2", expected: 15, slot: 20 });
  m.dataset.tables.ModelRosters.push({
    PlayerID: 102,
    TeamID: 2,
    LineupSlotID: 20,
  });
  return m;
}

// Model the reported two-WR package with one weaker starter and one weaker bench receiver.
async function assignmentModel() {
  const m = await upgradeModel();
  Object.assign(m.byId.get("1")!, { pos: "WR", expected: 13 });
  Object.assign(m.byId.get("101")!, { pos: "WR", expected: 12 });
  m.byId.get("2")!.expected = 9;
  Object.assign(m.byId.get("102")!, { pos: "WR", expected: 10 });
  return m;
}

// Each side is used once, with the stronger offer assigned to the starter when upgrade counts otherwise tie.
it("assigns two offered receivers to distinct starter and bench upgrades without reusing either side", async () => {
  const m = await assignmentModel();
  const q: TradeSearchQuery = {
    ...query,
    give: ["101", "1"],
    upgrade: { mode: "either", minimum: 1 },
  };
  const result = offeredUpgrades(m, q, "2");
  expect(result).toMatchObject([
    { offered: "1", compared: "2", group: "starter" },
    { offered: "101", compared: "102", group: "depth" },
  ]);
  expect(new Set(result.map((e) => e.offered)).size).toBe(2);
  expect(new Set(result.map((e) => e.compared)).size).toBe(2);
  expect(
    offeredUpgrades(m, { ...q, give: [...q.give].reverse() }, "2"),
  ).toEqual(result);
  expect(
    offeredUpgrades(m, { ...q, upgrade: { mode: "starter", minimum: 1 } }, "2"),
  ).toMatchObject([{ offered: "1", compared: "2", group: "starter" }]);
  // A single offer is consumed by its starter assignment, even though it could also beat the bench player.
  expect(offeredUpgrades(m, { ...q, give: ["1"] }, "2")).toHaveLength(1);
});

// A greedy strongest-to-weakest choice would find one match; exact assignment must find both legal starter upgrades.
it("maximizes distinct starter upgrades before choosing larger advantages", async () => {
  const m = await assignmentModel();
  m.byId.get("2")!.expected = 11;
  m.dataset.tables.ModelRosters.find((r) => r.PlayerID === 102)!.LineupSlotID =
    23;
  m.byId.get("102")!.slot = 23;
  const q: TradeSearchQuery = {
    ...query,
    give: ["1", "101"],
    upgrade: { mode: "starter", minimum: 2 },
  };
  expect(offeredUpgrades(m, q, "2")).toMatchObject([
    { offered: "1", compared: "2", gain: 2 },
    { offered: "101", compared: "102", gain: 2 },
  ]);
});

// Starter count dominates depth count, and depth count is optimized before advantage tie-breaks.
it("prioritizes starters then depth across the complete package", async () => {
  const m = await assignmentModel();
  m.byId.get("2")!.expected = 11.5;
  Object.assign(m.byId.get("104")!, {
    owner: "2",
    pos: "WR",
    expected: 11,
    slot: 20,
  });
  m.dataset.tables.ModelRosters.push({
    PlayerID: 104,
    TeamID: 2,
    LineupSlotID: 20,
  });
  const q: TradeSearchQuery = {
    ...query,
    give: ["1", "101"],
    upgrade: { mode: "either", minimum: 1 },
  };
  expect(offeredUpgrades(m, q, "2")).toMatchObject([
    { offered: "1", compared: "2", group: "starter" },
    { offered: "101", compared: "102", group: "depth" },
  ]);
  m.byId.get("104")!.slot = 21;
  m.byId.get("102")!.slot = 21;
  expect(
    offeredUpgrades(m, { ...q, upgrade: { mode: "depth", minimum: 1 } }, "2"),
  ).toEqual([]);
});

// Five-player masks remain exact and unique; missing comparison forecasts exclude only that unverifiable edge.
it("assigns five offers uniquely and respects unknown forecasts and actual bench membership", async () => {
  const m = await assignmentModel();
  const give = ["1", "100", "101", "103", "104"];
  give.forEach((id, i) =>
    Object.assign(m.byId.get(id)!, { owner: "1", pos: "WR", expected: 20 - i }),
  );
  for (const [i, id] of ["102", "106", "107", "108"].entries()) {
    Object.assign(m.byId.get(id)!, {
      owner: "2",
      pos: "WR",
      expected: 8 - i,
      slot: 20,
    });
    if (id !== "102")
      m.dataset.tables.ModelRosters.push({
        PlayerID: Number(id),
        TeamID: 2,
        LineupSlotID: 20,
      });
  }
  const q: TradeSearchQuery = {
    ...query,
    give,
    upgrade: { mode: "either", minimum: 1 },
  };
  const result = offeredUpgrades(m, q, "2");
  expect(result).toHaveLength(5);
  expect(new Set(result.map((e) => e.compared)).size).toBe(5);
  expect(new Set(result.map((e) => e.offered)).size).toBe(5);
  // The maximum five-offer requirement needs all four bench comparisons plus its distinct starter.
  const counted = {
    ...q,
    below: 500,
    above: 500,
    upgrade: { ...q.upgrade!, requiredStarters: 1, requiredBench: 4 },
  };
  expect(findTradeMatches(m, counted).matches.length).toBeGreaterThan(0);
  m.byId.get("108")!.expected = null;
  expect(findTradeMatches(m, counted).matches).toEqual([]);
  expect(offeredUpgrades(m, q, "2")).toHaveLength(4);
  expect(
    offeredUpgrades(
      m,
      { ...q, upgrade: { mode: "depth", minimum: 1 } },
      "2",
    ).every((e) => e.compared !== "2"),
  ).toBe(true);
});

// A user's benched player can upgrade the other team's starter; the opponent's current player still counts if traded away.
it("checks pre-trade starter fit regardless of the offered player's bench designation", async () => {
  const m = await upgradeModel();
  const q: TradeSearchQuery = {
    ...query,
    give: ["101"],
    below: 500,
    above: 500,
    upgrade: { mode: "starter", minimum: 1 },
  };
  const evidence = offeredUpgrades(m, q, "2");
  expect(m.byId.get("101")!.slot).toBe(20);
  expect(evidence).toMatchObject([
    {
      offered: "101",
      compared: "200",
      group: "starter",
      gain: 5,
      source: "Imported ESPN lineup",
    },
  ]);
  for (const count of [1, 2]) {
    const matches = findTradeMatches(m, { ...q, count }).matches;
    expect(matches.some((match) => match.get.includes("200"))).toBe(true);
    expect(
      matches.every(
        (match) => JSON.stringify(match.upgrades) === JSON.stringify(evidence),
      ),
    ).toBe(true);
  }
  // An offered QB below their current starter cannot pass just because that starter would leave.
  expect(findTradeMatches(m, { ...q, give: ["100"] }).matches).toEqual([]);
});

// Depth uses actual bench membership; a starter cannot be relabeled depth even when ranked second at his position.
it("compares actual bench players and assigns an offer only once in Either mode", async () => {
  const m = await upgradeModel();
  const q: TradeSearchQuery = {
    ...query,
    give: ["100"],
    upgrade: { mode: "depth", minimum: 1 },
  };
  expect(offeredUpgrades(m, q, "2")).toMatchObject([
    { compared: "102", gain: 5, group: "depth" },
  ]);
  expect(
    offeredUpgrades(m, { ...q, upgrade: { mode: "either", minimum: 1 } }, "2"),
  ).toMatchObject([{ group: "depth" }]);
  // Reproduce the Stafford case: the starter ranks second, but remains a starter and cannot supply a depth label.
  m.byId.get("102")!.expected = 35;
  expect(offeredUpgrades(m, { ...q, give: ["101"] }, "2")).toEqual([]);
  expect(
    offeredUpgrades(
      m,
      { ...q, give: ["101"], upgrade: { mode: "either", minimum: 1 } },
      "2",
    ),
  ).toMatchObject([{ compared: "200", gain: 5, group: "starter" }]);
});

// Use saved/imported starter choices and the weakest same-position starter, including a same-position FLEX slot.
it("honors saved starters and multi-starter positional/FLEX comparisons", async () => {
  const m = await upgradeModel();
  const q: TradeSearchQuery = {
    ...query,
    give: ["100"],
    upgrade: { mode: "starter", minimum: 1 },
  };
  const raw = saveStarterLineup(m, "2", ["2", "102"]);
  expect(offeredUpgrades(m, q, "2", raw)).toMatchObject([
    { compared: "102", source: "Saved app lineup", gain: 5 },
  ]);
  expect(
    findTradeMatches(m, { ...q, below: 500, above: 500 }, undefined, raw)
      .matches.length,
  ).toBeGreaterThan(0);
  for (const [id, expected, slot] of [
    ["103", 21, 2],
    ["104", 15, 23],
  ] as const) {
    Object.assign(m.byId.get(id)!, { owner: "2", expected, slot });
    m.dataset.tables.ModelRosters.push({
      PlayerID: Number(id),
      TeamID: 2,
      LineupSlotID: slot,
    });
  }
  expect(offeredUpgrades(m, { ...q, give: ["1"] }, "2")).toMatchObject([
    { compared: "104", group: "starter" },
  ]);
});

// Missing comparison/forecast data never becomes a zero; real zero and negative forecasts remain numeric.
it("does not invent upgrades for incomplete forecasts, missing bench or invalid starter data", async () => {
  const m = await upgradeModel();
  const q: TradeSearchQuery = {
    ...query,
    give: ["101"],
    upgrade: { mode: "depth", minimum: 1 },
  };
  m.byId.get("102")!.owner = "0";
  expect(offeredUpgrades(m, q, "2")).toEqual([]);
  m.byId.get("102")!.owner = "2";
  m.byId.get("102")!.expected = null;
  expect(offeredUpgrades(m, q, "2")).toEqual([]);
  m.byId.get("102")!.expected = 0;
  expect(offeredUpgrades(m, q, "2")[0].comparedPPG).toBe(0);
  m.byId.get("101")!.expected = null;
  expect(offeredUpgrades(m, q, "2")).toEqual([]);
  m.byId.get("101")!.expected = -1;
  m.byId.get("102")!.expected = -2;
  expect(offeredUpgrades(m, q, "2")[0].gain).toBe(1);
  expect(
    offeredUpgrades(
      m,
      { ...q, upgrade: { mode: "starter", minimum: 1 } },
      "2",
      "malformed",
    ),
  ).toEqual([]);
});

// Require only one qualifying offered player, preserve exact thresholds, and reject equality even at minimum zero.
it("accepts at least one upgrade and applies the adjustable minimum without rounding", async () => {
  const m = await upgradeModel();
  const q: TradeSearchQuery = {
    ...query,
    give: ["1", "101"],
    upgrade: { mode: "starter", minimum: 1 },
  };
  m.byId.get("101")!.expected = 26;
  expect(offeredUpgrades(m, q, "2")).toMatchObject([
    { offered: "101", gain: 1 },
  ]);
  expect(
    offeredUpgrades(
      m,
      { ...q, upgrade: { mode: "starter", minimum: 1.001 } },
      "2",
    ),
  ).toEqual([]);
  m.byId.get("101")!.expected = 25;
  expect(
    offeredUpgrades(m, { ...q, upgrade: { mode: "starter", minimum: 0 } }, "2"),
  ).toEqual([]);
  for (const minimum of [-1, NaN, Infinity])
    expect(
      tradeSearchBounds(m, {
        ...q,
        upgrade: { mode: "starter", minimum },
      }).errors.join(),
    ).toContain("Expected PPG advantage");
});

// Upgrade criteria must invalidate stale searches, while disabled queries preserve the original matching/scoring path.
it("keeps the disabled filter unchanged and includes enabled criteria in search identity", async () => {
  const m = await upgradeModel();
  const q = { ...query, give: ["101"], below: 500, above: 500 };
  const unfiltered = findTradeMatches(m, q);
  expect(findTradeMatches(m, { ...q, upgrade: undefined })).toEqual(unfiltered);
  const enabled: TradeSearchQuery = {
    ...q,
    upgrade: { mode: "starter", minimum: 1 },
  };
  expect(tradeSearchContext(m, enabled)).not.toBe(tradeSearchContext(m, q));
  expect(
    tradeSearchContext(m, {
      ...enabled,
      upgrade: { mode: "depth", minimum: 1 },
    }),
  ).not.toBe(tradeSearchContext(m, enabled));
  expect(
    tradeSearchContext(m, {
      ...enabled,
      upgrade: { mode: "starter", minimum: 2 },
    }),
  ).not.toBe(tradeSearchContext(m, enabled));
  const filtered = findTradeMatches(m, enabled);
  expect(filtered.matches.map((match) => match.key)).toEqual(
    unfiltered.matches.map((match) => match.key),
  );
  for (const match of filtered.matches) {
    const original = unfiltered.matches.find(
      (candidate) => candidate.key === match.key,
    )!;
    expect(scoreTradeMatch(m, enabled, match)).toMatchObject(
      scoreTradeMatch(m, q, original),
    );
  }
  expect(
    findTradeMatches(m, {
      ...enabled,
      upgrade: { mode: "starter", minimum: 100 },
    }).stats.upgradeExcluded,
  ).toBe(1);
});

// Validate tight and fractional pruning against a separate exhaustive oracle, rather than only wide ranges.
it("preserves exact fractional boundaries and prunes without losing any valid subset", async () => {
  const m = await matchingModel();
  for (let count = 1; count <= 5; count++)
    for (const offset of [0, 0.01, 5, 15]) {
      const q = { ...query, count, below: offset, above: offset };
      const broad = findTradeMatches(m, {
        ...q,
        below: 500,
        above: 500,
      }).matches;
      const b = tradeSearchBounds(m, q);
      expect(
        findTradeMatches(m, q)
          .matches.map((x) => x.key)
          .sort(),
      ).toEqual(
        broad
          .filter((x) => x.incoming >= b.lower && x.incoming <= b.upper)
          .map((x) => x.key)
          .sort(),
      );
    }
  const b = tradeSearchBounds(m, query);
  expect(b.lower).toBeCloseTo(40.31);
  expect(b.upper).toBeCloseTo(50.31);
  expect(findTradeMatches(m, query).matches.map((x) => x.incoming)).toEqual([
    40.31, 50.31, 45.31, 45.31,
  ]);
});

// Zero indices are real candidates, injuries/byes do not filter them, and missing indices are reported.
it("keeps zero, injured and bye players while excluding only unavailable incoming indices", async () => {
  const m = await matchingModel();
  m.byId.get("1")!.index = 0;
  Object.assign(m.byId.get("100")!, {
    injury: "OUT",
    out: true,
    bye: m.current,
  });
  m.byId.get("106")!.index = null;
  const found = findTradeMatches(m, { ...query, below: 0, above: 0 });
  expect(found.matches.map((x) => x.get)).toEqual([["100"], ["101"]]);
  expect(found.stats.excluded).toBe(1);
  expect(findTradeMatches(m, { ...query, count: 5 }).stats.thinTeams).toBe(1);
});

// Reject malformed searches explicitly, never coercing missing/invalid indices or controls into zero.
it("validates IDs, ownership, counts, offsets and finite aggregate ranges", async () => {
  const m = await matchingModel();
  for (const change of [
    { give: [] },
    { give: ["1", "1"] },
    { give: ["missing"] },
    { give: ["100"] },
    { count: 0 },
    { count: 6 },
    { count: 1.5 },
    { below: -1 },
    { above: NaN },
    { teamA: "missing" },
  ])
    expect(() => findTradeMatches(m, { ...query, ...change })).toThrow();
  m.byId.get("1")!.index = null;
  expect(tradeSearchBounds(m, query).errors.join()).toContain(
    "unavailable index",
  );
  m.byId.get("1")!.index = Number.MAX_VALUE;
  expect(
    tradeSearchBounds(m, { ...query, above: Number.MAX_VALUE }).errors.join(),
  ).toContain("finite");
});

// Summed packages may exceed 100; raw matching must not depend on the consolidation premium.
it("supports totals above 100 and leaves raw matching independent of premium", async () => {
  const m = await matchingModel();
  m.byId.get("1")!.index = 110;
  const q = { ...query, count: 5, below: 100, above: 100 };
  const first = findTradeMatches(m, q).matches;
  expect(first.some((x) => x.incoming > 100)).toBe(true);
  m.settings.Premium = 0.35;
  expect(findTradeMatches(m, q).matches).toEqual(first);
});

// Compare all displayed scoring/test fields with the existing evaluator under imported and saved starters.
it("reuses authoritative scoring for bench, starter and unequal trades without mutating the draft", async () => {
  const d = await starterFixture(),
    m = evaluate(d, d.settings);
  for (const give of [["101"], ["100"], ["1", "101"]])
    for (const get of [["200"], ["2", "200"]]) {
      const q = { ...query, give, count: get.length, below: 500, above: 500 };
      const match = findTradeMatches(m, q).matches.find(
        (x) => x.get.join() === get.sort(cmpId).join(),
      )!;
      for (const raw of [undefined, saveStarterLineup(m, "1", ["1", "101"])]) {
        const original = structuredClone(q);
        const row = scoreTradeMatch(m, q, match, raw);
        const result = evaluateTrade(
          m,
          { teamA: "1", teamB: "2", give, get },
          true,
          raw,
        );
        if (!result.valid) throw Error(result.errors.join());
        expect(row).toMatchObject({
          own: result.directA.expectedPerWeek,
          other: result.directB.expectedPerWeek,
          ownTotal: result.directA.expected,
          otherTotal: result.directB.expected,
          grade: result.grade,
          surplus: result.surplusTest,
          points: result.pointsTest,
          dropsA: result.dropsA,
          dropsB: result.dropsB,
          irA: result.irA,
          irB: result.irB,
          legal: result.legality,
        });
        expect(q).toEqual(original);
      }
    }
});

// Invalid scoring remains a visible index match; warnings distinguish injury/bye from ordinary availability.
it("retains invalid evaluations and reports known availability warnings", async () => {
  const d = await starterFixture(),
    m = evaluate(d, d.settings);
  const q = { ...query, give: ["101"], below: 500, above: 500 };
  const match = findTradeMatches(m, q).matches.find((x) => x.get[0] === "200")!;
  Object.assign(m.byId.get("200")!, {
    injury: "OUT",
    out: true,
    bye: m.current,
  });
  expect(scoreTradeMatch(m, q, match).warnings.join()).toContain(
    "Incoming QB: OUT",
  );
  expect(scoreTradeMatch(m, q, match).warnings.join()).toContain(
    "bye this week",
  );
  m.byId.get("200")!.value = null;
  const row = scoreTradeMatch(m, q, match);
  expect(row.own).toBeNull();
  expect(row.warnings.join()).toContain("Incomplete model data");
  expect(row.get).toEqual(["200"]);
});

// Rank real gains, zeros and losses before missing scores, without favoring the nearest index over scoring.
it("sorts globally by direct scoring then index gap and stable IDs", () => {
  const base = { difference: 0, teamB: "2", get: ["1"] } as SearchRow;
  const rows = [
    { ...base, key: "missing", own: null },
    { ...base, key: "loss", own: -2 },
    { ...base, key: "zero", own: 0 },
    { ...base, key: "far", own: 4, difference: 5 },
    { ...base, key: "near", own: 4, difference: 1 },
  ];
  expect(rows.sort(compareSearchRows).map((x) => x.key)).toEqual([
    "near",
    "far",
    "zero",
    "loss",
    "missing",
  ]);
  expect(
    compareSearchRows(
      { ...base, own: 1, get: ["2"] },
      { ...base, own: 1, get: ["10"] },
    ),
  ).toBeLessThan(0);
});

// Context identity changes only with relevant model/search/workspace inputs, and settings key order is canonical.
it("invalidates context for account, outgoing, model and starter changes", async () => {
  const m = await matchingModel(),
    first = tradeSearchContext(m, query, "", "local");
  expect(tradeSearchContext(m, { ...query }, "", "local")).toBe(first);
  expect(tradeSearchContext(m, query, "", "other-account")).not.toBe(first);
  expect(tradeSearchContext(m, query, "saved", "local")).not.toBe(first);
  expect(tradeSearchContext(m, { ...query, count: 2 }, "", "local")).not.toBe(
    first,
  );
  m.settings = Object.fromEntries(
    Object.entries(m.settings).reverse(),
  ) as typeof m.settings;
  expect(tradeSearchContext(m, query, "", "local")).toBe(first);
  m.settings.Premium = 0.35;
  expect(tradeSearchContext(m, query, "", "local")).not.toBe(first);
});

// Every grade boundary is inclusive, and missing grades cannot masquerade as severe deficits.
it("compares existing grade ceilings inclusively without converting unavailable grades to F", () => {
  for (const [i, grade] of positionGradeScale.entries())
    for (const [j, ceiling] of positionGradeScale.entries())
      expect(gradeAtOrBelow(grade, ceiling)).toBe(i <= j);
  for (const unknown of ["n.a.", "", "Unavailable"])
    expect(gradeAtOrBelow(unknown, "A+")).toBe(false);
  expect(gradeAtOrBelow("F", "unknown")).toBe(false);
});

// The filter consumes pre-trade Team Rosters grades, with no changes to ownership, baselines or scoring.
it("filters by the selected offered position using the existing team grade snapshot", async () => {
  const d = await starterFixture(),
    m = evaluate(d, d.settings);
  const q: TradeSearchQuery = {
    ...query,
    give: ["101"],
    below: 500,
    above: 500,
  };
  const before = teamsAssessment(m);
  const grade = before.get("2")!.find((row) => row.position === "QB")!;
  expect(grade.grade).toBe("F");
  const unfiltered = findTradeMatches(m, q);
  const filtered = findTradeMatches(m, {
    ...q,
    deficit: { position: "QB", ceiling: "F" },
  });
  expect(filtered.matches.map((row) => row.get)).toEqual(
    unfiltered.matches.map((row) => row.get),
  );
  expect(
    filtered.matches.every(
      (row) =>
        row.deficit?.grade === grade.grade &&
        row.deficit.status === grade.status,
    ),
  ).toBe(true);
  expect(filtered.stats.deficitExcluded).toBe(0);
  expect(teamsAssessment(m)).toEqual(before);
  // This WR group exceeds C even though the same opponent's QB group qualifies.
  m.byId.get("1")!.pos = "WR";
  expect(
    findTradeMatches(m, {
      ...q,
      give: ["1"],
      deficit: { position: "WR", ceiling: "C" },
    }).matches,
  ).toEqual([]);
  // No usable TE grade means no match, even at the most permissive ceiling.
  m.byId.get("1")!.pos = "TE";
  m.byId.get("1")!.value = 0;
  const absent = findTradeMatches(m, {
    ...q,
    give: ["1"],
    deficit: { position: "TE", ceiling: "A+" },
  });
  expect(absent.matches).toEqual([]);
  expect(absent.stats.deficitExcluded).toBe(1);
});

// Editing either selected criterion invalidates results; unrepresented positions cannot start a search.
it("validates deficit selections and fingerprints position and grade changes", async () => {
  const d = await starterFixture(),
    m = evaluate(d, d.settings);
  const q: TradeSearchQuery = {
    ...query,
    give: ["1", "101"],
    deficit: { position: "QB", ceiling: "C+" },
  };
  expect(tradeSearchBounds(m, q).errors).toEqual([]);
  for (const deficit of [
    { position: "RB", ceiling: "C+" },
    { position: "QB", ceiling: "C" },
  ] as const)
    expect(tradeSearchContext(m, { ...q, deficit })).not.toBe(
      tradeSearchContext(m, q),
    );
  for (const deficit of [
    { position: "WR", ceiling: "C+" },
    { position: "QB", ceiling: "n.a." },
  ] as const)
    expect(tradeSearchBounds(m, { ...q, deficit }).errors.join()).toContain(
      "offered deficit position",
    );
  expect(tradeSearchBounds(m, { ...q, give: ["1"] }).errors.join()).toContain(
    "offered deficit position",
  );
});

// A qualifying upgrade at another offered position cannot satisfy a QB-specific deficit search.
it("requires the qualifying positional upgrade to match the selected deficit position", async () => {
  const d = await starterFixture(),
    m = evaluate(d, d.settings);
  Object.assign(m.byId.get("106")!, { owner: "1", expected: 20, slot: 20 });
  m.dataset.tables.ModelRosters.push({
    PlayerID: 106,
    TeamID: 1,
    LineupSlotID: 20,
  });
  m.byId.get("101")!.expected = 5;
  const q: TradeSearchQuery = {
    ...query,
    give: ["101", "106"],
    below: 500,
    above: 500,
    deficit: { position: "QB", ceiling: "C+" },
    upgrade: { mode: "starter", minimum: 1 },
  };
  expect(offeredUpgrades(m, q, "2")).toMatchObject([
    { offered: "106", compared: "2" },
  ]);
  expect(
    findTradeMatches(m, { ...q, upgrade: undefined }).matches.length,
  ).toBeGreaterThan(0);
  const filtered = findTradeMatches(m, q);
  expect(filtered.matches).toEqual([]);
  expect(filtered.stats.upgradeExcluded).toBe(1);
  m.byId.get("101")!.expected = 30;
  expect(findTradeMatches(m, q).matches.length).toBeGreaterThan(0);
});

// Trace slot identities back to the evaluator and reconcile both weekly deltas and the displayed averages.
it("explains actual replacements, byes and slot gains for both teams without altering scoring", async () => {
  const d = await starterFixture(),
    m = evaluate(d, d.settings);
  const q: TradeSearchQuery = {
    ...query,
    give: ["100"],
    below: 500,
    above: 500,
  };
  const match = findTradeMatches(m, q).matches.find(
    (row) => row.get[0] === "2",
  )!;
  const trace = searchLineupDetails(m, q, match);
  expect(trace.own.source).toBe("Imported ESPN lineup");
  expect(trace.own.replacements).toEqual(["101"]);
  expect(trace.own.weekly[0].changes).toContainEqual({
    slot: "QB",
    before: "100",
    after: "101",
    gain: 10,
  });
  expect(trace.other.weekly[0].changes).toContainEqual({
    slot: "QB",
    before: "200",
    after: "100",
    gain: 10,
  });
  expect(
    trace.own.weekly.find((week) => week.week === 8)!.changes,
  ).toContainEqual({ slot: "QB", before: null, after: "101", gain: 30 });
  const scored = scoreTradeMatch(m, q, match);
  for (const [side, average] of [
    [trace.own, scored.own],
    [trace.other, scored.other],
  ] as const) {
    expect(
      side.weekly.reduce((total, week) => total + week.gain!, 0) /
        m.weeks.length,
    ).toBeCloseTo(average!);
    for (const week of side.weekly) {
      expect(
        week.changes.reduce((total, slot) => total + slot.gain!, 0),
      ).toBeCloseTo(week.gain!);
      expect(week.after! - week.before!).toBeCloseTo(week.gain!);
    }
  }
});

// Saved starters determine explanations too; bench departures and missing scores retain zero/null semantics.
it("honors saved scoring lineups and keeps unavailable explanations distinct from zero", async () => {
  const d = await starterFixture(),
    m = evaluate(d, d.settings);
  const q: TradeSearchQuery = {
    ...query,
    give: ["101"],
    below: 500,
    above: 500,
  };
  const match = findTradeMatches(m, q).matches.find(
    (row) => row.get[0] === "200",
  )!;
  const bench = searchLineupDetails(m, q, match);
  expect(bench.own.benchOutgoing).toEqual(["101"]);
  expect(
    bench.own.weekly.every(
      (week) => week.gain === 0 && week.changes.length === 0,
    ),
  ).toBe(true);
  const raw = saveStarterLineup(m, "1", ["1", "101"]);
  const saved = searchLineupDetails(m, q, match, raw);
  expect(saved.own.source).toBe("Saved app lineup");
  expect(saved.own.replacements).toEqual(["100"]);
  m.byId.get("100")!.expected = null;
  const unknown = searchLineupDetails(m, q, match);
  expect(unknown.own.weekly.every((week) => week.gain === null)).toBe(true);
  expect(unknown.own.issues.length).toBeGreaterThan(0);
  expect(() =>
    searchLineupDetails(m, { ...q, give: ["missing"] }, match),
  ).toThrow();
});

// Two offers must beat two different starters; missing comparison forecasts cannot fill the required count.
it("requires at least the requested number of distinct starter upgrades", async () => {
  const m = await assignmentModel();
  m.byId.get("2")!.expected = 11;
  m.byId.get("102")!.slot = 23;
  m.dataset.tables.ModelRosters.find(
    (row) => row.PlayerID === 102,
  )!.LineupSlotID = 23;
  const q: TradeSearchQuery = {
    ...query,
    give: ["1", "101"],
    below: 500,
    above: 500,
    upgrade: {
      mode: "starter",
      minimum: 2,
      requiredStarters: 2,
      requiredBench: 0,
    },
  };
  const found = findTradeMatches(m, q);
  expect(found.matches.length).toBeGreaterThan(0);
  expect(found.matches[0].upgrades).toHaveLength(2);
  expect(
    new Set(found.matches[0].upgrades!.map((edge) => edge.compared)).size,
  ).toBe(2);
  m.byId.get("102")!.expected = null;
  const missing = findTradeMatches(m, q);
  expect(missing.matches).toEqual([]);
  expect(missing.stats.upgradeExcluded).toBe(1);
  expect(
    findTradeMatches(m, {
      ...q,
      upgrade: { ...q.upgrade!, requiredStarters: 1 },
    }).matches.length,
  ).toBeGreaterThan(0);
});

// Retain alternative group assignments so a two-starter preference cannot hide a feasible starter/bench combination.
it("finds requested mixed and bench-only counts before applying starter-priority tie breaks", async () => {
  const m = await assignmentModel();
  Object.assign(m.byId.get("200")!, { pos: "WR", expected: 8, slot: 23 });
  m.dataset.tables.ModelRosters.find(
    (row) => row.PlayerID === 200,
  )!.LineupSlotID = 23;
  const q: TradeSearchQuery = {
    ...query,
    give: ["1", "101"],
    below: 500,
    above: 500,
    upgrade: {
      mode: "either",
      minimum: 1,
      requiredStarters: 1,
      requiredBench: 1,
    },
  };
  const mixed = findTradeMatches(m, q).matches[0].upgrades!;
  expect(mixed.filter((edge) => edge.group === "starter")).toHaveLength(1);
  expect(mixed.filter((edge) => edge.group === "depth")).toHaveLength(1);
  expect(new Set(mixed.map((edge) => edge.offered)).size).toBe(2);
  expect(new Set(mixed.map((edge) => edge.compared)).size).toBe(2);
  const benchQuery = {
    ...q,
    upgrade: { ...q.upgrade!, requiredStarters: 0, requiredBench: 2 },
  };
  expect(findTradeMatches(m, benchQuery).matches).toEqual([]);
  Object.assign(m.byId.get("104")!, {
    owner: "2",
    pos: "WR",
    expected: 9,
    slot: 20,
  });
  m.dataset.tables.ModelRosters.push({
    PlayerID: 104,
    TeamID: 2,
    LineupSlotID: 20,
  });
  expect(
    findTradeMatches(m, benchQuery).matches[0].upgrades!.filter(
      (edge) => edge.group === "depth",
    ),
  ).toHaveLength(2);
  // A minimum is not an exact count: the existing assignment still finds every eligible offer when feasible.
  expect(
    findTradeMatches(m, {
      ...q,
      upgrade: { ...q.upgrade!, requiredStarters: 1, requiredBench: 0 },
    }).matches[0].upgrades!.filter((edge) => edge.group === "starter"),
  ).toHaveLength(2);
});

// Validate only active group counts, fingerprint count edits, and keep old callers' any-one Either behavior.
it("validates upgrade counts and keeps count changes separate from scoring and inactive filters", async () => {
  const m = await upgradeModel();
  const q: TradeSearchQuery = {
    ...query,
    give: ["1", "101"],
    below: 500,
    above: 500,
    upgrade: {
      mode: "either",
      minimum: 1,
      requiredStarters: 1,
      requiredBench: 0,
    },
  };
  for (const [requiredStarters, requiredBench] of [
    [0, 0],
    [2, 1],
    [-1, 1],
    [1.5, 0],
    [NaN, 1],
    [Infinity, 0],
    [6, 0],
  ])
    expect(
      tradeSearchBounds(m, {
        ...q,
        upgrade: { ...q.upgrade!, requiredStarters, requiredBench },
      }).errors.join(),
    ).toContain("Upgrade minimums");
  for (const [requiredStarters, requiredBench] of [
    [2, 0],
    [1, 1],
    [0, 1],
  ]) {
    const next = {
      ...q,
      upgrade: { ...q.upgrade!, requiredStarters, requiredBench },
    };
    expect(tradeSearchBounds(m, next).errors).toEqual([]);
    expect(tradeSearchContext(m, next)).not.toBe(tradeSearchContext(m, q));
  }
  expect(
    tradeSearchBounds(m, {
      ...q,
      upgrade: { ...q.upgrade!, mode: "starter", requiredBench: NaN },
    }).errors,
  ).toEqual([]);
  const legacy: TradeSearchQuery = {
    ...q,
    give: ["100"],
    upgrade: { mode: "either", minimum: 1 },
  };
  expect(findTradeMatches(m, legacy).matches.length).toBeGreaterThan(0);
  expect(
    findTradeMatches(m, {
      ...legacy,
      upgrade: { ...legacy.upgrade!, requiredStarters: 1, requiredBench: 0 },
    }).matches,
  ).toEqual([]);
  expect(
    findTradeMatches(m, {
      ...legacy,
      upgrade: { ...legacy.upgrade!, requiredStarters: 0, requiredBench: 1 },
    }).matches.length,
  ).toBeGreaterThan(0);
});

// The selected deficit position needs one qualifying edge, while the other required starter can upgrade another position.
it("allows a counted package to meet a deficit with one upgrade and improve a different position too", async () => {
  const m = await upgradeModel();
  Object.assign(m.byId.get("1")!, { pos: "WR", expected: 20 });
  const q: TradeSearchQuery = {
    ...query,
    give: ["1", "101"],
    below: 500,
    above: 500,
    upgrade: {
      mode: "starter",
      minimum: 1,
      requiredStarters: 2,
      requiredBench: 0,
    },
    deficit: { position: "QB", ceiling: "A+" },
  };
  const matches = findTradeMatches(m, q).matches;
  expect(matches.length).toBeGreaterThan(0);
  expect(matches[0].upgrades).toMatchObject([
    { offered: "1", compared: "2" },
    { offered: "101", compared: "200" },
  ]);
});

// Exhaustive small assignments independently check feasibility for every valid starter/bench quota combination.
it("matches exhaustive assignment feasibility for every requested starter and bench count", async () => {
  const m = await assignmentModel();
  const offers = ["1", "101", "106"],
    opponents = ["2", "200", "102"];
  offers.forEach((id, i) =>
    Object.assign(m.byId.get(id)!, {
      owner: "1",
      pos: "WR",
      expected: 20 - i * 2,
    }),
  );
  Object.assign(m.byId.get("200")!, { pos: "WR", expected: 15, slot: 23 });
  m.dataset.tables.ModelRosters.find(
    (row) => row.PlayerID === 200,
  )!.LineupSlotID = 23;
  m.byId.get("2")!.expected = 17;
  m.byId.get("102")!.expected = 14;
  const possibilities: { starter: number; bench: number }[] = [];
  function enumerate(
    i: number,
    used: Set<string>,
    starter: number,
    bench: number,
  ) {
    if (i === offers.length) {
      possibilities.push({ starter, bench });
      return;
    }
    enumerate(i + 1, used, starter, bench);
    for (const id of opponents) {
      if (
        used.has(id) ||
        m.byId.get(offers[i])!.expected! - m.byId.get(id)!.expected! < 1
      )
        continue;
      enumerate(
        i + 1,
        new Set([...used, id]),
        starter + Number(id !== "102"),
        bench + Number(id === "102"),
      );
    }
  }
  enumerate(0, new Set(), 0, 0);
  for (let starter = 0; starter <= 3; starter++)
    for (let bench = 0; bench <= 3 - starter; bench++) {
      if (!starter && !bench) continue;
      const q: TradeSearchQuery = {
        ...query,
        give: offers,
        below: 500,
        above: 500,
        upgrade: {
          mode: "either",
          minimum: 1,
          requiredStarters: starter,
          requiredBench: bench,
        },
      };
      const feasible = possibilities.some(
        (value) => value.starter >= starter && value.bench >= bench,
      );
      expect(findTradeMatches(m, q).matches.length > 0).toBe(feasible);
    }
});
