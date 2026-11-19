import { describe, it, expect } from "vitest";
import { fixture } from "./fixtures";
import { evaluate, type Model, type Player } from "../src/domain/valuation";
import { defaults } from "../src/domain/contracts";
import type { DefensePositionStat } from "../src/domain/matchups";
import {
  calculateMppg,
  MPPG_CAP,
  MPPG_EARLY_GAMES,
  MPPG_EARLY_RELIABILITY,
  MPPG_ESPN_SHARE,
  MPPG_MATCHUP_THRESHOLD,
  MPPG_MATCHUP_WEIGHT,
  MPPG_SCORING_LEVEL_BASE,
  MPPG_SCORING_LEVEL_POWER,
  MPPG_STREAK_FADE,
  MPPG_STREAK_THRESHOLD,
} from "../src/domain/mppg";

const round1 = (x: number) => Math.round(x * 10) / 10;
// The fixture's opponent is "OTHER". A defence that allows (1 + raw) times the league average over `games` games.
const defence = (pos: string, raw: number, games = 8) =>
  new Map<string, DefensePositionStat>([[`OTHER/${pos}`, { defenseTeam: "OTHER", pos, gamesPlayed: games, allowedPerGameRaw: (1 + raw) * 100, leagueAverageRaw: 100 } as DefensePositionStat]]);
const noMatchup = new Map<string, DefensePositionStat>();

// One fixture player with exactly the inputs a case states.
async function setup(inputs: { pos: string; eppg: number; weekly: number | null; recent?: number | null; actual?: number | null }): Promise<{ m: Model; p: Player }> {
  const m = evaluate(await fixture([20, 20]), defaults), p = m.players[0];
  p.pos = inputs.pos as Player["pos"]; p.blendedExpected = inputs.eppg; p.weekly = inputs.weekly;
  p.recent = inputs.recent ?? null; p.actual = inputs.actual ?? null;
  return { m, p };
}

// MPPG by Design T (docs/mppg-threshold-proposal.md): the ESPN rule, the position mix, the hot-streak fade, the thresholded matchup
// and the scoring level.
describe("MPPG formula (Design T)", () => {
  it("uses the approved named constants", () => {
    expect([MPPG_CAP, MPPG_EARLY_GAMES, MPPG_EARLY_RELIABILITY]).toEqual([0.5, 3, 0.5]);
    expect(MPPG_ESPN_SHARE).toEqual({ QB: 0.75, RB: 0.45, WR: 0.55, TE: 0, K: 1, "D/ST": 0.6 });
    expect(MPPG_MATCHUP_WEIGHT).toEqual({ QB: 0.75, RB: 0.35, WR: 0.7, TE: 1.85, K: 2.0, "D/ST": 2.35 });
    expect([MPPG_MATCHUP_THRESHOLD, MPPG_STREAK_THRESHOLD, MPPG_STREAK_FADE, MPPG_SCORING_LEVEL_BASE, MPPG_SCORING_LEVEL_POWER]).toEqual([0.12, 2, 0.55, 12, 5]);
  });

  // a. ESPN zero.
  it("ESPN projecting 0 gives MPPG 0 and says so, with the matchup effect 0 when matchup data is usable and null otherwise", async () => {
    const { m, p } = await setup({ pos: "WR", eppg: 18, weekly: 0 });
    const usable = calculateMppg(m, p, m.current, defence("WR", 0.3));
    expect(usable).toMatchObject({ value: 0, espnZero: true, matchupEffect: 0, source: "matchup", reason: "" });
    expect(usable.buildLine).toBe("ESPN projects 0 this week");
    const none = calculateMppg(m, p, m.current, noMatchup);
    expect(none).toMatchObject({ value: 0, espnZero: true, matchupEffect: null, source: "eppg-only", reason: "Matchup data unavailable" });
    expect(none.buildLine).toBe("ESPN projects 0 this week");
    expect(calculateMppg(m, p, m.current, defence("WR", 0.3)).base).toBeCloseTo(0.45 * 18, 5);
  });

  // b. The ESPN share by position.
  it.each(Object.entries({ QB: 0.75, RB: 0.45, WR: 0.55, TE: 0, K: 1, "D/ST": 0.6 }))("%s takes %s of its base from ESPN, and none when ESPN has no projection", async (pos, share) => {
    const { m, p } = await setup({ pos, eppg: 15, weekly: 10 });
    const result = calculateMppg(m, p, m.current, noMatchup);
    expect(result.espnShare).toBe(share);
    expect(result.value).toBeCloseTo(round1((1 - share) * 15 + share * 10), 5);
    p.weekly = null;
    const missing = calculateMppg(m, p, m.current, noMatchup);
    expect(missing).toMatchObject({ espnShare: 0, espnWeekly: null, value: 15 });
    // A missing projection with a hot streak: the streak term still applies, and nothing is filled in.
    p.recent = 22; p.actual = 15;
    expect(calculateMppg(m, p, m.current, noMatchup).value).toBeCloseTo(round1(15 - 0.55 * (22 - 15 - 2)), 5);
  });
  it("a position that is not in the tables has no ESPN share and no matchup weight", async () => {
    const { m, p } = await setup({ pos: "XX", eppg: 15, weekly: 10, recent: 20, actual: 15 });
    const result = calculateMppg(m, p, m.current, defence("XX", 0.4));
    expect(result).toMatchObject({ espnShare: 0, matchupEffect: 0 });
    expect(result.value).toBeCloseTo(round1(15 - 0.55 * 3), 5);
  });

  // c. The hot-streak fade.
  it("trims 0.55 of a hot streak above 2 points, and does nothing when either average is missing", async () => {
    const { m, p } = await setup({ pos: "WR", eppg: 20.26, weekly: 16.16, recent: 20 + 8.19, actual: 20 });
    expect(calculateMppg(m, p, m.current, noMatchup).streakFade).toBeCloseTo(0.55 * 6.19, 6);
    p.recent = null; expect(calculateMppg(m, p, m.current, noMatchup).streakFade).toBe(0);
    p.recent = 28; p.actual = null; expect(calculateMppg(m, p, m.current, noMatchup).streakFade).toBe(0);
    p.recent = 21; p.actual = 20; expect(calculateMppg(m, p, m.current, noMatchup).streakFade).toBe(0);
  });

  // d. The 12% threshold.
  it("ignores a matchup under 12% and uses one of 12% or more", async () => {
    const { m, p } = await setup({ pos: "TE", eppg: 14, weekly: 14 });
    const under = calculateMppg(m, p, m.current, defence("TE", 0.119));
    expect(under).toMatchObject({ matchupIgnored: true, matchupEffect: 0, source: "matchup" });
    expect(under.buildLine).toContain("matchup +12% ignored (under 12%)");
    const atLeast = calculateMppg(m, p, m.current, defence("TE", 0.12));
    expect(atLeast.matchupIgnored).toBe(false);
    expect(atLeast.matchupEffect).toBeGreaterThan(0);
    expect(calculateMppg(m, p, m.current, defence("TE", -0.119)).matchupIgnored).toBe(true);
    expect(calculateMppg(m, p, m.current, defence("TE", -0.12)).matchupEffect).toBeLessThan(0);
  });
  it("keeps matchupPct and rawMatchupPct as the matchup after the early-game halving and the 50% cap, before the threshold and the weight", async () => {
    const { m, p } = await setup({ pos: "TE", eppg: 14, weekly: 14 });
    expect(calculateMppg(m, p, m.current, defence("TE", 0.8))).toMatchObject({ matchupPct: 0.5, capped: true });
    expect(calculateMppg(m, p, m.current, defence("TE", 0.8)).rawMatchupPct).toBeCloseTo(0.8, 6);
    const early = calculateMppg(m, p, m.current, defence("TE", 0.1, 3));
    expect(early.matchupPct).toBeCloseTo(0.05, 10);
    expect(early.matchupIgnored).toBe(true);
  });

  // e. The scoring level.
  it("scales the matchup by (EPPG / 12)^5, at most 1", async () => {
    const full = await setup({ pos: "TE", eppg: 12, weekly: 12 });
    expect(calculateMppg(full.m, full.p, full.m.current, defence("TE", 0.3)).scoringLevel).toBe(1);
    const low = await setup({ pos: "TE", eppg: 8, weekly: 8 });
    const result = calculateMppg(low.m, low.p, low.m.current, defence("TE", 0.3));
    expect(result.scoringLevel).toBeCloseTo(Math.pow(8 / 12, 5), 6);
    expect(result.scoringLevel).toBeCloseTo(0.1317, 4);
    const high = await setup({ pos: "TE", eppg: 20, weekly: 20 });
    expect(calculateMppg(high.m, high.p, high.m.current, defence("TE", 0.3)).scoringLevel).toBe(1);
  });

  // f. The weights, with the Week 10 Isaiah Likely inputs.
  it("weights a tight end's matchup by 1.85: EPPG 14.59, a +37.58% matchup and ESPN 12.45 give 24.7", async () => {
    const { m, p } = await setup({ pos: "TE", eppg: 14.59, weekly: 12.45 });
    const result = calculateMppg(m, p, m.current, defence("TE", 0.3758));
    expect(result.value).toBeCloseTo(24.7, 1);
    expect(result.value).toBe(24.7);
    expect(result.matchupEffect).toBeCloseTo(1.85 * 0.3758, 4);
    expect(result.buildLine).toMatch(/^Base 14\.6 = EPPG 14\.6 · × \(1 \+ 70%\) · OTHER allows 38% more points to TEs than average \(8 games\)$/);
  });

  // g. No final cap.
  it("does not cap the weighted adjustment: a defence with a -50% matchup floors at 0", async () => {
    const { m, p } = await setup({ pos: "D/ST", eppg: 12, weekly: 6 });
    const result = calculateMppg(m, p, m.current, defence("D/ST", -0.5));
    expect(result.matchupEffect).toBeCloseTo(2.35 * -0.5, 6);
    expect(result.value).toBe(0);
  });

  // The explanation lines.
  it("explains the base, a hot streak and a missing ESPN projection", async () => {
    const { m, p } = await setup({ pos: "WR", eppg: 20.26, weekly: 16.16, recent: 28.19, actual: 20 });
    expect(calculateMppg(m, p, m.current, defence("WR", -0.024)).buildLine).toBe("Base 14.6 = 45% EPPG 20.3 + 55% ESPN 16.2 − hot streak 3.4 · OTHER matchup −2% ignored (under 12%)");
    p.weekly = null; p.recent = null;
    expect(calculateMppg(m, p, m.current, noMatchup).buildLine).toBe("Base 20.3 = EPPG 20.3 (no ESPN projection) · matchup data unavailable");
    const kicker = await setup({ pos: "K", eppg: 8, weekly: 9 });
    expect(calculateMppg(kicker.m, kicker.p, kicker.m.current, noMatchup).buildLine).toBe("Base 9.0 = ESPN 9.0 · matchup data unavailable");
    const counted = await setup({ pos: "TE", eppg: 14, weekly: null });
    expect(calculateMppg(counted.m, counted.p, counted.m.current, defence("TE", 0.8, 2)).buildLine).toContain("(2 games, counted at 50%)");
    expect(calculateMppg(counted.m, counted.p, counted.m.current, defence("TE", 0.8)).buildLine).toContain("(8 games, capped)");
  });

  // h. The unavailable cases are unchanged.
  it("floors negative expected values at zero", async () => {
    // ESPN's weekly projection is cleared: with one, the mix with it would no longer be negative.
    const m = evaluate(await fixture([5, 5]), defaults), p = m.players[0];
    p.blendedExpected = -5; p.weekly = null; expect(calculateMppg(m, p).value).toBe(0);
  });
  it("bye week returns null with 'Bye week', and never 0", async () => {
    const m = evaluate(await fixture([20, 20]), defaults), p = m.players[0]; p.bye = m.current;
    expect(calculateMppg(m, p)).toMatchObject({ value: null, reason: "Bye week", espnShare: 0, streakFade: 0, base: 0, scoringLevel: 0, matchupEffect: null, matchupIgnored: false, espnZero: false });
  });
  it.each(["OUT", "IR", "SUSPENDED"])("%s returns null with 'Out'", async (injury) => {
    const m = evaluate(await fixture([20, 20]), defaults), p = m.players[0]; p.injury = injury;
    expect(calculateMppg(m, p)).toMatchObject({ value: null, reason: "Out" });
  });
  it("missing ESPN weekly does not make MPPG unavailable", async () => {
    const m = evaluate(await fixture([20, 20]), defaults), p = m.players[0]; p.blendedExpected = 20; p.weekly = null;
    expect(calculateMppg(m, p).value).not.toBeNull();
  });
  it("null EPPG returns null even if ESPN weekly exists", async () => {
    const m = evaluate(await fixture([20, 20]), defaults), p = m.players[0]; p.blendedExpected = null; p.weekly = 16.5;
    expect(calculateMppg(m, p)).toMatchObject({ value: null, source: "unavailable", reason: "No Expected PPG", espnWeekly: 16.5 });
  });
  it("a future week returns null", async () => {
    const m = evaluate(await fixture([20, 20]), defaults);
    expect(calculateMppg(m, m.players[0], m.current + 1)).toMatchObject({ value: null, source: "unavailable" });
  });
});
