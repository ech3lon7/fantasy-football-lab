import React from "react";
import { describe, it, expect } from "vitest";
import {
  playerColumns,
  playerColumnName,
  playerColumnTrend,
  playerColumnExpected,
  playerColumnIndex,
  playerColumnActual,
  playerColumnRecent,
  playerColumnProjected,
  playerColumnValue,
  playerColumnGem,
  playerColumnInjury,
} from "../src/ui/components";
import type { Player } from "../src/domain/valuation";

describe("playerColumns layout and order", () => {
  it("orders shared columns with Trend PPG, EPPG, Surplus index, Actual PPG first", () => {
    const keys = playerColumns.map((col) => col.key);
    expect(keys).toEqual([
      "name",
      "trend",
      "expected",
      "index",
      "actual",
      "recent",
      "projected",
      "value",
      "gem",
      "injury",
    ]);
  });

  it("has correct labels for the first five columns", () => {
    expect(playerColumns[0].label).toBe("Player");
    expect(playerColumns[1].label).toBe("Trend Δ PPG");
    expect(playerColumns[2].label).toBe("Expected PPG");
    expect(playerColumns[3].label).toBe("Surplus index");
    expect(playerColumns[4].label).toBe("Actual PPG");
  });

  it("exports named column constants matching playerColumns indices", () => {
    expect(playerColumnName).toBe(playerColumns[0]);
    expect(playerColumnTrend).toBe(playerColumns[1]);
    expect(playerColumnExpected).toBe(playerColumns[2]);
    expect(playerColumnIndex).toBe(playerColumns[3]);
    expect(playerColumnActual).toBe(playerColumns[4]);
    expect(playerColumnRecent).toBe(playerColumns[5]);
    expect(playerColumnProjected).toBe(playerColumns[6]);
    expect(playerColumnValue).toBe(playerColumns[7]);
    expect(playerColumnGem).toBe(playerColumns[8]);
    expect(playerColumnInjury).toBe(playerColumns[9]);
  });

  it("playerColumnName renders player name, position, nfl, and MA status pill when trend is present", () => {
    const dummyPlayer = {
      id: "100",
      name: "Test Runner",
      pos: "RB" as const,
      nfl: "KC",
      trend: {
        points: [10, 15, 20, 25, 30],
        fastMA: 25,
        slowMA: 20,
        direction: "bullish" as const,
        weeksAvailable: 5,
        latest: {
          tone: "bullish" as const,
          badge: "Bullish (+5.00 MA)",
          label: "Fast 3-week MA (25.00) is above Slow 5-week MA (20.00)",
          delta: 5,
          goldenCross: false,
          deathCross: false,
        },
      },
    } as unknown as Player;

    const vdom = playerColumnName.render!(dummyPlayer);
    expect(vdom).toBeDefined();
    expect(React.isValidElement(vdom)).toBe(true);
    if (React.isValidElement<{ ariaLabel?: string }>(vdom)) {
      expect(vdom.props.ariaLabel).toBe("Test Runner RB · KC");
    }
  });
});
