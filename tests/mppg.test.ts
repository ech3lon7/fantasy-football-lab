import { describe, it, expect } from "vitest";
import { fixture } from "./fixtures";
import { evaluate } from "../src/domain/valuation";
import { defaults } from "../src/domain/contracts";
import { calculateMppg, MPPG_CAP, MPPG_EARLY_GAMES, MPPG_EARLY_RELIABILITY } from "../src/domain/mppg";

// The original availability and projection cases now assert the approved matchup formula.
describe("MPPG formula", () => {
  it("uses the approved named constants", () => {
    expect([MPPG_CAP, MPPG_EARLY_GAMES, MPPG_EARLY_RELIABILITY]).toEqual([0.5, 3, 0.5]);
  });
  it("does not use ESPN weekly even when season projections equal EPPG", async () => {
    const m = evaluate(await fixture([20, 20, 20]), defaults), p = m.players[0];
    p.blendedExpected = 20; p.projected = 20; p.weekly = 15;
    const a = calculateMppg(m, p); p.weekly = 30;
    expect(calculateMppg(m, p).value).toBe(a.value);
    expect(a.buildLine).not.toMatch(/ESPN/);
  });
  it("does not add an ESPN model edge when EPPG is above projection", async () => {
    const m = evaluate(await fixture([22, 22]), defaults), p = m.players[0];
    p.blendedExpected = 22; p.projected = 20; p.weekly = 14;
    const result = calculateMppg(m, p); p.projected = 10;
    expect(calculateMppg(m, p).value).toBe(result.value);
  });
  it("does not subtract an ESPN model edge when EPPG is below projection", async () => {
    const m = evaluate(await fixture([17, 17]), defaults), p = m.players[0];
    p.blendedExpected = 17; p.projected = 20; p.weekly = 15;
    const result = calculateMppg(m, p); p.projected = 30;
    expect(calculateMppg(m, p).value).toBe(result.value);
    expect(result.buildLine).not.toContain("ESPN");
  });
  it("floors negative expected values at zero", async () => {
    const m = evaluate(await fixture([5, 5]), defaults), p = m.players[0];
    p.blendedExpected = -5; expect(calculateMppg(m, p).value).toBe(0);
  });
  it("bye week returns null with 'Bye week', and never 0", async () => {
    const m = evaluate(await fixture([20, 20]), defaults), p = m.players[0]; p.bye = m.current;
    expect(calculateMppg(m, p)).toMatchObject({ value: null, reason: "Bye week" });
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
    expect(calculateMppg(m, p)).toMatchObject({ value: null, source: "unavailable", reason: "No Expected PPG" });
  });
  it("a future week returns null", async () => {
    const m = evaluate(await fixture([20, 20]), defaults);
    expect(calculateMppg(m, m.players[0], m.current + 1)).toMatchObject({ value: null, source: "unavailable" });
  });
});
