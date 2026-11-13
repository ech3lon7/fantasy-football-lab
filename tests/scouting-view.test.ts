import { describe, expect, it } from "vitest";
import { fixture } from "./fixtures";
import { evaluate, type Player } from "../src/domain/valuation";
import {
  decodeGemFilters,
  screenGems,
  validateGemDraft,
} from "../src/domain/gem-screening";
import {
  activePresetId,
  addSavedSearch,
  facetCounts,
  filtersPatch,
  readSavedSearches,
  removeSavedSearch,
  scoutingPresets,
  sortScouting,
} from "../src/domain/view/scouting";

// Top-level await builds the base player before the describe blocks create their rows.
const d = await fixture();
const base: Player = {
  ...evaluate(d, d.settings).players[0],
  gem: "Gem",
  owner: "0",
  pos: "WR",
  regression: "NEUTRAL",
  uncertain: false,
  trend: undefined,
};
const player = (id: string, patch: Partial<Player> = {}): Player => ({
  ...base,
  id,
  ...patch,
});
const teams = ["1", "2"];
const query = (id: string, patch = {}) =>
  validateGemDraft(
    { ...scoutingPresets.find((p) => p.id === id)!.draft("1"), ...patch },
    teams,
  ).query!;

describe("optional engine criteria", () => {
  const rows = [
    player("1", { gem: "Gem" }),
    player("2", {
      gem: "Watch",
      opportunity: { ...base.opportunity, signals: ["Role-growth watch"] },
    }),
    player("3", { gem: "No breakout signal", regression: "BUY LOW" }),
    player("4", { gem: "No breakout signal", regression: "SELL HIGH" }),
    player("5", { pos: "K", gem: "No breakout signal" }),
  ];
  const ids = (q: ReturnType<typeof query>) =>
    screenGems(rows, q).matches.map((r) => r.player.id);
  it("treats signals as all-required by default and any-of when asked", () => {
    const all = query("all", { signals: ["Gem", "Watch"] });
    const any = query("all", { signals: ["Gem", "Watch"], signalMode: "any" });
    expect(ids(all)).toEqual([]);
    expect(ids(any)).toEqual(["1", "2"]);
  });
  it("filters by regression label and the combined K and D/ST position", () => {
    expect(ids(query("buysell"))).toEqual(["3", "4"]);
    expect(ids(query("buysell", { regression: "BUY LOW" }))).toEqual(["3"]);
    expect(ids(query("streamers", { pool: "All" }))).toEqual(["5"]);
  });
  it("filters by mppgMin: players below or with null MPPG fail the filter", () => {
    const list = [
      player("1", { mppg: 15.0 }),
      player("2", { mppg: 9.5 }),
      player("3", { mppg: null }),
    ];
    const q = query("all", { mppgMin: "10" });
    const matches = screenGems(list, q).matches.map((r) => r.player.id);
    expect(matches).toEqual(["1"]);
  });
  it("round-trips the optional criteria and clears them with filtersPatch", () => {
    const q = query("buysell", { signals: ["Gem"], signalMode: "any" });
    const saved = filtersPatch(q);
    const back = validateGemDraft(
      decodeGemFilters(saved, "1").draft,
      teams,
    ).query!;
    expect(back.signalMode).toBe("any");
    expect(back.regression).toBe("either");
    const cleared = { ...saved, ...filtersPatch(query("gem")) };
    const plain = validateGemDraft(
      decodeGemFilters(cleared, "1").draft,
      teams,
    ).query!;
    expect(plain.signalMode).toBeUndefined();
    expect(plain.regression).toBeUndefined();
  });
});

describe("facet counts", () => {
  const rows = [
    player("1", { gem: "Gem", owner: "0" }),
    player("2", { gem: "Watch", owner: "0" }),
    player("3", { gem: "Watch", owner: "2" }),
    player("4", { gem: "No breakout signal", owner: "0", pos: "QB" }),
  ];
  it("reports the matches if each option were toggled", () => {
    const q = query("gem");
    const f = facetCounts(rows, q);
    expect(f.total).toBe(2);
    expect(f.pool.Available).toBe(2);
    expect(f.pool.All).toBe(3);
    expect(f.position.QB).toBe(1);
    // Adding a required signal narrows; the counts are what the list would show, not a static total.
    expect(f.signals.Gem).toBe(1);
    expect(f.signals.Watch).toBe(1);
  });
  it("counts the removal when a signal is already selected", () => {
    const q = query("gem", { signals: ["Gem"] });
    const f = facetCounts(rows, q);
    expect(f.total).toBe(1);
    expect(f.signals.Gem).toBe(2);
  });
  it("counts players hidden by pool, signals or classification", () => {
    const q = query("gem", { signals: ["Gem"] });
    expect(facetCounts(rows, q).hidden).toBe(2);
  });
  it("does not change the players or the query", () => {
    const q = query("gem");
    const before = JSON.stringify([rows, q]);
    facetCounts(rows, q);
    expect(JSON.stringify([rows, q])).toBe(before);
  });
});

describe("built-in and saved searches", () => {
  it("recognizes each built-in search and none once it is edited", () => {
    for (const p of scoutingPresets)
      expect(activePresetId(query(p.id), "1", teams)).toBe(p.id);
    expect(
      activePresetId(query("gem", { injured: true }), "1", teams),
    ).toBeNull();
  });
  it("saves, replaces by name, removes and ignores malformed entries", () => {
    const patch = filtersPatch(query("rising"));
    let raw = addSavedSearch(undefined, " My search ", patch);
    raw = addSavedSearch(raw, "my search", patch);
    const list = readSavedSearches(raw);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("my search");
    expect(readSavedSearches(removeSavedSearch(raw, list[0].id))).toEqual([]);
    expect(addSavedSearch("kept", "   ", patch)).toBe("kept");
    for (const bad of [undefined, "", "{", "{}", '[{"id":1}]'])
      expect(readSavedSearches(bad)).toEqual([]);
  });
});

describe("sorting", () => {
  it("defaults to Expected PPG, keeps unavailable values last and breaks ties by id", () => {
    const results = [
      player("3", { blendedExpected: null }),
      player("2", { blendedExpected: 10 }),
      player("1", { blendedExpected: 10 }),
      player("4", { blendedExpected: 12 }),
    ].map((p) => ({ player: p, evidence: [], missing: [] }));
    expect(
      sortScouting(results, "expected", true).map((r) => r.player.id),
    ).toEqual(["4", "1", "2", "3"]);
    expect(
      sortScouting(results, "expected", false).map((r) => r.player.id),
    ).toEqual(["1", "2", "4", "3"]);
  });

  it("sorts by MPPG descending with nulls (bye/out/missing) ranked last, never 0", () => {
    const results = [
      player("1", { mppg: 14.5 }),
      player("2", { mppg: null }), // bye or out
      player("3", { mppg: 18.2 }),
      player("4", { mppg: 8.0 }),
    ].map((p) => ({ player: p, evidence: [], missing: [] }));
    const sorted = sortScouting(results, "mppg", true);
    expect(sorted.map((r) => r.player.id)).toEqual(["3", "1", "4", "2"]);
    expect(sorted[0].player.mppg).toBe(18.2);
    expect(sorted[3].player.mppg).toBeNull();
  });
});
