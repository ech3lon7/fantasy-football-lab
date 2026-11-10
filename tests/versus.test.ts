import { describe, expect, it } from "vitest";
import { evaluate } from "../src/domain/valuation";
import { addToVersus, versus } from "../src/domain/view/versus";
import { fixture } from "./fixtures";

const d = await fixture([12, 18, 24]);
const m = evaluate(d, d.settings);
const ids = m.players.map((p) => p.id);

describe("versus", () => {
  it("compares two players row by row and marks the higher side", () => {
    const v = versus(m, ids[0], ids[1])!;
    expect(v.rows.map((r) => r.label)).toEqual([
      "Expected PPG",
      "Floor, next game",
      "Ceiling, next game",
      "Recent PPG",
      "Value PPG",
      "ESPN season PPG",
      "Surplus index",
    ]);
    const eppg = v.rows[0];
    const a = m.byId.get(ids[0])!.blendedExpected!,
      b = m.byId.get(ids[1])!.blendedExpected!;
    expect(eppg.better).toBe(a === b ? "even" : a > b ? "a" : "b");
    // The larger side fills its bar; the other is relative to it.
    expect(Math.max(eppg.aShare!, eppg.bShare!)).toBe(1);
  });
  it("shows missing values as null with no bar, never zero", () => {
    const empty = evaluate({ ...d }, d.settings);
    const p = empty.byId.get(ids[0])!;
    p.blendedExpected = null;
    const v = versus(empty, ids[0], ids[1])!;
    expect(v.rows[0].a).toBeNull();
    expect(v.rows[0].aShare).toBeNull();
    expect(v.rows[0].better).toBeNull();
  });
  it("returns null when either player is missing", () => {
    expect(versus(m, ids[0], "nope")).toBeNull();
  });
});

describe("versus selection", () => {
  it("keeps the last two players and ignores a repeat", () => {
    expect(addToVersus(undefined, "1")).toEqual(["1"]);
    expect(addToVersus("1", "2")).toEqual(["1", "2"]);
    expect(addToVersus("1,2", "3")).toEqual(["2", "3"]);
    expect(addToVersus("1,2", "2")).toEqual(["1", "2"]);
  });
});
