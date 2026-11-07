import { describe, it, expect } from "vitest";
import {
  calculatePlayerTrend,
  isGoldenCross,
  isDeathCross,
  DEFAULT_LEAGUE_AVG_VOLUME,
  calculateLeagueAverageVolume,
  getTargetVolumeBenchmark,
  TARGET_VOLUME_BENCHMARKS,
} from "../src/domain/player-trend";
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

  describe("golden cross detection", () => {
    it("identifies a newly formed golden cross when fast MA crosses above slow MA in latest week", () => {
      // Week 1: 15 pts (fast=15, slow=15)
      // Week 2: 10 pts (fast=(15+20)/3=11.67, slow=(15*1+10*2)/3=11.67, with prior games padded or unpadded, let's use 5 games)
      // Suppose games:
      // W1: 15 pts
      // W2: 12 pts
      // W3: 10 pts (fast=10.67, slow=11.67 -> fast < slow)
      // W4: 9 pts  (fast=9.33, slow=10.5 -> fast < slow)
      // W5: 24 pts (fast=(9+48)/3=19.00; slow=(15*1+12*2+10*3+9*4+24*5)/15 = (15+24+30+36+120)/15 = 225/15 = 15.00 -> fast > slow!)
      const history: Row[] = [
        { Week: 1, Points: 15, Targets: 8, HistoryStatus: "Valid", Games: 1 },
        { Week: 2, Points: 12, Targets: 7, HistoryStatus: "Valid", Games: 1 },
        { Week: 3, Points: 10, Targets: 6, HistoryStatus: "Valid", Games: 1 },
        { Week: 4, Points: 9, Targets: 5, HistoryStatus: "Valid", Games: 1 },
        { Week: 5, Points: 24, Targets: 11, HistoryStatus: "Valid", Games: 1 },
      ];

      const result = calculatePlayerTrend(history, "WR");
      // In Week 4: fast MA is below slow MA
      expect(result.series[3].fastMA).toBeLessThanOrEqual(result.series[3].slowMA);
      // In Week 5: fast MA is above slow MA
      expect(result.series[4].fastMA).toBeGreaterThan(result.series[4].slowMA);
      // Thus golden cross is true
      expect(result.latest?.goldenCross).toBe(true);
      expect(isGoldenCross(result)).toBe(true);
    });

    it("returns false when fast MA was already above slow MA in the prior week", () => {
      // 5 games of consistently rising scores: fast MA was already above slow MA in Week 4 and stays above in Week 5
      const history: Row[] = [
        { Week: 1, Points: 10, Targets: 8, HistoryStatus: "Valid", Games: 1 },
        { Week: 2, Points: 12, Targets: 7, HistoryStatus: "Valid", Games: 1 },
        { Week: 3, Points: 14, Targets: 9, HistoryStatus: "Valid", Games: 1 },
        { Week: 4, Points: 18, Targets: 10, HistoryStatus: "Valid", Games: 1 },
        { Week: 5, Points: 22, Targets: 12, HistoryStatus: "Valid", Games: 1 },
      ];

      const result = calculatePlayerTrend(history, "WR");
      // Fast was already above in Week 4
      expect(result.series[3].fastMA).toBeGreaterThan(result.series[3].slowMA);
      // Fast is above in Week 5
      expect(result.series[4].fastMA).toBeGreaterThan(result.series[4].slowMA);
      // NOT a newly formed crossover in Week 5
      expect(result.latest?.goldenCross).toBe(false);
      expect(isGoldenCross(result)).toBe(false);
    });

    it("returns false when fast MA remains below slow MA in the latest week", () => {
      const history: Row[] = [
        { Week: 1, Points: 20, Targets: 8, HistoryStatus: "Valid", Games: 1 },
        { Week: 2, Points: 18, Targets: 7, HistoryStatus: "Valid", Games: 1 },
        { Week: 3, Points: 15, Targets: 6, HistoryStatus: "Valid", Games: 1 },
        { Week: 4, Points: 12, Targets: 5, HistoryStatus: "Valid", Games: 1 },
        { Week: 5, Points: 10, Targets: 4, HistoryStatus: "Valid", Games: 1 },
      ];

      const result = calculatePlayerTrend(history, "WR");
      expect(result.latest?.goldenCross).toBe(false);
      expect(isGoldenCross(result)).toBe(false);
    });

    it("returns false when history has fewer than 2 games", () => {
      const singleGame: Row[] = [
        { Week: 1, Points: 25, Targets: 12, HistoryStatus: "Valid", Games: 1 },
      ];
      const result = calculatePlayerTrend(singleGame, "WR");
      expect(result.latest?.goldenCross).toBe(false);
      expect(isGoldenCross(result)).toBe(false);
      expect(isGoldenCross(null)).toBe(false);
    });
  });
  describe("deathCross (bearish crossover) detection", () => {
    it("detects a newly formed death cross when fast MA was >= slow MA and crosses below in latest game", () => {
      const history: Row[] = [
        { Week: 1, Points: 10, Targets: 5, HistoryStatus: "Valid", Games: 1 },
        { Week: 2, Points: 12, Targets: 6, HistoryStatus: "Valid", Games: 1 },
        { Week: 3, Points: 14, Targets: 7, HistoryStatus: "Valid", Games: 1 },
        { Week: 4, Points: 25, Targets: 10, HistoryStatus: "Valid", Games: 1 },
        { Week: 5, Points: 5, Targets: 3, HistoryStatus: "Valid", Games: 1 },
      ];

      const result = calculatePlayerTrend(history, "WR");
      expect(result.series[3].fastMA).toBeGreaterThanOrEqual(result.series[3].slowMA);
      expect(result.series[4].fastMA).toBeLessThan(result.series[4].slowMA);
      expect(result.latest?.deathCross).toBe(true);
      expect(isDeathCross(result)).toBe(true);
    });

    it("returns false when fast MA was already below slow MA in the prior week", () => {
      const history: Row[] = [
        { Week: 1, Points: 20, Targets: 8, HistoryStatus: "Valid", Games: 1 },
        { Week: 2, Points: 18, Targets: 7, HistoryStatus: "Valid", Games: 1 },
        { Week: 3, Points: 12, Targets: 5, HistoryStatus: "Valid", Games: 1 },
        { Week: 4, Points: 8, Targets: 4, HistoryStatus: "Valid", Games: 1 },
        { Week: 5, Points: 6, Targets: 3, HistoryStatus: "Valid", Games: 1 },
      ];

      const result = calculatePlayerTrend(history, "WR");
      expect(result.series[3].fastMA).toBeLessThan(result.series[3].slowMA);
      expect(result.series[4].fastMA).toBeLessThan(result.series[4].slowMA);
      expect(result.latest?.deathCross).toBe(false);
      expect(isDeathCross(result)).toBe(false);
    });

    it("returns false when history has fewer than 2 games", () => {
      const singleGame: Row[] = [
        { Week: 1, Points: 5, Targets: 2, HistoryStatus: "Valid", Games: 1 },
      ];
      const result = calculatePlayerTrend(singleGame, "WR");
      expect(result.latest?.deathCross).toBe(false);
      expect(isDeathCross(result)).toBe(false);
      expect(isDeathCross(null)).toBe(false);
    });
  });
  describe("league average volume calculation", () => {
    it("returns default baseline when history is empty or sparse", () => {
      expect(calculateLeagueAverageVolume([], [], "QB")).toBe(DEFAULT_LEAGUE_AVG_VOLUME.QB);
      expect(calculateLeagueAverageVolume([], [], "RB")).toBe(DEFAULT_LEAGUE_AVG_VOLUME.RB);
      expect(calculateLeagueAverageVolume([], [], "WR")).toBe(DEFAULT_LEAGUE_AVG_VOLUME.WR);
      expect(calculateLeagueAverageVolume([], [], "TE")).toBe(DEFAULT_LEAGUE_AVG_VOLUME.TE);
    });

    it("calculates accurate mean opportunities across played games for given position", () => {
      const players: Row[] = [
        { PlayerID: 10, Position: "WR" },
        { PlayerID: 20, Position: "WR" },
        { PlayerID: 30, Position: "RB" },
      ];
      const history: Row[] = [
        { PlayerID: 10, Week: 1, Targets: 8, HistoryStatus: "Valid", Games: 1 },
        { PlayerID: 10, Week: 2, Targets: 6, HistoryStatus: "Valid", Games: 1 },
        { PlayerID: 10, Week: 3, Targets: 10, HistoryStatus: "Valid", Games: 1 },
        { PlayerID: 20, Week: 1, Targets: 4, HistoryStatus: "Valid", Games: 1 },
        { PlayerID: 20, Week: 2, Targets: 7, HistoryStatus: "Valid", Games: 1 },
        // RB game should be ignored for WR average:
        { PlayerID: 30, Week: 1, RushAttempts: 15, Targets: 5, HistoryStatus: "Valid", Games: 1 },
      ];

      // 5 WR games: 8 + 6 + 10 + 4 + 7 = 35 / 5 = 7.0
      const wrAvg = calculateLeagueAverageVolume(history, players, "WR");
      expect(wrAvg).toBe(7.0);    });
  });
  describe("target volume benchmarks", () => {
    it("returns benchmark values and labels for standard skill positions", () => {
      expect(getTargetVolumeBenchmark("RB")).toEqual({ value: 18, label: "18 Touches" });
      expect(getTargetVolumeBenchmark("WR")).toEqual({ value: 7, label: "7 Targets" });
      expect(getTargetVolumeBenchmark("TE")).toEqual({ value: 6, label: "6 Targets" });
      expect(getTargetVolumeBenchmark("QB")).toEqual({ value: 35, label: "35 Pass Att." });
    });

    it("returns null for positions without volume benchmarks", () => {
      expect(getTargetVolumeBenchmark("K")).toBeNull();
      expect(getTargetVolumeBenchmark("D/ST")).toBeNull();
      expect(getTargetVolumeBenchmark("UNKNOWN")).toBeNull();
    });

    it("exposes TARGET_VOLUME_BENCHMARKS map directly", () => {
      expect(TARGET_VOLUME_BENCHMARKS["RB"]).toEqual({ value: 18, label: "18 Touches" });
      expect(TARGET_VOLUME_BENCHMARKS["WR"]).toEqual({ value: 7, label: "7 Targets" });
      expect(TARGET_VOLUME_BENCHMARKS["TE"]).toEqual({ value: 6, label: "6 Targets" });
      expect(TARGET_VOLUME_BENCHMARKS["QB"]).toEqual({ value: 35, label: "35 Pass Att." });
    });
  });
});
