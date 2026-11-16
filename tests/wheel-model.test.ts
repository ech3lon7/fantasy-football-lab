import { describe, expect, it } from "vitest";
import { defaultTradeFilters } from "../src/domain/trade-filters";
import {
  activeFilterCount,
  categoriesFor,
  categoryActive,
  formatGain,
  hubSummary,
  rangeValue,
  rangeToFilter,
} from "../src/features/next/trade/wheel/wheel-model";

describe("wheel categories", () => {
  it("has the six categories of Find trades, clockwise from the top as on the Playbook board", () => {
    expect(categoriesFor("find").map((c) => c.id)).toEqual([
      "gains",
      "players",
      "positions",
      "teams",
      "size",
      "grades",
    ]);
  });

  it("adds Chains on the Chain planner", () => {
    const ids = categoriesFor("chain").map((c) => c.id);
    expect(ids).toHaveLength(7);
    expect(ids[6]).toBe("chains");
  });

  it("lists the Gains sub-options in the board's order", () => {
    expect(categoriesFor("find")[0].options.map((o) => o.label)).toEqual([
      "Your EPPG",
      "Their EPPG",
      "Your MPPG",
      "Their MPPG",
    ]);
  });

  it("gives Their EPPG one handle from -2 to +1 in half steps", () => {
    const their = categoriesFor("find")[0].options[1];
    expect(their).toMatchObject({ kind: "slider", min: -2, max: 1, step: 0.5 });
  });
});

describe("what counts as set", () => {
  it("counts nothing at the defaults, which are your gain at least 0 and their gain at least +1", () => {
    const f = defaultTradeFilters();
    expect(activeFilterCount(f)).toBe(0);
    for (const c of categoriesFor("find"))
      expect(categoryActive(f, c.id)).toBe(0);
  });

  it("counts a changed default and each other active filter once, under its category", () => {
    const f = {
      ...defaultTradeFilters(),
      theirGain: 0.5,
      yourGain: { minimum: 1, maximum: null },
      mustGet: ["a"],
      getPositions: ["WR" as const],
      teams: ["2"],
    };
    expect(categoryActive(f, "gains")).toBe(2);
    expect(categoryActive(f, "players")).toBe(1);
    expect(categoryActive(f, "positions")).toBe(1);
    expect(categoryActive(f, "teams")).toBe(1);
    expect(activeFilterCount(f)).toBe(5);
  });

  it("counts a size other than 1 to 3 on either side", () => {
    const f = {
      ...defaultTradeFilters(),
      giveSize: { minimum: 1, maximum: 2 },
    };
    expect(categoryActive(f, "size")).toBe(1);
  });
});

describe("hub wording", () => {
  it("writes gains with a sign", () => {
    expect(formatGain(1)).toBe("+1");
    expect(formatGain(0.5)).toBe("+0.5");
    expect(formatGain(0)).toBe("0");
    expect(formatGain(-1.5)).toBe("-1.5");
  });

  it("summarises the category setting", () => {
    expect(hubSummary(defaultTradeFilters(), "gains")).toBe(
      "Their EPPG at least +1",
    );
    expect(
      hubSummary({ ...defaultTradeFilters(), mustGet: ["a", "b"] }, "players"),
    ).toBe("2 wanted");
    expect(
      hubSummary({ ...defaultTradeFilters(), mustGet: ["a", "b"], mustGetRequired: ["a"] }, "players"),
    ).toBe("2 wanted · 1 required");
    expect(
      hubSummary({ ...defaultTradeFilters(), mustGive: ["x"], mustGiveRequired: ["x"] }, "players"),
    ).toBe("1 offered · 1 required");
    expect(hubSummary(defaultTradeFilters(), "positions")).toBe("Any position");
  });
});

describe("two-handle ranges", () => {
  it("shows an open end as the end of the track and writes it back as no limit", () => {
    expect(rangeValue(null, -3, 10, "min")).toBe(-3);
    expect(rangeValue(null, -3, 10, "max")).toBe(10);
    expect(rangeValue(2, -3, 10, "min")).toBe(2);
    expect(rangeToFilter(-3, -3, 10, "min")).toBeNull();
    expect(rangeToFilter(10, -3, 10, "max")).toBeNull();
    expect(rangeToFilter(4, -3, 10, "min")).toBe(4);
  });
});
