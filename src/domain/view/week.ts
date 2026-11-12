import { quantile, type Draft } from "../contracts";
import {
  horizon,
  lineup,
  roster,
  scheduled,
  type PositionGrade,
} from "../lineups";
import {
  defaultGemDraft,
  screenGems,
  validateGemDraft,
} from "../gem-screening";
import { evaluateTrade } from "../trades";
import { readLineupBasis, tradeImpact } from "../trade-impact";
import { playerSignals, type Model, type Player } from "../valuation";
import { depthChart, gradeTone } from "./roster";

const f1 = (x: number | null) => (x === null ? null : x.toFixed(1));
const signed1 = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(1)}`;
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export interface OutlookPoint {
  week: number;
  // Null when the lineup cannot be scored that week; it is never drawn as zero.
  mine: number | null;
  median: number | null;
}

export interface ScoreRow {
  position: string;
  grade: string;
  tone: ReturnType<typeof gradeTone>;
  mine: string | null;
  median: string | null;
  // Bar lengths on one scale shared by every row; null when the value is unavailable.
  mineShare: number | null;
  medianShare: number | null;
  side: "above" | "below" | null;
  // Why the row has no value; empty when it does.
  reason: string;
}

export interface Move {
  kind: "trade" | "waiver" | "lineup";
  title: string;
  // The lead figure and what it measures, such as "+2.0" and "EPPG/wk".
  big: string | null;
  unit: string;
  line: string;
  href: string;
  playerId?: string;
}

export interface WeekSummary {
  week: number;
  headline: string;
  deck: string;
  outlook: {
    points: OutlookPoint[];
    average: string | null;
    medianAverage: string | null;
    gap: string | null;
    peak: { week: number; value: string } | null;
    dip: { week: number; note: string } | null;
    reason: string;
  };
  scoreboard: { rows: ScoreRow[]; note: string };
  moves: Move[];
}

const median = (xs: number[]) => quantile(xs, 0.5);

// Expected points per remaining week for the Value PPG-selected lineup of one team; the series the outlook draws.
function teamSeries(m: Model, team: string) {
  return horizon(m, roster(m, team)).map((l) => ({
    week: l.week,
    value: l.unfilled === l.slots.length ? null : l.expected,
  }));
}

// A starter on bye that the healthy lineup would use; shown as the reason for a dip.
function byeStarters(m: Model, team: string, week: number) {
  const healthy = lineup(m, roster(m, team), week, false, true);
  return healthy.ids.filter((id) => {
    const p = id ? m.byId.get(id) : undefined;
    return p && !scheduled(m, p, week);
  }).length;
}

// Everything the This week screen shows, computed from model results; no sentence is typed in the interface.
export function weekSummary(
  m: Model,
  team: string,
  grades: PositionGrade[],
  draft?: Draft,
  basis?: string,
): WeekSummary {
  const teams = m.dataset.tables.ModelTeams.map((t) => String(t.TeamID));
  const all = new Map(teams.map((t) => [t, teamSeries(m, t)]));
  const mine = all.get(team) ?? [];
  const points: OutlookPoint[] = mine.map((p, i) => {
    const others = teams
      .map((t) => all.get(t)?.[i]?.value)
      .filter((v): v is number => v !== null && v !== undefined);
    return { week: p.week, mine: p.value, median: median(others) };
  });
  const have = points.filter((p) => p.mine !== null);
  const average = mean(have.map((p) => p.mine!));
  const medianAverage = mean(
    points.filter((p) => p.median !== null).map((p) => p.median!),
  );
  const gap =
    average !== null && medianAverage !== null ? average - medianAverage : null;
  const peak = have.length
    ? have.reduce((a, b) => (b.mine! > a.mine! ? b : a))
    : null;
  const low = have.length
    ? have.reduce((a, b) => (b.mine! < a.mine! ? b : a))
    : null;
  const byes = low ? byeStarters(m, team, low.week) : 0;
  const dip =
    low && average !== null && low.mine! < average && byes > 0
      ? {
          week: low.week,
          note: `W${low.week} dip: ${byes} starter${byes === 1 ? "" : "s"} on bye`,
        }
      : null;

  // Scoreboard: starter Value PPG per slot against the league median, one shared scale.
  const top = Math.max(
    0,
    ...grades.flatMap((g) => [g.starterValue ?? 0, g.median ?? 0]),
  );
  const share = (v: number | null) =>
    v === null || top <= 0 ? null : Math.max(0, v) / top;
  const rows: ScoreRow[] = grades.map((g) => ({
    position: g.position,
    grade: g.grade,
    tone: gradeTone(g.grade),
    mine: g.grade === "n.a." ? null : f1(g.starterValue),
    // A league median over no usable teams is not a real zero; show it only when this position is graded.
    median: g.grade === "n.a." ? null : f1(g.median),
    mineShare: g.grade === "n.a." ? null : share(g.starterValue),
    medianShare: g.grade === "n.a." ? null : share(g.median),
    side:
      g.versus === null || g.grade === "n.a."
        ? null
        : g.versus >= 0
          ? "above"
          : "below",
    reason:
      g.grade === "n.a."
        ? g.status === "Available"
          ? "Not enough usable player values or league data to grade."
          : g.status
        : "",
  }));
  const missing = rows.filter((r) => r.reason);
  const note = missing.length
    ? `Starter Value PPG per slot. ${missing.map((r) => `${r.position} is unavailable: ${r.reason.replace(/\.$/, "")}`).join("; ")}.`
    : "Starter Value PPG per slot against the league median.";

  // Weakest starting position by distance below the league median.
  const ranked = grades
    .filter((g) => ["QB", "RB", "WR", "TE"].includes(g.position))
    .filter((g) => g.versus !== null && g.grade !== "n.a.")
    .sort((a, b) => a.versus! - b.versus!);
  const weak = ranked[0] && ranked[0].versus! < 0 ? ranked[0] : null;

  // The open trade draft, when it is a valid trade, is the trade idea; its numbers come from the trade evaluator.
  let trade: Move | null = null;
  let tradeGain: number | null = null;
  if (draft && draft.give.length && draft.get.length) {
    const result = evaluateTrade(m, draft);
    const impact = result.valid
      ? tradeImpact(result, readLineupBasis(basis))
      : null;
    const gain = impact?.own.expectedPerWeek ?? null;
    if (result.valid && gain !== null) {
      const names = (ids: string[]) =>
        ids.map((id) => m.byId.get(id)?.name ?? "Player").join(" + ");
      tradeGain = gain;
      trade = {
        kind: "trade",
        title: `${names(draft.give)} for ${names(draft.get)}`,
        big: signed1(gain),
        unit: "EPPG/wk",
        line: `Your open trade · ${result.grade}`,
        href: "#/trades",
        playerId: draft.get[0] ?? draft.give[0],
      };
    }
  }

  // Best available player with an active label at the weakest position (any starting position when none is weak).
  const query = validateGemDraft(
    {
      ...defaultGemDraft(team),
      pool: "Available",
      position: weak ? weak.position : "RB / WR / TE",
    },
    teams,
  ).query;
  const pick = query
    ? screenGems(m.players, query)
        .matches.map((r) => r.player)
        .filter((p) =>
          playerSignals(p).some((s) => s && !/^(none|no )/i.test(s)),
        )
        .filter((p) => p.blendedExpected !== null)
        .sort(
          (a, b) => b.blendedExpected! - a.blendedExpected! || +a.id - +b.id,
        )[0]
    : undefined;
  const waiver: Move | null = pick
    ? {
        kind: "waiver",
        title: `Claim ${pick.name}`,
        big: f1(pick.recent),
        unit: "recent PPG",
        line: `${playerSignals(pick)
          .filter((s) => s && !/^(none|no )/i.test(s))
          .slice(0, 2)
          .join(" · ")} · free agent`,
        href: `#/player/${pick.id}`,
        playerId: pick.id,
      }
    : null;

  // A bench player whose Expected PPG is above a starter's at the same position.
  let lineupMove: Move | null = null;
  for (const group of depthChart(m, team, grades)) {
    const starters = group.tiles.filter((t) => t.role === "Starter"),
      bench = group.tiles.filter((t) => t.role === "Bench");
    for (const b of bench) {
      const bp = m.byId.get(b.id) as Player;
      for (const s of starters) {
        const sp = m.byId.get(s.id) as Player;
        if (
          bp.blendedExpected !== null &&
          sp.blendedExpected !== null &&
          bp.blendedExpected > sp.blendedExpected &&
          (!lineupMove ||
            bp.blendedExpected - sp.blendedExpected > Number(lineupMove.big))
        )
          lineupMove = {
            kind: "lineup",
            title: `${bp.name} has passed ${sp.name}`,
            big: (bp.blendedExpected - sp.blendedExpected).toFixed(1),
            unit: "EPPG",
            line: `${sp.name} starts ahead of ${bp.name} in your lineup`,
            href: "#/roster",
            playerId: bp.id,
          };
      }
    }
  }
  if (!lineupMove) {
    for (const group of depthChart(m, team, grades)) {
      const starters = group.tiles.filter((t) => t.role === "Starter"),
        bench = group.tiles.filter((t) => t.role === "Bench");
      for (const s of starters) {
        const sp = m.byId.get(s.id) as Player;
        if (!sp) continue;
        const isBye = sp.bye === m.current;
        const isOut = !!(sp.injury && /^(out|ir|pup|sus)/i.test(sp.injury));
        if (isBye || isOut) {
          const availableBench = bench
            .map((b) => m.byId.get(b.id) as Player)
            .filter(
              (p) =>
                p &&
                p.blendedExpected !== null &&
                p.bye !== m.current &&
                (!p.injury || !/^(out|ir|pup|sus)/i.test(p.injury)),
            )
            .sort((a, b) => b.blendedExpected! - a.blendedExpected!)[0];
          if (availableBench) {
            lineupMove = {
              kind: "lineup",
              title: `Start ${availableBench.name}`,
              big: f1(availableBench.blendedExpected),
              unit: "EPPG",
              line: `${sp.name} is ${isBye ? `on bye (wk ${sp.bye})` : sp.injury} in starter slot`,
              href: "#/roster",
              playerId: availableBench.id,
            };
            break;
          }
        }
      }
      if (lineupMove) break;
    }
  }
  const moves = [trade, waiver, lineupMove].filter((x): x is Move => !!x);

  const headline = weak
    ? `${weak.position} is your weak spot.`
    : ranked.length
      ? "No position is below the league median."
      : "Not enough data to rank your positions yet.";

  const isWeakUnusable =
    weak &&
    (weak.starterValue === null ||
      weak.starterValue === 0 ||
      weak.usable === 0 ||
      (weak.versus !== null && weak.versus <= -0.999));

  let deckParts: string[];
  if (gap === null) {
    deckParts = [
      "The league comparison needs a scorable lineup.",
      isWeakUnusable
        ? `You have no usable ${weak!.position} starter.`
        : weak
          ? `${weak.position} is your weakest spot.`
          : "",
      tradeGain !== null && trade
        ? `Your open trade, ${trade.title}, ${tradeGain >= 0 ? "adds" : "costs"} ${Math.abs(tradeGain).toFixed(1)} expected points a week.`
        : "",
    ].filter(Boolean);
  } else {
    const weakFragment = weak
      ? isWeakUnusable
        ? `, and you have no usable ${weak.position} starter`
        : `, but ${weak.position} sits ${Math.abs(weak.versus! * 100).toFixed(0)}% below it`
      : "";
    deckParts = [
      `Your starters project ${Math.abs(gap).toFixed(1)} points a week ${gap >= 0 ? "above" : "below"} the league median${weakFragment}.`,
      tradeGain !== null && trade
        ? `Your open trade, ${trade.title}, ${tradeGain >= 0 ? "adds" : "costs"} ${Math.abs(tradeGain).toFixed(1)} expected points a week.`
        : "",
    ].filter(Boolean);
  }

  return {
    week: m.current,
    headline,
    deck: deckParts.join(" "),
    outlook: {
      points,
      average: f1(average),
      medianAverage: f1(medianAverage),
      gap: gap === null ? null : signed1(gap),
      peak: peak ? { week: peak.week, value: peak.mine!.toFixed(1) } : null,
      dip,
      reason: have.length
        ? ""
        : "No remaining week has a scorable lineup in this snapshot.",
    },
    scoreboard: { rows, note },
    moves,
  };
}

export interface TickerItem {
  id: string;
  name: string;
  label: string;
  // "up" for labels that point to rising production, "down" for caution labels.
  direction: "up" | "down";
}

const caution = /^(Reduced workload|TD caution|SELL HIGH)/;

// The labelled players worth a glance, own roster first; listed as active signals because label history starts with the second import.
export function tickerItems(m: Model, team: string, limit = 14): TickerItem[] {
  const items: { item: TickerItem; rank: number }[] = [];
  for (const p of m.players) {
    for (const label of playerSignals(p)) {
      if (!label || /^(none|no |insufficient|not applicable)/i.test(label))
        continue;
      items.push({
        item: {
          id: p.id,
          name: p.name,
          label,
          direction: caution.test(label) ? "down" : "up",
        },
        rank: (p.owner === team ? 0 : p.owner === "0" ? 100 : 200) + p.priority,
      });
    }
  }
  return items
    .sort((a, b) => a.rank - b.rank || +a.item.id - +b.item.id)
    .slice(0, limit)
    .map((x) => x.item);
}
