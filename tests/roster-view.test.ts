import { describe, expect, it } from "vitest";
import { evaluate } from "../src/domain/valuation";
import { roster, teamsAssessment } from "../src/domain/lineups";
import {
  depthChart,
  gradeTone,
  leagueColumns,
  leagueGrid,
  positionPlayers,
} from "../src/domain/view/roster";
import { fixture } from "./fixtures";

const d = await fixture([10, 14, 18, 12, 16]);
const m = evaluate(d, d.settings);
const grades = teamsAssessment(m);
const team = String(d.tables.ModelTeams[0].TeamID);

describe("grade tones", () => {
  it("maps letters onto six steps and leaves unavailable grades without a tone", () => {
    expect(["F", "D−", "C+", "B", "A−", "A+"].map(gradeTone)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(gradeTone("n.a.")).toBeNull();
    expect(gradeTone("")).toBeNull();
  });
});

describe("depth chart", () => {
  const chart = depthChart(m, team, grades.get(team)!);
  it("lists every rostered player once, grouped by position", () => {
    const ids = chart.flatMap((g) => g.tiles.map((t) => t.id)).sort();
    expect(ids).toEqual(
      roster(m, team)
        .filter((id) => m.byId.has(id))
        .sort(),
    );
    for (const g of chart)
      for (const t of g.tiles) expect(t.pos).toBe(g.position);
  });
  it("puts starters before bench and IR, and gives starters a slot", () => {
    for (const g of chart) {
      const roles = g.tiles.map((t) => t.role);
      expect(roles).toEqual(
        [...roles].sort(
          (a, b) =>
            ["Starter", "Bench", "IR"].indexOf(a) -
            ["Starter", "Bench", "IR"].indexOf(b),
        ),
      );
      for (const t of g.tiles)
        expect(t.slot !== null).toBe(t.role === "Starter");
    }
  });
  it("keeps up to nine played games in the strip and never invents scores", () => {
    for (const t of chart.flatMap((g) => g.tiles)) {
      expect(t.strip.length).toBeLessThanOrEqual(9);
      for (const point of t.strip)
        expect(point.points === null || Number.isFinite(point.points)).toBe(
          true,
        );
    }
  });
  it("matches each group's grade to the team assessment", () => {
    for (const g of chart)
      expect(g.grade).toBe(
        grades.get(team)!.find((x) => x.position === g.position)!.grade,
      );
  });
});

describe("league grid", () => {
  const grid = leagueGrid(m, grades);
  it("has a row per team and a cell per position column", () => {
    expect(grid).toHaveLength(d.tables.ModelTeams.length);
    for (const row of grid)
      expect(row.cells.map((c) => c.position)).toEqual(leagueColumns);
  });
  it("explains every unavailable grade and gives available ones a tone", () => {
    for (const cell of grid.flatMap((r) => r.cells)) {
      if (cell.grade === "n.a.") {
        expect(cell.tone).toBeNull();
        expect(cell.reason).not.toBe("");
      } else {
        expect(cell.tone).not.toBeNull();
        expect(cell.reason).toBe("");
      }
    }
  });
});

describe("position players", () => {
  it("lists the players behind a cell and the starters filling FLEX", () => {
    const rb = positionPlayers(m, team, grades.get(team)!, "RB");
    for (const t of rb.tiles) expect(t.pos).toBe("RB");
    for (const t of positionPlayers(m, team, grades.get(team)!, "FLEX").tiles)
      expect(t.slot).toBe("FLEX");
  });
});
