import { cmpId } from "../contracts";
import { lineup, roster, rosterExcess, weeklyLineup } from "../lineups";
import type { ScenarioMove } from "../roster-scenarios";
import type { Model, Player } from "../valuation";
import { lineupGainSpread, type GainSpread } from "./trade-room";
import { calculateMppg } from "../mppg";

export interface AddDropPair {
  addId: string;
  addName: string;
  addPos: string;
  dropId: string;
  dropName: string;
  dropPos: string;
  // Lineup gain in Expected PPG per remaining week, with its combined spread, floor and ceiling.
  gain: GainSpread;
  // "starts" when the pickup enters the modeled lineup in some week; otherwise depth only.
  starts: "starts" | "depth";
  // The lineup slot the pickup first fills, such as FLEX; null for depth only.
  startsAt: string | null;
  // How many remaining weeks the pickup starts.
  startWeeks: number;
}

const expectedLineup = (m: Model, ids: string[], week: number) =>
  lineup(m, ids, week, false, false, "expected");

// For each available player, the roster player to drop that helps the lineup most, using the existing drop rules:
// only droppable players, a legal roster afterwards, and ties broken by the lower surplus index and then the player id.
export function addDropPairs(
  m: Model,
  team: string,
  limit = 10,
  candidates = 25,
  scope: "season" | "week" = "season",
): AddDropPair[] {
  const ids = roster(m, team);

  // 3.6 If scope is "week", rank pairs by the weekly lineup's MPPG gain this week
  if (scope === "week") {
    const baseWeekly = weeklyLineup(m, team);
    const pool = m.players
      .filter((p) => p.owner === "0" && !p.out && calculateMppg(m, p).value !== null)
      .sort((a, b) => (calculateMppg(m, b).value ?? 0) - (calculateMppg(m, a).value ?? 0) || cmpId(a.id, b.id))
      .slice(0, candidates);

    const drops = ids
      .map((id) => m.byId.get(id))
      .filter((p): p is Player => !!p && p.droppable);

    const pairs: AddDropPair[] = [];
    for (const add of pool) {
      let best: { drop: Player; gain: number; starts: boolean } | undefined;
      for (const drop of drops) {
        const nextIds = [...ids.filter((id) => id !== drop.id), add.id];
        if (rosterExcess(m, nextIds) > 0) continue;

        // Counterfactual weekly lineup
        // Create an overlay model mapping
        const overlayModel: Model = {
          ...m,
          players: m.players.map((p) => {
            if (p.id === add.id) return { ...p, owner: team };
            if (p.id === drop.id) return { ...p, owner: "0" };
            return p;
          }),
        };
        const nextWeekly = weeklyLineup(overlayModel, team);
        const gain = Math.round((nextWeekly.totalMppg - baseWeekly.totalMppg) * 10) / 10;
        const starts = nextWeekly.starterIds.includes(add.id);

        const better =
          !best ||
          gain > best.gain + 1e-9 ||
          (Math.abs(gain - best.gain) <= 1e-9 &&
            ((drop.index ?? 0) < (best.drop.index ?? 0) ||
              ((drop.index ?? 0) === (best.drop.index ?? 0) &&
                cmpId(drop.id, best.drop.id) < 0)));
        if (better) best = { drop, gain, starts };
      }

      if (!best || best.gain < -1e-9) continue;
      const mppgAdd = calculateMppg(m, add);
      const spread = mppgAdd.spread ?? 3.5;
      pairs.push({
        addId: add.id,
        addName: add.name,
        addPos: add.pos,
        dropId: best.drop.id,
        dropName: best.drop.name,
        dropPos: best.drop.pos,
        gain: {
          gain: best.gain,
          spread,
          floor: best.gain - spread,
          ceiling: best.gain + spread,
          players: [add.name, best.drop.name],
          sharesNflTeam: Boolean(add.nfl && add.nfl === best.drop.nfl),
          reason: `MPPG gain for week ${m.current}`,
        },
        starts: best.starts ? "starts" : "depth",
        startsAt: best.starts ? "FLEX" : null,
        startWeeks: best.starts ? 1 : 0,
      });
    }

    return pairs
      .sort(
        (a, b) =>
          Number(b.starts === "starts") - Number(a.starts === "starts") ||
          (b.gain.gain ?? -Infinity) - (a.gain.gain ?? -Infinity) ||
          cmpId(a.addId, b.addId),
      )
      .slice(0, limit);
  }

  const base = m.weeks.map((w) => expectedLineup(m, ids, w));
  const pool = m.players
    .filter(
      (p) =>
        p.owner === "0" &&
        p.blendedExpected !== null &&
        p.value !== null &&
        !p.out,
    )
    .sort(
      (a, b) => b.blendedExpected! - a.blendedExpected! || cmpId(a.id, b.id),
    )
    .slice(0, candidates);
  const drops = ids
    .map((id) => m.byId.get(id))
    .filter((p): p is Player => !!p && p.droppable);
  const pairs: AddDropPair[] = [];
  for (const add of pool) {
    let best:
      | { drop: Player; total: number; after: ReturnType<typeof lineup>[] }
      | undefined;
    for (const drop of drops) {
      const next = [...ids.filter((id) => id !== drop.id), add.id];
      // A swap keeps the roster size, but position limits must still hold.
      if (rosterExcess(m, next) > 0) continue;
      const after = m.weeks.map((w) => expectedLineup(m, next, w));
      const total = after.reduce(
        (sum, l, i) => sum + (l.expected - base[i].expected),
        0,
      );
      const better =
        !best ||
        total > best.total + 1e-9 ||
        (Math.abs(total - best.total) <= 1e-9 &&
          ((drop.index ?? 0) < (best.drop.index ?? 0) ||
            ((drop.index ?? 0) === (best.drop.index ?? 0) &&
              cmpId(drop.id, best.drop.id) < 0)));
      if (better) best = { drop, total, after };
    }
    // A pickup whose best drop still costs lineup points is not a pair worth showing.
    if (!best || best.total < -1e-9) continue;
    const startWeeks = best.after.filter((l) => l.ids.includes(add.id)).length;
    const first = best.after.find((l) => l.ids.includes(add.id));
    const perWeek = m.weeks.length ? best.total / m.weeks.length : null;
    const side = {
      weekly: best.after.map((l, i) => ({
        slots: l.slots,
        beforeIds: base[i].ids,
        ids: l.ids,
      })),
    };
    pairs.push({
      addId: add.id,
      addName: add.name,
      addPos: add.pos,
      dropId: best.drop.id,
      dropName: best.drop.name,
      dropPos: best.drop.pos,
      gain: lineupGainSpread(m, side, perWeek),
      starts: startWeeks > 0 ? "starts" : "depth",
      startsAt: first ? first.slots[first.ids.indexOf(add.id)] : null,
      startWeeks,
    });
  }
  // Pickups that start come first by gain; depth-only pickups follow by Expected PPG.
  return pairs
    .sort(
      (a, b) =>
        Number(b.starts === "starts") - Number(a.starts === "starts") ||
        (b.gain.gain ?? -Infinity) - (a.gain.gain ?? -Infinity) ||
        cmpId(a.addId, b.addId),
    )
    .slice(0, limit);
}

// The two moves that apply a pair to a hypothetical roster: cut the drop, then add the pickup.
export function pairMoves(team: string, pair: AddDropPair): ScenarioMove[] {
  return [
    { kind: "move", player: pair.dropId, from: team, to: "0" },
    { kind: "move", player: pair.addId, from: "0", to: team },
  ];
}
