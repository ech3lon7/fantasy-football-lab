import { type Model } from "./valuation";
import {
  available,
  irAssignments,
  rosterExcess,
} from "./lineups";
import { cmpId, num } from "./contracts";

export interface FastLineups {
  total: (team: string, ids: string[]) => number;
  weekly: (team: string, ids: string[]) => (string | null)[][];
  legal: (ids: string[]) => {
    ids: string[];
    drops: string[];
    excess: number;
  };
  clear: () => void;
}

export function createFastLineups(m: Model): FastLineups {
  const ctx = m.dataset.tables.ModelContext[0];
  const qbCount = num(ctx.QBSlots);
  const rbCount = num(ctx.RBSlots);
  const wrCount = num(ctx.WRSlots);
  const teCount = num(ctx.TESlots);
  const flexCount = num(ctx.FlexSlots);
  const kCount = num(ctx.KSlots);
  const dstCount = num(ctx.DSTSlots);

  const slotPlan: [string, number][] = [
    ["QB", qbCount],
    ["RB", rbCount],
    ["WR", wrCount],
    ["TE", teCount],
    ["FLEX", flexCount],
    ["K", kCount],
    ["D/ST", dstCount],
  ];

  const weeks = m.weeks;
  const numWeeks = weeks.length;
  const curWeekIdx = weeks.indexOf(m.current);

  interface PlayerInfo {
    id: string;
    pos: string;
    expected: number;
    value: number;
    availMask: number;
    droppable: boolean;
    index: number;
  }

  const playerMap = new Map<string, PlayerInfo>();
  for (const p of m.players) {
    let mask = 0;
    if (p.value !== null) {
      for (let i = 0; i < numWeeks; i++) {
        if (available(m, p, weeks[i], false)) {
          mask |= 1 << i;
        }
      }
    }
    playerMap.set(p.id, {
      id: p.id,
      pos: p.pos,
      expected: p.expected ?? 0,
      value: p.value ?? 0,
      availMask: mask,
      droppable: !!p.droppable,
      index: p.index ?? Infinity,
    });
  }

  const totalMemo = new Map<string, number>();
  const weeklyMemo = new Map<string, (string | null)[][]>();
  const valueScoreMemo = new Map<string, number>();
  const legalMemo = new Map<
    string,
    { dropped: Set<string>; excess: number }
  >();

  function scoreExpected(ids: string[]): number {
    const ir = new Set(irAssignments(m, ids));
    const bag: PlayerInfo[] = [];
    for (const id of ids) {
      const p = playerMap.get(id);
      if (p && m.byId.get(id)?.value !== null) {
        bag.push(p);
      }
    }
    bag.sort(
      (a, b) => b.expected - a.expected || cmpId(a.id, b.id),
    );

    let total = 0;
    for (let wi = 0; wi < numWeeks; wi++) {
      const bit = 1 << wi;
      const isCur = wi === curWeekIdx;
      const used = new Set<string>();

      for (let s = 0; s < slotPlan.length; s++) {
        const pos = slotPlan[s][0];
        const count = slotPlan[s][1];
        let filled = 0;

        for (let j = 0; j < bag.length; j++) {
          if (filled >= count) break;
          const p = bag[j];
          if (used.has(p.id)) continue;
          if (!(p.availMask & bit)) continue;
          if (isCur && ir.has(p.id)) continue;
          if (
            pos === "FLEX"
              ? p.pos !== "RB" && p.pos !== "WR" && p.pos !== "TE"
              : p.pos !== pos
          )
            continue;

          used.add(p.id);
          total += p.expected;
          filled++;
        }
      }
    }
    return total;
  }

  function getWeeklyExpected(ids: string[]): (string | null)[][] {
    const ir = new Set(irAssignments(m, ids));
    const bag: PlayerInfo[] = [];
    for (const id of ids) {
      const p = playerMap.get(id);
      if (p && m.byId.get(id)?.value !== null) {
        bag.push(p);
      }
    }
    bag.sort(
      (a, b) => b.expected - a.expected || cmpId(a.id, b.id),
    );

    const weeklyLineups: (string | null)[][] = [];

    for (let wi = 0; wi < numWeeks; wi++) {
      const bit = 1 << wi;
      const isCur = wi === curWeekIdx;
      const used = new Set<string>();
      const lineupIds: (string | null)[] = [];

      for (let s = 0; s < slotPlan.length; s++) {
        const pos = slotPlan[s][0];
        const count = slotPlan[s][1];
        let filled = 0;

        for (let j = 0; j < bag.length; j++) {
          if (filled >= count) break;
          const p = bag[j];
          if (used.has(p.id)) continue;
          if (!(p.availMask & bit)) continue;
          if (isCur && ir.has(p.id)) continue;
          if (
            pos === "FLEX"
              ? p.pos !== "RB" && p.pos !== "WR" && p.pos !== "TE"
              : p.pos !== pos
          )
            continue;

          used.add(p.id);
          lineupIds.push(p.id);
          filled++;
        }
        while (filled < count) {
          lineupIds.push(null);
          filled++;
        }
      }
      weeklyLineups.push(lineupIds);
    }
    return weeklyLineups;
  }

  function fastValueRosterScore(ids: string[]): number {
    const key = [...ids].sort(cmpId).join(",");
    const cached = valueScoreMemo.get(key);
    if (cached !== undefined) return cached;

    const ir = new Set(irAssignments(m, ids));
    const bag: PlayerInfo[] = [];
    for (const id of ids) {
      const p = playerMap.get(id);
      if (p && m.byId.get(id)?.value !== null) {
        bag.push(p);
      }
    }
    bag.sort(
      (a, b) => b.value - a.value || cmpId(a.id, b.id),
    );

    let total = 0;
    for (let wi = 0; wi < numWeeks; wi++) {
      const bit = 1 << wi;
      const isCur = wi === curWeekIdx;
      const used = new Set<string>();

      for (let s = 0; s < slotPlan.length; s++) {
        const pos = slotPlan[s][0];
        const count = slotPlan[s][1];
        let filled = 0;

        for (let j = 0; j < bag.length; j++) {
          if (filled >= count) break;
          const p = bag[j];
          if (used.has(p.id)) continue;
          if (!(p.availMask & bit)) continue;
          if (isCur && ir.has(p.id)) continue;
          if (
            pos === "FLEX"
              ? p.pos !== "RB" && p.pos !== "WR" && p.pos !== "TE"
              : p.pos !== pos
          )
            continue;

          used.add(p.id);
          total += p.value;
          filled++;
        }
      }
    }
    valueScoreMemo.set(key, total);
    return total;
  }

  function legal(ids: string[]) {
    const key = [...ids].sort(cmpId).join(",");
    let cached = legalMemo.get(key);
    if (!cached) {
      let bag = [...ids];
      for (let step = 0; step < 5 && rosterExcess(m, bag) > 0; step++) {
        const excess = rosterExcess(m, bag);
        const base = fastValueRosterScore(bag);
        const candidates = bag
          .filter(
            (id) =>
              playerMap.get(id)?.droppable &&
              rosterExcess(
                m,
                bag.filter((x) => x !== id),
              ) < excess,
          )
          .map((id) => ({
            id,
            loss: base - fastValueRosterScore(bag.filter((x) => x !== id)),
          }))
          .sort(
            (a, b) =>
              a.loss - b.loss ||
              (playerMap.get(a.id)?.index ?? Infinity) -
                (playerMap.get(b.id)?.index ?? Infinity) ||
              cmpId(a.id, b.id),
          );

        if (!candidates.length) break;
        const id = candidates[0].id;
        bag = bag.filter((x) => x !== id);
      }

      const dropped = new Set(ids.filter((id) => !bag.includes(id)));
      cached = { dropped, excess: rosterExcess(m, bag) };
      legalMemo.set(key, cached);
    }

    return {
      ids: ids.filter((id) => !cached!.dropped.has(id)),
      drops: ids.filter((id) => cached!.dropped.has(id)),
      excess: cached.excess,
    };
  }

  function total(_team: string, ids: string[]): number {
    const key = [...ids].sort(cmpId).join(",");
    let val = totalMemo.get(key);
    if (val === undefined) {
      val = scoreExpected(ids);
      totalMemo.set(key, val);
    }
    return val;
  }

  function weekly(_team: string, ids: string[]): (string | null)[][] {
    const key = [...ids].sort(cmpId).join(",");
    let val = weeklyMemo.get(key);
    if (!val) {
      val = getWeeklyExpected(ids);
      weeklyMemo.set(key, val);
    }
    return val;
  }

  function clear() {
    totalMemo.clear();
    weeklyMemo.clear();
    valueScoreMemo.clear();
    legalMemo.clear();
  }

  return {
    total,
    weekly,
    legal,
    clear,
  };
}
