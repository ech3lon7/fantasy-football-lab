import { describe, expect, it } from "vitest";
import { evaluate, type Model, type Player } from "../src/domain/valuation";
import { addDropPairs, pairMoves } from "../src/domain/view/add-drop";
import { fixture } from "./fixtures";
import {
  applyRosterScenario,
  scenarioRosterBase,
} from "../src/domain/roster-scenarios";

const d = await fixture([12, 18, 24]);
const base = evaluate(d, d.settings);
const team = String(d.tables.ModelTeams[0].TeamID);

// Rebuild the model with some players altered, leaving the originals untouched.
function withPlayers(m: Model, patch: Record<string, Partial<Player>>): Model {
  const players = m.players.map((p) => ({ ...p, ...(patch[p.id] ?? {}) }));
  return { ...m, players, byId: new Map(players.map((p) => [p.id, p])) };
}

describe("add and drop pairs", () => {
  const pairs = addDropPairs(base, team);
  it("pair an available player with one of your droppable players", () => {
    for (const p of pairs) {
      expect(base.byId.get(p.addId)!.owner).toBe("0");
      const drop = base.byId.get(p.dropId)!;
      expect(drop.owner).toBe(team);
      expect(drop.droppable).toBe(true);
    }
  });
  it("lists pickups that start first, then depth-only rows, and a starting pickup always has a positive gain", () => {
    const flags = pairs.map((p) => p.starts === "starts");
    expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
    for (const p of pairs) {
      if (p.starts === "starts") {
        expect(p.startsAt).not.toBeNull();
        expect(p.startWeeks).toBeGreaterThan(0);
      } else {
        expect(p.startsAt).toBeNull();
        expect(p.gain.gain ?? 0).toBeCloseTo(0, 9);
      }
    }
  });
  it("never lists a pair whose best drop costs lineup points", () => {
    for (const p of pairs)
      expect(p.gain.gain ?? 0).toBeGreaterThanOrEqual(-1e-9);
  });
  it("states a range only when the gain and every changed player's spread are known", () => {
    for (const p of pairs) {
      if (p.gain.spread === null) {
        expect(p.gain.floor).toBeNull();
        expect(p.gain.ceiling).toBeNull();
      } else {
        expect(p.gain.floor).toBeCloseTo(p.gain.gain! - p.gain.spread, 9);
      }
    }
  });
  it("does not change the model or the roster", () => {
    const before = JSON.stringify(base.players.map((p) => [p.id, p.owner]));
    addDropPairs(base, team);
    expect(JSON.stringify(base.players.map((p) => [p.id, p.owner]))).toBe(
      before,
    );
  });
});

describe("a clearly better free agent", () => {
  // Make an available running back far better than the one rostered RB.
  const mine = base.players.find((p) => p.owner === team && p.pos === "RB")!;
  const free = base.players.find((p) => p.owner === "0" && p.pos === "RB")!;
  const m = withPlayers(base, {
    [free.id]: { blendedExpected: 40, expected: 40, value: 40 },
    [mine.id]: { blendedExpected: 5, expected: 5, value: 5, droppable: true },
  });
  const [top] = addDropPairs(m, team);
  it("is the top pair, starts, and drops the weaker player for a positive gain", () => {
    expect(top.addId).toBe(free.id);
    expect(top.dropId).toBe(mine.id);
    expect(top.starts).toBe("starts");
    expect(top.gain.gain!).toBeGreaterThan(0);
  });
  it("never drops a player who cannot be dropped", () => {
    const locked = withPlayers(m, { [mine.id]: { droppable: false } });
    for (const p of addDropPairs(locked, team))
      expect(p.dropId).not.toBe(mine.id);
  });
  it("is accepted by the simulator and changes ownership both ways", () => {
    const scenario = {
      id: "s1",
      name: "Pair",
      team,
      season: Number(m.dataset.tables.ModelContext[0].Season),
      sourceHash: m.dataset.hash,
      moves: pairMoves(team, top),
      cursor: 2,
      baseLineups: "",
      baseRoster: scenarioRosterBase(m),
    };
    const applied = applyRosterScenario(m, scenario, undefined);
    expect(applied.simulation?.issues ?? []).toEqual([]);
    expect(applied.byId.get(free.id)!.owner).toBe(team);
    expect(applied.byId.get(mine.id)!.owner).toBe("0");
  });
  it("turns into a cut and an add for the simulator", () => {
    expect(pairMoves(team, top)).toEqual([
      { kind: "move", player: mine.id, from: team, to: "0" },
      { kind: "move", player: free.id, from: "0", to: team },
    ]);
  });
});
