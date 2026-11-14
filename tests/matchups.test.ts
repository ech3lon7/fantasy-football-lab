import { describe, it, expect } from "vitest";
import { fixture } from "./fixtures";
import { evaluate } from "../src/domain/valuation";
import { defaults } from "../src/domain/contracts";
import { computeDefenseStats, playerMatchups } from "../src/domain/matchups";

describe("Defense matchups vs position (2.1 - 2.5)", () => {
  // Historical cutoffs must exclude the target week, retain raw rates and cache only the default model snapshot.
  it("cuts off future history and memoizes unrounded defense rates per model", async () => {
    const d = await fixture([10.11, 20.22, 30.33]);
    const m = evaluate(d, defaults);
    const all = computeDefenseStats(m);
    const prior = computeDefenseStats(m, 3);
    const stat = [...all.values()].find((value) => value.pointsAllowedTotal > 0)!;
    const earlier = prior.get(`${stat.defenseTeam}/${stat.pos}`)!;
    expect(earlier.pointsAllowedTotal).toBeLessThan(stat.pointsAllowedTotal);
    expect(stat.allowedPerGameRaw).toBe(stat.pointsAllowedTotal / stat.gamesPlayed);
    expect(stat.leagueAverageRaw).toEqual(expect.any(Number));
    expect(computeDefenseStats(m)).toBe(all);
    expect(computeDefenseStats(evaluate(d, defaults))).not.toBe(all);
  });
  it("computes points allowed per defense and ranks them", async () => {
    const d = await fixture([20, 20, 20]);
    // Schedule already has Opponent: "OTHER" for team 1
    // Let's add an opponent defense "PHI" and "DAL"
    d.tables.ModelSchedule.forEach((s) => {
      s.StatsOfficial = true;
      s.Opponent = Number(s.Week ?? 1) % 2 === 1 ? "PHI" : "DAL";
    });

    const m = evaluate(d, defaults);
    const stats = computeDefenseStats(m);
    expect(stats.size).toBeGreaterThan(0);

    const p = m.players[0];
    const matchups = playerMatchups(m, p, stats);
    expect(matchups.length).toBe(m.final - m.current + 1);
    expect(matchups[0].opponent).toBeDefined();
    expect(matchups[0].shortText).toContain(`W${m.current}`);
  });

  it("handles bye weeks correctly with status 'bye'", async () => {
    const d = await fixture([20, 20]);
    const m = evaluate(d, defaults);
    const p = m.players[0];
    p.bye = m.current;

    const matchups = playerMatchups(m, p);
    expect(matchups[0].bye).toBe(true);
    expect(matchups[0].status).toBe("bye");
    expect(matchups[0].opponent).toBe("BYE");
  });
});
