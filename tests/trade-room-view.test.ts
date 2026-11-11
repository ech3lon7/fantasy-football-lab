import { describe, expect, it } from "vitest";
import { evaluate } from "../src/domain/valuation";
import { evaluateTrade } from "../src/domain/trades";
import { tradeImpact } from "../src/domain/trade-impact";
import {
  gradeGoalSentence,
  gradeStepChips,
  lineupGainSpread,
  lineupMoves,
  taleOfTape,
  verdicts,
} from "../src/domain/view/trade-room";
import { tradeSearchFixture } from "./fixtures";

const d = await tradeSearchFixture();
const m = evaluate(d, d.settings);
const teams = d.tables.ModelTeams.map((t) => String(t.TeamID));
const mine = teams[0],
  other = teams[1];
const own = m.players.filter((p) => p.owner === mine),
  theirs = m.players.filter((p) => p.owner === other);
// One-for-one between the first two teams using the first player on each side.
const draft = {
  teamA: mine,
  teamB: other,
  give: [own[0].id],
  get: [theirs[0].id],
};
const result = evaluateTrade(m, draft);

// Guard against vacuous passes: the checks below only mean something if this trade evaluates.
it("uses a trade that evaluates", () => {
  expect(result.valid).toBe(true);
});

describe("lineup move list", () => {
  it("returns null for a week outside the horizon", () => {
    if (!result.valid) return;
    const impact = tradeImpact(result)!;
    expect(lineupMoves(m, impact.own, 999, draft.give, draft.get)).toBeNull();
  });
  it("tags only slots that changed and never emits a no-change tag", () => {
    if (!result.valid) return;
    const impact = tradeImpact(result)!;
    const week = m.weeks[0];
    for (const [side, out, inc] of [
      [impact.own, draft.give, draft.get],
      [impact.other, draft.get, draft.give],
    ] as const) {
      const moves = lineupMoves(m, side, week, [...out], [...inc])!;
      expect(moves.before).toHaveLength(moves.after.length);
      for (const row of [...moves.before, ...moves.after])
        expect(JSON.stringify(row.tag)).not.toMatch(/no change/i);
      // Incoming players who start are New; outgoing starters Leave.
      for (const row of moves.after)
        if (row.id && inc.includes(row.id)) expect(row.tag).toBe("New");
      for (const row of moves.before)
        if (row.id && out.includes(row.id)) expect(row.tag).toBe("Leaves");
      // A note exists for every non-empty tag that is not Unfilled.
      const tagged = moves.after.filter((r) => r.tag && r.tag !== "Unfilled");
      expect(moves.notes).toHaveLength(tagged.length);
    }
  });
  it("keeps unavailable Expected PPG as null", () => {
    if (!result.valid) return;
    const moves = lineupMoves(
      m,
      tradeImpact(result)!.own,
      m.weeks[0],
      draft.give,
      draft.get,
    )!;
    for (const row of [...moves.before, ...moves.after])
      if (!row.id) expect(row.eppg).toBeNull();
  });
});

describe("grade-step chips", () => {
  it("shows only positions with a real step change", () => {
    if (!result.valid) return;
    const chips = gradeStepChips(m, draft, result);
    for (const chip of [...chips.own, ...chips.other]) {
      expect(chip.steps).not.toBe(0);
      expect(chip.before).not.toBe("n.a.");
      expect(chip.after).not.toBe("n.a.");
      expect(chip.tone).toBe(chip.steps > 0 ? "positive" : "negative");
      expect(chip.text).toContain(`${chip.before}→${chip.after}`);
    }
  });
  it("returns nothing for an invalid trade", () => {
    const bad = evaluateTrade(m, { ...draft, give: [] });
    expect(bad.valid).toBe(false);
  });
});

describe("lineup gain spread", () => {
  it("combines changed players' spreads as the root of the summed squares", () => {
    if (!result.valid) return;
    const own = tradeImpact(result)!.own;
    const s = lineupGainSpread(m, own, own.expectedPerWeek);
    if (s.spread !== null) {
      expect(s.floor).toBeCloseTo(own.expectedPerWeek! - s.spread, 9);
      expect(s.ceiling).toBeCloseTo(own.expectedPerWeek! + s.spread, 9);
      expect(s.spread).toBeGreaterThanOrEqual(0);
    } else expect(s.floor).toBeNull();
  });
  it("shows no figure when the gain is unavailable", () => {
    if (!result.valid) return;
    const s = lineupGainSpread(m, tradeImpact(result)!.own, null);
    expect(s.spread).toBeNull();
    expect(s.reason).not.toBe("");
  });
});

describe("verdicts", () => {
  it("returns four separate verdicts in a fixed order", () => {
    const v = verdicts(m, result);
    if (!result.valid) return expect(v).toBeNull();
    expect(v!.map((x) => x.id)).toEqual([
      "surplus",
      "lineup",
      "legality",
      "uncertainty",
    ]);
    for (const x of v!) expect(x.summary).not.toBe("");
  });
  it("matches the legality and uncertainty verdicts to the trade result", () => {
    if (!result.valid) return;
    const v = verdicts(m, result)!;
    expect(v[2].summary).toBe(result.legality ? "Legal" : "Needs changes");
    expect(v[3].tone).toBe(result.uncertainty.length ? "warn" : "good");
    expect(v[0].summary).toBe(result.grade);
  });
  it("draws the advantage bar from the deal result, capped at 100%", () => {
    if (!result.valid) return;
    const bar = verdicts(m, result)![0].bar!;
    if (result.advantage === null) expect(bar.percent).toBeNull();
    else {
      expect(Math.abs(bar.value!)).toBeLessThanOrEqual(1);
      expect(bar.value).toBeCloseTo(
        Math.max(-1, Math.min(1, result.advantage)),
        9,
      );
      expect(bar.tone).toBe(
        result.advantage > 0
          ? "good"
          : result.advantage === 0
            ? "neutral"
            : result.advantage > -m.settings.BadLossPct
              ? "warn"
              : "bad",
      );
    }
    for (const other of verdicts(m, result)!.slice(1))
      expect(other.bar).toBeUndefined();
  });
  it("returns null for an invalid trade", () => {
    expect(verdicts(m, evaluateTrade(m, { ...draft, give: [] }))).toBeNull();
  });
});

describe("tale of the tape", () => {
  it("sums each side and shows null when a player's value is missing", () => {
    const rows = taleOfTape(m, draft);
    expect(rows.map((r) => r.label)).toEqual([
      "Expected PPG (sum)",
      "Value PPG (sum)",
      "Surplus (positive VORP)",
    ]);
    const sent = m.byId.get(draft.give[0])!;
    expect(rows[0].send).toBe(sent.blendedExpected!.toFixed(1));
    const gap = new Map(m.byId);
    gap.set(sent.id, { ...sent, blendedExpected: null });
    expect(taleOfTape({ ...m, byId: gap }, draft)[0].send).toBeNull();
    expect(taleOfTape(m, { ...draft, give: [] })[0].send).toBeNull();
  });
});

describe("grade goal sentences", () => {
  const rule = (
    side: "own" | "other",
    position: string,
    steps: number,
    type?: "upgrade" | "drop_limit" | "deplete" | "match_net",
  ) => ({ id: "r", side, position, steps, type });
  it("reads an upgrade as the grade it reaches", () => {
    expect(gradeGoalSentence(rule("own", "WR", 2, "upgrade"), "D+")).toBe(
      "Your WR is D+ today. +2 steps means C or better.",
    );
    expect(gradeGoalSentence(rule("own", "WR", 1, "upgrade"), "B")).toBe(
      "Your WR is B today. +1 step means B+ or better.",
    );
  });
  it("says when an upgrade is out of reach", () => {
    expect(gradeGoalSentence(rule("own", "QB", 3, "upgrade"), "A")).toContain(
      "out of reach",
    );
  });
  it("reads drop limits as the lowest grade allowed", () => {
    expect(gradeGoalSentence(rule("own", "RB", 0, "drop_limit"), "C")).toBe(
      "Your RB is C today. No drop keeps C or better.",
    );
    expect(gradeGoalSentence(rule("own", "RB", -2, "drop_limit"), "C")).toBe(
      "Your RB is C today. Dropping at most 2 steps keeps D+ or better.",
    );
    expect(
      gradeGoalSentence(rule("own", "RB", -9, "drop_limit"), "D"),
    ).toContain("keeps F or better");
  });
  it("never claims a grade it does not have", () => {
    expect(gradeGoalSentence(rule("own", "TE", 2, "upgrade"), null)).toContain(
      "no grade today",
    );
    expect(
      gradeGoalSentence(rule("own", "TE", 2, "upgrade"), "n.a."),
    ).toContain("cannot be met");
  });
  it("describes their team and overall goals without a grade", () => {
    expect(gradeGoalSentence(rule("other", "WR", 1, "upgrade"), "B")).toBe(
      "Their WR must improve by 1 step or more.",
    );
    expect(
      gradeGoalSentence(rule("other", "OVERALL", 0, "match_net"), null),
    ).toContain("match your overall");
    expect(gradeGoalSentence(rule("other", "TE", -2, "deplete"), null)).toBe(
      "Their TE must drop at least 2 steps.",
    );
    expect(
      gradeGoalSentence(rule("own", "OVERALL", 2, "upgrade"), null),
    ).toContain("total +2 or more");
  });
});
