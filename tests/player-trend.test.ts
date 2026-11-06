import { describe, it, expect } from "vitest";
import { calculatePlayerTrend } from "../src/domain/player-trend";
import type { Row } from "../src/domain/contracts";

describe("calculatePlayerTrend", () => {
  it("returns empty series and null latest for empty history", () => {
    const result = calculatePlayerTrend([], "WR");
    expect(result.series).toEqual([]);
    expect(result.latest).toBeNull();
  });

  it("calculates 2-game fast WMA and 5-game slow WMA correctly for multi-game history", () => {
    // 5 games: 10, 12, 14, 16, 20
    const history: Row[] = [
      { Week: 1, Points: 10, Targets: 8, HistoryStatus: "Valid", Games: 1 },
      { Week: 2, Points: 12, Targets: 7, HistoryStatus: "Valid", Games: 1 },
      { Week: 3, Points: 14, Targets: 9, HistoryStatus: "Valid", Games: 1 },
      { Week: 4, Points: 16, Targets: 10, HistoryStatus: "Valid", Games: 1 },
      { Week: 5, Points: 20, Targets: 12, HistoryStatus: "Valid", Games: 1 },
    ];

    const result = calculatePlayerTrend(history, "WR");
    expect(result.series).toHaveLength(5);

    // Week 1: 10 points
    expect(result.series[0].points).toBe(10);
    expect(result.series[0].fastMA).toBe(10);

    // Week 2: Fast MA = (1*10 + 2*12) / 3 = 34 / 3 = 11.33
    expect(result.series[1].fastMA).toBe(11.33);

    // Week 5:
    // Fast MA = (1*16 + 2*20) / 3 = 56 / 3 = 18.67
    expect(result.series[4].fastMA).toBe(18.67);

    // Slow MA across 5 games (10, 12, 14, 16, 20) with weights [1, 2, 3, 4, 5] (sum=15):
    // (1*10 + 2*12 + 3*14 + 4*16 + 5*20) / 15 = (10 + 24 + 42 + 64 + 100) / 15 = 240 / 15 = 16.00
    expect(result.series[4].slowMA).toBe(16.0);

    // Latest status:
    // Spread = 18.67 - 16.00 = +2.67 (>= +1.5 -> bullish)
    // Volume = 12 targets (>= 5 -> confirmed)
    expect(result.latest?.status).toBe("bullish");
    expect(result.latest?.confirmed).toBe(true);
    expect(result.latest?.tone).toBe("good");
    expect(result.latest?.spread).toBe(2.67);
    expect(result.latest?.label).toContain("Bullish");
  });

  it("detects efficiency fluke when points surge but volume is low", () => {
    // 5 games: 8, 8, 8, 8, 25 (with only 2 targets on the 25-point game)
    const history: Row[] = [
      { Week: 1, Points: 8, Targets: 2, HistoryStatus: "Valid", Games: 1 },
      { Week: 2, Points: 8, Targets: 3, HistoryStatus: "Valid", Games: 1 },
      { Week: 3, Points: 8, Targets: 2, HistoryStatus: "Valid", Games: 1 },
      { Week: 4, Points: 8, Targets: 2, HistoryStatus: "Valid", Games: 1 },
      { Week: 5, Points: 25, Targets: 2, HistoryStatus: "Valid", Games: 1 },
    ];

    const result = calculatePlayerTrend(history, "WR");
    expect(result.latest?.status).toBe("bullish");
    expect(result.latest?.confirmed).toBe(false);
    expect(result.latest?.tone).toBe("orange");
    expect(result.latest?.label).toContain("Efficiency Spike");
  });

  it("detects bearish down-trend when fast MA drops below slow MA", () => {
    // Player cooling down: 22, 20, 18, 8, 6
    const history: Row[] = [
      { Week: 1, Points: 22, Targets: 10, HistoryStatus: "Valid", Games: 1 },
      { Week: 2, Points: 20, Targets: 9, HistoryStatus: "Valid", Games: 1 },
      { Week: 3, Points: 18, Targets: 8, HistoryStatus: "Valid", Games: 1 },
      { Week: 4, Points: 8, Targets: 5, HistoryStatus: "Valid", Games: 1 },
      { Week: 5, Points: 6, Targets: 4, HistoryStatus: "Valid", Games: 1 },
    ];

    const result = calculatePlayerTrend(history, "WR");
    // Fast MA at Week 5 = (1*8 + 2*6) / 3 = 20 / 3 = 6.67
    // Slow MA is significantly higher
    expect(result.latest?.status).toBe("bearish");
    expect(result.latest?.tone).toBe("bad");
    expect(result.latest?.spread).toBeLessThan(-1.5);
    expect(result.latest?.label).toContain("Bearish");
  });

  it("anchors early-season slow MA using projected PPG when available", () => {
    // Rookie with only 2 played games: 6, 20. Projected PPG is 10.
    const history: Row[] = [
      { Week: 1, Points: 6, RushAttempts: 5, Targets: 1, HistoryStatus: "Valid", Games: 1 },
      { Week: 2, Points: 20, RushAttempts: 18, Targets: 3, HistoryStatus: "Valid", Games: 1 },
    ];

    const result = calculatePlayerTrend(history, "RB", 10);
    expect(result.series).toHaveLength(2);
    // Fast MA at week 2 = (1*6 + 2*20) / 3 = 46 / 3 = 15.33
    expect(result.series[1].fastMA).toBe(15.33);
    // Slow MA anchored with 10 for unplayed 3 games:
    // (1*10 + 2*10 + 3*10 + 4*6 + 5*20) / 15 = (10 + 20 + 30 + 24 + 100) / 15 = 184 / 15 = 12.27
    expect(result.series[1].slowMA).toBe(12.27);
    expect(result.latest?.status).toBe("bullish");
    expect(result.latest?.confirmed).toBe(true);
    expect(result.latest?.tone).toBe("good");
  });
});
