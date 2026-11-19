import { describe, expect, it } from "vitest";
import { fixture } from "./fixtures";
import { defaults } from "../src/domain/contracts";
import { evaluate } from "../src/domain/valuation";
import { calculateMppg } from "../src/domain/mppg";
import type { DefensePositionStat } from "../src/domain/matchups";

// Exercise the approved multiplier against unrounded, explicitly supplied defense data.
describe("matchup-adjusted MPPG", () => {
  it.each([
    [25, 0.6, 9, 17.5, "Base 25.0 = EPPG 25.0 (no ESPN projection) · × (1 − 30%) · MIN allows 40% fewer points to QBs than average (9 games)"],
    [14.6, 1.47, 9, 19.7, "Base 14.6 = EPPG 14.6 (no ESPN projection) · × (1 + 35%) · MIN allows 47% more points to QBs than average (9 games)"],
    [10, 1.8, 9, 11.5, "Base 10.0 = EPPG 10.0 (no ESPN projection) · × (1 + 15%) · MIN allows 80% more points to QBs than average (9 games, capped)"],
    [10, 0.3, 9, 8.5, "Base 10.0 = EPPG 10.0 (no ESPN projection) · × (1 − 15%) · MIN allows 70% fewer points to QBs than average (9 games, capped)"],
    [14.6, 1.2, 2, 14.6, "Base 14.6 = EPPG 14.6 (no ESPN projection) · MIN matchup +10% ignored (under 12%)"],
    [10, 1.02, 9, 10, "Base 10.0 = EPPG 10.0 (no ESPN projection) · MIN matchup +2% ignored (under 12%)"],
  ])("uses EPPG %s and opponent ratio %s", async (eppg, ratio, games, expected, line) => {
    const d = await fixture([20, 20, 20]);
    const m = evaluate(d, defaults);
    const p = m.players[0];
    p.pos = "QB"; p.blendedExpected = eppg; p.weekly = null;
    const schedule = m.dataset.tables.ModelSchedule.find((s) => String(s.ProTeamID) === p.nflId && Number(s.Week) === m.current)!;
    schedule.Opponent = "MIN";
    const stat = { defenseTeam: "MIN", pos: "QB", gamesPlayed: games, allowedPerGameRaw: ratio * 10, leagueAverageRaw: 10, status: "official" } as DefensePositionStat;
    const result = calculateMppg(m, p, m.current, new Map([["MIN/QB", stat]]));
    expect(result.value).toBe(expected);
    expect(result.buildLine).toBe(line);
    expect(result.source).toBe("matchup");
  });

  it("uses EPPG alone when matchup data is missing, and never uses ESPN when EPPG is missing", async () => {
    const m = evaluate(await fixture([20, 20]), defaults);
    const p = m.players[0]; p.blendedExpected = 12.1; p.weekly = null;
    const unavailable = calculateMppg(m, p, m.current, new Map());
    expect(unavailable.value).toBe(12.1);
    expect(unavailable.reason).toBe("Matchup data unavailable");
    expect(unavailable.buildLine).toBe("Base 12.1 = EPPG 12.1 (no ESPN projection) · matchup data unavailable");
    p.blendedExpected = null; p.weekly = 20;
    expect(calculateMppg(m, p).reason).toBe("No Expected PPG");
    expect(calculateMppg(m, p).value).toBeNull();
  });

  // Each unavailable matchup condition must retain the player's expected scoring forecast.
  it.each(["no schedule", "no opponent", "no defense games", "zero league average"])("falls back for %s", async (condition) => {
    const m = evaluate(await fixture([20, 20]), defaults);
    const p = m.players[0]; p.pos = "QB"; p.blendedExpected = 12.1; p.weekly = null;
    const schedule = m.dataset.tables.ModelSchedule.find((s) => String(s.ProTeamID) === p.nflId && Number(s.Week) === m.current)!;
    schedule.Opponent = condition === "no opponent" ? "" : "MIN";
    schedule.OpponentID = "";
    if (condition === "no schedule") m.dataset.tables.ModelSchedule = m.dataset.tables.ModelSchedule.filter((s) => s !== schedule);
    const stat = { gamesPlayed: condition === "no defense games" ? 0 : 4, allowedPerGameRaw: 12, leagueAverageRaw: condition === "zero league average" ? 0 : 10 } as DefensePositionStat;
    const result = calculateMppg(m, p, m.current, new Map([["MIN/QB", stat]]));
    expect(result.value).toBe(12.1);
    expect(result.reason).toBe("Matchup data unavailable");
  });
});
