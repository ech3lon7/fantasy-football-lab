import { describe, it, expect } from "vitest";
import { fixture } from "./fixtures";
import { evaluate } from "../src/domain/valuation";
import { defaults } from "../src/domain/contracts";
import { calculateMppg, MPPG_EDGE_WEIGHT } from "../src/domain/mppg";

describe("MPPG formula (1.1)", () => {
  it("uses named constant MPPG_EDGE_WEIGHT = 0.5", () => {
    expect(MPPG_EDGE_WEIGHT).toBe(0.5);
  });

  it("EPPG equals ESPN season, so MPPG equals ESPN weekly", async () => {
    const d = await fixture([20, 20, 20, 20, 20]);
    // Set player 1: weekly = 15.0, projected = 20.0
    d.tables.ModelPlayers[0].Current_Week_Projection = 15.0;
    d.tables.ModelPlayers[0].ESPN_Projected_PPG = 20.0;
    d.tables.ModelPlayers[0].ESPN_Projected_Games = 16;
    const m = evaluate(d, defaults);
    const p = m.players[0];
    expect(p.blendedExpected).toBeCloseTo(20.0, 1);
    expect(p.projected).toBeCloseTo(20.0, 1);

    const res = calculateMppg(m, p);
    expect(res.value).toBe(15.0);
    expect(res.edge).toBeCloseTo(0, 2);
    expect(res.source).toBe("blend");
  });

  it("EPPG 2 above ESPN season adds +1 to ESPN weekly", async () => {
    const d = await fixture([22, 22, 22, 22, 22]);
    // EPPG will be ~22, projected = 20 -> edge = 0.5 * 2 = 1.0
    d.tables.ModelPlayers[0].Current_Week_Projection = 14.0;
    d.tables.ModelPlayers[0].ESPN_Projected_PPG = 20.0;
    d.tables.ModelPlayers[0].ESPN_Projected_Games = 16;
    // ensure EPPG is 22:
    const m = evaluate(d, defaults);
    const p = m.players[0];
    // if blendedExpected is 22:
    p.blendedExpected = 22.0;
    p.projected = 20.0;
    p.weekly = 14.0;

    const res = calculateMppg(m, p);
    expect(res.edge).toBe(1.0);
    expect(res.value).toBe(15.0);
  });

  it("EPPG 3 below ESPN season subtracts 1.5", async () => {
    const d = await fixture([17, 17, 17, 17, 17]);
    const m = evaluate(d, defaults);
    const p = m.players[0];
    p.blendedExpected = 17.0;
    p.projected = 20.0;
    p.weekly = 15.0;

    const res = calculateMppg(m, p);
    expect(res.edge).toBe(-1.5);
    expect(res.value).toBe(13.5);
    expect(res.buildLine).toContain("− ½ × 3.0");
  });

  it("a large negative edge floors at 0", async () => {
    const d = await fixture([5, 5, 5]);
    const m = evaluate(d, defaults);
    const p = m.players[0];
    p.blendedExpected = 5.0;
    p.projected = 30.0; // edge = 0.5 * (5 - 30) = -12.5
    p.weekly = 5.0; // 5.0 - 12.5 = -7.5 -> floors to 0

    const res = calculateMppg(m, p);
    expect(res.value).toBe(0);
    expect(res.edge).toBe(-12.5);
  });

  it("bye week returns null with 'Bye week', and never 0", async () => {
    const d = await fixture([20, 20]);
    const m = evaluate(d, defaults);
    const p = m.players[0];
    p.bye = m.current; // on bye

    const res = calculateMppg(m, p);
    expect(res.value).toBeNull();
    expect(res.reason).toBe("Bye week");
  });

  it("OUT status returns null with 'Out'", async () => {
    const d = await fixture([20, 20]);
    const m = evaluate(d, defaults);
    const p = m.players[0];
    p.injury = "OUT";
    p.out = true;

    const res = calculateMppg(m, p);
    expect(res.value).toBeNull();
    expect(res.reason).toBe("Out");
  });

  it("missing ESPN weekly returns null with 'No ESPN weekly projection' (and not EPPG)", async () => {
    const d = await fixture([20, 20]);
    const m = evaluate(d, defaults);
    const p = m.players[0];
    p.blendedExpected = 20.0;
    p.weekly = null;

    const res = calculateMppg(m, p);
    expect(res.value).toBeNull();
    expect(res.reason).toBe("No ESPN weekly projection");
  });

  it("null EPPG returns ESPN weekly with source 'espn-only'", async () => {
    const d = await fixture([20, 20]);
    const m = evaluate(d, defaults);
    const p = m.players[0];
    p.blendedExpected = null;
    p.weekly = 16.5;

    const res = calculateMppg(m, p);
    expect(res.value).toBe(16.5);
    expect(res.source).toBe("espn-only");
    expect(res.edge).toBeNull();
  });

  it("a future week returns null", async () => {
    const d = await fixture([20, 20]);
    const m = evaluate(d, defaults);
    const p = m.players[0];
    p.weekly = 16.5;

    const res = calculateMppg(m, p, m.current + 1);
    expect(res.value).toBeNull();
    expect(res.source).toBe("unavailable");
  });
});
