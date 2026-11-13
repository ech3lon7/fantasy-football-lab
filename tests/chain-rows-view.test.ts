import { describe, expect, it } from "vitest";
import {
  chainGainSpread,
  chainStatus,
  combineChips,
} from "../src/domain/view/chain-rows";
import type { GainSpread, GradeChip } from "../src/domain/view/trade-room";

const chip = (
  position: string,
  before: string,
  after: string,
  steps: number,
): GradeChip => ({
  position,
  before,
  after,
  steps,
  text: `${position} ${before}→${after} ${steps > 0 ? "+" : ""}${steps}`,
  tone: steps > 0 ? "positive" : "negative",
});

const spread = (gain: number | null, s: number | null): GainSpread => ({
  gain,
  spread: s,
  floor: gain !== null && s !== null ? gain - s : null,
  ceiling: gain !== null && s !== null ? gain + s : null,
  players: [],
  sharesNflTeam: false,
  reason: "",
});

describe("chain result view", () => {
  it("merges grade steps by position: first before, last after, summed steps; cancelled positions vanish", () => {
    const merged = combineChips(
      [chip("WR", "C", "B", 3), chip("RB", "B", "C", -3)],
      [chip("WR", "B", "A", 3), chip("RB", "C", "B", 3)],
    );
    expect(merged.map((c) => c.text)).toEqual(["WR C→A +6"]);
    expect(merged[0].tone).toBe("positive");
  });

  it("combines the two steps' spreads as independent values and keeps the stated total", () => {
    const g = chainGainSpread(spread(2, 3), spread(4, 4), 6);
    expect(g.gain).toBe(6);
    expect(g.spread).toBe(5);
    expect(g.floor).toBe(1);
    expect(g.ceiling).toBe(11);
  });

  it("never turns an unavailable spread into zero", () => {
    const g = chainGainSpread(spread(2, 3), spread(4, null), 6);
    expect(g.gain).toBe(6);
    expect(g.spread).toBeNull();
    expect(g.floor).toBeNull();
  });

  it("takes the worst price status of the two steps; a widened chain is widened", () => {
    const pass = { surplus: "PASS", points: "PASS" };
    const fail = { surplus: "FAIL", points: "PASS" };
    expect(chainStatus(pass, pass, []).kind).toBe("pass");
    expect(chainStatus(pass, fail, []).kind).toBe("warning");
    expect(chainStatus(pass, fail, []).detail).toContain("Surplus test: FAIL");
    expect(chainStatus(pass, pass, ["Index window ±5 → ±10"]).kind).toBe(
      "widened",
    );
  });
});
