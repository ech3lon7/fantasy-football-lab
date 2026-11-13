import { describe, expect, it } from "vitest";
import {
  entranceCues,
  paparazziFlashes,
  shutterClicks,
  vibrationFor,
} from "../src/ui/feel/entrances";

describe("card entrance cues", () => {
  it("superstar: nine flashes between 0.05 s and 1.45 s, each with a click at the same moment", () => {
    expect(paparazziFlashes).toHaveLength(9);
    for (const f of paparazziFlashes) {
      expect(f.delayS).toBeGreaterThanOrEqual(0.05);
      expect(f.delayS).toBeLessThanOrEqual(1.45);
    }
    expect(entranceCues.superstar.at).toEqual(
      paparazziFlashes.map((f) => Math.round(f.delayS * 1000)),
    );
  });

  it("every localised flash covers well under a quarter of a 1040 x 330 card", () => {
    // The flash is a circle of this diameter; its area against the card's.
    for (const f of paparazziFlashes)
      expect((Math.PI * (f.size / 2) ** 2) / (1040 * 330)).toBeLessThan(0.25);
  });

  it("the shutter is two short clicks 45 ms apart, the second quieter", () => {
    expect(shutterClicks).toHaveLength(2);
    expect(shutterClicks[1].offsetMs - shutterClicks[0].offsetMs).toBe(45);
    expect(shutterClicks[1].gain).toBeLessThan(shutterClicks[0].gain);
  });

  it("star: one rising chime from 1.4 to 2.8 kHz over 0.4 s at 0.25 s", () => {
    expect(entranceCues.star.at).toEqual([250]);
    expect(entranceCues.star.tone).toEqual({
      fromHz: 1400,
      toHz: 2800,
      ms: 400,
    });
  });

  it("good: one very quiet ping at 2.1 kHz for 0.14 s", () => {
    expect(entranceCues.good.at).toEqual([300]);
    expect(entranceCues.good.tone).toEqual({
      fromHz: 2093,
      toHz: 2093,
      ms: 140,
    });
  });

  it("haptics: 8 ms per flash, one 12 ms pulse for a star, none for good", () => {
    expect(vibrationFor("superstar")).toBe(8);
    expect(vibrationFor("star")).toBe(12);
    expect(vibrationFor("good")).toBe(0);
  });
});
