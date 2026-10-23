import { mean, n, num, str, type Dataset, type Row } from "./contracts";
import type { Player } from "./valuation";

// Version the confirmed scoring-and-workload rule separately from app and workbook versions.
export const gemVersion = "automatic-breakout-3";
export const gemPositions = ["RB", "WR", "TE"] as const;
// Scoring is Gem-only; growth remains part of the unchanged Watch opportunity calculation.
export const defaultGemRules = {
  growthPct: 0.25,
  positions: {
    RB: { mean: 18, floor: 14, growth: 3, points: 16 },
    WR: { mean: 7, floor: 5, growth: 2, points: 16 },
    TE: { mean: 6, floor: 5, growth: 2, points: 11 },
  },
};
export interface GemCheck {
  check: string;
  required: string;
  actual: string;
  status: "PASS" | "FAIL" | "UNKNOWN" | "UNRESOLVED";
}
export interface GemAssessment {
  classification:
    | "Gem"
    | "Watch"
    | "No breakout signal"
    | "Insufficient data"
    | "Not applicable";
  checks: GemCheck[];
  explanation: string;
  recentWeeks: number[];
  previousWeeks: number[];
  recent: number | null;
  previous: number | null;
  increase: number | null;
  growthPct: number | null;
  warnings: string[];
  reducedWorkload: GemCheck | null;
}

// Every qualification gate uses imported played-game data; contextual uncertainty is reported separately.
export function assessGem(
  p: Player,
  rows: Row[],
  d: Dataset,
  now = Date.now(),
): GemAssessment {
  const recentRows = rows.slice(-3),
    previousRows = rows.slice(-6, -3);
  const result: GemAssessment = {
    classification: "Not applicable",
    checks: [],
    explanation:
      "Gem scoring and workload rules apply to RB, WR and TE. Other scoring and regression signals remain separate.",
    recentWeeks: recentRows.map((r) => num(r.Week)),
    previousWeeks: previousRows.map((r) => num(r.Week)),
    recent: null,
    previous: null,
    increase: null,
    growthPct: null,
    warnings: [],
    reducedWorkload: null,
  };
  if (!gemPositions.includes(p.pos as (typeof gemPositions)[number]))
    return result;
  const rule =
    defaultGemRules.positions[p.pos as (typeof gemPositions)[number]];
  // Known null counting stats represent zero; absent, negative and invalid values remain missing evidence.
  const keys = p.pos === "RB" ? ["RushAttempts", "Targets"] : ["Targets"];
  const complete =
    p.historyComplete &&
    rows.length === p.games &&
    new Set(rows.map((r) => r.Week)).size === rows.length;
  const usable = [...recentRows, ...previousRows].every((r) =>
    keys.every(
      (key) =>
        Object.hasOwn(r, key) &&
        (r[key] === null || (n(r[key]) !== null && num(r[key]) >= 0)),
    ),
  );
  const amounts = (bag: Row[]) =>
    bag.map((r) => keys.reduce((total, key) => total + num(r[key]), 0));
  const recent = usable ? amounts(recentRows) : [],
    previous = usable ? amounts(previousRows) : [];
  result.recent = mean(recent);
  result.previous = mean(previous);
  result.increase =
    result.recent !== null && result.previous !== null
      ? result.recent - result.previous
      : null;
  result.growthPct =
    result.increase !== null && result.previous !== null && result.previous > 0
      ? result.increase / result.previous
      : null;
  const historyPass = complete && rows.length >= 5;
  const meanPass = recent.length === 3 && result.recent! >= rule.mean;
  const growthPass =
    previous.length >= 2 &&
    result.increase !== null &&
    result.increase >= rule.growth &&
    (result.previous === 0 || result.growthPct! >= defaultGemRules.growthPct);
  const availabilityPass = !p.uncertain && p.available > 0;
  const unit = p.pos === "RB" ? "carries + targets" : "targets";
  const fmt = (value: number | null) =>
    value === null ? "unavailable" : value.toFixed(2);
  // Flag sustained decline independently: average loss must meet both thresholds and occur in at least two recent games.
  const declineMinimum = p.pos === "RB" ? 3 : 2;
  // Compare totals across window lengths so exact 20% boundaries are not lost to division rounding.
  const previousTotal = previous.reduce((total, value) => total + value, 0);
  const recentTotal = recent.reduce((total, value) => total + value, 0);
  const declineNumerator =
    previousTotal * recent.length - recentTotal * previous.length;
  const lowerGames =
    previous.length >= 2 && result.previous !== null
      ? recent.filter(
          (value) =>
            value * previous.length <=
            previousTotal - declineMinimum * previous.length,
        ).length
      : 0;
  const declining =
    historyPass &&
    usable &&
    result.previous !== null &&
    result.previous > 0 &&
    result.increase !== null &&
    declineNumerator >= declineMinimum * recent.length * previous.length &&
    declineNumerator * 5 >= previousTotal * recent.length &&
    lowerGames >= 2;
  result.reducedWorkload = {
    check: "Reduced workload",
    required: `Average decline ≥ ${declineMinimum} ${unit}/game AND ≥ 20%; at least 2 of the last 3 games ≥ ${declineMinimum} below the earlier average; 5+ verified games`,
    actual: `${fmt(result.previous)} → ${fmt(result.recent)} ${unit}/game; change ${fmt(result.increase)}; ${result.growthPct === null ? "percentage unavailable" : (result.growthPct * 100).toFixed(2) + "%"}; ${lowerGames}/3 recent games meet the decline minimum`,
    status: !historyPass || !usable ? "UNKNOWN" : declining ? "PASS" : "FAIL",
  };
  // Gem uses overlapping three-game windows from the latest four played games; Watch/decline retain their earlier windows.
  const confirmationRows = rows.slice(-4, -1);
  const gemHistoryPass = complete && rows.length >= 4;
  const windows = [
    { name: "Recent window", rows: recentRows },
    { name: "Previous window", rows: confirmationRows },
  ].map((window) => {
    const workloadUsable = window.rows.every((r) =>
      keys.every(
        (key) =>
          Object.hasOwn(r, key) &&
          (r[key] === null || (n(r[key]) !== null && num(r[key]) >= 0)),
      ),
    );
    const pointsUsable = window.rows.every((r) => n(r.Points) !== null);
    const workload = workloadUsable ? amounts(window.rows) : [];
    const points = pointsUsable ? window.rows.map((r) => num(r.Points)) : [];
    const scoresPassing = points.filter((value) => value >= rule.points).length;
    const workloadsPassing = workload.filter(
      (value) => value >= rule.floor,
    ).length;
    const scoreMean = mean(points),
      workloadMean = mean(workload);
    const known = gemHistoryPass && window.rows.length === 3;
    // These domain-owned checks also supply every threshold and observed result to the evidence UI.
    const status = (valid: boolean, passed: boolean): GemCheck["status"] =>
      !known || !valid ? "UNKNOWN" : passed ? "PASS" : "FAIL";
    return [
      {
        check: `${window.name} actual PPG`,
        required: `≥ ${rule.points} points/game`,
        actual: `${fmt(scoreMean)}; weeks ${window.rows.map((r) => num(r.Week)).join(", ") || "none"}`,
        status: status(
          pointsUsable,
          scoreMean !== null && scoreMean >= rule.points,
        ),
      },
      {
        check: `${window.name} scoring support`,
        required: `At least 2 of 3 games ≥ ${rule.points} points`,
        actual:
          pointsUsable && points.length
            ? `${points.join(", ")}; ${scoresPassing}/3 meet the floor`
            : "unavailable",
        status: status(pointsUsable, scoresPassing >= 2),
      },
      {
        check: `${window.name} ${unit} / game`,
        required: `≥ ${rule.mean}`,
        actual: fmt(workloadMean),
        status: status(
          workloadUsable,
          workloadMean !== null && workloadMean >= rule.mean,
        ),
      },
      {
        check: `${window.name} workload support`,
        required: `At least 2 of 3 games ≥ ${rule.floor} ${unit}`,
        actual:
          workloadUsable && workload.length
            ? `${workload.join(", ")}; ${workloadsPassing}/3 meet the floor`
            : "unavailable",
        status: status(workloadUsable, workloadsPassing >= 2),
      },
    ];
  });
  // Qualification and explanations consume the same checks, preventing a label/evidence disagreement.
  result.checks = [
    {
      check: "Verified history",
      required:
        "4+ played games; both overlapping three-game windows must pass",
      actual: `${rows.length} games; recent weeks ${result.recentWeeks.join(", ") || "none"}; previous-window weeks ${confirmationRows.map((r) => num(r.Week)).join(", ") || "none"}`,
      status: !complete ? "UNKNOWN" : gemHistoryPass ? "PASS" : "FAIL",
    },
    ...windows.flat(),
    {
      check: "Availability",
      required: "Active; no unresolved return scenario; remaining games",
      actual: `${p.injury}; ${p.available} available games${p.opportunity.returnWeek !== null ? "; return scenario selected" : ""}`,
      status: availabilityPass ? "PASS" : "UNRESOLVED",
    },
  ];
  // Freshness and injured teammates are automatic warnings, never a request for manual qualification.
  const sourceTime = Date.parse(d.sourceUTC || "");
  if (
    !Number.isFinite(sourceTime) ||
    now - sourceTime > 86400000 ||
    sourceTime > now + 300000
  )
    result.warnings.push(
      `Stale or undated snapshot (${d.sourceUTC || "unavailable"}). Classification describes the imported data; current conditions may differ.`,
    );
  const competition = d.tables.ModelPlayers.filter(
    (r) =>
      str(r.PlayerID) !== p.id &&
      str(r.ProTeamID) === p.nflId &&
      (p.pos === "RB"
        ? r.Position === "RB"
        : ["WR", "TE"].includes(str(r.Position))) &&
      r.InjuryStatus &&
      r.InjuryStatus !== "ACTIVE",
  );
  if (competition.length)
    result.warnings.push(
      `Injured same-team competition: ${competition.map((r) => `${str(r.Player)} (${str(r.InjuryStatus)})`).join(", ")}. This does not establish whether the increased role is temporary.`,
    );
  // Preserve the existing Watch opportunity tests; strong stable production can now independently earn Gem.
  const promising =
    recent.length === 3 &&
    previous.length >= 2 &&
    result.increase !== null &&
    result.increase > 0 &&
    (meanPass || growthPass);
  const shortPromising =
    complete &&
    usable &&
    rows.length < 5 &&
    recent.length > 0 &&
    result.recent! >= rule.mean;
  result.classification = result.checks.every(
    (check) => check.status === "PASS",
  )
    ? "Gem"
    : !complete || !usable || !rows.length
      ? "Insufficient data"
      : promising || shortPromising
        ? "Watch"
        : "No breakout signal";
  result.explanation =
    result.classification === "Gem"
      ? "Strong actual scoring backed by sustained workload in both consecutive, overlapping three-game windows. Workload growth is not required. This identifies a strong production candidate, not a guaranteed breakout or proof of an undervalued player."
      : result.classification === "Watch"
        ? `Workload opportunity meets the existing Watch criteria but does not pass every Gem gate. ${result.checks
            .filter((c) => c.status !== "PASS")
            .map((c) => c.check + ": " + c.status)
            .join("; ")}.`
        : result.classification === "Insufficient data"
          ? "Verified played-game evidence is missing, inconsistent or invalid. Gem requires both actual scoring and workload."
          : "No qualifying Gem or developing-workload signal under the automatic rules.";
  return result;
}
