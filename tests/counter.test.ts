import { describe, expect, it } from "vitest";
import { evaluate } from "../src/domain/valuation";
import { evaluateTrade } from "../src/domain/trades";
import { tradeImpact } from "../src/domain/trade-impact";
import { counterOffers } from "../src/domain/view/counter";
import { tradeSearchFixture } from "./fixtures";

const d = await tradeSearchFixture();
const m = evaluate(d, d.settings);
const teams = d.tables.ModelTeams.map((t) => String(t.TeamID));
const mine = teams[0],
  other = teams[1];
const own = m.players.filter((p) => p.owner === mine),
  theirs = m.players.filter((p) => p.owner === other);
const draft = {
  teamA: mine,
  teamB: other,
  give: [own[0].id],
  get: [theirs[0].id],
};
const results = counterOffers(m, draft);

describe("counter offers", () => {
  // Guard against vacuous passes: the checks below mean something only if counters exist.
  it("finds counters for this offer", () => {
    expect(results.counters.length).toBeGreaterThan(0);
  });
  it("starts from a valid offer and reports both lineups' change", () => {
    expect(evaluateTrade(m, draft).valid).toBe(true);
    expect(results.base).not.toBeNull();
  });
  it("differs from the offer by exactly one swap or one added player", () => {
    for (const c of results.counters) {
      const { give, get } = c.draft;
      const gave = new Set(draft.give),
        got = new Set(draft.get);
      const giveChanges =
        give.filter((x) => !gave.has(x)).length +
        draft.give.filter((x) => !give.includes(x)).length;
      const getChanges =
        get.filter((x) => !got.has(x)).length +
        draft.get.filter((x) => !get.includes(x)).length;
      if (c.kind === "swap-receive")
        expect([giveChanges, getChanges]).toEqual([0, 2]);
      if (c.kind === "swap-send")
        expect([giveChanges, getChanges]).toEqual([2, 0]);
      if (c.kind === "add-receive")
        expect([giveChanges, getChanges]).toEqual([0, 1]);
      if (c.kind === "add-send")
        expect([giveChanges, getChanges]).toEqual([1, 0]);
      expect(give.length).toBeLessThanOrEqual(5);
      expect(get.length).toBeLessThanOrEqual(5);
    }
  });
  it("only offers counters that still help the owner and are valid trades", () => {
    for (const c of results.counters) {
      expect(c.ownGain).toBeGreaterThan(0);
      const impact = tradeImpact(evaluateTrade(m, c.draft, true))!;
      expect(impact.own.expectedPerWeek).toBeCloseTo(c.ownGain, 9);
    }
  });
  it("lists counters that help both teams first", () => {
    const flags = results.counters.map((c) => c.helpsBoth);
    expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
    for (const c of results.counters)
      expect(c.helpsBoth).toBe(c.otherGain !== null && c.otherGain > 0);
  });
  it("keeps the other team's change null rather than zero when it cannot be scored", () => {
    for (const c of results.counters)
      expect(c.otherGain === null || Number.isFinite(c.otherGain)).toBe(true);
  });
  it("returns nothing for an invalid offer and never edits the draft or model", () => {
    expect(counterOffers(m, { ...draft, give: [] })).toEqual({
      base: null,
      counters: [],
    });
    const before = JSON.stringify(draft);
    counterOffers(m, draft);
    expect(JSON.stringify(draft)).toBe(before);
  });
  it("respects the result limit", () => {
    expect(
      counterOffers(m, draft, undefined, undefined, 3).counters.length,
    ).toBeLessThanOrEqual(3);
  });
});
