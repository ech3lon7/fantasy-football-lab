import { describe, expect, it, vi } from "vitest";
import { evaluate } from "../src/domain/valuation";
import { readStarterLineup, starterTemplate } from "../src/domain/starter-lineups";
import {
  optimizeLineup,
  moveFormationPlayer,
  pinBlocker,
  type FormationSlot,
} from "../src/domain/lineup-optimizer";
import { formationFixture } from "./fixtures";
import * as mppg from "../src/domain/mppg";

const round = (value: number) => Math.round(value * 10) / 10;

// The ESPN lineup as the formation reads it: a fixed slot template with the imported starters.
async function setup(options: { byeStarter?: boolean; optimal?: boolean } = {}) {
  const d = await formationFixture(options);
  const m = evaluate(d, d.settings);
  const team = "1";
  const selection = readStarterLineup(m, team);
  const template = starterTemplate(m, selection.ids, selection.assignments);
  const current: FormationSlot[] = template.slots.map((slot, index) => ({
    slot: slot as FormationSlot["slot"],
    index,
    playerId: template.ids[index] ?? null,
  }));
  return { m, team, current };
}

// Manual moves keep the selected slot, swap only legal starters and reject invalid positions.
describe("manual formation moves", () => {
  it("starts a backup in FLEX without moving other starters", async () => {
    const { m, team, current } = await setup();
    const flex = current.find((slot) => slot.slot === "FLEX")!;
    const moved = moveFormationPlayer(m, team, current, "10", flex.index);
    expect(moved.find((slot) => slot.index === flex.index)?.playerId).toBe("10");
    expect(moved.filter((slot) => slot.index !== flex.index)).toEqual(current.filter((slot) => slot.index !== flex.index));
    expect(() => moveFormationPlayer(m, team, current, "10", 0)).toThrow(/not eligible/);
  });
});

describe("optimizer: maximum-MPPG lineup", () => {
  it("starts a bench RB over the starting FLEX WR and only that slot moves", async () => {
    const { m, team, current } = await setup();
    const result = optimizeLineup(m, team, { current, pins: [] });
    expect(result.changes).toHaveLength(1);
    const change = result.changes[0];
    expect(change).toMatchObject({
      slot: "FLEX",
      inId: "10",
      outId: "7",
      gain: 1.9,
      pinned: false,
    });
    expect(
      result.slots.find((slot) => slot.slot === "FLEX")?.playerId,
    ).toBe("10");
    expect(result.currentTotal).toBe(107.8);
    expect(result.optimizedTotal).toBe(109.7);
    expect(result.gain).toBe(1.9);
    expect(result.pinCost).toBeNull();
  });
});

describe("optimizer: slot stability", () => {
  it("keeps a retained FLEX starter in FLEX when pins cause another change", async () => {
    const { m, team, current } = await setup();
    const first = optimizeLineup(m, team, { current, pins: [] });
    const result = optimizeLineup(m, team, { current: first.slots, pins: ["10", "11"] });
    expect(result.slots.find((entry) => entry.slot === "FLEX")?.playerId).toBe("10");
  });
  it("describes each replacement against the player leaving that slot", async () => {
    const { m, team, current } = await setup();
    const changed = current.map((entry) => ({
      ...entry,
      playerId: entry.playerId === "1" ? "15" : entry.playerId === "3" ? "13" : entry.playerId,
    }));
    const result = optimizeLineup(m, team, { current: changed, pins: [] });
    expect(result.changes.find((entry) => entry.inId === "1")?.outId).toBe("15");
    expect(result.changes.find((entry) => entry.inId === "3")?.outId).toBe("13");
  });
  it("keeps unchanged starters in their indices and treats a same-position swap as no change", async () => {
    const { m, team, current } = await setup();
    const fixed = optimizeLineup(m, team, { current, pins: [] });
    expect(
      fixed.slots.find((slot) => slot.slot === "QB")?.playerId,
    ).toBe("1");
    // Swap the two starting RBs: the players are the same, so nothing is a change.
    const swapped = current.map((slot) =>
      slot.slot === "RB"
        ? { ...slot, playerId: slot.playerId === "2" ? "3" : "2" }
        : slot,
    );
    const result = optimizeLineup(m, team, {
      current: swapped,
      pins: [],
    });
    // The RB swap alone changes nothing: the only change is the same FLEX upgrade as before.
    expect(result.changes).toEqual(fixed.changes);
    expect(result.changes.map((c) => c.slot)).toEqual(["FLEX"]);
    expect(result.gain).toBe(1.9);
    expect(
      result.slots
        .filter((slot) => slot.slot === "RB")
        .map((slot) => slot.playerId),
    ).toEqual(
      swapped.filter((slot) => slot.slot === "RB").map((slot) => slot.playerId),
    );
  });
});

describe("optimizer: availability", () => {
  it("replaces a bye starter with the best eligible cover", async () => {
    const { m, team, current } = await setup({ byeStarter: true });
    const result = optimizeLineup(m, team, { current, pins: [] });
    expect(
      result.slots.find((slot) => slot.slot === "TE")?.playerId,
    ).toBe("14");
    expect(result.changes).toHaveLength(2);
    expect(result.changes.map((c) => c.outId)).toContain("6");
  });

  it("returns zero changes when the lineup is already the highest-MPPG lineup", async () => {
    const { m, team, current } = await setup({ optimal: true });
    const result = optimizeLineup(m, team, { current, pins: [] });
    expect(result.changes).toEqual([]);
    expect(result.gain).toBe(0);
    expect(result.optimizedTotal).toBe(result.currentTotal);
  });
});

describe("optimizer: pins", () => {
  it("starts a pinned bench WR and matches the best lineup that contains him", async () => {
    const { m, team, current } = await setup();
    const result = optimizeLineup(m, team, { current, pins: ["11"] });
    expect(
      result.slots.find((slot) => slot.slot === "WR" && slot.playerId === "11"),
    ).toBeTruthy();
    // Okafor + Osei at WR, Dunn at FLEX; Andrade and Brannigan sit out.
    expect(result.optimizedTotal).toBe(105.9);
    expect(result.changes.map((c) => c.inId)).toContain("11");
  });

  it("prices pins as the rounded unpinned best minus the rounded pinned best", async () => {
    const { m, team, current } = await setup();
    const result = optimizeLineup(m, team, { current, pins: ["11"] });
    const unpinned = optimizeLineup(m, team, { current, pins: [] });
    expect(result.pinCost).toBe(round(unpinned.optimizedTotal - result.optimizedTotal));
    expect(result.pinCost).toBe(3.8);
  });

  it("reports conflicting pins and leaves the lineup unchanged", async () => {
    const { m, team, current } = await setup();
    const result = optimizeLineup(m, team, {
      current,
      pins: ["1", "15", "21"],
    });
    expect(result.conflicts).toHaveLength(2);
    for (const id of result.conflicts) expect(["1", "15", "21"]).toContain(id);
    expect(result.changes).toEqual([]);
    expect(result.gain).toBe(0);
    expect(result.slots.map((slot) => slot.playerId)).toEqual(
      current.map((slot) => slot.playerId),
    );
  });

  it("refuses pins for bye, out and IR players with a reason", async () => {
    const { m, team } = await setup();
    expect(pinBlocker(m, team, "18")).toBe("Bye week");
    expect(pinBlocker(m, team, "19")).toBe("Out");
    expect(pinBlocker(m, team, "20")).toBe("IR");
    expect(pinBlocker(m, team, "999")).toBe("Not on this team");
    expect(pinBlocker(m, team, "1")).toBeNull();
    const result = optimizeLineup(m, team, {
      current: [],
      pins: ["18", "19", "20"],
    });
    expect(result.unpinnable).toEqual([
      { id: "18", reason: "Bye week" },
      { id: "19", reason: "Out" },
      { id: "20", reason: "IR" },
    ]);
  });
});

describe("optimizer: rounding", () => {
  it("subtracts rounded lineup totals rather than rounding each change", async () => {
    const { m, current } = await setup();
    // MPPG currently rounds to tenths upstream; controlled fractional values exercise the optimizer's separate rounding contract.
    const calculate = mppg.calculateMppg;
    const stub = vi.spyOn(mppg, "calculateMppg").mockImplementation((model, player, week) => {
      const result = calculate(model, player, week);
      return { ...result, value: player.id === "7" ? 9.34 : player.id === "10" ? 11.26 : result.value };
    });
    try {
      const result = optimizeLineup(m, "1", { current, pins: [] });
      expect(result.gain).toBe(round(result.optimizedTotal - result.currentTotal));
      expect(result.gain).not.toBe(result.changes[0].gain);
    } finally {
      stub.mockRestore();
    }
  });
  it("shows a gain equal to the rounded new total minus the rounded old total", async () => {
    const { m, team, current } = await setup();
    const result = optimizeLineup(m, team, { current, pins: [] });
    expect(result.currentTotal).toBe(round(result.currentTotal));
    expect(result.optimizedTotal).toBe(round(result.optimizedTotal));
    expect(result.gain).toBe(round(result.optimizedTotal - result.currentTotal));
    expect(result.gain).toBe(1.9);
  });
});
