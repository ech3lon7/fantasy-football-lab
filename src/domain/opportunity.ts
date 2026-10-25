// The workload window shares label policy while forecasts and supplemental provider definitions stay unchanged.
import { labelPolicy } from "./label-rules";
import { mean, n, num, str, sum, type Dataset, type Row } from "./contracts";

// Supplemental evidence stays tied to one imported snapshot and uses the existing synced state.
export const evidenceKey = "valuationEvidence";
export const roleScenarioKey = "roleForecastScenarioWeight";
export const evidenceVersion = "opportunity-1";
const fields = [
  "PassAttempts",
  "SnapShare",
  "RouteParticipation",
  "TargetShare",
  "AirYardsShare",
  "RushInside5",
  "RedZoneTargets",
  "UsageXFP",
  "ROSOverallRank",
  "TradeValue",
  "ReturnWeek",
] as const;
export interface EvidenceRow {
  PlayerID: string;
  Week: number;
  Source: string;
  AsOfUTC: string;
  PassAttempts?: number;
  SnapShare?: number;
  RouteParticipation?: number;
  TargetShare?: number;
  AirYardsShare?: number;
  RushInside5?: number;
  RedZoneTargets?: number;
  UsageXFP?: number;
  ROSOverallRank?: number;
  TradeValue?: number;
  ReturnWeek?: number;
  MarketFormat?: string;
}
export interface EvidenceInput {
  datasetHash: string;
  rows: EvidenceRow[];
}
// A current-week label does not make an old market source fresh.
export const marketStatus = (row: EvidenceRow | null, now = Date.now()) =>
  !row
    ? "Unavailable — import a current redraft reference"
    : now - Date.parse(row.AsOfUTC) > 86400000
      ? "Stale reference — older than 24 hours"
      : "Current source reference; provider units differ from surplus points";
export interface Workload {
  carries: number | null;
  targets: number | null;
  receptions: number | null;
  touchdowns: number | null;
  games: number;
  rate: number | null;
  recentRate: number | null;
  priorRate: number | null;
  delta: number | null;
  recentCarries: number | null;
  recentTargets: number | null;
  recentReceptions: number | null;
  recentPassAttempts: number | null;
  recentGames: number;
  priorGames: number;
  source: string;
  signals: string[];
  snapShare: number | null;
  routes: number | null;
  rushInside5: number | null;
  redZoneTargets: number | null;
  wopr: number | null;
  usageXFP: number | null;
  fpoe: number | null;
  supplementalStatus: string;
  market: EvidenceRow | null;
  returnWeek: number | null;
}

// Validate sources, periods and units before any optional data can affect the model.
export function parseEvidence(
  rows: Record<string, unknown>[],
  d: Dataset,
): EvidenceInput {
  if (rows.length > 200)
    throw Error("Import at most 200 player-week rows at a time.");
  const ids = new Set(d.tables.ModelPlayers.map((p) => str(p.PlayerID)));
  const current = num(d.tables.ModelContext[0].CurrentWeek);
  const final = num(d.tables.ModelContext[0].FinalWeek);
  const seen = new Set<string>();
  const playedKeys = new Set(
    [...playedHistory(d)].flatMap(([id, history]) =>
      history.map((h) => `${id}/${h.Week}`),
    ),
  );
  const parsed = rows.map((r, i) => {
    const p: EvidenceRow = {
      PlayerID: str(r.PlayerID).trim(),
      Week: Number(r.Week),
      Source: str(r.Source).trim(),
      AsOfUTC: str(r.AsOfUTC).trim(),
    };
    if (
      !ids.has(p.PlayerID) ||
      !Number.isInteger(p.Week) ||
      p.Week < 1 ||
      p.Week > final ||
      !p.Source ||
      p.Source.length > 120 ||
      !p.AsOfUTC.endsWith("Z") ||
      !Number.isFinite(Date.parse(p.AsOfUTC)) ||
      Date.parse(p.AsOfUTC) > Date.now() + 300000
    )
      throw Error(
        `Row ${i + 1}: use a known PlayerID, valid week, source and UTC timestamp.`,
      );
    const key = `${p.PlayerID}/${p.Week}`;
    if (seen.has(key)) throw Error(`Row ${i + 1}: duplicate player/week.`);
    seen.add(key);
    for (const f of fields) {
      if (r[f] === undefined || r[f] === null || r[f] === "") continue;
      const v =
        typeof r[f] === "number"
          ? r[f]
          : /^\d+(?:\.\d+)?$/.test(str(r[f]))
            ? Number(r[f])
            : NaN;
      if (
        !Number.isFinite(v) ||
        v < 0 ||
        ((f.endsWith("Share") || f === "RouteParticipation") && v > 1) ||
        (f === "ROSOverallRank" && (!Number.isInteger(v) || v < 1)) ||
        (f === "ReturnWeek" &&
          (!Number.isInteger(v) || v < current || v > final + 1)) ||
        (["PassAttempts", "RushInside5", "RedZoneTargets"].includes(f) &&
          !Number.isInteger(v))
      )
        throw Error(
          `Row ${i + 1}: ${f} has invalid units or range. Shares use 0–1.`,
        );
      p[f] = v;
    }
    if (!fields.some((f) => p[f] !== undefined))
      throw Error(`Row ${i + 1}: no supported evidence supplied.`);
    // Market formats must be explicit so dynasty or superflex prices cannot silently enter redraft comparisons.
    if (p.ROSOverallRank !== undefined || p.TradeValue !== undefined) {
      if (
        r.MarketFormat !== "redraft-1qb-ppr" ||
        num(d.tables.ModelContext[0].QBSlots) !== 1 ||
        num(d.tables.ModelContext[0].ReceptionPoints, 1) !== 1
      )
        throw Error(
          `Row ${i + 1}: market references require MarketFormat redraft-1qb-ppr and matching league settings.`,
        );
      p.MarketFormat = "redraft-1qb-ppr";
    }
    if (
      p.Week >= current &&
      [
        "PassAttempts",
        "SnapShare",
        "RouteParticipation",
        "TargetShare",
        "AirYardsShare",
        "RushInside5",
        "RedZoneTargets",
        "UsageXFP",
      ].some((f) => p[f as keyof EvidenceRow] !== undefined)
    )
      throw Error(
        `Row ${i + 1}: usage evidence must describe a completed scoring week.`,
      );
    // Calendar completion alone does not establish this player's participation.
    if (
      [
        "PassAttempts",
        "SnapShare",
        "RouteParticipation",
        "TargetShare",
        "AirYardsShare",
        "RushInside5",
        "RedZoneTargets",
        "UsageXFP",
      ].some((f) => p[f as keyof EvidenceRow] !== undefined) &&
      !playedKeys.has(key)
    )
      throw Error(
        `Row ${i + 1}: usage evidence requires a verified played game for this player/week.`,
      );
    if (
      (p.ROSOverallRank !== undefined ||
        p.TradeValue !== undefined ||
        p.ReturnWeek !== undefined) &&
      p.Week !== current
    )
      throw Error(
        `Row ${i + 1}: market references and return scenarios must use the current scoring week.`,
      );
    return p;
  });
  const result = { datasetHash: d.hash, rows: parsed };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 40000)
    throw Error(
      "Evidence is too large for synced settings; import fewer rows.",
    );
  return result;
}

// Ignore evidence for a different workbook rather than silently carrying assumptions across leagues.
export function readEvidence(raw: string | undefined, d: Dataset) {
  if (!raw)
    return {
      input: { datasetHash: d.hash, rows: [] } as EvidenceInput,
      issue: "",
    };
  try {
    const value = JSON.parse(raw);
    if (value.datasetHash !== d.hash)
      return {
        input: { datasetHash: d.hash, rows: [] } as EvidenceInput,
        issue:
          "Supplemental evidence belongs to an earlier snapshot. Reimport it for this workbook.",
      };
    if (!Array.isArray(value.rows)) throw Error("Evidence rows are missing.");
    return { input: parseEvidence(value.rows, d), issue: "" };
  } catch (e) {
    return {
      input: { datasetHash: d.hash, rows: [] } as EvidenceInput,
      issue: e instanceof Error ? e.message : "Invalid supplemental evidence.",
    };
  }
}

// Only verified played games before the active scoring period may contribute completed-game workload.
export function playedHistory(d: Dataset) {
  const ctx = d.tables.ModelContext[0];
  const histories = new Map<string, Row[]>();
  for (const h of d.tables.ModelHistory) {
    if (
      h.HistoryStatus !== "Valid" ||
      num(h.Games) <= 0 ||
      h.Season !== ctx.Season ||
      num(h.Week) >= num(ctx.CurrentWeek) ||
      n(h.Points) === null
    )
      continue;
    const key = str(h.PlayerID);
    histories.set(key, [...(histories.get(key) ?? []), h]);
  }
  for (const rows of histories.values())
    rows.sort((a, b) => num(a.Week) - num(b.Week));
  return histories;
}

// Missing stat keys mean unavailable; explicit ESPN null counting stats in verified games mean zero.
const countsAvailable = (rows: Row[], keys: string[]) =>
  rows.length > 0 &&
  rows.every((r) =>
    keys.every(
      (k) =>
        Object.hasOwn(r, k) &&
        (r[k] === null || (n(r[k]) !== null && num(r[k]) >= 0)),
    ),
  );
const count = (rows: Row[], key: string) => sum(rows.map((r) => num(r[key])));

// Align carries, targets, touchdowns and per-game denominators, then compare nonoverlapping role windows.
export function workload(
  p: Row,
  rows: Row[],
  input: EvidenceInput,
  current: number,
): Workload {
  const pos = str(p.Position),
    games = num(p.GamesPlayed);
  const relevant =
    pos === "RB" || pos === "QB" ? ["RushAttempts", "Targets"] : ["Targets"];
  const usable =
    rows.length === games && countsAvailable(rows, relevant) && !p.HistoryIssue;
  const seasonAligned =
    games > 0 &&
    num(p.Season_Games) === games &&
    num(p.Current_Actual_Games) === 0 &&
    relevant.every((k) => n(p[k]) !== null);
  const totals = usable ? rows : seasonAligned ? [p] : [];
  // Receiver rushes also belong in the team's rushing denominator, even though their role screen uses targets.
  const carries =
    countsAvailable(totals, ["RushAttempts"]) &&
    ["RB", "QB", "WR", "TE"].includes(pos)
      ? count(totals, "RushAttempts")
      : null;
  const targets =
    totals.length && ["RB", "WR", "TE"].includes(pos)
      ? count(totals, "Targets")
      : null;
  const receptions = countsAvailable(totals, ["Receptions"])
    ? count(totals, "Receptions")
    : null;
  const touchdowns = countsAvailable(
    totals,
    pos === "RB" ? ["RushTD", "ReceivingTD"] : ["ReceivingTD"],
  )
    ? count(totals, "ReceivingTD") +
      (pos === "RB" ? count(totals, "RushTD") : 0)
    : null;
  const amount = (bag: Row[]) =>
    count(bag, pos === "QB" ? "RushAttempts" : "Targets") +
    (pos === "RB" ? count(bag, "RushAttempts") : 0);
  // A valid scoring window can support supplied xFP even when native workload fields are unavailable.
  const matchingHistory = rows.length === games && !p.HistoryIssue;
  const recent = matchingHistory ? rows.slice(-labelPolicy.window) : [],
    prior = matchingHistory ? rows.slice(0, -labelPolicy.window) : [];
  const recentRate =
    usable && recent.length ? amount(recent) / recent.length : null;
  const priorRate =
    usable && prior.length ? amount(prior) / prior.length : null;
  const own = input.rows.filter((r) => r.PlayerID === str(p.PlayerID));
  const extras = recent.map((h) => own.find((r) => r.Week === h.Week));
  // Mixed providers may define xFP or opportunity shares differently, so do not average them together.
  const compatibleSources =
    new Set(extras.filter(Boolean).map((r) => r!.Source)).size <= 1;
  const average = (key: keyof EvidenceRow) =>
    compatibleSources &&
    extras.length &&
    extras.every((r) => typeof r?.[key] === "number")
      ? mean(extras.map((r) => r![key] as number))
      : null;
  const usageXFP = average("UsageXFP");
  const targetShare = average("TargetShare"),
    airShare = average("AirYardsShare");
  const market =
    own.find(
      (r) =>
        r.Week === current &&
        (r.ROSOverallRank !== undefined || r.TradeValue !== undefined),
    ) ?? null;
  const sources = [
    ...new Set(
      extras.filter(Boolean).map((r) => `${r!.Source} (${r!.AsOfUTC})`),
    ),
  ];
  return {
    carries,
    targets,
    receptions,
    touchdowns,
    games,
    rate:
      totals.length && games > 0
        ? (pos === "QB"
            ? (carries ?? 0)
            : (targets ?? 0) + (pos === "RB" ? (carries ?? 0) : 0)) / games
        : null,
    recentRate,
    priorRate,
    delta:
      recentRate !== null && priorRate !== null ? recentRate - priorRate : null,
    recentCarries:
      usable && recent.length && carries !== null
        ? count(recent, "RushAttempts") / recent.length
        : null,
    recentTargets:
      usable && recent.length && targets !== null
        ? count(recent, "Targets") / recent.length
        : null,
    recentReceptions: countsAvailable(recent, ["Receptions"])
      ? count(recent, "Receptions") / recent.length
      : null,
    recentGames: recent.length,
    recentPassAttempts: average("PassAttempts"),
    priorGames: prior.length,
    source: usable
      ? "Completed-game history; same period as actual PPG"
      : seasonAligned
        ? "Aligned season totals; weekly role trend unavailable"
        : "Workload unavailable: completed-game counts are missing or incomplete",
    signals: [],
    snapShare: average("SnapShare"),
    routes: average("RouteParticipation"),
    rushInside5: average("RushInside5"),
    redZoneTargets: average("RedZoneTargets"),
    wopr:
      targetShare !== null && airShare !== null
        ? 1.5 * targetShare + 0.7 * airShare
        : null,
    usageXFP,
    fpoe:
      usageXFP !== null
        ? mean(recent.map((h) => num(h.Points)))! - usageXFP
        : null,
    supplementalStatus: sources.length
      ? `Latest ${recent.length} played-game window; ${sources.join("; ")}. ${compatibleSources ? "Missing coverage stays unavailable." : "Mixed provider definitions: comparisons unavailable."}`
      : "Routes, snaps, air yards, high-value touches and usage-based xFP need supplemental player-week data.",
    market,
    returnWeek:
      own.find((r) => r.Week === current && r.ReturnWeek !== undefined)
        ?.ReturnWeek ?? null,
  };
}

export interface RoleCalibration {
  position: string;
  examples: number;
  tested: number;
  mae: number | null;
  baselineMAE: number | null;
  coefficients: number[] | null;
  forecast: Map<string, number>;
  status: string;
}

// Solve a small least-squares system; singular or negative opportunity coefficients remain unusable.
function fit(rows: { x: number[]; y: number }[]) {
  if (rows.length < 30) return null;
  const size = rows[0].x.length;
  const a = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size + 1 }, (_, j) =>
      sum(rows.map((r) => r.x[i] * (j === size ? r.y : r.x[j]))),
    ),
  );
  for (let i = 0; i < size; i++) {
    const pivot = a
      .slice(i)
      .reduce(
        (best, row, offset) =>
          Math.abs(row[i]) > Math.abs(a[best][i]) ? i + offset : best,
        i,
      );
    [a[i], a[pivot]] = [a[pivot], a[i]];
    if (Math.abs(a[i][i]) < 1e-9) return null;
    const scale = a[i][i];
    a[i] = a[i].map((v) => v / scale);
    for (let k = 0; k < size; k++)
      if (k !== i) {
        const factor = a[k][i];
        a[k] = a[k].map((v, j) => v - factor * a[i][j]);
      }
  }
  const coefficients = a.map((row) => row[size]);
  return coefficients.every(Number.isFinite) &&
    coefficients.slice(1).every((v) => v >= 0)
    ? coefficients
    : null;
}

// Walk forward by scoring week: future scores and workload never enter the training features.
export function calibrateRole(
  d: Dataset,
  histories = playedHistory(d),
): RoleCalibration[] {
  return ["RB", "WR", "TE"].map((position) => {
    const players = d.tables.ModelPlayers.filter(
      (p) => p.Position === position && !p.HistoryIssue,
    );
    const examples: {
      x: number[];
      y: number;
      week: number;
      baseline: number;
    }[] = [];
    const features = (rows: Row[]) =>
      position === "RB"
        ? [
            1,
            count(rows, "RushAttempts") / rows.length,
            count(rows, "Targets") / rows.length,
          ]
        : [1, count(rows, "Targets") / rows.length];
    for (const p of players) {
      const rows = histories.get(str(p.PlayerID)) ?? [];
      for (let i = 2; i < rows.length; i++) {
        const past = rows.slice(0, i),
          recent = past.slice(-3);
        if (
          !countsAvailable(
            recent,
            position === "RB" ? ["RushAttempts", "Targets"] : ["Targets"],
          )
        )
          continue;
        examples.push({
          x: features(recent),
          y: num(rows[i].Points),
          week: num(rows[i].Week),
          baseline: mean(past.map((r) => num(r.Points)))!,
        });
      }
    }
    const errors: number[] = [],
      baselines: number[] = [];
    for (const week of [...new Set(examples.map((r) => r.week))].sort(
      (a, b) => a - b,
    )) {
      const coefficients = fit(examples.filter((r) => r.week < week));
      if (!coefficients) continue;
      for (const row of examples.filter((r) => r.week === week)) {
        errors.push(
          Math.abs(sum(row.x.map((x, i) => x * coefficients[i])) - row.y),
        );
        baselines.push(Math.abs(row.baseline - row.y));
      }
    }
    const coefficients = fit(examples),
      forecast = new Map<string, number>();
    if (coefficients)
      for (const p of players) {
        const recent = (histories.get(str(p.PlayerID)) ?? []).slice(-3);
        if (
          recent.length < 3 ||
          !countsAvailable(
            recent,
            position === "RB" ? ["RushAttempts", "Targets"] : ["Targets"],
          )
        )
          continue;
        forecast.set(
          str(p.PlayerID),
          sum(features(recent).map((x, i) => x * coefficients[i])),
        );
      }
    return {
      position,
      examples: examples.length,
      tested: errors.length,
      mae: mean(errors),
      baselineMAE: mean(baselines),
      coefficients,
      forecast,
      status:
        errors.length >= 30
          ? "Exploratory walk-forward check on this snapshot; not historical validation of the ESPN blend"
          : "Insufficient independent held-out examples; role forecast is experimental",
    };
  });
}
