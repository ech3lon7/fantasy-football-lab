import {
  type Dataset,
  type Settings,
  type Row,
  type Position,
  positions,
  n,
  num,
  str,
  cmpId,
  sum,
  mean,
  sd,
  quantile,
} from "./contracts";
import {
  calibrateRole,
  evidenceVersion,
  playedHistory,
  readEvidence,
  workload,
  type Workload,
  type RoleCalibration,
  type EvidenceInput,
} from "./opportunity";
import { assessGem, gemVersion, type GemAssessment } from "./gems";
export interface Player {
  id: string;
  name: string;
  pos: Position;
  nfl: string;
  nflId: string;
  owner: string;
  injury: string;
  raw: Row;
  games: number;
  actual: number | null;
  recent: number | null;
  scoringSD: number | null;
  projected: number | null;
  weekly: number | null;
  observed: number | null;
  weight: number;
  expected: number | null;
  blendedExpected: number | null;
  penalty: number | null;
  value: number | null;
  historyComplete: boolean;
  out: boolean;
  uncertain: boolean;
  irEligible: boolean;
  slot: number;
  droppable: boolean;
  remaining: number;
  available: number;
  bye: number;
  opponent: string;
  baseline: number | null;
  baselineStatus: string;
  vorp: number | null;
  positive: number | null;
  index: number | null;
  rank: number | null;
  adp: number | null;
  edge: number | null;
  targetShare: number | null;
  rushShare: number | null;
  opportunities: number | null;
  td: number | null;
  xtd: number | null;
  tdRate: number | null;
  regression: string;
  gem: string;
  breakout?: GemAssessment;
  priority: number;
  earlier: number | null;
  trendDelta: number | null;
  trendPct: number | null;
  arrow: string;
  gap: number | null;
  gapPct: number | null;
  workload: number | null;
  workloadSupport: boolean;
  status: string;
  explanation: string;
  opportunity: Workload;
  roleForecast: number | null;
}
export interface Pool {
  position: Position;
  eligible: number;
  candidates: Player[];
  value: number | null;
  status: string;
}
export interface Model {
  players: Player[];
  byId: Map<string, Player>;
  pools: Pool[];
  dataset: Dataset;
  settings: Settings;
  current: number;
  final: number;
  weeks: number[];
  analysisVersion: string;
  calibration: RoleCalibration[];
  supplementalInput: EvidenceInput;
  evidenceIssue: string;
  evidenceRaw: string;
  roleScenarioWeight: number;
}
// Keep the primary classification and independent supporting signals available on every screen.
export const playerSignals = (p: Player) => [
  ...new Set([p.gem, ...p.opportunity.signals]),
];
// Workbook mode is used only to verify the unchanged Excel contract before app-specific evidence is added.
export function evaluate(
  d: Dataset,
  s: Settings,
  options: {
    workbookMode?: boolean;
    evidence?: string;
    roleWeight?: string;
  } = {},
): Model {
  const ctx = d.tables.ModelContext[0],
    current = num(ctx.CurrentWeek),
    final = num(ctx.FinalWeek),
    weeks = Array.from(
      { length: Math.max(0, final - current + 1) },
      (_, i) => current + i,
    );
  const histories = playedHistory(d),
    supplemental = readEvidence(options.evidence, d);
  const calibration = options.workbookMode ? [] : calibrateRole(d, histories);
  // Role influence is an explicit scenario; zero preserves the existing adaptive forecast.
  const parsedWeight = Number(options.roleWeight ?? 0);
  const roleScenarioWeight =
    !options.workbookMode &&
    Number.isFinite(parsedWeight) &&
    parsedWeight >= 0 &&
    parsedWeight <= 1
      ? parsedWeight
      : 0;
  if (!Number.isFinite(parsedWeight) || parsedWeight < 0 || parsedWeight > 1)
    supplemental.issue =
      "Role forecast scenario weight must be between 0 and 1; the original blend is retained.";
  const schedules = new Map<string, Row[]>();
  for (const r of d.tables.ModelSchedule) {
    const key = str(r.ProTeamID);
    schedules.set(key, [...(schedules.get(key) ?? []), r]);
  }
  const roster = new Map(
    d.tables.ModelRosters.map((r) => [
      str(r.PlayerID),
      num(r.LineupSlotID, 20),
    ]),
  );
  const players: Player[] = d.tables.ModelPlayers.map((r) => {
    const games = num(r.GamesPlayed),
      actual = games > 0 ? n(r.Actual_PPG) : null,
      recent = games > 0 ? n(r.Last3_PPG) : null,
      scoringSD = games > 1 ? n(r.ScoreSD) : null;
    const historyComplete =
      !r.HistoryIssue &&
      games >= num(r.Season_Games) - num(r.Current_Actual_Games);
    const projected =
      num(r.ProjectionRecords) === 1 &&
      n(r.ESPN_Projected_PPG) !== null &&
      (num(r.ESPN_Projected_Games) > 0 ||
        num(r.ESPN_Projected_PPG) !== 0 ||
        num(r.ESPN_Projected_Total) !== 0)
        ? n(r.ESPN_Projected_PPG)
        : null;
    const observed =
        games > 0 && actual !== null && recent !== null
          ? (1 - s.RecentWeight) * actual + s.RecentWeight * recent
          : null,
      weight = games / (games + s.PriorGames);
    const blendedExpected = historyComplete
      ? projected !== null
        ? observed !== null
          ? weight * observed + (1 - weight) * projected
          : projected
        : games >= 4
          ? observed
          : null
      : null;
    const roleForecast =
      calibration
        .find((c) => c.position === str(r.Position))
        ?.forecast.get(str(r.PlayerID)) ?? null;
    const expected =
      blendedExpected !== null && roleForecast !== null
        ? (1 - roleScenarioWeight) * blendedExpected +
          roleScenarioWeight * roleForecast
        : blendedExpected;
    const penalty =
      expected === null
        ? null
        : games >= s.MinConsistencyGames && expected > 0
          ? Math.min(
              s.ConsistencyCap * expected,
              s.ConsistencyCoefficient * (scoringSD ?? 0) * weight,
            )
          : 0;
    const injury = str(r.InjuryStatus) || "ACTIVE",
      out = [
        "OUT",
        "INJURY_RESERVE",
        "IR",
        "SUSPENSION",
        "SUSPENDED",
        "SSPD",
        "SUSP",
      ].includes(injury),
      ss = schedules.get(str(r.ProTeamID)) ?? [],
      remaining = sum(
        ss
          .filter((x) => num(x.Week) >= current && num(x.Week) <= final)
          .map((x) => num(x.HasGame)),
      );
    const opportunity = workload(
      r,
      histories.get(str(r.PlayerID)) ?? [],
      supplemental.input,
      current,
    );
    const pos = str(r.Position) as Position,
      opportunities =
        !options.workbookMode && ["RB", "WR", "TE"].includes(pos)
          ? opportunity.targets === null ||
            (pos === "RB" && opportunity.carries === null)
            ? null
            : opportunity.targets + (pos === "RB" ? opportunity.carries! : 0)
          : pos === "RB"
            ? num(r.RushAttempts) + num(r.Targets)
            : ["WR", "TE"].includes(pos)
              ? num(r.Targets)
              : null,
      td =
        !options.workbookMode && ["RB", "WR", "TE"].includes(pos)
          ? opportunity.touchdowns
          : pos === "RB"
            ? num(r.RushTD) + num(r.ReceivingTD)
            : ["WR", "TE"].includes(pos)
              ? num(r.ReceivingTD)
              : null;
    const status =
      num(r.ProjectionRecords) > 1
        ? "Conflicting projections"
        : !historyComplete
          ? "History incomplete / conflict"
          : expected === null
            ? "Insufficient data"
            : injury !== "ACTIVE" || opportunity.returnWeek !== null
              ? "Conditional - injury availability"
              : games === 0
                ? "Projection only"
                : projected !== null
                  ? "Available"
                  : "Actual results only";
    return {
      id: str(r.PlayerID),
      name: str(r.Player),
      pos,
      nfl: str(r.NFLTeam),
      nflId: str(r.ProTeamID),
      owner: str(r.OnTeamID),
      injury,
      raw: r,
      games,
      actual,
      recent,
      scoringSD,
      projected,
      weekly: n(r.Current_Week_Projection),
      observed,
      weight,
      expected,
      blendedExpected,
      penalty,
      value: expected !== null && penalty !== null ? expected - penalty : null,
      historyComplete,
      out,
      uncertain: injury !== "ACTIVE" || opportunity.returnWeek !== null,
      irEligible: ["OUT", "INJURY_RESERVE", "IR"].includes(injury),
      slot: roster.get(str(r.PlayerID)) ?? 20,
      droppable: !!r.Droppable,
      remaining,
      // A sourced, user-selected return scenario excludes weeks before that return; unknown returns stay conditional.
      available:
        remaining -
        sum(
          ss
            .filter(
              (x) =>
                num(x.Week) >= current &&
                num(x.Week) <= final &&
                (opportunity.returnWeek !== null
                  ? num(x.Week) < opportunity.returnWeek ||
                    (num(x.Week) === current && out)
                  : out && num(x.Week) === current),
            )
            .map((x) => num(x.HasGame)),
        ),
      bye: num(ss[0]?.ByeWeek),
      opponent:
        str(ss.find((x) => num(x.Week) === current)?.Opponent) || "Unknown",
      baseline: null,
      baselineStatus: "",
      vorp: null,
      positive: null,
      index: null,
      rank: null,
      adp: num(r.ADP) > 0 ? n(r.ADP) : null,
      edge: null,
      targetShare: null,
      rushShare: null,
      opportunities,
      td,
      xtd:
        !options.workbookMode && ["RB", "WR", "TE"].includes(pos)
          ? opportunities === null
            ? null
            : (pos === "RB" ? opportunity.carries! / s.CarriesPerTD : 0) +
              opportunity.targets! / s.TargetsPerTD
          : pos === "RB"
            ? num(r.RushAttempts) / s.CarriesPerTD +
              num(r.Targets) / s.TargetsPerTD
            : ["WR", "TE"].includes(pos)
              ? num(r.Targets) / s.TargetsPerTD
              : null,
      tdRate: opportunities && td !== null ? td / opportunities : null,
      regression: "NEUTRAL - insufficient data",
      gem: "",
      priority: 99,
      earlier: null,
      trendDelta: null,
      trendPct: null,
      arrow: "n.a.",
      gap: null,
      gapPct: null,
      workload: null,
      workloadSupport: false,
      status,
      explanation: "",
      opportunity,
      roleForecast,
    };
  });
  const totals = new Map<string, { targets: number; rush: number }>();
  const missingTeamTargets = new Set<string>(),
    missingTeamRush = new Set<string>();
  for (const p of players) {
    // Missing teammate counts make a share unknown rather than inflating its denominator coverage.
    if (
      p.games > 0 &&
      ["RB", "WR", "TE"].includes(p.pos) &&
      p.opportunity.targets === null
    )
      missingTeamTargets.add(p.nflId);
    if (
      p.games > 0 &&
      ["QB", "RB", "WR", "TE"].includes(p.pos) &&
      p.opportunity.carries === null
    )
      missingTeamRush.add(p.nflId);
    const t = totals.get(p.nflId) ?? { targets: 0, rush: 0 };
    // Share numerators and denominators use the same completed scoring window.
    t.targets += options.workbookMode
      ? num(p.raw.Targets)
      : (p.opportunity.targets ?? 0);
    t.rush += options.workbookMode
      ? num(p.raw.RushAttempts)
      : (p.opportunity.carries ?? 0);
    totals.set(p.nflId, t);
  }
  for (const p of players) {
    const t = totals.get(p.nflId)!;
    p.targetShare =
      t.targets &&
      (options.workbookMode ||
        (p.opportunity.targets !== null && !missingTeamTargets.has(p.nflId)))
        ? (options.workbookMode ? num(p.raw.Targets) : p.opportunity.targets!) /
          t.targets
        : null;
    p.rushShare =
      t.rush &&
      (options.workbookMode ||
        (p.opportunity.carries !== null && !missingTeamRush.has(p.nflId)))
        ? (options.workbookMode
            ? num(p.raw.RushAttempts)
            : p.opportunity.carries!) / t.rush
        : null;
  }
  const pools = positions.map((position) => {
    const all = players
      .filter(
        (p) =>
          p.pos === position &&
          p.owner === "0" &&
          n(p.raw.OnTeamID) !== null &&
          p.value !== null &&
          p.historyComplete &&
          p.injury === "ACTIVE" &&
          (options.workbookMode || !p.uncertain) &&
          p.remaining > 0,
      )
      .sort((a, b) => b.value! - a.value! || cmpId(a.id, b.id));
    const candidates = all.slice(0, 3);
    return {
      position,
      eligible: all.length,
      candidates,
      value: mean(candidates.map((p) => p.value!)),
      status: !candidates.length
        ? "UNAVAILABLE - no eligible free agents"
        : candidates.length < 3
          ? "CONDITIONAL - thin replacement pool"
          : "Available",
    };
  });
  for (const p of players) {
    const pool = pools.find((x) => x.position === p.pos)!;
    p.baseline = pool.value;
    p.baselineStatus = pool.status;
    p.vorp =
      p.value === null
        ? null
        : p.available <= 0
          ? 0
          : p.baseline === null
            ? null
            : (p.value - p.baseline) * p.available;
    p.positive = p.vorp === null ? null : Math.max(0, p.vorp);
  }
  const peak = Math.max(0, ...players.map((p) => p.positive ?? 0)),
    ordered = players
      .filter(
        (p) => ["QB", "RB", "WR", "TE"].includes(p.pos) && p.vorp !== null,
      )
      .map((p) => p.vorp!)
      .sort((a, b) => b - a);
  const groups = new Map<
    string,
    { avg: number | null; sigma: number | null; high: number | null }
  >();
  for (const pos of ["RB", "WR", "TE"]) {
    const group = players.filter((p) => p.pos === pos);
    const rates = group
      .filter(
        (p) => (p.opportunities ?? 0) >= s.MinOpportunity && p.tdRate !== null,
      )
      .map((p) => p.tdRate!);
    groups.set(pos, {
      avg: mean(rates),
      sigma: sd(rates, false),
      high: quantile(
        group
          .filter((p) => (p.opportunities ?? 0) > 0)
          .map((p) => p.opportunities!),
        0.8,
      ),
    });
  }
  for (const p of players) {
    p.index =
      p.positive === null ? null : peak > 0 ? (100 * p.positive) / peak : 0;
    p.rank =
      p.vorp !== null && ["QB", "RB", "WR", "TE"].includes(p.pos)
        ? ordered.indexOf(p.vorp) + 1
        : null;
    p.edge = p.adp !== null && p.rank !== null ? p.adp - p.rank : null;
    const g = groups.get(p.pos);
    if (g && g.avg !== null && g.sigma !== null && g.high !== null) {
      p.regression =
        (p.opportunities ?? 0) < s.MinOpportunity
          ? "NEUTRAL - low volume"
          : p.tdRate === null
            ? "NEUTRAL - insufficient data"
            : p.opportunities! >= g.high && p.tdRate < g.avg - 0.5 * g.sigma
              ? "BUY LOW"
              : p.opportunities! < g.high && p.tdRate > g.avg + 1.5 * g.sigma
                ? "SELL HIGH"
                : "NEUTRAL";
    }
    if (
      p.historyComplete &&
      p.games >= 3 + s.GemMinPriorGames &&
      p.actual !== null &&
      p.recent !== null
    ) {
      p.earlier =
        Math.round(
          ((num(p.raw.ActualPoints) - 3 * p.recent) / (p.games - 3)) * 1e10,
        ) / 1e10;
      p.trendDelta = p.recent - p.earlier;
      p.trendPct = p.earlier === 0 ? null : p.trendDelta / Math.abs(p.earlier);
      const floor = Math.max(
        s.GemTrendFloor,
        s.GemTrendPctFloor * Math.abs(p.earlier),
      );
      p.arrow =
        p.trendDelta === 0
          ? "→"
          : p.trendDelta >= floor
            ? "↑"
            : p.trendDelta <= -floor
              ? "↓"
              : "→";
    }
    p.gap =
      p.actual !== null && p.projected !== null ? p.actual - p.projected : null;
    p.gapPct = p.gap !== null && p.projected! > 0 ? p.gap / p.projected! : null;
    p.workload =
      p.opportunities !== null && p.games > 0
        ? p.opportunities / p.games
        : null;
    p.workloadSupport =
      p.workload !== null &&
      (p.pos === "WR"
        ? p.workload >= s.GemWRTargets && (p.targetShare ?? -1) >= s.GemWRShare
        : p.pos === "TE"
          ? p.workload >= s.GemTETargets &&
            (p.targetShare ?? -1) >= s.GemTEShare
          : p.pos === "RB"
            ? p.workload >= s.GemRBOpportunities &&
              ((p.rushShare ?? -1) >= s.GemRBRushShare ||
                (p.targetShare ?? -1) >= s.GemRBTargetShare)
            : false);
    const gapPass =
        p.gap !== null &&
        p.gap >= s.GemMinGap &&
        (p.gapPct === null || p.gapPct >= s.GemMinGapPct),
      recent =
        p.recent !== null && p.projected !== null && p.recent >= p.projected;
    p.gem = !p.historyComplete
      ? "Data issue"
      : p.games < 1
        ? "Projection only"
        : p.value === null
          ? "Data issue"
          : p.games < s.GemMinGames
            ? gapPass || (p.workloadSupport && p.regression === "BUY LOW")
              ? "Emerging"
              : "Limited history"
            : p.regression === "SELL HIGH"
              ? "TD caution"
              : gapPass && recent && p.workloadSupport
                ? "Gem candidate"
                : p.workloadSupport && p.regression === "BUY LOW"
                  ? "Opportunity watch"
                  : gapPass && recent
                    ? "Projection-gap watch"
                    : "No gem signal";
    p.priority =
      (
        {
          "Gem candidate": 1,
          "Opportunity watch": 2,
          "Projection-gap watch": 3,
          Emerging: 4,
          "TD caution": 5,
        } as Record<string, number>
      )[p.gem] ?? 99;
    p.explanation =
      p.gem === "Gem candidate"
        ? "Actual scoring beats the season forecast, with recent scoring and workload support."
        : p.gem === "Opportunity watch"
          ? "Workload supports the existing BUY LOW regression flag."
          : p.gem === "Projection-gap watch"
            ? "Scoring beats the season forecast; workload support is weak or not modeled."
            : p.gem === "Emerging"
              ? "Promising evidence with fewer than the required played games."
              : p.gem === "TD caution"
                ? "Existing SELL HIGH flag: touchdown rate may be elevated relative to workload."
                : p.gem === "Data issue"
                  ? "Resolve incomplete history or unavailable model inputs."
                  : "No qualifying gem signal under the selected settings.";
    // Independent evidence can coexist with a touchdown caution or projection-gap label.
    if (!options.workbookMode && p.historyComplete && p.value !== null) {
      const o = p.opportunity;
      const minimum =
        p.pos === "RB"
          ? s.GemRBOpportunities
          : p.pos === "WR"
            ? s.GemWRTargets
            : p.pos === "TE"
              ? s.GemTETargets
              : p.pos === "QB"
                ? 3
                : Infinity;
      if (
        o.recentGames === 3 &&
        o.priorGames >= s.GemMinPriorGames &&
        o.recentRate !== null &&
        o.priorRate !== null &&
        o.delta !== null &&
        o.recentRate >= minimum &&
        o.delta >= 2 &&
        o.delta >= Math.abs(o.priorRate) * 0.2
      )
        o.signals.push("Role-growth watch");
      if (
        ["RB", "WR", "TE", "QB"].includes(p.pos) &&
        p.games >= 3 + s.GemMinPriorGames &&
        p.trendDelta !== null &&
        p.trendDelta >= s.GemMinGap &&
        p.recent !== null &&
        p.projected !== null &&
        p.recent >= p.projected
      )
        o.signals.push("Scoring breakout watch");
      if (p.gem === "No gem signal" && o.signals.length) {
        p.gem = o.signals[0];
        p.priority = p.gem === "Role-growth watch" ? 2 : 3;
        p.explanation =
          p.gem === "Role-growth watch"
            ? "Recent workload increased versus earlier played games. This is a role watch, not a forecast bonus."
            : "Recent scoring improved versus earlier games and exceeds the season projection. Confirm the role before acting.";
      }
    }
  }
  // Automatic breakout labels use the existing imported history; forecasts and the workbook parity path stay unchanged.
  if (!options.workbookMode)
    for (const p of players) {
      if (["Projection-gap watch", "TD caution"].includes(p.gem))
        p.opportunity.signals.push(p.gem);
      p.breakout = assessGem(p, histories.get(p.id) ?? [], d);
      p.gem = p.breakout.classification;
      p.priority = p.gem === "Gem" ? 1 : p.gem === "Watch" ? 2 : 99;
      p.explanation = p.breakout.explanation;
    }
  return {
    players,
    byId: new Map(players.map((p) => [p.id, p])),
    pools,
    dataset: d,
    settings: s,
    current,
    final,
    weeks,
    analysisVersion: options.workbookMode
      ? "v5.2-workbook"
      : `${evidenceVersion}/${gemVersion}`,
    calibration,
    supplementalInput: supplemental.input,
    evidenceIssue: supplemental.issue,
    evidenceRaw: options.evidence ?? "",
    roleScenarioWeight,
  };
}
