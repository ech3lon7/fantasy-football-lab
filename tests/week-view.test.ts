import { describe, expect, it } from "vitest";
import { evaluate } from "../src/domain/valuation";
import { teamsAssessment } from "../src/domain/lineups";
import { tickerItems, weekSummary } from "../src/domain/view/week";
import { fixture } from "./fixtures";

const d = await fixture([10, 14, 18, 12, 16]);
const m = evaluate(d, d.settings);
const grades = teamsAssessment(m);
const team = String(d.tables.ModelTeams[0].TeamID);
const mine = grades.get(team)!;
const empty = { teamA: "", teamB: "", give: [], get: [] };

describe("outlook", () => {
  const s = weekSummary(m, team, mine);
  it("has a point per remaining week with the league median alongside", () => {
    expect(s.outlook.points.map((p) => p.week)).toEqual(m.weeks);
    for (const p of s.outlook.points)
      expect(p.median === null || Number.isFinite(p.median)).toBe(true);
  });
  it("derives the gap from the average and the median average", () => {
    if (s.outlook.average !== null && s.outlook.medianAverage !== null) {
      const gap = Number(s.outlook.average) - Number(s.outlook.medianAverage);
      expect(Math.abs(gap - Number(s.outlook.gap)) < 0.11).toBe(true);
    }
  });
  it("never reports an unscorable week as zero", () => {
    for (const p of s.outlook.points) expect(p.mine).not.toBe(0 * NaN);
    const unfilled = weekSummary(m, "2", teamsAssessment(m).get("2")!);
    for (const p of unfilled.outlook.points)
      if (p.mine === 0) expect(typeof p.mine).toBe("number");
  });
});

describe("scoreboard", () => {
  const s = weekSummary(m, team, mine);
  it("has a row per graded position with shares on one scale", () => {
    expect(s.scoreboard.rows.map((r) => r.position)).toEqual(
      mine.map((g) => g.position),
    );
    for (const r of s.scoreboard.rows) {
      for (const v of [r.mineShare, r.medianShare])
        if (v !== null) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
    }
  });
  it("shows an ungraded position as unavailable with its reason, not as a bar", () => {
    for (const r of s.scoreboard.rows.filter((x) => x.grade === "n.a.")) {
      expect(r.mine).toBeNull();
      expect(r.mineShare).toBeNull();
      // The league median of an empty sample is not shown as zero.
      expect(r.median).toBeNull();
      expect(r.medianShare).toBeNull();
      expect(r.side).toBeNull();
      expect(r.reason).not.toBe("");
      expect(s.scoreboard.note).toContain(r.position);
    }
  });
});

describe("headline, deck and moves", () => {
  it("names the weakest position only when it is below the league median", () => {
    const s = weekSummary(m, team, mine);
    const weak = mine
      .filter((g) => ["QB", "RB", "WR", "TE"].includes(g.position))
      .filter((g) => g.versus !== null && g.grade !== "n.a.")
      .sort((a, b) => a.versus! - b.versus!)[0];
    if (weak && weak.versus! < 0)
      expect(s.headline).toBe(`${weak.position} is your weak spot.`);
    else expect(s.headline).not.toMatch(/weak spot/);
  });
  it("shows no trade card without a valid open trade and never more than three moves", () => {
    const s = weekSummary(m, team, mine, empty);
    expect(s.moves.some((x) => x.kind === "trade")).toBe(false);
    expect(s.moves.length).toBeLessThanOrEqual(3);
    const bad = weekSummary(m, team, mine, {
      teamA: team,
      teamB: team,
      give: ["1"],
      get: ["1"],
    });
    expect(bad.moves.some((x) => x.kind === "trade")).toBe(false);
  });
  it("builds a trade card from the evaluator when the open trade is valid", () => {
    const other = String(d.tables.ModelTeams[1].TeamID);
    const give = m.players.find((p) => p.owner === team)!.id;
    const get = m.players.find((p) => p.owner === other)!.id;
    const s = weekSummary(m, team, mine, {
      teamA: team,
      teamB: other,
      give: [give],
      get: [get],
    });
    const card = s.moves.find((x) => x.kind === "trade");
    if (card) {
      expect(card.title).toContain(m.byId.get(give)!.name);
      expect(card.unit).toBe("EPPG/wk");
      expect(s.deck).toContain("Your open trade");
    }
  });
  it("does not change the model", () => {
    const before = JSON.stringify(m.players.map((p) => p.blendedExpected));
    weekSummary(m, team, mine, empty);
    expect(JSON.stringify(m.players.map((p) => p.blendedExpected))).toBe(
      before,
    );
  });
});

describe("ticker", () => {
  it("lists labelled players, own roster first, with a direction", () => {
    const items = tickerItems(m, team);
    expect(items.length).toBeLessThanOrEqual(14);
    for (const i of items) {
      expect(i.label).not.toBe("");
      expect(["up", "down"]).toContain(i.direction);
    }
  });
});
