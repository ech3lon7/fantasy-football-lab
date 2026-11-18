import { describe, expect, it } from "vitest";
import {
  clearTradeFilters,
  defaultTradeFilters,
  showAllTradeFilters,
  filterTradeRows,
  sortTradeRows,
  clampTheirGain,
  type TradeFilters,
  type FilterableTrade,
} from "../src/domain/trade-filters";
import { bigLeagueFixture } from "./big-league-fixture";
import { evaluate } from "../src/domain/valuation";
import { forHypotheticalScoring } from "../src/domain/lineups";
import { runCompleteTradeSearch } from "../src/domain/complete-trade-search";

// A compact, precomputed result makes every filter and its hidden count independently observable.
const row = (overrides: Partial<FilterableTrade> = {}): FilterableTrade => ({
  key: "one",
  team: "2",
  give: ["a"],
  get: ["b"],
  ownGain: 2,
  otherGain: 2,
  ownWeekGain: 1,
  otherWeekGain: 1,
  ownStarters: ["b"],
  otherStarters: ["a"],
  givePositions: ["QB"],
  incomingPlayers: [{ pos: "WR", gem: "Gem" }],
  opponentGrades: { QB: "C" },
  positionImpact: {
    own: [{ position: "QB", before: "C", after: "B", drop: 0, stepDelta: 3 }],
    other: [],
  },
  surfaceAverage: 1.5,
  surfaceProjection: 2.0,
  ...overrides,
});

describe("instant trade filters", () => {
  // Show all includes both inclusive loss-floor boundaries without activating other filters.
  it("shows all trades retained by the approved floor", () => {
    const filters = showAllTradeFilters();
    const trades = [
      row({ ownGain: -3, otherGain: 1 }),
      row({ key: "two", ownGain: 5, otherGain: -2 }),
    ];
    expect(filterTradeRows(trades, filters).visible).toHaveLength(2);
    expect(filters.yourGain).toEqual({ minimum: null, maximum: null });
    expect(filters.theirGain).toBe(-2);
  });

  it("restores both approved defaults and counts hidden rows for each active filter", () => {
    const filters = defaultTradeFilters();
    const result = filterTradeRows(
      [row(), row({ key: "two", ownGain: -1, otherGain: -2.5 })],
      filters,
    );
    expect(result.visible.map((r) => r.key)).toEqual(["one"]);
    expect(result.hidden[0].reasons).toEqual(["yourGain", "theirGain"]);
    expect(result.counts.yourGain).toBe(1);
    expect(result.counts.theirGain).toBe(1);
    expect(clearTradeFilters()).toEqual(filters);
  });

  it("clamps the recipient minimum to the approved range and half-point steps", () => {
    expect(clampTheirGain(-3)).toBe(-2);
    expect(clampTheirGain(2)).toBe(1);
    expect(clampTheirGain(-0.6)).toBe(-0.5);
    expect(clampTheirGain(Number.NaN)).toBe(1);
  });

  it("requires the same incoming player to match selected position and label", () => {
    const filters = {
      ...defaultTradeFilters(),
      getPositions: ["WR" as const],
      labels: ["Gem" as const],
    };
    const trade = row({
      incomingPlayers: [
        { pos: "WR", gem: "Watch" },
        { pos: "RB", gem: "Gem" },
      ],
    });
    expect(filterTradeRows([trade], filters).hidden[0].reasons).toContain("labels");
  });

  it("sorts without changing membership and places unknown acceptance last", () => {
    const rows = [
      row({ key: "unknown", acceptance: null }),
      row({ key: "good", acceptance: 0.7 }),
      row({ key: "fair", acceptance: 0.4 }),
    ];
    const sorted = sortTradeRows(rows, "acceptance");
    expect(sorted.map((item) => item.key)).toEqual(["good", "fair", "unknown"]);
    expect(rows.map((item) => item.key)).toEqual(["unknown", "good", "fair"]);
  });

  it("applies every optional category and preserves unavailable numbers as unavailable", () => {
    const filters = {
      ...defaultTradeFilters(),
      ownWeek: { minimum: 0, maximum: 2 },
      otherWeek: { minimum: 0, maximum: 2 },
      receiveStarts: true,
      giveStarts: true,
      gradeGoals: [{ id: "g", side: "own" as const, position: "QB", steps: 1 }],
      mustGet: ["b"],
      mustGive: ["a"],
      exclude: ["z"],
      getPositions: ["WR" as const],
      givePositions: ["QB"],
      labels: ["Gem" as const],
      teams: ["2"],
      teamGrade: { position: "QB", ceiling: "C+" },
      giveSize: { minimum: 1, maximum: 1 },
      getSize: { minimum: 1, maximum: 1 },
    };
    expect(filterTradeRows([row()], filters).visible).toHaveLength(1);
    const failed = row({
      ownWeekGain: null,
      otherWeekGain: 3,
      ownStarters: [],
      otherStarters: [],
      positionImpact: { own: [], other: [] },
      give: ["x", "z"],
      get: ["y", "z"],
      givePositions: ["RB"],
      incomingPlayers: [{ pos: "TE", gem: "Watch" }],
      team: "3",
      opponentGrades: { QB: "A" },
    });
    expect(filterTradeRows([failed], filters).hidden[0].reasons).toEqual([
      "ownWeek",
      "otherWeek",
      "receiveStarts",
      "giveStarts",
      "gradeGoals",
      "getPositions",
      "givePositions",
      "labels",
      "teamGrade",
      "giveSize",
      "getSize",
      "mustGive",
      "mustGet",
      "exclude",
      "teams",
    ]);
  });

  it("Show all and Reset keep the six search-input fields", () => {
    const custom: TradeFilters = {
      ...defaultTradeFilters(),
      yourGain: { minimum: 3, maximum: null },
      theirGain: 0.5,
      mustGive: ["p1"],
      mustGiveRequired: ["p1"],
      mustGet: ["p2"],
      mustGetRequired: ["p2"],
      exclude: ["p3"],
      teams: ["team2"],
      giveOnly: true,
      getOnly: true,
    };
    const reset = defaultTradeFilters(custom);
    expect(reset.yourGain).toEqual({ minimum: 0, maximum: null });
    expect(reset.theirGain).toBe(-2);
    expect(reset.mustGive).toEqual(["p1"]);
    expect(reset.mustGiveRequired).toEqual(["p1"]);
    expect(reset.mustGet).toEqual(["p2"]);
    expect(reset.mustGetRequired).toEqual(["p2"]);
    expect(reset.exclude).toEqual(["p3"]);
    expect(reset.teams).toEqual(["team2"]);
    expect(reset.giveOnly).toBe(true);
    expect(reset.getOnly).toBe(true);

    const showAll = showAllTradeFilters(custom);
    expect(showAll.yourGain).toEqual({ minimum: null, maximum: null });
    expect(showAll.theirGain).toBe(-2);
    expect(showAll.mustGive).toEqual(["p1"]);
    expect(showAll.mustGiveRequired).toEqual(["p1"]);
    expect(showAll.mustGet).toEqual(["p2"]);
    expect(showAll.mustGetRequired).toEqual(["p2"]);
    expect(showAll.exclude).toEqual(["p3"]);
    expect(showAll.teams).toEqual(["team2"]);
    expect(showAll.giveOnly).toBe(true);
    expect(showAll.getOnly).toBe(true);
  });

  it("hides N is what one filter alone hides: relaxing it raises the count by exactly N (R6)", () => {
    const rows = [
      row({ key: "ok" }),
      row({ key: "theirOnly", otherGain: -2.2 }),
      row({ key: "theirOnly2", otherGain: -2.5 }),
      row({ key: "both", ownGain: -1, otherGain: -2.5 }),
    ];
    const before = filterTradeRows(rows, defaultTradeFilters());
    expect(before.visible.map((r) => r.key)).toEqual(["ok"]);
    // "both" fails two filters, so neither filter alone brings it back.
    expect(before.only.theirGain).toBe(2);
    expect(before.only.yourGain ?? 0).toBe(0);
    expect(before.counts.theirGain).toBe(3);
    const relaxed = filterTradeRows(rows, {
      ...defaultTradeFilters(),
      theirGain: -3,
    });
    expect(relaxed.visible.length - before.visible.length).toBe(
      before.only.theirGain,
    );
  });

  describe("T4 filter checks", () => {
    it("giveOnly and mustGive", () => {
      const f1: TradeFilters = {
        ...defaultTradeFilters(),
        mustGive: ["p1", "p2"],
        mustGiveRequired: ["p1"],
        giveOnly: false,
      };
      // Matches: includes p1 (required) and another player
      expect(filterTradeRows([row({ give: ["p1", "p3"] })], f1).visible).toHaveLength(1);
      // Fails: missing required p1
      expect(filterTradeRows([row({ give: ["p2", "p3"] })], f1).hidden[0].reasons).toContain("mustGive");

      const f2: TradeFilters = { ...f1, giveOnly: true };
      // Fails giveOnly: p3 is not in mustGive
      expect(filterTradeRows([row({ give: ["p1", "p3"] })], f2).hidden[0].reasons).toContain("mustGive");
      // Passes giveOnly: all in mustGive
      expect(filterTradeRows([row({ give: ["p1", "p2"] })], f2).visible).toHaveLength(1);
      expect(filterTradeRows([row({ give: ["p1"] })], f2).visible).toHaveLength(1);
    });

    it("getOnly and mustGet", () => {
      const f1: TradeFilters = {
        ...defaultTradeFilters(),
        mustGet: ["p1", "p2"],
        mustGetRequired: ["p1"],
        getOnly: false,
      };
      expect(filterTradeRows([row({ get: ["p1", "p3"] })], f1).visible).toHaveLength(1);
      expect(filterTradeRows([row({ get: ["p2", "p3"] })], f1).hidden[0].reasons).toContain("mustGet");

      const f2: TradeFilters = { ...f1, getOnly: true };
      expect(filterTradeRows([row({ get: ["p1", "p3"] })], f2).hidden[0].reasons).toContain("mustGet");
      expect(filterTradeRows([row({ get: ["p1", "p2"] })], f2).visible).toHaveLength(1);
      expect(filterTradeRows([row({ get: ["p1"] })], f2).visible).toHaveLength(1);
    });

    it("exclude", () => {
      const f: TradeFilters = { ...defaultTradeFilters(), exclude: ["x", "y"] };
      expect(filterTradeRows([row({ give: ["a"], get: ["b"] })], f).visible).toHaveLength(1);
      expect(filterTradeRows([row({ give: ["x"], get: ["b"] })], f).hidden[0].reasons).toContain("exclude");
      expect(filterTradeRows([row({ give: ["a"], get: ["y"] })], f).hidden[0].reasons).toContain("exclude");
    });

    it("teams", () => {
      const f1: TradeFilters = { ...defaultTradeFilters(), teams: ["3", "4"] };
      expect(filterTradeRows([row({ team: "3" })], f1).visible).toHaveLength(1);
      expect(filterTradeRows([row({ team: "2" })], f1).hidden[0].reasons).toContain("teams");

      const f2: TradeFilters = { ...defaultTradeFilters(), teams: null };
      expect(filterTradeRows([row({ team: "2" })], f2).visible).toHaveLength(1);
    });

    it("never trade (protectedIds)", () => {
      const f = defaultTradeFilters();
      const r = row({ give: ["p1", "p2"] });
      expect(filterTradeRows([r], f, ["p3"]).visible).toHaveLength(1);
      const hidden = filterTradeRows([r], f, ["p2"]);
      expect(hidden.visible).toHaveLength(0);
      expect(hidden.hidden[0].reasons).toContain("never");
      expect(hidden.counts.never).toBe(1);
    });

    it("mustGiveStarts", () => {
      const f: TradeFilters = {
        ...defaultTradeFilters(),
        mustGive: ["p1", "p2"],
        mustGiveRequired: ["p1"],
        mustGiveStarts: true,
      };
      // p1 is in otherStarters
      expect(filterTradeRows([row({ give: ["p1"], otherStarters: ["p1"] })], f).visible).toHaveLength(1);
      // p1 is NOT in otherStarters
      const hidden = filterTradeRows([row({ give: ["p1"], otherStarters: ["p2"] })], f);
      expect(hidden.visible).toHaveLength(0);
      expect(hidden.hidden[0].reasons).toContain("mustGiveStarts");
      expect(hidden.counts.mustGiveStarts).toBe(1);

      // If mustGiveRequired is empty, mustGiveStarts is a no-op
      const fEmpty: TradeFilters = { ...f, mustGiveRequired: [] };
      expect(filterTradeRows([row({ give: ["p1"], otherStarters: [] })], fEmpty).visible).toHaveLength(1);
    });

    it("mustGetStarts", () => {
      const f: TradeFilters = {
        ...defaultTradeFilters(),
        mustGet: ["p1", "p2"],
        mustGetRequired: ["p1"],
        mustGetStarts: true,
      };
      expect(filterTradeRows([row({ get: ["p1"], ownStarters: ["p1"] })], f).visible).toHaveLength(1);
      const hidden = filterTradeRows([row({ get: ["p1"], ownStarters: ["p2"] })], f);
      expect(hidden.visible).toHaveLength(0);
      expect(hidden.hidden[0].reasons).toContain("mustGetStarts");
      expect(hidden.counts.mustGetStarts).toBe(1);

      const fEmpty: TradeFilters = { ...f, mustGetRequired: [] };
      expect(filterTradeRows([row({ get: ["p1"], ownStarters: [] })], fEmpty).visible).toHaveLength(1);
    });

    it("looksBetter", () => {
      const f: TradeFilters = { ...defaultTradeFilters(), looksBetter: true };
      expect(filterTradeRows([row({ surfaceAverage: 0.1 })], f).visible).toHaveLength(1);
      expect(filterTradeRows([row({ surfaceAverage: 0.0 })], f).hidden[0].reasons).toContain("looksBetter");
      expect(filterTradeRows([row({ surfaceAverage: -0.5 })], f).hidden[0].reasons).toContain("looksBetter");
      expect(filterTradeRows([row({ surfaceAverage: null })], f).hidden[0].reasons).toContain("looksBetter");
    });

    it("surface sort", () => {
      const rows = [
        row({ key: "nullAvg", surfaceAverage: null, surfaceProjection: 3 }),
        row({ key: "lowAvg", surfaceAverage: 1.0, surfaceProjection: 2.0 }),
        row({ key: "highAvg1", surfaceAverage: 2.0, surfaceProjection: 1.0 }),
        row({ key: "highAvg2", surfaceAverage: 2.0, surfaceProjection: 3.0 }),
        row({ key: "highAvg3", surfaceAverage: 2.0, surfaceProjection: null }),
      ];
      const sorted = sortTradeRows(rows, "surface");
      expect(sorted.map((r) => r.key)).toEqual([
        "highAvg2", // avg 2.0, proj 3.0
        "highAvg1", // avg 2.0, proj 1.0
        "highAvg3", // avg 2.0, proj null
        "lowAvg",   // avg 1.0, proj 2.0
        "nullAvg",  // avg null
      ]);
    });
  });

  describe("T4 brute-force equality on bigLeagueFixture(4)", () => {
    it(
      "each filter visible set matches direct Array.filter",
      async () => {
        const rawFixture = await bigLeagueFixture(4);
        const m = forHypotheticalScoring(
          evaluate(rawFixture, rawFixture.settings),
        );
        const ownTeam = "1";
        const teams = [...new Set(m.players.map((p) => p.owner))].filter(
          (t) => t !== "0" && t !== ownTeam,
        );
        const manager = { version: 1 as const, profiles: {} };
        const collected: FilterableTrade[] = [];

        await runCompleteTradeSearch(
          m,
          ownTeam,
          undefined,
          manager,
          teams,
          (event) => {
            if (event.done) {
              collected.push(...event.rows.map((r) => r.filterEvidence));
            }
          },
        );

        expect(collected.length).toBeGreaterThan(0);

        // Pick sample players and teams from the real trades
        const allGive = [...new Set(collected.flatMap((r) => r.give))];
        const allGet = [...new Set(collected.flatMap((r) => r.get))];
        const pGive1 = allGive[0];
        const pGive2 = allGive[1] ?? allGive[0];
        const pGet1 = allGet[0];
        const pGet2 = allGet[1] ?? allGet[0];
        const targetTeam = teams[0];

        // 1. mustGive + giveOnly
        const fGiveOnly: TradeFilters = {
          ...showAllTradeFilters(),
          mustGive: [pGive1, pGive2],
          mustGiveRequired: [pGive1],
          giveOnly: true,
        };
        const resGiveOnly = filterTradeRows(collected, fGiveOnly).visible;
        const directGiveOnly = collected.filter(
          (r) =>
            r.give.includes(pGive1) &&
            r.give.every((id) => [pGive1, pGive2].includes(id)),
        );
        expect(resGiveOnly.map((r) => r.key)).toEqual(
          directGiveOnly.map((r) => r.key),
        );

        // 2. mustGet + getOnly
        const fGetOnly: TradeFilters = {
          ...showAllTradeFilters(),
          mustGet: [pGet1, pGet2],
          mustGetRequired: [pGet1],
          getOnly: true,
        };
        const resGetOnly = filterTradeRows(collected, fGetOnly).visible;
        const directGetOnly = collected.filter(
          (r) =>
            r.get.includes(pGet1) &&
            r.get.every((id) => [pGet1, pGet2].includes(id)),
        );
        expect(resGetOnly.map((r) => r.key)).toEqual(
          directGetOnly.map((r) => r.key),
        );

        // 3. exclude
        const fExclude: TradeFilters = {
          ...showAllTradeFilters(),
          exclude: [pGive1, pGet1],
        };
        const resExclude = filterTradeRows(collected, fExclude).visible;
        const directExclude = collected.filter(
          (r) => !r.give.includes(pGive1) && !r.get.includes(pGet1),
        );
        expect(resExclude.map((r) => r.key)).toEqual(
          directExclude.map((r) => r.key),
        );

        // 4. teams
        const fTeams: TradeFilters = {
          ...showAllTradeFilters(),
          teams: [targetTeam],
        };
        const resTeams = filterTradeRows(collected, fTeams).visible;
        const directTeams = collected.filter((r) => r.team === targetTeam);
        expect(resTeams.map((r) => r.key)).toEqual(
          directTeams.map((r) => r.key),
        );

        // 5. never trade (protectedIds)
        const resNever = filterTradeRows(collected, showAllTradeFilters(), [
          pGive1,
        ]).visible;
        const directNever = collected.filter((r) => !r.give.includes(pGive1));
        expect(resNever.map((r) => r.key)).toEqual(
          directNever.map((r) => r.key),
        );

        // 6. mustGiveStarts
        const fGiveStarts: TradeFilters = {
          ...showAllTradeFilters(),
          mustGive: [pGive1],
          mustGiveRequired: [pGive1],
          mustGiveStarts: true,
        };
        const resGiveStarts = filterTradeRows(collected, fGiveStarts).visible;
        const directGiveStarts = collected.filter(
          (r) => r.give.includes(pGive1) && r.otherStarters.includes(pGive1),
        );
        expect(resGiveStarts.map((r) => r.key)).toEqual(
          directGiveStarts.map((r) => r.key),
        );

        // 7. mustGetStarts
        const fGetStarts: TradeFilters = {
          ...showAllTradeFilters(),
          mustGet: [pGet1],
          mustGetRequired: [pGet1],
          mustGetStarts: true,
        };
        const resGetStarts = filterTradeRows(collected, fGetStarts).visible;
        const directGetStarts = collected.filter(
          (r) => r.get.includes(pGet1) && r.ownStarters.includes(pGet1),
        );
        expect(resGetStarts.map((r) => r.key)).toEqual(
          directGetStarts.map((r) => r.key),
        );

        // 8. looksBetter
        const fLooksBetter: TradeFilters = {
          ...showAllTradeFilters(),
          looksBetter: true,
        };
        const resLooksBetter = filterTradeRows(collected, fLooksBetter).visible;
        const directLooksBetter = collected.filter(
          (r) => r.surfaceAverage !== null && r.surfaceAverage > 0,
        );
        expect(resLooksBetter.map((r) => r.key)).toEqual(
          directLooksBetter.map((r) => r.key),
        );
      },
      60_000,
    );
  });
});
