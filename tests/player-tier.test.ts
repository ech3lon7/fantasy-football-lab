import { describe, expect, it } from "vitest";
import {
  calculatePlayerTiers,
  TIER_GOOD_PER_TEAM,
  TIER_MIN_GAMES,
  TIER_STAR_PER_TEAM,
  TIER_SUPERSTAR_PER_TEAM,
} from "../src/domain/player-tier";
import { evaluate } from "../src/domain/valuation";
import { fixture } from "./fixtures";

// Build a real evaluated model whose players have exactly these (games, points per game, position) and a league of `teams` teams.
async function league(
  entries: { id: number; games: number; ppg: number | null; pos?: string }[],
  teams: number,
) {
  const raw = await fixture();
  raw.tables.ModelContext[0].TeamCount = teams;
  const base = raw.tables.ModelPlayers[0];
  raw.tables.ModelPlayers = entries.map((e) => ({
    ...base,
    PlayerID: e.id,
    Player: `Player ${e.id}`,
    Pos: e.pos ?? "WR",
    GamesPlayed: e.games,
    Actual_PPG: e.ppg,
    OnTeamID: 0,
  }));
  raw.tables.ModelRosters = [];
  raw.tables.ModelHistory = [];
  return evaluate(raw, raw.settings);
}

const many = (count: number, games = 6) =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    games,
    ppg: 100 - i,
  }));

describe("player tiers (display only)", () => {
  it("names the constants the plan fixes", () => {
    expect([
      TIER_MIN_GAMES,
      TIER_SUPERSTAR_PER_TEAM,
      TIER_STAR_PER_TEAM,
      TIER_GOOD_PER_TEAM,
    ]).toEqual([4, 1, 3, 6]);
  });

  it("ties share the better rank and the next rank skips", async () => {
    const m = await league(
      [
        { id: 1, games: 6, ppg: 25 },
        { id: 2, games: 6, ppg: 25 },
        { id: 3, games: 6, ppg: 20 },
      ],
      12,
    );
    const t = calculatePlayerTiers(m);
    expect(t.get("1")?.rank).toBe(1);
    expect(t.get("2")?.rank).toBe(1);
    expect(t.get("3")?.rank).toBe(3);
  });

  it("a 3-game player has no rank and no tier, however well they scored", async () => {
    const m = await league(
      [
        { id: 1, games: 3, ppg: 40 },
        { id: 2, games: 4, ppg: 10 },
      ],
      12,
    );
    const t = calculatePlayerTiers(m);
    expect(t.get("1")).toMatchObject({ rank: null, tier: null, games: 3 });
    expect(t.get("2")).toMatchObject({ rank: 1, games: 4 });
    expect(t.get("2")?.rankedCount).toBe(1);
  });

  it("a player with null points per game has no tier and is not ranked from zero", async () => {
    const m = await league(
      [
        { id: 1, games: 6, ppg: null },
        { id: 2, games: 6, ppg: 12 },
      ],
      12,
    );
    const t = calculatePlayerTiers(m);
    expect(t.get("1")).toMatchObject({ rank: null, tier: null, ppg: null });
    expect(t.get("2")?.rank).toBe(1);
  });

  it("a 10-team league cuts at ranks 10, 30 and 60", async () => {
    const t = calculatePlayerTiers(await league(many(70), 10));
    const tier = (rank: number) => t.get(String(rank))?.tier;
    expect([tier(10), tier(11)]).toEqual(["superstar", "star"]);
    expect([tier(30), tier(31)]).toEqual(["star", "good"]);
    expect([tier(60), tier(61)]).toEqual(["good", null]);
  });

  it("a 12-team league cuts at ranks 12, 36 and 72", async () => {
    const t = calculatePlayerTiers(await league(many(80), 12));
    const tier = (rank: number) => t.get(String(rank))?.tier;
    expect([
      tier(12),
      tier(13),
      tier(36),
      tier(37),
      tier(72),
      tier(73),
    ]).toEqual(["superstar", "star", "star", "good", "good", null]);
  });

  it("kickers and defenses share the one list with everyone else", async () => {
    const m = await league(
      [
        { id: 1, games: 6, ppg: 30, pos: "K" },
        { id: 2, games: 6, ppg: 20, pos: "QB" },
        { id: 3, games: 6, ppg: 25, pos: "D/ST" },
      ],
      12,
    );
    const t = calculatePlayerTiers(m);
    expect([t.get("1")?.rank, t.get("3")?.rank, t.get("2")?.rank]).toEqual([
      1, 2, 3,
    ]);
    expect(t.get("1")?.rankedCount).toBe(3);
  });

  it("returns every field the card needs", async () => {
    const t = calculatePlayerTiers(await league(many(3), 12));
    expect(t.get("1")).toEqual({
      rank: 1,
      rankedCount: 3,
      tier: "superstar",
      ppg: 100,
      games: 6,
    });
  });
});
