import { describe, expect, it } from "vitest";
import {
  defaultTradeFilters,
  type TradeFilters,
} from "../src/domain/trade-filters";
import { findWheelData } from "../src/features/next/trade/wheel/wheel-data";
import { evaluate } from "../src/domain/valuation";
import { tradeSearchFixture } from "./fixtures";

// Drive the adapter the way the wheel does and keep the filter state it writes.
async function setup() {
  const raw = await tradeSearchFixture();
  const m = evaluate(raw, raw.settings);
  let filters: TradeFilters = defaultTradeFilters();
  const data = () =>
    findWheelData({
      m,
      teamA: "1",
      filters,
      update: (patch) => (filters = { ...filters, ...patch }),
      clear: () => (filters = defaultTradeFilters()),
      counts: { total: 100, visible: 60, hides: { theirGain: 7 } },
    });
  return { m, data, state: () => filters };
}

describe("the wheel sets the same filter state as the list", () => {
  it("writes Their EPPG as one minimum, clamped to -2..+1 in half steps", async () => {
    const { data, state } = await setup();
    data().setNumber("theirGain", 0.5, null);
    expect(state().theirGain).toBe(0.5);
    data().setNumber("theirGain", 9, null);
    expect(state().theirGain).toBe(1);
    data().setNumber("theirGain", -9, null);
    expect(state().theirGain).toBe(-2);
    expect(data().getNumber("theirGain")).toEqual({ lo: -2, hi: null });
  });

  it("writes your gain as a range, with an open end at the end of its track", async () => {
    const { data, state } = await setup();
    data().setNumber("yourGain", 1, null);
    expect(state().yourGain).toEqual({ minimum: 1, maximum: null });
    data().setNumber("yourGain", 0, 4);
    expect(state().yourGain).toEqual({ minimum: null, maximum: 4 });
    expect(data().getNumber("yourGain")).toEqual({ lo: 0, hi: 4 });
  });

  it("toggles positions to get and to give, and incoming labels", async () => {
    const { data, state } = await setup();
    data().setToggle("getPositions", "WR", true);
    data().setToggle("givePositions", "QB", true);
    data().setToggle("labels", "Gem", true);
    expect(state().getPositions).toEqual(["WR"]);
    expect(state().givePositions).toEqual(["QB"]);
    expect(state().labels).toEqual(["Gem"]);
    data().setToggle("getPositions", "WR", false);
    expect(state().getPositions).toEqual([]);
    expect(
      data()
        .getToggles("getPositions")
        .find((t) => t.key === "WR")?.on,
    ).toBe(false);
  });

  it("lists the opponents, and writing all of them back means every team", async () => {
    const { data, state } = await setup();
    const teams = data().getToggles("teams");
    expect(teams.every((t) => t.on)).toBe(true);
    expect(teams.some((t) => t.key === "1")).toBe(false);
    data().setToggle("teams", teams[0].key, false);
    expect(state().teams).not.toBeNull();
    data().setToggle("teams", teams[0].key, true);
    expect(state().teams).toBeNull();
  });

  it("includes and excludes players", async () => {
    const { data, state } = await setup();
    data().togglePlayer("mustGet", "101");
    data().togglePlayer("exclude", "101");
    expect(state().mustGet).toEqual(["101"]);
    expect(state().exclude).toEqual(["101"]);
    data().togglePlayer("mustGet", "101");
    expect(state().mustGet).toEqual([]);
  });

  it("reports the counts the worker gave it and counts what is set", async () => {
    const { data } = await setup();
    expect(data().hides.theirGain).toBe(7);
    expect(data().total).toBe(100);
    expect(data().visible).toBe(60);
    expect(data().activeCount).toBe(0);
  });

  it("clear restores the defaults, not blanks", async () => {
    const { data, state } = await setup();
    data().setNumber("theirGain", -1, null);
    data().setNumber("yourGain", 5, null);
    data().clear();
    expect(state()).toEqual(defaultTradeFilters());
    expect(state().theirGain).toBe(-2);
    expect(state().yourGain.minimum).toBe(0);
  });
});
