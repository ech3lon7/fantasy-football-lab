import { type Model, type Player } from "./valuation";
import {
  positions,
  type Position,
  num,
  cmpId,
  sum,
  quantile,
} from "./contracts";
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
        p.irEligible ||
        (p.slot === 21 &&
          p.owner === owner &&
          ["QUESTIONABLE", "DOUBTFUL"].includes(p.injury)),
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
  return (
    scheduled(m, p, w) &&
    !(w === m.current && p.out) &&
    // Imported return weeks are explicit conditional scenarios, never inferred missed-game estimates.
    !(p.opportunity.returnWeek !== null && w < p.opportunity.returnWeek) &&
    !(downside && p.uncertain)
  );
}
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
