import { type Model, type Player } from "./valuation";
import {
  positions,
  type Position,
  num,
  cmpId,
  sum,
  quantile,
} from "./contracts";
import { calculateMppg, type MppgResult } from "./mppg";
import { playerMatchups } from "./matchups";
import { combineSpreads, normalCdf } from "./view/odds";
const fields = {
  QB: "QBSlots",
  RB: "RBSlots",
  WR: "WRSlots",
  TE: "TESlots",
  K: "KSlots",
  "D/ST": "DSTSlots",
};
const limits = {
  QB: "QBLimit",
  RB: "RBLimit",
  WR: "WRLimit",
  TE: "TELimit",
  K: "KLimit",
  "D/ST": "DSTLimit",
};
export const roster = (m: Model, team: string) =>
  m.players.filter((p) => p.owner === team).map((p) => p.id);
export const capacity = (m: Model) =>
  sum(
    Object.values(fields).map((f) => num(m.dataset.tables.ModelContext[0][f])),
  ) +
  num(m.dataset.tables.ModelContext[0].FlexSlots) +
  num(m.dataset.tables.ModelContext[0].BenchSlots);
const scheduleCache = new WeakMap<Model, Set<string>>();
export const scheduled = (m: Model, p: Player, w: number) => {
  let keys = scheduleCache.get(m);
  if (!keys) {
    keys = new Set(
      m.dataset.tables.ModelSchedule.filter((r) => num(r.HasGame) > 0).map(
        (r) => `${r.ProTeamID}/${r.Week}`,
      ),
    );
    scheduleCache.set(m, keys);
  }
  return keys.has(`${p.nflId}/${w}`);
};
export function irAssignments(m: Model, ids: string[]) {
  const bag = ids.map((id) => m.byId.get(id)).filter((p): p is Player => !!p),
    ctx = m.dataset.tables.ModelContext[0],
    max = num(ctx.IRSlots),
    counts = new Map<string, number>();
  for (const p of bag)
    if (p.owner !== "0") counts.set(p.owner, (counts.get(p.owner) ?? 0) + 1);
  // MODE.SNGL requires at least one repeated owner; imported team rosters satisfy this.
  const owner =
    [...counts]
      .filter(([, c]) => c > 1)
      .sort((a, b) => b[1] - a[1] || cmpId(a[0], b[0]))[0]?.[0] ?? "0";
  const excess = (p: Player) => {
    const lim = num(ctx[limits[p.pos]]);
    return lim > 0
      ? Math.max(0, bag.filter((x) => x.pos === p.pos).length - lim)
      : 0;
  };
  return bag
    .filter(
      (p) =>
        // A temporary OUT designation alone must not place a hypothetical starter on modeled IR.
        (!m.ignoreTemporaryAbsences ||
          p.slot === 21 ||
          ["INJURY_RESERVE", "IR"].includes(p.injury)) &&
        (p.irEligible ||
          (p.slot === 21 &&
            p.owner === owner &&
            ["QUESTIONABLE", "DOUBTFUL"].includes(p.injury))),
    )
    .sort(
      (a, b) =>
        excess(b) - excess(a) ||
        Number(b.slot === 21) - Number(a.slot === 21) ||
        (a.index ?? Infinity) - (b.index ?? Infinity) ||
        cmpId(a.id, b.id),
    )
    .slice(0, max)
    .map((p) => p.id);
}
export function available(m: Model, p: Player, w: number, downside = false) {
  // Hypotheticals include temporary absences, but actual IR slots/statuses stay excluded throughout the horizon.
  if (
    m.ignoreTemporaryAbsences &&
    (p.slot === 21 || ["INJURY_RESERVE", "IR"].includes(p.injury))
  )
    return false;
  const temporary =
    m.ignoreTemporaryAbsences === true && (!p.out || p.injury === "OUT");
  return (
    // A known bye is bypassed; missing schedules and non-temporary restrictions still apply.
    (scheduled(m, p, w) || (m.ignoreByeWeeks === true && p.bye === w)) &&
    !(w === m.current && p.out && !temporary) &&
    // Imported return weeks are explicit conditional scenarios, never inferred missed-game estimates.
    !(
      p.opportunity.returnWeek !== null &&
      w < p.opportunity.returnWeek &&
      !temporary
    ) &&
    !(downside && p.uncertain && !temporary)
  );
}
// Compare both sides of a hypothetical against the same bye-free scoring basis without mutating the live model.
export const withoutByeWeeks = (m: Model): Model =>
  m.ignoreByeWeeks ? m : { ...m, ignoreByeWeeks: true };
// Apply the same roster-potential assumptions to both sides without mutating the live model or its recorded data.
export const forHypotheticalScoring = (m: Model): Model =>
  m.ignoreByeWeeks && m.ignoreTemporaryAbsences
    ? m
    : { ...m, ignoreByeWeeks: true, ignoreTemporaryAbsences: true };
export interface Lineup {
  week: number;
  ids: (string | null)[];
  slots: string[];
  expected: number;
  value: number;
  unfilled: number;
}
export function lineup(
  m: Model,
  ids: string[],
  week: number,
  downside = false,
  healthy = false,
  basis: "value" | "expected" = "value",
): Lineup {
  const ir = new Set(healthy ? [] : irAssignments(m, ids)),
    ctx = m.dataset.tables.ModelContext[0];
  const bag = ids
    .map((id) => m.byId.get(id))
    .filter(
      (p): p is Player =>
        !!p &&
        p.value !== null &&
        (healthy || available(m, p, week, downside)) &&
        (healthy || week !== m.current || !ir.has(p.id)),
    )
    // Direct starter scenarios rank scoring upgrades; legacy modeled lineups retain Value PPG ordering.
    .sort(
      (a, b) =>
        (basis === "expected"
          ? b.expected! - a.expected!
          : b.value! - a.value!) || cmpId(a.id, b.id),
    );
  const used = new Set<string>(),
    result: (string | null)[] = [],
    slots: string[] = [];
  function pick(pos: string, count: number) {
    const eligible = bag.filter(
      (p) =>
        !used.has(p.id) &&
        (pos === "FLEX" ? ["RB", "WR", "TE"].includes(p.pos) : p.pos === pos),
    );
    for (let i = 0; i < count; i++) {
      const p = eligible[i];
      result.push(p?.id ?? null);
      slots.push(pos);
      if (p) used.add(p.id);
    }
  }
  for (const pos of ["QB", "RB", "WR", "TE"] as const)
    pick(pos, num(ctx[fields[pos]]));
  pick("FLEX", num(ctx.FlexSlots));
  pick("K", num(ctx.KSlots));
  pick("D/ST", num(ctx.DSTSlots));
  return {
    week,
    ids: result,
    slots,
    expected: sum(
      result.map((id) => (id ? (m.byId.get(id)?.expected ?? 0) : 0)),
    ),
    value: sum(result.map((id) => (id ? (m.byId.get(id)?.value ?? 0) : 0))),
    unfilled: result.filter((x) => !x).length,
  };
}
export const horizon = (m: Model, ids: string[], downside = false) =>
  m.weeks.map((w) => lineup(m, ids, w, downside));
export const rosterScore = (m: Model, ids: string[]) =>
  sum(horizon(m, ids).map((l) => l.value));
export function rosterExcess(m: Model, ids: string[]) {
  const ir = new Set(irAssignments(m, ids)),
    active = ids.filter((id) => !ir.has(id)),
    ctx = m.dataset.tables.ModelContext[0];
  return (
    Math.max(0, active.length - capacity(m)) +
    sum(
      positions.map((pos) => {
        const limit = num(ctx[limits[pos]]);
        return limit > 0
          ? Math.max(
              0,
              active.filter((id) => m.byId.get(id)?.pos === pos).length - limit,
            )
          : 0;
      }),
    )
  );
}
export function makeLegal(m: Model, ids: string[]) {
  let bag = [...ids];
  for (let step = 0; step < 5 && rosterExcess(m, bag) > 0; step++) {
    const excess = rosterExcess(m, bag),
      base = rosterScore(m, bag);
    const candidates = bag
      .filter(
        (id) =>
          m.byId.get(id)?.droppable &&
          rosterExcess(
            m,
            bag.filter((x) => x !== id),
          ) < excess,
      )
      .map((id) => ({
        id,
        loss:
          base -
          rosterScore(
            m,
            bag.filter((x) => x !== id),
          ),
      }))
      .sort(
        (a, b) =>
          a.loss - b.loss ||
          (m.byId.get(a.id)?.index ?? Infinity) -
            (m.byId.get(b.id)?.index ?? Infinity) ||
          cmpId(a.id, b.id),
      );
    if (!candidates.length) break;
    const id = candidates[0].id;
    bag = bag.filter((x) => x !== id);
  }
  return {
    ids: bag,
    drops: ids.filter((id) => !bag.includes(id)),
    excess: rosterExcess(m, bag),
  };
}
export function fillRoster(m: Model, ids: string[], blocked: string[]) {
  const bag = [...ids];
  const adds: string[] = [],
    blockedSet = new Set(blocked);
  for (
    let step = 0;
    step < 5 && bag.length < capacity(m) + irAssignments(m, bag).length;
    step++
  ) {
    const base = rosterScore(m, bag),
      candidates = m.players
        .filter(
          (p) =>
            p.owner === "0" &&
            p.remaining > 0 &&
            p.value !== null &&
            !p.uncertain &&
            !bag.includes(p.id) &&
            !blockedSet.has(p.id) &&
            rosterExcess(m, [...bag, p.id]) === 0,
        )
        .map((p) => ({ p, gain: rosterScore(m, [...bag, p.id]) - base }))
        .sort(
          (a, b) =>
            b.gain - a.gain ||
            (b.p.index ?? -Infinity) - (a.p.index ?? -Infinity) ||
            cmpId(a.p.id, b.p.id),
        );
    if (!candidates.length) break;
    bag.push(candidates[0].p.id);
    adds.push(candidates[0].p.id);
  }
  return { ids: bag, adds };
}
export interface PositionGrade {
  position: string;
  grade: string;
  rostered: number;
  usable: number;
  injuries: number;
  starterValue: number | null;
  median: number | null;
  versus: number | null;
  coverage: number | null;
  reserves: Player[];
  balance: string;
  advice: string;
  status: string;
}
export function teamsAssessment(m: Model): Map<string, PositionGrade[]> {
  const s = m.settings,
    bands: [number, string][] = [
      [-Infinity, "F"],
      [s.GradeDMinus, "D−"],
      [s.GradeD, "D"],
      [s.GradeDPlus, "D+"],
      [s.GradeCMinus, "C−"],
      [s.GradeC, "C"],
      [s.GradeCPlus, "C+"],
      [s.GradeBMinus, "B−"],
      [s.GradeB, "B"],
      [s.GradeBPlus, "B+"],
      [s.GradeAMinus, "A−"],
      [s.GradeA, "A"],
      [s.GradeAPlus, "A+"],
    ];
  const result = new Map<string, PositionGrade[]>();
  for (const t of m.dataset.tables.ModelTeams) {
    const team = String(t.TeamID),
      ids = roster(m, team),
      ls = horizon(m, ids),
      core = new Set(lineup(m, ids, m.current, false, true).ids),
      bag = ids.map((id) => m.byId.get(id)!);
    const rows = [...positions.slice(0, 4), "FLEX", "K", "D/ST"].map((pos) => {
      const count = num(
          m.dataset.tables.ModelContext[0][
            pos === "FLEX" ? "FlexSlots" : fields[pos as Position]
          ],
        ),
        eligible = bag.filter((p) =>
          pos === "FLEX" ? ["RB", "WR", "TE"].includes(p.pos) : p.pos === pos,
        ),
        denom = count * m.weeks.length;
      const starterValue = denom
          ? sum(
              ls.map((l) =>
                sum(
                  l.ids.map((id, i) =>
                    l.slots[i] === pos && id ? (m.byId.get(id)?.value ?? 0) : 0,
                  ),
                ),
              ),
            ) / denom
          : null,
        coverage = denom
          ? sum(
              ls.map(
                (l) => l.ids.filter((id, i) => id && l.slots[i] === pos).length,
              ),
            ) / denom
          : null;
      const reserves =
        pos === "FLEX"
          ? []
          : eligible
              .filter(
                (p) =>
                  p.value !== null &&
                  p.baseline !== null &&
                  p.value > p.baseline &&
                  !p.uncertain &&
                  p.available > 0 &&
                  !core.has(p.id),
              )
              .sort((a, b) => b.value! - a.value! || cmpId(a.id, b.id));
      return {
        position: pos,
        grade: "n.a.",
        rostered: eligible.length,
        usable: eligible.filter((p) => p.value !== null).length,
        injuries: eligible.filter((p) => p.uncertain).length,
        starterValue,
        median: null,
        versus: null,
        coverage,
        reserves,
        balance: "",
        advice: "",
        status: eligible.some((p) => p.value === null)
          ? "CONDITIONAL - missing player values"
          : eligible.some((p) => p.uncertain)
            ? "CONDITIONAL - injury availability"
            : "Available",
      } as PositionGrade;
    });
    result.set(team, rows);
  }
  for (const rows of result.values())
    for (const row of rows) {
      const sample = [...result.values()]
          .flat()
          .filter(
            (x) =>
              x.position === row.position &&
              x.usable === x.rostered &&
              x.starterValue !== null,
          )
          .map((x) => x.starterValue!),
        median = quantile(sample, 0.5);
      row.median = median;
      row.versus =
        median !== null && median > 0 && row.starterValue !== null
          ? row.starterValue / median - 1
          : null;
      if (row.usable === row.rostered && row.versus !== null)
        row.grade = [...bands]
          .reverse()
          .find(([minimum]) => row.versus! >= minimum)![1];
      const pool =
        row.position === "FLEX"
          ? m.pools.find((p) => p.status !== "Available")
          : m.pools.find((p) => p.position === row.position);
      if (row.status === "Available" && pool && pool.status !== "Available")
        row.status = pool.status;
      const margin = Math.max(
        0,
        ...row.reserves.map(
          (p) => (p.value! - p.baseline!) / Math.max(1, Math.abs(p.baseline!)),
        ),
      );
      row.balance =
        row.versus === null || row.usable !== row.rostered
          ? "Review data"
          : (row.coverage ?? 0) < 0.9
            ? "Shortage"
            : row.versus < -0.1
              ? "Need upgrade"
              : row.position === "FLEX"
                ? "Shared depth"
                : row.reserves.length
                  ? margin <= m.settings.ReserveCutoff
                    ? "Limited spare value"
                    : "Potential surplus"
                  : "Thin depth";
      row.advice =
        row.balance === "Review data"
          ? "Resolve missing values before relying on the grade."
          : row.balance === "Shortage"
            ? `Add usable cover; ${Math.round((1 - (row.coverage ?? 0)) * 100)}% of starter-weeks are unfilled.`
            : row.balance === "Need upgrade"
              ? `Seek a starter upgrade; modeled value is ${Math.round(-row.versus! * 100)}% below the league median.`
              : row.balance === "Potential surplus"
                ? "Discuss reserves, then check bye cover and lineup loss in Trades."
                : row.balance === "Limited spare value"
                  ? "Reserves are close to replacement; the model supports a limited asking price."
                  : row.position === "FLEX"
                    ? "FLEX is allocated before counting spare RB/WR/TE depth."
                    : ["K", "D/ST"].includes(row.position)
                      ? "Check opponent and current-week ESPN projection."
                      : "Protect starters; no healthy above-replacement spare after FLEX.";
    }
  return result;
}

export interface SuggestedSwap {
  startId: string;
  startName: string;
  overId: string;
  overName: string;
  gain: number; // positive difference in MPPG
  chance: number; // chance start outscores over
  chancePct: string; // e.g. "67%"
  reason: string; // e.g. "67% chance he outscores Brannigan · ESPN projects 11.4 this week vs 9.4 · Soft vs RB..."
  gainText: string; // e.g. "+1.9"
}

export interface WeeklyLineupSlot {
  slot: string;
  playerId: string | null;
  player: Player | null;
  mppg: MppgResult | null;
  isNewStarter: boolean; // starter differs from season lineup
}

export interface WeeklyLineup {
  week: number;
  slots: WeeklyLineupSlot[];
  starterIds: string[];
  totalMppg: number;
  totalSpread: number;
  seasonLineupMppg: number;
  gainOverSeasonLineup: number;
  gainText: string;
  swaps: SuggestedSwap[];
  hasSwaps: boolean;
  note: string;
}

// 2.1 & 2.2 Weekly lineup ranked by MPPG with suggested swaps
export function weeklyLineup(m: Model, team: string): WeeklyLineup {
  const teamRosterIds = roster(m, team);
  const week = m.current;
  const ctx = m.dataset.tables.ModelContext[0];

  // 1. Season lineup (using existing standard lineup function)
  const seasonL = lineup(m, teamRosterIds, week, false, false, "value");
  const seasonStarterIds = new Set(seasonL.ids.filter((id): id is string => Boolean(id)));

  // Calculate season lineup's total MPPG
  let seasonMppgTotal = 0;
  for (const sId of seasonStarterIds) {
    const p = m.byId.get(sId);
    if (p) {
      const res = calculateMppg(m, p, week);
      if (res.value !== null) {
        seasonMppgTotal += res.value;
      }
    }
  }

  // 2. Weekly lineup: eligible players must have non-null MPPG
  const ir = new Set(irAssignments(m, teamRosterIds));
  const eligiblePlayersWithMppg: { player: Player; mppg: MppgResult }[] = [];

  for (const id of teamRosterIds) {
    const p = m.byId.get(id);
    if (!p) continue;
    if (ir.has(p.id)) continue;
    const mppgRes = calculateMppg(m, p, week);
    if (mppgRes.value !== null) {
      eligiblePlayersWithMppg.push({ player: p, mppg: mppgRes });
    }
  }

  // Rank eligible players descending by MPPG value, then stable id tiebreak
  eligiblePlayersWithMppg.sort(
    (a, b) => b.mppg.value! - a.mppg.value! || cmpId(a.player.id, b.player.id),
  );

  const used = new Set<string>();
  const weeklySlots: WeeklyLineupSlot[] = [];

  function pickWeekly(pos: string, count: number) {
    const candidates = eligiblePlayersWithMppg.filter(
      (item) =>
        !used.has(item.player.id) &&
        (pos === "FLEX"
          ? ["RB", "WR", "TE"].includes(item.player.pos)
          : item.player.pos === pos),
    );
    for (let i = 0; i < count; i++) {
      const item = candidates[i];
      if (item) {
        used.add(item.player.id);
        weeklySlots.push({
          slot: pos,
          playerId: item.player.id,
          player: item.player,
          mppg: item.mppg,
          isNewStarter: !seasonStarterIds.has(item.player.id),
        });
      } else {
        weeklySlots.push({
          slot: pos,
          playerId: null,
          player: null,
          mppg: null,
          isNewStarter: false,
        });
      }
    }
  }

  for (const pos of ["QB", "RB", "WR", "TE"] as const)
    pickWeekly(pos, num(ctx[fields[pos]]));
  pickWeekly("FLEX", num(ctx.FlexSlots));
  pickWeekly("K", num(ctx.KSlots));
  pickWeekly("D/ST", num(ctx.DSTSlots));

  const weeklyStarterIds = weeklySlots
    .map((s) => s.playerId)
    .filter((id): id is string => Boolean(id));
  const weeklyStarterIdSet = new Set(weeklyStarterIds);

  // Total starters MPPG and root-sum-square spread
  let totalMppg = 0;
  const spreads: number[] = [];
  for (const slot of weeklySlots) {
    if (slot.mppg?.value !== null && slot.mppg?.value !== undefined) {
      totalMppg += slot.mppg.value;
      if (slot.mppg.spread !== null && slot.mppg.spread !== undefined) {
        spreads.push(slot.mppg.spread);
      }
    }
  }
  const totalSpread = Math.round(combineSpreads(spreads) * 10) / 10;
  totalMppg = Math.round(totalMppg * 10) / 10;
  seasonMppgTotal = Math.round(seasonMppgTotal * 10) / 10;
  const gain = Math.round((totalMppg - seasonMppgTotal) * 10) / 10;
  const gainText = `${gain >= 0 ? "+" : "−"}${Math.abs(gain).toFixed(1)}`;

  // 3. Suggested swaps: compare starter SETS, not slots
  // "in": in weekly starters, but not in season starters
  // "out": in season starters, but not in weekly starters
  const inPlayers = weeklySlots
    .filter((s) => s.player && !seasonStarterIds.has(s.player.id))
    .map((s) => ({ player: s.player!, mppg: s.mppg! }));
  inPlayers.sort((a, b) => b.mppg.value! - a.mppg.value!);

  const outPlayers: { player: Player; mppg: MppgResult }[] = [];
  for (const sId of seasonStarterIds) {
    if (!weeklyStarterIdSet.has(sId)) {
      const p = m.byId.get(sId);
      if (p) {
        outPlayers.push({ player: p, mppg: calculateMppg(m, p, week) });
      }
    }
  }
  // Sort outPlayers ascending by MPPG value (worst out first, nulls first)
  outPlayers.sort((a, b) => (a.mppg.value ?? -999) - (b.mppg.value ?? -999));

  const swaps: SuggestedSwap[] = [];
  const swapCount = Math.min(inPlayers.length, outPlayers.length);

  for (let i = 0; i < swapCount; i++) {
    const pin = inPlayers[i];
    const pout = outPlayers[i];

    const vIn = pin.mppg.value ?? 0;
    const vOut = pout.mppg.value ?? 0;
    const diff = Math.max(0, Math.round((vIn - vOut) * 10) / 10);

    const spIn = pin.mppg.spread ?? 3.5;
    const spOut = pout.mppg.spread ?? 3.5;
    const combSpread = Math.sqrt(spIn * spIn + spOut * spOut);
    const z = combSpread > 0 ? (vIn - vOut) / combSpread : 0;
    const pr = Math.round(normalCdf(z) * 100);

    const matchupList = playerMatchups(m, pin.player);
    const currMatchup = matchupList.find((mu) => mu.week === week);
    const chipText = currMatchup ? currMatchup.text : "";

    const reason =
      pout.mppg.value === null
        ? `${pout.player.name} is ${pout.mppg.reason.toLowerCase()} · ${chipText}`
        : `${pr}% chance he outscores ${pout.player.name.split(" ").slice(-1)[0]} · ESPN projects ${pin.player.weekly?.toFixed(1) ?? "—"} this week vs ${pout.player.weekly?.toFixed(1) ?? "—"}${chipText ? " · " + chipText : ""}`;

    swaps.push({
      startId: pin.player.id,
      startName: pin.player.name,
      overId: pout.player.id,
      overName: pout.player.name,
      gain: diff,
      chance: pr,
      chancePct: `${pr}%`,
      reason,
      gainText: `+${diff.toFixed(1)}`,
    });
  }

  const slotChangeCount = swaps.length;
  const note =
    slotChangeCount > 0
      ? `${slotChangeCount} slot ${slotChangeCount === 1 ? "change" : "changes"} from your season lineup this week. Neither changes your ESPN lineup until you set it there.`
      : "Your season lineup is already your best Week " + week + " lineup.";

  return {
    week,
    slots: weeklySlots,
    starterIds: weeklyStarterIds,
    totalMppg,
    totalSpread,
    seasonLineupMppg: seasonMppgTotal,
    gainOverSeasonLineup: gain,
    gainText,
    swaps,
    hasSwaps: swaps.length > 0,
    note,
  };
}
