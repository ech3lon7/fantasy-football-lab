import { describe, expect, it } from "vitest";
import { evaluate } from "../src/domain/valuation";
import { nextRefreshDefaults } from "../src/domain/next-refresh";
import { playerCard } from "../src/domain/view/player-card";
import { readableInk, teamColors } from "../src/domain/view/nfl-colors";
import { labelTone } from "../src/domain/view/labels";
import { fixture } from "./fixtures";

// Build a model from the synthetic fixture with a known scoring pattern.
async function model(scores = [12, 18, 24]) {
  const d = await fixture(scores);
  return evaluate(d, d.settings);
}

describe("player card header", () => {
  it("uses the same floor, ceiling and spread as the next-refresh scenarios", async () => {
    const m = await model();
    const p = m.byId.get("1")!;
    const card = playerCard(m, "1")!;
    const defaults = nextRefreshDefaults(m, p);
    expect(card.header.floor).toBe(defaults.lower!.toFixed(1));
    expect(card.header.ceiling).toBe(defaults.higher!.toFixed(1));
    expect(card.header.spread).toBe(defaults.spread!.toFixed(1));
    expect(card.header.eppg).toBe(p.blendedExpected!.toFixed(1));
    expect(card.header.rangeReason).toBe("");
  });
  it("returns null for a player that is not in the snapshot", async () => {
    expect(playerCard(await model(), "no-such-player")).toBeNull();
  });
  it("shows no range and explains why when EPPG or variability is missing", async () => {
    const m = await model([]);
    const card = playerCard(m, "1")!;
    expect(card.header.floor).toBeNull();
    expect(card.header.ceiling).toBeNull();
    expect(card.header.rangeReason).not.toBe("");
  });
});

describe("numbers and null handling", () => {
  it("never lists a missing value as zero and gives every missing value a reason", async () => {
    const m = await model([]);
    const card = playerCard(m, "1")!;
    const shown = card.numbers.groups.flatMap((g) => g.items);
    for (const x of shown) expect(x.display).not.toBeNull();
    for (const x of card.numbers.unavailable) {
      expect(x.value).toBeNull();
      expect(x.display).toBeNull();
      expect(x.reason).not.toBe("");
    }
    // Games played is a real zero here and must stay a number, not move to the unavailable list.
    expect(shown.find((x) => x.label === "Games played")?.display).toBe("0");
    expect(
      card.numbers.unavailable.find((x) => x.label === "Actual season PPG"),
    ).toBeDefined();
  });
  it("groups available values by provenance", async () => {
    const card = playerCard(await model(), "1")!;
    expect(card.numbers.groups.map((g) => g.provenance)).toEqual([
      "fact",
      "espn",
      "model",
    ]);
    const actual = card.numbers.groups[0].items.find(
      (x) => x.label === "Actual season PPG",
    );
    expect(actual?.display).toBe("18.00");
  });
});

describe("radar and calculation", () => {
  it("places the position average at 0.5 and leaves gaps for missing inputs", async () => {
    const card = playerCard(await model(), "1")!;
    for (const axis of card.radar) {
      expect(axis.scaledAverage).toBe(0.5);
      if (axis.value === null || axis.average === null)
        expect(axis.scaled).toBeNull();
      else if (axis.scaled !== null) {
        expect(axis.scaled).toBeGreaterThanOrEqual(0);
        expect(axis.scaled).toBeLessThanOrEqual(1);
      }
    }
    // The fixture has no workload data, so those axes are gaps rather than zeros.
    expect(card.radar.find((a) => a.key === "workload")?.scaled).toBeNull();
  });
  it("lists the calculation steps in model order with unavailable steps shown as null", async () => {
    const card = playerCard(await model(), "1")!;
    expect(card.calculation.map((s) => s.label).slice(0, 3)).toEqual([
      "Actual PPG",
      "Recent PPG",
      "Observed PPG",
    ]);
    const empty = playerCard(await model([]), "1")!;
    expect(
      empty.calculation.find((s) => s.label === "Actual PPG")?.display,
    ).toBeNull();
  });
});

describe("label tones", () => {
  it("marks the four caution labels amber and every other label positive", () => {
    for (const label of ["Reduced workload", "BUY LOW", "SELL HIGH", "TD caution"])
      expect(labelTone(label)).toBe("warning");
    for (const label of ["Gem", "Pre-gem", "Watch", "Role-growth watch"])
      expect(labelTone(label)).toBe("positive");
  });
  it("keeps status chips distinguished from labels", () => {
    expect(labelTone("Active")).toBe("positive");
  });
});

describe("team colours", () => {
  it("returns a readable text colour and a neutral fallback for unknown teams", () => {
    expect(teamColors("KC").background).toBe("#e31837");
    expect(teamColors("WAS")).toEqual(teamColors("WSH"));
    expect(teamColors("???").background).toBe("#4a5060");
    expect(readableInk("#ffb612")).toBe("#14171f");
    expect(readableInk("#241773")).toBe("#ffffff");
  });
});
