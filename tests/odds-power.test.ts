import { describe, expect, it } from "vitest";
import { evaluate } from "../src/domain/valuation";
import { teamsAssessment } from "../src/domain/lineups";
import {
  combineSpreads,
  normalCdf,
  oddsReading,
  outscoreProbability,
} from "../src/domain/view/odds";
import { leaguePower } from "../src/domain/view/power";
import { versus } from "../src/domain/view/versus";
import { fixture } from "./fixtures";

describe("normal CDF and combined spread", () => {
  it("matches known values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1)).toBeCloseTo(0.8413447, 6);
    expect(normalCdf(-1.96)).toBeCloseTo(0.0249979, 6);
    expect(normalCdf(3) + normalCdf(-3)).toBeCloseTo(1, 7);
  });
  it("combines independent spreads as the root of the summed squares", () => {
    expect(combineSpreads([3, 4])).toBe(5);
    expect(combineSpreads([])).toBe(0);
  });
});

describe("outscore probability", () => {
  const e = (mean: number | null, spread: number | null) => ({ mean, spread });
  it("is exactly one half at equal values", () => {
    expect(outscoreProbability(e(10, 3), e(10, 3))).toBeCloseTo(0.5, 9);
  });
  it("grows with the edge, falls with the spread and the two sides sum to one", () => {
    const edge = outscoreProbability(e(14, 3), e(10, 3))!;
    const noisy = outscoreProbability(e(14, 9), e(10, 9))!;
    expect(edge).toBeGreaterThan(0.75);
    expect(noisy).toBeLessThan(edge);
    expect(edge + outscoreProbability(e(10, 3), e(14, 3))!).toBeCloseTo(1, 9);
  });
  it("shows no figure when a value or spread is missing, or there is no variability", () => {
    expect(outscoreProbability(e(null, 3), e(10, 3))).toBeNull();
    expect(outscoreProbability(e(10, null), e(10, 3))).toBeNull();
    expect(outscoreProbability(e(10, 0), e(8, 0))).toBeNull();
  });
  it("words the result as a coin flip, a modest edge or a clear edge", () => {
    expect(oddsReading(0.52)).toBe("close to a coin flip");
    expect(oddsReading(0.6)).toBe("a modest edge");
    expect(oddsReading(0.85)).toBe("a clear edge");
    expect(oddsReading(0.1)).toBe("a clear edge");
  });
});

const d = await fixture([12, 18, 24]);
const m = evaluate(d, d.settings);
const ids = m.players.map((p) => p.id);

describe("start or sit in versus", () => {
  it("adds odds only when both sides have an EPPG and a spread", () => {
    const v = versus(m, ids[0], ids[1])!;
    if (v.odds) {
      const a = Number(v.odds.a.replace("%", "")),
        b = Number(v.odds.b.replace("%", ""));
      expect(Math.abs(a + b - 100)).toBeLessThanOrEqual(1);
      expect(v.odds.caveat).toMatch(/not a prediction/);
      expect(v.odds.ranges).toContain("±");
    } else expect(v.odds).toBeNull();
  });
  it("shows the same player against itself as an even call or no figure", () => {
    const v = versus(m, ids[0], ids[0])!;
    if (v.odds) expect(v.odds.reading).toBe("close to a coin flip");
  });
});

describe("league power ranges", () => {
  const team = String(d.tables.ModelTeams[0].TeamID);
  const rows = leaguePower(m, team);
  it("lists every team once, ranked by expected points", () => {
    expect(rows).toHaveLength(d.tables.ModelTeams.length);
    const expected = rows.map((r) => r.expected ?? -Infinity);
    expect(expected).toEqual([...expected].sort((a, b) => b - a));
    expect(rows.filter((r) => r.mine)).toHaveLength(1);
  });
  it("gives a range only when every starter has a spread, and never zero for a missing lineup", () => {
    for (const r of rows) {
      if (r.spread === null) {
        expect(r.floor).toBeNull();
        expect(r.ceiling).toBeNull();
      } else {
        expect(r.floor).toBeCloseTo(r.expected! - r.spread, 9);
        expect(r.ceiling).toBeCloseTo(r.expected! + r.spread, 9);
      }
      if (r.expected === null) expect(r.reason).not.toBe("");
    }
  });
  it("shows the owner's chance against each other team and none against themselves", () => {
    for (const r of rows) {
      if (r.mine) expect(r.chance).toBeNull();
      else if (r.chance !== null) {
        expect(r.chance).toBeGreaterThan(0);
        expect(r.chance).toBeLessThan(1);
      }
    }
  });
  it("agrees with the team assessment's lineup on who is on the roster", () => {
    expect(teamsAssessment(m).size).toBe(rows.length);
  });
});
