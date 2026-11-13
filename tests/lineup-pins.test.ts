import { describe, expect, it } from "vitest";
import {
  clearPins,
  pinsFor,
  readLineupPins,
  setPin,
} from "../src/domain/lineup-pins";

describe("lineup pins store", () => {
  it("round-trips pins per team and week", () => {
    let raw = setPin(undefined, "1", 10, "7", true);
    raw = setPin(raw, "1", 10, "10", true);
    raw = setPin(raw, "2", 10, "3", true);
    expect(pinsFor(raw, "1", 10)).toEqual(["7", "10"]);
    expect(pinsFor(raw, "2", 10)).toEqual(["3"]);
    expect(pinsFor(raw, "1", 11)).toEqual([]);
    raw = setPin(raw, "1", 10, "7", false);
    expect(pinsFor(raw, "1", 10)).toEqual(["10"]);
    expect(pinsFor(raw, "2", 10)).toEqual(["3"]);
  });

  it("clears only the requested team", () => {
    let raw = setPin(undefined, "1", 10, "7", true);
    raw = setPin(raw, "2", 10, "3", true);
    raw = clearPins(raw, "1");
    expect(pinsFor(raw, "1", 10)).toEqual([]);
    expect(pinsFor(raw, "2", 10)).toEqual(["3"]);
    raw = clearPins(raw, "2");
    expect(raw).toBe("");
    expect(readLineupPins(raw)).toEqual({});
  });

  it("treats an older week's entry as empty and never merges it into the new week", () => {
    const stale = setPin(undefined, "1", 9, "7", true);
    expect(pinsFor(stale, "1", 10)).toEqual([]);
    expect(pinsFor(stale, "1", 9)).toEqual(["7"]);
    const fresh = setPin(stale, "1", 10, "10", true);
    expect(pinsFor(fresh, "1", 10)).toEqual(["10"]);
    expect(pinsFor(fresh, "1", 9)).toEqual([]);
  });

  it("returns no pins for missing or malformed data instead of crashing", () => {
    expect(readLineupPins(undefined)).toEqual({});
    expect(readLineupPins("")).toEqual({});
    expect(readLineupPins("{not json")).toEqual({});
    expect(readLineupPins('{"1":{"week":"ten","ids":["7"]}}')).toEqual({});
    expect(readLineupPins('{"1":{"week":10,"ids":["7"],"extra":true}}')).toEqual(
      {},
    );
    expect(pinsFor('{"1":{"week":10,"ids":["7"]}}', "1", 10)).toEqual(["7"]);
    // A malformed store is replaced rather than merged.
    expect(
      pinsFor(setPin("{not json", "1", 10, "7", true), "1", 10),
    ).toEqual(["7"]);
  });
});
