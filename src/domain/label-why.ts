// The Why panel is presentation-only: every status, margin, sentence and chart value is built here.
import { defaultGemRules, gemPositions, labelPolicy } from "./label-rules";
import {
  historicalLabelContext,
  labelResearchNote,
} from "./historical-label-reference";
import { evidenceMeter } from "./evidence-meter";
import type { EvidenceComparison } from "./evidence-comparison";
import { mean, n, num, type Row } from "./contracts";
import { playedHistory } from "./opportunity";
import {
  tagExplanation,
  type TagEvidenceRow,
  type TagExplanation,
} from "./tag-evidence";
import { playerSignals, type Model, type Player } from "./valuation";

// These are the only analytical labels the Why panel explains.
export const LABEL_TAGS = [
  "Gem",
  "Pre-gem",
  "Watch",
  "Role-growth watch",
  "Scoring breakout watch",
  "Projection-gap watch",
  "SELL HIGH",
  "TD caution",
  "BUY LOW",
  "Reduced workload",
] as const;
export type LabelTag = (typeof LABEL_TAGS)[number];

export type LabelTone = "positive" | "warning";
export type GateStatus = "PASS" | "FAIL" | "UNKNOWN";
export type GateGroup = "signal" | "trust";
export type ThresholdSource = "setting" | "policy" | "espn" | "model";
export type MarginTone = "spare" | "close" | "at-line" | "short" | "none";

export interface WhyGate {
  id: string;
  label: string;
  sublabel?: string;
  group: GateGroup;
  status: GateStatus;
  kind: "numeric" | "condition";
  value: string;
  threshold?: string;
  thresholdSource?: ThresholdSource;
  margin: { text: string; tone: MarginTone };
  meter?: {
    player: number;
    threshold: number;
    clippedHigh: boolean;
    clippedLow: boolean;
    favorableIncreases: boolean;
  };
  numeric?: {
    threshold: number;
    value: number;
    unit: string;
    operator: "≥" | ">" | "≤" | "<";
  };
  sample?: "games" | "opportunities";
  shortPhrase?: string;
  pill?: string;
  historical?: { short: string; note: string; unavailable?: boolean };
  detail?: EvidenceComparison[];
  // Normalized only for ordering near misses; the UI never displays it.
  shortfall: number;
}

export interface WhyChart {
  metric: "workload" | "points";
  unitLabel: string;
  bars: {
    week: number;
    season: number;
    value: number | null;
    window: "recent" | "earlier" | "unused";
  }[];
  lines: {
    kind: "earlierAvg" | "recentAvg" | "threshold" | "espn" | "seasonAvg";
    value: number;
    from: "earlier" | "recent" | "all";
    label: string;
    source?: ThresholdSource;
  }[];
  jump?: { from: number; to: number; label: string; tone: "spare" | "short" };
  gap?: { from: number; to: number; label: string };
  note?: string;
  ariaLabel: string;
}

export interface WhyGameRow {
  season: number;
  week: number;
  window: "recent" | "earlier" | "unused";
  points: number | null;
  targets?: number | null;
  carries?: number | null;
  tds?: number | null;
}

export interface LabelWhy {
  tag: LabelTag;
  tone: LabelTone;
  state: "earned" | "near";
  failed: number;
  shortfall: number;
  chip: string;
  verdict: string;
  summary: string;
  groups: {
    id: GateGroup;
    title: string;
    met: number;
    total: number;
    gates: WhyGate[];
  }[];
  nearSections?: {
    id: "not-met" | "already-met";
    title: "Not met" | "Already met";
    count: number;
    gates: WhyGate[];
  }[];
  warnings: string[];
  flip?: { headline: string; detail: string; caveat: string };
  closest?: { headline: string; detail: string };
  chart?: WhyChart;
  games: WhyGameRow[];
  canAdjust: boolean;
  stale: boolean;
  details: {
    meaning: string;
    interpretation?: string;
    limitations?: string;
    researchNote: string;
    window?: string;
    sourceUTC: string | null;
    notes: string[];
  };
}

export const WHY_CLOSE_FRACTION = 0.25;

// Warning labels are the adverse touchdown-regression signals; their margins use trigger wording.
const WARNING_TAGS: LabelTag[] = ["SELL HIGH", "TD caution", "Reduced workload"];
const TRIGGER_TAGS: LabelTag[] = ["SELL HIGH", "TD caution"];
const PRIMARY_RANK: Partial<Record<LabelTag, number>> = {
  Gem: 0,
  "Pre-gem": 1,
  Watch: 2,
};
const POSITIVE_ORDER: LabelTag[] = [
  "Gem",
  "Pre-gem",
  "Watch",
  "Role-growth watch",
  "Scoring breakout watch",
  "Projection-gap watch",
];
const WARNING_ORDER: LabelTag[] = [
  "SELL HIGH",
  "TD caution",
  "BUY LOW",
  "Reduced workload",
];

const format2 = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(2)
    : "Unavailable";
const formatPercent = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${(value * 100).toFixed(2)}%`
    : "Unavailable";
const capitalize = (value: string) =>
  value.length ? value[0].toUpperCase() + value.slice(1) : value;
const plural = (count: number, one: string, many = `${one}s`) =>
  count === 1 ? one : many;

// Workload units stay position-specific and match the classifier's own wording.
function workloadUnit(p: Player) {
  return p.pos === "QB"
    ? "carries"
    : p.pos === "RB"
      ? "carries + targets"
      : "targets";
}
function roleMinimum(p: Player, m: Model) {
  if (p.pos === "QB") return labelPolicy.qbCarries;
  if (p.pos === "RB") return m.settings.GemRBOpportunities;
  if (p.pos === "WR") return m.settings.GemWRTargets;
  if (p.pos === "TE") return m.settings.GemTETargets;
  return Infinity;
}
function gemRule(p: Player) {
  return p.pos === "RB" || p.pos === "WR" || p.pos === "TE"
    ? defaultGemRules.positions[p.pos]
    : defaultGemRules.positions.WR;
}

// Display formatting keeps the unit in the value column and never turns null into zero.
function formatValue(value: number, unit: string) {
  if (unit === "%") return `${(value * 100).toFixed(2)}%`;
  if (unit === "games") return `${value.toFixed(0)} games`;
  if (unit === "opportunities") return `${value.toFixed(0)} opportunities`;
  if (unit === "PPG") return `${value.toFixed(2)} PPG`;
  if (unit === "points") return `${value.toFixed(2)} points`;
  return `${value.toFixed(2)} ${unit}`;
}
// Thresholds stay numeric in their own column; the unit is already in the value column.
function formatThreshold(value: number, unit: string) {
  if (unit === "%") return `${(value * 100).toFixed(0)}%`;
  if (unit === "games" || unit === "opportunities")
    return value.toFixed(0);
  return value.toFixed(2);
}
// Whole percentages avoid "0%" when a real but sub-point shortfall rounds down.
function wholePercent(value: number) {
  const points = Math.round(Math.abs(value) * 100);
  return points === 0 && Math.abs(value) > 0 ? "<1" : `${points}`;
}
function formatDelta(value: number, unit: string) {
  if (unit === "games" || unit === "opportunities")
    return `${Math.abs(Math.round(value))}`;
  if (unit === "%") return `${wholePercent(value)}%`;
  return Math.abs(value).toFixed(2);
}
function formatShort(shortfall: number, unit: string) {
  if (unit === "games")
    return `${Math.max(1, Math.round(shortfall))} ${plural(Math.max(1, Math.round(shortfall)), "game")} short`;
  if (unit === "opportunities")
    return `${Math.max(1, Math.round(shortfall))} ${plural(Math.max(1, Math.round(shortfall)), "opportunity", "opportunities")} short`;
  if (unit === "%") return `${wholePercent(shortfall)}% short`;
  return `${shortfall.toFixed(2)} short`;
}
function formatLongShort(shortfall: number, unit: string) {
  if (unit === "%") {
    const points = Math.round(Math.abs(shortfall) * 100);
    return `${wholePercent(shortfall)} ${plural(points <= 1 ? 1 : 2, "percentage point")} short`;
  }
  return formatShort(shortfall, unit);
}
function normalizedShortfall(shortfall: number, threshold: number, unit: string) {
  const span = Math.max(
    Math.abs(threshold),
    unit === "%" ? 0.01 : unit === "games" || unit === "opportunities" ? 1 : 1,
  );
  return Math.abs(shortfall) / span;
}

// Condition outcomes are binary; numeric outcomes reuse the same meter as the legacy evidence UI.
function comparisonStatus(
  comparison: EvidenceComparison,
  tag: string,
  check: string,
  remainingWeeks: number,
): GateStatus {
  if (comparison.condition)
    return comparison.condition === "PASS" || comparison.condition === "WAIVED"
      ? "PASS"
      : comparison.condition === "FAIL"
        ? "FAIL"
        : "UNKNOWN";
  if (
    !comparison.numeric ||
    comparison.numeric.value === null ||
    comparison.numeric.threshold === null
  )
    return "UNKNOWN";
  const meter = evidenceMeter(comparison, tag, check, remainingWeeks);
  return meter?.qualifies ? "PASS" : "FAIL";
}

// A condition FAIL has no numeric distance; it is only ever used for blocked trust gates.
function marginFor(
  comparison: EvidenceComparison,
  status: GateStatus,
  trigger: boolean,
): { text: string; tone: MarginTone; shortfall: number } {
  if (comparison.condition) {
    if (comparison.condition === "WAIVED")
      return { text: "Waived", tone: "none", shortfall: 0 };
    if (comparison.condition === "UNKNOWN")
      return { text: "Unavailable", tone: "none", shortfall: 0 };
    if (comparison.condition === "PASS")
      return { text: "Yes", tone: "none", shortfall: 0 };
    return { text: "No", tone: "none", shortfall: 1 };
  }
  const numeric = comparison.numeric;
  if (!numeric || numeric.value === null || numeric.threshold === null)
    return { text: "Unavailable", tone: "none", shortfall: 0 };
  const minimum = numeric.operator === "≥" || numeric.operator === ">";
  const favorable = minimum
    ? numeric.value - numeric.threshold
    : numeric.threshold - numeric.value;
  const shortfall = Math.max(0, -favorable);
  if (status === "UNKNOWN")
    return { text: "Unavailable", tone: "none", shortfall: 0 };
  if (status === "FAIL")
    return {
      text: trigger
        ? `${formatDelta(shortfall, numeric.unit)} short of the trigger`
        : formatShort(shortfall, numeric.unit),
      tone: "short",
      shortfall: normalizedShortfall(
        shortfall,
        numeric.threshold,
        numeric.unit,
      ),
    };
  if (Math.abs(favorable) <= 1e-9)
    return { text: "Right at the line", tone: "at-line", shortfall: 0 };
  if (trigger)
    return {
      text: `${formatDelta(favorable, numeric.unit)} ${minimum ? "past" : "under"} the trigger`,
      tone: "spare",
      shortfall: 0,
    };
  if (!minimum)
    return {
      text: `${formatDelta(favorable, numeric.unit)} under the limit`,
      tone: "spare",
      shortfall: 0,
    };
  const threshold = Math.abs(numeric.threshold);
  if (threshold > 0 && numeric.unit !== "games") {
    const ratio = favorable / threshold;
    if (ratio >= 1)
      return {
        text: `${(numeric.value / numeric.threshold).toFixed(1)}× the bar`,
        tone: "spare",
        shortfall: 0,
      };
    if (ratio <= WHY_CLOSE_FRACTION)
      return {
        text: `+${formatDelta(favorable, numeric.unit)} · close call`,
        tone: "close",
        shortfall: 0,
      };
  }
  return {
    text: `+${formatDelta(favorable, numeric.unit)} spare`,
    tone: "spare",
    shortfall: 0,
  };
}

type Phrase = (gate: WhyGate, p: Player) => string;

interface BlueprintBase {
  id: string;
  label: string;
  sublabel?: string;
  group: GateGroup;
  thresholdSource: ThresholdSource;
  sample?: "games" | "opportunities";
  historicalCheck?: string;
  phrase?: Phrase;
  kind?: "numeric" | "condition";
  // Compact label used by passing trust pills, e.g. "earlier games".
  pillLabel?: string;
}
interface SimpleBlueprint extends BlueprintBase {
  row: string;
  index: number;
}
interface CompoundBlueprint extends BlueprintBase {
  parts: { row: string; index: number }[];
  routes: number[][];
}
type Blueprint = SimpleBlueprint | CompoundBlueprint;

const bp = (value: SimpleBlueprint): SimpleBlueprint => value;
const samplePhrase = (gate: WhyGate) => {
  if (gate.sample === "games" && gate.numeric) {
    const k = Math.max(1, Math.round(gate.numeric.threshold - gate.numeric.value));
    return `${k} more ${plural(k, "game")} ${k === 1 ? "is" : "are"} needed`;
  }
  if (gate.sample === "opportunities" && gate.numeric) {
    const k = Math.max(
      1,
      Math.ceil(gate.numeric.threshold - gate.numeric.value),
    );
    return `about ${k} more ${plural(k, "opportunity", "opportunities")} ${k === 1 ? "is" : "are"} needed`;
  }
  return "";
};
// Recover the absolute shortfall from the numeric operands; never use the normalized sort key.
const absoluteShortfall = (gate: WhyGate) => {
  if (!gate.numeric) return 0;
  const minimum =
    gate.numeric.operator === "≥" || gate.numeric.operator === ">";
  return Math.max(
    0,
    minimum
      ? gate.numeric.threshold - gate.numeric.value
      : gate.numeric.value - gate.numeric.threshold,
  );
};
// Phrases that already say "short" need the bare amount to avoid "short short".
const shortAmount = (gate: WhyGate) => {
  if (!gate.numeric) return "0";
  return formatShort(absoluteShortfall(gate), gate.numeric.unit).replace(
    / short$/,
    "",
  );
};
// Percentage sentences spell out "percentage points"; compact pills keep "% short".
const shortPercentagePoints = (gate: WhyGate) => {
  const points = Math.round(absoluteShortfall(gate) * 100);
  return `${wholePercent(absoluteShortfall(gate))} ${plural(points <= 1 ? 1 : 2, "percentage point")}`;
};

// Blueprints map the legacy evidence rows onto the new plain-language gates.
const BLUEPRINTS: Record<string, Blueprint[]> = {
  "Role-growth watch": [
    bp({ id: "role-growth.history", label: "Full game history", group: "trust", row: "Verified history and model", index: 0, thresholdSource: "policy", kind: "condition" }),
    bp({ id: "role-growth.model", label: "Model data usable", group: "trust", row: "Verified history and model", index: 1, thresholdSource: "policy", kind: "condition" }),
    bp({ id: "role-growth.recent-games", label: "Recent games played", group: "trust", row: "Workload sample", index: 0, thresholdSource: "policy", sample: "games", pillLabel: "recent games" }),
    bp({ id: "role-growth.earlier-games", label: "Earlier games played", group: "trust", row: "Workload sample", index: 1, thresholdSource: "setting", sample: "games", pillLabel: "earlier games" }),
    bp({ id: "role-growth.recent-rate", label: "Recent {unit}", group: "signal", row: "Recent workload", index: 0, thresholdSource: "setting", historicalCheck: "Recent workload", phrase: (g, p) => `recent ${workloadUnit(p)} are ${shortAmount(g)} short` }),
    bp({ id: "role-growth.jump", label: "Jump vs. earlier", group: "signal", row: "Workload increase", index: 0, thresholdSource: "policy", historicalCheck: "Workload increase", phrase: (g) => `the jump is ${shortAmount(g)} short` }),
    bp({ id: "role-growth.jump-share", label: "Jump as a share", group: "signal", row: "Workload increase", index: 1, thresholdSource: "policy", phrase: (g) => `the relative jump is ${shortAmount(g)} short` }),
  ],
  "Scoring breakout watch": [
    bp({ id: "scoring.history", label: "Full game history", group: "trust", row: "Verified history and model", index: 0, thresholdSource: "policy", kind: "condition" }),
    bp({ id: "scoring.model", label: "Model data usable", group: "trust", row: "Verified history and model", index: 1, thresholdSource: "policy", kind: "condition" }),
    bp({ id: "scoring.games", label: "Games played", group: "trust", row: "Played-game sample", index: 0, thresholdSource: "setting", sample: "games", pillLabel: "games" }),
    bp({ id: "scoring.recent-ppg", label: "Recent PPG vs. ESPN projection", group: "signal", row: "Recent actual PPG", index: 0, thresholdSource: "espn", historicalCheck: "Recent actual PPG", phrase: (g) => `the recent average is ${shortAmount(g)} under ESPN's projection` }),
    bp({ id: "scoring.jump", label: "Scoring jump vs. earlier", group: "signal", row: "Scoring improvement", index: 0, thresholdSource: "setting", historicalCheck: "Scoring improvement", phrase: (g) => `the jump is ${shortAmount(g)} short of the ${g.threshold?.replace(/^[^0-9-]*/, "") ?? "required"} needed` }),
  ],
  "Projection-gap watch": [
    bp({ id: "projection.history", label: "Full game history", group: "trust", row: "Verified history and model", index: 0, thresholdSource: "policy", kind: "condition" }),
    bp({ id: "projection.model", label: "Model data usable", group: "trust", row: "Verified history and model", index: 1, thresholdSource: "policy", kind: "condition" }),
    bp({ id: "projection.games", label: "Games played", group: "trust", row: "Played-game sample", index: 0, thresholdSource: "setting", sample: "games", pillLabel: "games" }),
    bp({ id: "projection.gap", label: "Season PPG above ESPN", group: "signal", row: "Season scoring gap", index: 0, thresholdSource: "setting", phrase: (g) => `the season gap is ${shortAmount(g)} short` }),
    bp({ id: "projection.gap-share", label: "Gap as a share", group: "signal", row: "Relative scoring gap", index: 0, thresholdSource: "setting", phrase: (g) => `the relative gap is ${shortPercentagePoints(g)} short` }),
    bp({ id: "projection.recent-ppg", label: "Recent PPG vs. ESPN projection", group: "signal", row: "Recent actual PPG", index: 0, thresholdSource: "espn", phrase: (g) => `the recent average is ${shortAmount(g)} under ESPN's projection` }),
  ],
  Watch: [
    bp({ id: "watch.games", label: "Games played", group: "trust", row: "Verified history", index: 0, thresholdSource: "policy", sample: "games", pillLabel: "games" }),
    bp({ id: "watch.history", label: "Full game history", group: "trust", row: "Verified history", index: 1, thresholdSource: "policy", kind: "condition" }),
    bp({ id: "watch.workload", label: "Workload counts usable", group: "trust", row: "Verified history", index: 2, thresholdSource: "policy", kind: "condition" }),
    bp({ id: "watch.short-level", label: "Recent {unit}", group: "signal", row: "Recent workload", index: 0, thresholdSource: "policy", historicalCheck: "Recent workload", phrase: (g, p) => `recent ${workloadUnit(p)} are ${shortAmount(g)} short` }),
    bp({ id: "watch.rising", label: "Workload is rising", group: "signal", row: "Positive workload change", index: 0, thresholdSource: "policy", historicalCheck: "Positive workload change", phrase: () => "workload is not rising" }),
    {
      id: "watch.volume-or-growth",
      label: "Volume or growth",
      group: "signal",
      thresholdSource: "policy",
      historicalCheck: "Recent workload",
      parts: [
        { row: "Level OR growth route", index: 0 },
        { row: "Level OR growth route", index: 1 },
        { row: "Level OR growth route", index: 2 },
      ],
      routes: [[0], [1, 2]],
      phrase: () => "neither the workload level nor the growth route clears",
    },
  ],
  "Reduced workload": [
    bp({ id: "reduced.decline", label: "Average drop", group: "signal", row: "Sustained workload decline", index: 0, thresholdSource: "policy", phrase: (g) => `the average drop is ${shortAmount(g)} short` }),
    bp({ id: "reduced.decline-share", label: "Drop as a share", group: "signal", row: "Sustained workload decline", index: 1, thresholdSource: "policy", phrase: (g) => `the relative drop is ${shortPercentagePoints(g)} short` }),
    bp({ id: "reduced.lower-games", label: "Games clearly lower", group: "signal", row: "Sustained workload decline", index: 2, thresholdSource: "policy", phrase: (g) => samplePhrase(g) || "not enough lower games" }),
    bp({ id: "reduced.games", label: "Games played", group: "trust", row: "Sustained workload decline", index: 3, thresholdSource: "policy", sample: "games", pillLabel: "games" }),
    bp({ id: "reduced.history", label: "Full game history", group: "trust", row: "Sustained workload decline", index: 4, thresholdSource: "policy", kind: "condition" }),
    bp({ id: "reduced.workload", label: "Workload counts usable", group: "trust", row: "Sustained workload decline", index: 5, thresholdSource: "policy", kind: "condition" }),
    bp({ id: "reduced.prior-positive", label: "Earlier workload above zero", group: "signal", row: "Sustained workload decline", index: 6, thresholdSource: "policy", phrase: () => "earlier workload must be above zero" }),
  ],
};

// Regression blueprints are shared by BUY LOW, SELL HIGH and TD caution.
function regressionBlueprints(tag: LabelTag): Blueprint[] {
  const buy = tag === "BUY LOW";
  const list: Blueprint[] = [];
  if (tag === "TD caution")
    list.push(
      bp({ id: "td.history", label: "Full game history", group: "trust", row: "Verified history and model", index: 0, thresholdSource: "policy", kind: "condition" }),
      bp({ id: "td.model", label: "Model data usable", group: "trust", row: "Verified history and model", index: 1, thresholdSource: "policy", kind: "condition" }),
      bp({ id: "td.games", label: "Games played", group: "trust", row: "Played-game sample", index: 0, thresholdSource: "setting", sample: "games", pillLabel: "games" }),
    );
  list.push(
    bp({ id: "regression.opportunities", label: "Opportunities (sample)", group: "trust", row: "Minimum opportunity sample", index: 0, thresholdSource: "setting", sample: "opportunities", pillLabel: "opportunities" }),
    bp({ id: "regression.volume", label: buy ? "High-volume role" : "Not a high-volume role", group: "signal", row: "Positional volume test", index: 0, thresholdSource: "model", phrase: (g) => `the volume is ${shortAmount(g)} short of the cutoff` }),
    bp({ id: "regression.td-rate", label: buy ? "TD rate below norm" : "TD rate above norm", group: "signal", row: "Player touchdown rate", index: 0, thresholdSource: "model", phrase: (g) => `the TD rate is ${shortPercentagePoints(g)} short of the trigger` }),
  );
  return list;
}

// Gem and Pre-gem gates come directly from the classifier checks, preserving their exact statuses.
function gemGateBlueprints(tag: "Gem" | "Pre-gem"): Blueprint[] {
  const prefix = tag === "Gem" ? "gem" : "pre-gem";
  const list: Blueprint[] = [
    bp({ id: `${prefix}.games`, label: "Games played", group: "trust", row: "Verified history", index: 0, thresholdSource: "policy", sample: "games", pillLabel: "games" }),
    bp({ id: `${prefix}.recent-ppg`, label: "Recent 3 · PPG", group: "signal", row: "Recent window actual PPG", index: 0, thresholdSource: "policy", historicalCheck: "Recent window actual PPG", phrase: (g) => `recent PPG is ${shortAmount(g)} short` }),
    bp({ id: `${prefix}.recent-scoring-support`, label: "Recent 3 · scoring games", group: "signal", row: "Recent window scoring support", index: 0, thresholdSource: "policy", phrase: (g) => samplePhrase(g) || "not enough scoring games" }),
    bp({ id: `${prefix}.recent-workload`, label: "Recent 3 · {unit}/game", group: "signal", row: "Recent window {workload} / game", index: 0, thresholdSource: "policy", historicalCheck: "Recent window targets / game", phrase: (g, p) => `recent ${workloadUnit(p)} are ${shortAmount(g)} short` }),
    bp({ id: `${prefix}.recent-workload-support`, label: "Recent 3 · workload games", group: "signal", row: "Recent window workload support", index: 0, thresholdSource: "policy", phrase: (g) => samplePhrase(g) || "not enough workload games" }),
  ];
  if (tag === "Gem")
    list.push(
      bp({ id: "gem.previous-ppg", label: "Previous 3 · PPG", group: "signal", row: "Previous window actual PPG", index: 0, thresholdSource: "policy", phrase: (g) => `previous PPG is ${shortAmount(g)} short` }),
      bp({ id: "gem.previous-scoring-support", label: "Previous 3 · scoring games", group: "signal", row: "Previous window scoring support", index: 0, thresholdSource: "policy", phrase: (g) => samplePhrase(g) || "not enough scoring games" }),
      bp({ id: "gem.previous-workload", label: "Previous 3 · {unit}/game", group: "signal", row: "Previous window {workload} / game", index: 0, thresholdSource: "policy", phrase: (g, p) => `previous ${workloadUnit(p)} are ${shortAmount(g)} short` }),
      bp({ id: "gem.previous-workload-support", label: "Previous 3 · workload games", group: "signal", row: "Previous window workload support", index: 0, thresholdSource: "policy", phrase: (g) => samplePhrase(g) || "not enough workload games" }),
    );
  list.push(
    bp({ id: `${prefix}.availability`, label: "Available to play", group: "trust", row: "Availability", index: 0, thresholdSource: "policy", kind: "condition", phrase: () => "availability is unresolved" }),
  );
  return list;
}

// Locate a row without assuming it exists; unavailable rows never create a fabricated gate.
function findRow(explanation: TagExplanation, name: string) {
  return explanation.rows.find((row) => row.check === name);
}
const resolveRow = (name: string, p: Player) =>
  name.replace("{workload}", workloadUnit(p));

// Build one gate from one comparison, keeping the legacy comparison detail for the expanded row.
function gateFromComparison(
  spec: BlueprintBase,
  tag: LabelTag,
  p: Player,
  m: Model,
  check: string,
  comparison: EvidenceComparison | undefined,
  status: GateStatus,
  detail?: EvidenceComparison[],
): WhyGate | null {
  if (!comparison) return null;
  const kind = spec.kind ?? (comparison.condition ? "condition" : "numeric");
  const label = spec.label
    .replace("{unit}", workloadUnit(p))
    .replace("{workload}", workloadUnit(p));
  const numeric =
    comparison.numeric &&
    comparison.numeric.value !== null &&
    comparison.numeric.threshold !== null
      ? {
          threshold: comparison.numeric.threshold,
          value: comparison.numeric.value,
          unit: comparison.numeric.unit,
          operator: comparison.numeric.operator,
        }
      : undefined;
  const meter = evidenceMeter(comparison, tag, check, m.weeks.length);
  const trigger =
    TRIGGER_TAGS.includes(tag) &&
    (spec.id === "regression.volume" || spec.id === "regression.td-rate");
  const margin = marginFor(comparison, status, trigger);
  const historical = spec.historicalCheck
    ? historicalLabelContext(tag, spec.historicalCheck, p, m)
    : undefined;
  const gate: WhyGate = {
    id: spec.id,
    label,
    sublabel: spec.sublabel,
    group: spec.group,
    status,
    kind,
    value:
      kind === "condition"
        ? comparison.actual
        : numeric
          ? formatValue(numeric.value, numeric.unit)
          : comparison.actual,
    threshold:
      kind === "condition"
        ? comparison.required
        : numeric
          ? `${numeric.operator} ${formatThreshold(numeric.threshold, numeric.unit)}`
          : comparison.required,
    thresholdSource: spec.thresholdSource,
    margin: { text: margin.text, tone: margin.tone },
    meter: meter
      ? {
          player: meter.playerPosition,
          threshold: meter.thresholdPosition,
          clippedHigh: meter.outside.includes("Above"),
          clippedLow: meter.outside.includes("Below"),
          favorableIncreases: meter.favorableIncreases,
        }
      : undefined,
    numeric,
    sample: spec.sample,
    pill:
      kind === "condition"
        ? `✓ ${label}`
        : spec.sample && numeric
          ? `✓ ${numeric.value.toFixed(0)} ${spec.pillLabel ?? "games"} (needs ${numeric.threshold.toFixed(0)})`
          : undefined,
    historical: historical
      ? {
          short: historical.short,
          note: historical.note,
          unavailable: historical.unavailable,
        }
      : undefined,
    detail,
    shortfall: margin.shortfall,
  };
  gate.shortPhrase = spec.phrase?.(gate, p) ?? (spec.sample ? samplePhrase(gate) : undefined);
  return gate;
}

// Map a tag's explanation rows through its blueprints.
function gatesFromBlueprints(
  tag: LabelTag,
  explanation: TagExplanation,
  p: Player,
  m: Model,
): WhyGate[] {
  const specs =
    tag === "Gem" || tag === "Pre-gem"
      ? gemGateBlueprints(tag)
      : tag === "BUY LOW" || tag === "SELL HIGH" || tag === "TD caution"
        ? regressionBlueprints(tag)
        : BLUEPRINTS[tag] ?? [];
  const gates: WhyGate[] = [];
  for (const spec of specs) {
    if ("parts" in spec) {
      const comparisons = spec.parts.map((part) =>
        findRow(explanation, part.row)?.comparisons?.[part.index],
      );
      const statuses = comparisons.map((comparison, i) =>
        comparison
          ? comparisonStatus(
              comparison,
              tag,
              spec.parts[i].row,
              m.weeks.length,
            )
          : "UNKNOWN",
      );
      const routeStatus = spec.routes.map((route) =>
        route.every((index) => statuses[index] === "PASS")
          ? "PASS"
          : route.some((index) => statuses[index] === "FAIL")
            ? "FAIL"
            : "UNKNOWN",
      );
      const status: GateStatus = routeStatus.includes("PASS")
        ? "PASS"
        : routeStatus.every((value) => value === "FAIL")
          ? "FAIL"
          : "UNKNOWN";
      // Show the route closest to passing, while retaining every alternative in the detail.
      const passingRoute = spec.routes.find(
        (route) => routeStatus[spec.routes.indexOf(route)] === "PASS",
      );
      const chosen =
        passingRoute ??
        [...spec.routes].sort(
          (a, b) =>
            a.filter((index) => statuses[index] !== "PASS").length -
            b.filter((index) => statuses[index] !== "PASS").length,
        )[0];
      const primary = chosen
        .map((index) => comparisons[index])
        .find((comparison) => comparison);
      const gate = gateFromComparison(
        spec,
        tag,
        p,
        m,
        spec.parts[0].row,
        primary,
        status,
        comparisons.filter((value): value is EvidenceComparison => !!value),
      );
      if (gate) gates.push(gate);
      continue;
    }
    const row = findRow(explanation, resolveRow(spec.row, p));
    const comparison = row?.comparisons?.[spec.index];
    if (!row || !comparison) continue;
    const status =
      spec.kind === "condition" && row.status
        ? row.status === "PASS"
          ? "PASS"
          : row.status === "FAIL"
            ? "FAIL"
            : "UNKNOWN"
        : comparisonStatus(comparison, tag, row.check, m.weeks.length);
    const gate = gateFromComparison(
      spec,
      tag,
      p,
      m,
      row.check,
      comparison,
      status,
      row.comparisons,
    );
    if (gate) gates.push(gate);
  }
  return gates;
}

// Gem/Pre-gem gate statuses follow the classifier's check status, not a re-derived predicate.
function gatesFromChecks(
  tag: "Gem" | "Pre-gem",
  checks: TagEvidenceRow[],
  p: Player,
  m: Model,
): WhyGate[] {
  const explanation: TagExplanation = {
    tag,
    meaning: "",
    rows: checks,
    interpretation: "",
    limitations: "",
    window: "",
  };
  const specs = gemGateBlueprints(tag);
  const gates: WhyGate[] = [];
  for (const spec of specs) {
    const simple = spec as SimpleBlueprint;
    const row = findRow(explanation, resolveRow(simple.row, p));
    if (!row) continue;
    const comparison = row.comparisons?.[simple.index];
    if (!comparison) continue;
    const status: GateStatus =
      row.status === "PASS"
        ? "PASS"
        : row.status === "FAIL"
          ? "FAIL"
          : "UNKNOWN";
    const gate = gateFromComparison(
      simple,
      tag,
      p,
      m,
      row.check,
      comparison,
      status,
      row.comparisons,
    );
    if (gate) gates.push(gate);
  }
  return gates;
}

// Applicability prevents a near miss from appearing for a position the label does not cover.
function applicable(tag: LabelTag, p: Player) {
  if (["Gem", "Pre-gem", "Watch", "Reduced workload"].includes(tag))
    return gemPositions.includes(p.pos as (typeof gemPositions)[number]);
  if (["BUY LOW", "SELL HIGH", "TD caution"].includes(tag))
    return (
      ["RB", "WR", "TE"].includes(p.pos) && !!p.regressionEvidence
    );
  return ["QB", "RB", "WR", "TE"].includes(p.pos);
}

// Group titles are only used by earned labels; near labels use Not met / Already met sections.
function groupTitle(tag: LabelTag, group: GateGroup) {
  if (group === "trust") return "Is there enough to trust?";
  if (tag === "Reduced workload") return "Is the workload really down?";
  if (tag === "Scoring breakout watch") return "Is the scoring really up?";
  if (tag === "Projection-gap watch") return "Is scoring beating the projection?";
  if (tag === "Gem" || tag === "Pre-gem") return "Is the production real?";
  if (["BUY LOW", "SELL HIGH", "TD caution"].includes(tag))
    return "Is the TD rate out of line?";
  return "Is the workload really up?";
}

// Split gates into signal/trust groups while preserving the blueprint order.
function groupsFor(tag: LabelTag, gates: WhyGate[]) {
  return (["signal", "trust"] as const).map((id) => {
    const list = gates.filter((gate) => gate.group === id);
    return {
      id,
      title: groupTitle(tag, id),
      met: list.filter((gate) => gate.status === "PASS").length,
      total: list.length,
      gates: list,
    };
  });
}

// Near layout partitions FAIL and PASS gates; UNKNOWN is impossible here by construction.
function nearSectionsFor(gates: WhyGate[]) {
  const order = (gate: WhyGate) =>
    gate.group === "signal" ? 0 : 1;
  const failed = gates
    .filter((gate) => gate.status === "FAIL")
    .sort((a, b) => order(a) - order(b));
  const passed = gates
    .filter((gate) => gate.status === "PASS")
    .sort((a, b) => order(a) - order(b));
  return [
    {
      id: "not-met" as const,
      title: "Not met" as const,
      count: failed.length,
      gates: failed,
    },
    {
      id: "already-met" as const,
      title: "Already met" as const,
      count: passed.length,
      gates: passed,
    },
  ];
}

// Base summary copy uses recorded values only; missing values fall back to the legacy meaning.
function baseSummary(tag: LabelTag, p: Player): string {
  const unit = workloadUnit(p);
  const assessment = p.breakout;
  if (tag === "Role-growth watch")
    return `${capitalize(unit)} climbed from ${format2(p.opportunity.priorRate)} to ${format2(p.opportunity.recentRate)} a game over the last 3 games.`;
  if (tag === "Watch") {
    if (assessment?.recent === null || assessment?.recent === undefined)
      return `Recent ${unit} workload is unavailable.`;
    if (assessment.previous === null)
      return `${capitalize(unit)} are ${format2(assessment.recent)} a game in the early sample.`;
    return `${capitalize(unit)} went from ${format2(assessment.previous)} to ${format2(assessment.recent)} a game.`;
  }
  if (tag === "Scoring breakout watch")
    return `Scoring is up ${format2(p.trendDelta)} points a game.`;
  if (tag === "Projection-gap watch")
    return `${format2(p.actual)} PPG this season vs. ESPN's ${format2(p.projected)}; last 3 games: ${format2(p.recent)}.`;
  if (tag === "Gem")
    return `Last 3 games: ${format2(p.recent)} PPG on ${format2(assessment?.recent)} ${unit} a game.`;
  if (tag === "Pre-gem") {
    const trend = p.breakout?.preGemChecks
      .find((check) => check.check === "Scoring improvement")
      ?.comparisons?.[0]?.numeric?.value;
    const direction = (trend ?? 0) >= 0 ? "up" : "down";
    return `Scoring is ${direction} ${format2(Math.abs(trend ?? 0))} PPG with workload holding at ${format2(assessment?.recent)} ${unit} a game.`;
  }
  if (tag === "Reduced workload")
    return `${capitalize(unit)} fell from ${format2(assessment?.previous)} to ${format2(assessment?.recent)} a game.`;
  if (tag === "BUY LOW")
    return `${format2(p.opportunities)} opportunities but a ${formatPercent(p.tdRate)} TD rate, below the ${p.pos} norm of ${formatPercent(p.regressionEvidence?.meanRate)}.`;
  return `${formatPercent(p.tdRate)} TD rate on ${format2(p.opportunities)} opportunities, above the ${p.pos} norm of ${formatPercent(p.regressionEvidence?.meanRate)}.`;
}

// Tailored near summaries append only the failed gates and never use a "Not yet" prefix.
function nearSummary(
  tag: LabelTag,
  p: Player,
  m: Model,
  gates: WhyGate[],
): string {
  const base = baseSummary(tag, p).replace(/\.$/, "");
  const failed = gates.filter((gate) => gate.status === "FAIL");
  if (!failed.length) return `${base}.`;
  // Role-growth uses one combined sample sentence when either nonoverlapping window is short.
  const roleSampleShort =
    tag === "Role-growth watch" &&
    failed.some(
      (gate) =>
        gate.id === "role-growth.recent-games" ||
        gate.id === "role-growth.earlier-games",
    );
  const phrases: string[] = [];
  if (roleSampleShort) {
    const k = Math.max(
      1,
      labelPolicy.window + m.settings.GemMinPriorGames - p.games,
    );
    phrases.push(
      `${k} more ${plural(k, "game")} ${k === 1 ? "is" : "are"} needed`,
    );
  }
  for (const gate of failed) {
    if (
      roleSampleShort &&
      (gate.id === "role-growth.recent-games" ||
        gate.id === "role-growth.earlier-games")
    )
      continue;
    const phrase = gate.shortPhrase || gate.margin.text;
    phrases.push(phrase.replace(/\.$/, ""));
  }
  // Scoring's two special cases read as one sentence instead of a list of checks.
  if (tag === "Scoring breakout watch") {
    const recent = failed.some((gate) => gate.id === "scoring.recent-ppg");
    const jump = failed.some((gate) => gate.id === "scoring.jump");
    if (recent && jump)
      return `${base}, but the recent average (${format2(p.recent)}) is still under ESPN's season projection (${format2(p.projected)}) and the jump is ${formatLongShort(
        Math.max(0, m.settings.GemMinGap - (p.trendDelta ?? 0)),
        "PPG",
      )}.`;
    if (recent)
      return `${base}, but the recent average (${format2(p.recent)}) is still under ESPN's season projection (${format2(p.projected)}).`;
    if (jump)
      return `${base}, but the jump is ${formatShort(
        Math.max(0, m.settings.GemMinGap - (p.trendDelta ?? 0)),
        "PPG",
      )} of the ${format2(m.settings.GemMinGap)} needed.`;
  }
  return `${base}, but ${phrases.join(" and ")}.`;
}

// Average levers use the same thresholds as the classifier; sample levers use the gate's own k.
function flipFor(
  tag: LabelTag,
  p: Player,
  m: Model,
  gates: WhyGate[],
): { headline: string; detail: string; caveat: string } | undefined {
  const failed = gates.filter((gate) => gate.status === "FAIL");
  if (!failed.length) return undefined;
  const failedIds = new Set(failed.map((gate) => gate.id));
  const caveat =
    "Based on the current 3-game window. The next game changes the window, so treat this as a rough guide.";
  const sampleGames = failed.filter(
    (gate) => gate.sample === "games" && gate.numeric,
  );
  const sampleOpportunities = failed.filter(
    (gate) => gate.sample === "opportunities" && gate.numeric,
  );
  const roleSampleShort =
    tag === "Role-growth watch" &&
    (failedIds.has("role-growth.recent-games") ||
      failedIds.has("role-growth.earlier-games"));
  let sample: string;
  if (roleSampleShort) {
    const k = Math.max(
      1,
      labelPolicy.window + m.settings.GemMinPriorGames - p.games,
    );
    sample = `Needs ${k} more played ${plural(k, "game")}`;
  } else {
    const parts: string[] = [];
    for (const gate of sampleGames) {
      const k = Math.max(
        1,
        Math.round(gate.numeric!.threshold - gate.numeric!.value),
      );
      parts.push(`Needs ${k} more played ${plural(k, "game")}`);
    }
    for (const gate of sampleOpportunities) {
      const k = Math.max(
        1,
        Math.ceil(gate.numeric!.threshold - gate.numeric!.value),
      );
      parts.push(`Needs about ${k} more ${plural(k, "opportunity", "opportunities")}`);
    }
    sample = parts.join(" and ");
  }
  // Average levers are limited to the four labels whose gates are rolling averages.
  let average = "";
  let extra = "";
  if (tag === "Role-growth watch") {
    if (
      failedIds.has("role-growth.recent-rate") ||
      failedIds.has("role-growth.jump") ||
      failedIds.has("role-growth.jump-share")
    ) {
      const prior = p.opportunity.priorRate;
      const recent = p.opportunity.recentRate;
      if (prior !== null && recent !== null) {
        const target = Math.max(
          roleMinimum(p, m),
          prior + labelPolicy.roleGrowth,
          prior + Math.abs(prior) * labelPolicy.roleGrowthPct,
        );
        const u = target - recent;
        if (u > 0)
          average = `About ${u.toFixed(2)} more ${workloadUnit(p)} a game over the last 3 games (≈ ${(3 * u).toFixed(2)} in total)`;
      }
    }
  }
  if (tag === "Watch") {
    const rule = gemRule(p);
    const short = p.games < labelPolicy.watchGames;
    const previous = p.breakout?.previous ?? null;
    const recent = p.breakout?.recent ?? null;
    if (recent !== null && (short || previous !== null)) {
      const target = short
        ? rule.mean
        : Math.min(
            rule.mean,
            Math.max(
              previous! + rule.growth,
              previous! * (1 + defaultGemRules.growthPct),
            ),
          );
      const u = target - recent;
      if (u > 0)
        average = `About ${u.toFixed(2)} more ${workloadUnit(p)} a game over the last 3 games (≈ ${(3 * u).toFixed(2)} in total)`;
    }
  }
  if (tag === "Scoring breakout watch") {
    if (
      (failedIds.has("scoring.recent-ppg") || failedIds.has("scoring.jump")) &&
      p.projected !== null &&
      p.recent !== null &&
      p.earlier !== null
    ) {
      const target = Math.max(
        p.projected,
        p.earlier + m.settings.GemMinGap,
      );
      const u = target - p.recent;
      if (u > 0)
        average = `About ${u.toFixed(2)} more points a game over the last 3 games (≈ ${(3 * u).toFixed(2)} in total)`;
      if (failedIds.has("scoring.recent-ppg") && !failedIds.has("scoring.jump"))
        extra = `It also flips if ESPN lowers the season projection to ${format2(p.recent)} or less.`;
    }
  }
  if (tag === "Projection-gap watch") {
    const seasonFailed =
      failedIds.has("projection.gap") || failedIds.has("projection.gap-share");
    const recentFailed = failedIds.has("projection.recent-ppg");
    const season =
      p.projected !== null && p.actual !== null
        ? Math.max(
            p.projected + m.settings.GemMinGap,
            p.projected * (1 + m.settings.GemMinGapPct),
          ) - p.actual
        : 0;
    const recent =
      p.projected !== null && p.recent !== null ? p.projected - p.recent : 0;
    if (seasonFailed && season > 0)
      average = `About ${season.toFixed(2)} more PPG on the season (≈ ${(season * p.games).toFixed(2)} points)`;
    if (recentFailed && recent > 0)
      average = average
        ? `${average} and ${recent.toFixed(2)} more a game over the last 3`
        : `About ${recent.toFixed(2)} more PPG over the last 3 games (≈ ${(3 * recent).toFixed(2)} in total)`;
  }
  // Non-sample misses on Gem/Pre-gem and warnings intentionally get no flip card;
  // sample-size misses get one for every label, including Gem/Pre-gem and warnings.
  if (!average && !sample) return undefined;
  const nonLever = failed.some(
    (gate) =>
      !gate.sample &&
      ![
        "role-growth.recent-rate",
        "role-growth.jump",
        "role-growth.jump-share",
        "watch.short-level",
        "watch.rising",
        "watch.volume-or-growth",
        "scoring.recent-ppg",
        "scoring.jump",
        "projection.gap",
        "projection.gap-share",
        "projection.recent-ppg",
      ].includes(gate.id),
  );
  let detail = sample;
  if (!detail && average && nonLever) detail = "…and the other check must also clear";
  if (sample && average && nonLever)
    detail = `${sample}…and the other check must also clear`;
  if (!detail) detail = "The numbers so far already meet the other checks.";
  if (extra) detail = `${detail} ${extra}`.trim();
  return { headline: average || sample, detail, caveat };
}

// Closest pass is earned-only and describes the smallest cushion among passing numeric signal gates.
function closestFor(
  tag: LabelTag,
  gates: WhyGate[],
): { headline: string; detail: string } | undefined {
  const candidates = gates
    .filter(
      (gate) =>
        gate.group === "signal" &&
        gate.status === "PASS" &&
        gate.kind === "numeric" &&
        gate.numeric &&
        gate.numeric.threshold !== 0,
    )
    .map((gate) => {
      const minimum =
        gate.numeric!.operator === "≥" || gate.numeric!.operator === ">";
      const favorable = minimum
        ? gate.numeric!.value - gate.numeric!.threshold
        : gate.numeric!.threshold - gate.numeric!.value;
      return {
        gate,
        ratio: favorable / Math.abs(gate.numeric!.threshold),
        favorable,
      };
    })
    .sort((a, b) => a.ratio - b.ratio);
  const closest = candidates[0];
  if (!closest || (closest.gate.margin.tone !== "close" && closest.gate.margin.tone !== "at-line"))
    return undefined;
  if (TRIGGER_TAGS.includes(tag))
    return {
      headline: "Closest to clearing",
      detail: `${closest.gate.label} is only ${formatDelta(closest.favorable, closest.gate.numeric!.unit)} past the trigger.`,
    };
  return {
    headline: "What could undo it",
    detail:
      closest.gate.margin.tone === "at-line"
        ? `${closest.gate.label} is exactly at the minimum, so there's no cushion.`
        : `${closest.gate.label} clears its bar by only ${formatDelta(closest.favorable, closest.gate.numeric!.unit)}. A quiet next game could drop the label.`,
  };
}

// Read a counting stat without converting absent evidence into zero.
function gameCount(game: Row, key: string) {
  return Object.hasOwn(game, key) &&
    (game[key] === null || (n(game[key]) !== null && num(game[key]) >= 0))
    ? num(game[key])
    : null;
}
function workloadAmount(game: Row, p: Player) {
  const carries = gameCount(game, "RushAttempts");
  const targets = gameCount(game, "Targets");
  if (p.pos === "QB") return carries;
  if (p.pos === "RB")
    return carries === null || targets === null ? null : carries + targets;
  return targets;
}

// Window assignment is shared by the chart and the game table.
function windowFor(
  tag: LabelTag,
  index: number,
  length: number,
): "recent" | "earlier" | "unused" {
  const recentStart = length - labelPolicy.window;
  if (index >= recentStart) return "recent";
  if (tag === "Gem" || tag === "Pre-gem")
    return index === recentStart - 1 ? "earlier" : "unused";
  if (tag === "Watch" || tag === "Reduced workload")
    return index >= Math.max(0, recentStart - labelPolicy.window)
      ? "earlier"
      : "unused";
  return "earlier";
}

// Build the chart and table from the same played-game history.
function chartFor(
  tag: LabelTag,
  p: Player,
  m: Model,
  gates: WhyGate[],
): WhyChart | undefined {
  if (["BUY LOW", "SELL HIGH", "TD caution"].includes(tag)) return undefined;
  const history = playedHistory(m.dataset).get(p.id) ?? [];
  const metric: "workload" | "points" =
    tag === "Role-growth watch" ||
    tag === "Watch" ||
    tag === "Reduced workload"
      ? "workload"
      : "points";
  const unitLabel =
    metric === "workload"
      ? p.pos === "RB"
        ? "Touches per game"
        : p.pos === "QB"
          ? "Carries per game"
          : "Targets per game"
      : "Points per game";
  const bars = history.map((game, index) => ({
    week: num(game.Week),
    season: num(game.Season),
    value:
      metric === "workload" ? workloadAmount(game, p) : n(game.Points),
    window: windowFor(tag, index, history.length),
  }));
  const values = (window: "recent" | "earlier") =>
    bars
      .filter((bar) => bar.window === window)
      .map((bar) => bar.value)
      .filter((value): value is number => value !== null);
  const earlierAvg = mean(values("earlier"));
  const recentAvg = mean(values("recent"));
  const lines: WhyChart["lines"] = [];
  if (tag === "Scoring breakout watch") {
    if (p.earlier !== null)
      lines.push({
        kind: "earlierAvg",
        value: p.earlier,
        from: "earlier",
        label: "Earlier avg",
      });
    if (p.recent !== null)
      lines.push({
        kind: "recentAvg",
        value: p.recent,
        from: "recent",
        label: "Last 3 avg",
      });
    if (p.projected !== null)
      lines.push({
        kind: "espn",
        value: p.projected,
        from: "all",
        label: "ESPN projection",
        source: "espn",
      });
  } else if (tag === "Projection-gap watch") {
    if (p.actual !== null)
      lines.push({
        kind: "seasonAvg",
        value: p.actual,
        from: "all",
        label: "Season avg",
      });
    if (p.recent !== null)
      lines.push({
        kind: "recentAvg",
        value: p.recent,
        from: "recent",
        label: "Last 3 avg",
      });
    if (p.projected !== null)
      lines.push({
        kind: "espn",
        value: p.projected,
        from: "all",
        label: "ESPN projection",
        source: "espn",
      });
  } else {
    // Gem's earlier line is the overlapping previous three-game window, not a single shaded bar.
    const priorAvg =
      tag === "Gem"
        ? (gates.find((gate) => gate.id === "gem.previous-ppg")?.numeric
            ?.value ?? earlierAvg)
        : tag === "Pre-gem"
          ? (p.earlier ?? earlierAvg)
          : earlierAvg;
    if (priorAvg !== null)
      lines.push({
        kind: "earlierAvg",
        value: priorAvg,
        from: "earlier",
        label: "Earlier avg",
      });
    if (recentAvg !== null)
      lines.push({
        kind: "recentAvg",
        value: recentAvg,
        from: "recent",
        label: "Last 3 avg",
      });
    if (tag === "Gem" || tag === "Pre-gem")
      lines.push({
        kind: "threshold",
        value: gemRule(p).points,
        from: "all",
        label: "Scoring threshold",
        source: "policy",
      });
    if (tag === "Role-growth watch")
      lines.push({
        kind: "threshold",
        value: roleMinimum(p, m),
        from: "all",
        label: "Minimum",
        source: p.pos === "QB" ? "policy" : "setting",
      });
    if (tag === "Watch" || tag === "Reduced workload")
      lines.push({
        kind: "threshold",
        value: gemRule(p).mean,
        from: "all",
        label: "Level threshold",
        source: "policy",
      });
  }
  const hasEspn = lines.some((line) => line.kind === "espn");
  const hasSetting = lines.some(
    (line) => line.kind === "threshold" && line.source === "setting",
  );
  const note =
    hasEspn && hasSetting
      ? "Blue is ESPN's number, so it can move when ESPN updates. Purple thresholds are your settings."
      : hasEspn
        ? "Blue is ESPN's number, so it can move when ESPN updates."
        : hasSetting
          ? "Purple thresholds are your settings."
          : undefined;
  const jump =
    tag === "Role-growth watch" &&
    p.opportunity.priorRate !== null &&
    p.opportunity.recentRate !== null
      ? {
          from: p.opportunity.priorRate,
          to: p.opportunity.recentRate,
          label: `${p.opportunity.delta !== null && p.opportunity.delta >= 0 ? "+" : ""}${format2(p.opportunity.delta)}`,
          tone:
            (p.opportunity.delta ?? 0) >= labelPolicy.roleGrowth
              ? ("spare" as const)
              : ("short" as const),
        }
      : undefined;
  const gap =
    tag === "Projection-gap watch" &&
    p.projected !== null &&
    p.actual !== null
      ? {
          from: p.projected,
          to: p.actual,
          label: `${p.gap !== null && p.gap >= 0 ? "+" : ""}${format2(p.gap)}`,
        }
      : undefined;
  return {
    metric,
    unitLabel,
    bars,
    lines,
    jump,
    gap,
    note,
    ariaLabel: `${tag} ${unitLabel.toLowerCase()} for the ${history.length} played ${plural(history.length, "game")}.`,
  };
}

// The game table uses the same windows and null semantics as the chart.
function gamesFor(tag: LabelTag, p: Player, m: Model): WhyGameRow[] {
  const history = playedHistory(m.dataset).get(p.id) ?? [];
  const regression = ["BUY LOW", "SELL HIGH", "TD caution"].includes(tag);
  return history.map((game, index) => {
    const tds =
      p.pos === "RB"
        ? gameCount(game, "RushTD") === null &&
          gameCount(game, "ReceivingTD") === null
          ? null
          : (gameCount(game, "RushTD") ?? 0) +
            (gameCount(game, "ReceivingTD") ?? 0)
        : ["WR", "TE"].includes(p.pos)
          ? gameCount(game, "ReceivingTD")
          : null;
    return {
      season: num(game.Season),
      week: num(game.Week),
      // Regression labels use the aligned season rows; other labels share the chart windows.
      window: regression ? "earlier" : windowFor(tag, index, history.length),
      points: n(game.Points),
      targets: gameCount(game, "Targets"),
      carries: gameCount(game, "RushAttempts"),
      tds,
    };
  });
}

// Details notes preserve the Gem-specific caveats that used to sit in the open panel.
function detailsNotes(tag: LabelTag, p: Player): string[] {
  if (tag !== "Gem") return [];
  const notes: string[] = [];
  if (p.pos === "RB")
    notes.push(
      `Recent carries / game: ${format2(p.opportunity.recentCarries)}; targets / game: ${format2(p.opportunity.recentTargets)}. Their sum measures work, not equal fantasy scoring value.`,
    );
  notes.push(
    "Provisional floor; historically redundant alongside the other current Gem gates.",
  );
  notes.push(
    "Gem requires both actual scoring and workload in the latest three played games and the previous overlapping three-game window, starting after four played games. Stable strong workload can qualify; growth and a prior Watch label are not required. Watch and Reduced workload retain their separate opportunity rules.",
  );
  notes.push(
    "Scoring Trend PPG still compares the last three played games with ALL earlier games. Watch workload growth and Reduced workload compare only the immediately preceding two or three. Scoring/projection gaps and touchdown cautions remain supporting signals. Gems are identified automatically; no manual role review, approval or news entry is required. The data does not establish whether a player is undervalued or the role is permanent. Rules remain provisional, not calibrated individual success probabilities; TE evidence is weaker.",
  );
  return notes;
}

// Build one label's full presentation record, or null when it has no state or no gates.
function buildLabel(
  tag: LabelTag,
  p: Player,
  m: Model,
  active: Set<string>,
): LabelWhy | null {
  const workbook = m.analysisVersion === "v5.2-workbook";
  const explanation =
    tag === "Gem" ? tagExplanation("Gem", p, m) : tagExplanation(tag, p, m);
  if (!explanation) return null;
  const gates =
    tag === "Gem"
      ? gatesFromChecks("Gem", explanation.rows, p, m)
      : tag === "Pre-gem"
        ? gatesFromChecks("Pre-gem", explanation.rows, p, m)
        : gatesFromBlueprints(tag, explanation, p, m);
  if (!gates.length) return null;
  const failed = gates.filter((gate) => gate.status === "FAIL").length;
  const unknown = gates.filter((gate) => gate.status === "UNKNOWN").length;
  const trustConditionFail = gates.some(
    (gate) =>
      gate.group === "trust" &&
      gate.kind === "condition" &&
      gate.status !== "PASS",
  );
  const hasHistoryGate =
    ["Gem", "Pre-gem"].includes(tag) ||
    gates.some(
      (gate) => gate.id.endsWith(".history") || gate.id.endsWith(".model"),
    );
  const globalTrust =
    hasHistoryGate || (p.historyComplete && p.value !== null);
  const earned = active.has(tag);
  const near =
    !earned &&
    !workbook &&
    applicable(tag, p) &&
    failed >= 1 &&
    failed <= 2 &&
    unknown === 0 &&
    !trustConditionFail &&
    globalTrust;
  if (!earned && !near) return null;
  const state = earned ? "earned" : "near";
  const tone: LabelTone = WARNING_TAGS.includes(tag) ? "warning" : "positive";
  const shortTag = tag.replace(/ watch$/, "");
  const k = failed;
  const chip =
    state === "earned"
      ? tag
      : tone === "warning"
        ? `${shortTag} · almost`
        : `${shortTag} · ${k} short`;
  const verdict =
    state === "earned"
      ? tone === "positive"
        ? `${tag}: all ${gates.length} checks met`
        : `${tag}: flagged, all ${gates.length} conditions met`
      : tone === "positive"
        ? `${tag}: ${k} ${plural(k, "check")} short`
        : `${tag}: not flagged, ${k} ${plural(k, "condition")} away`;
  const summary =
    state === "near"
      ? nearSummary(tag, p, m, gates)
      : tag === "Role-growth watch"
        ? `${baseSummary(tag, p)} The jump is big enough, recent enough and backed by enough games.`
        : baseSummary(tag, p);
  const groups = groupsFor(tag, gates);
  const source = Date.parse(m.dataset.sourceUTC ?? "");
  const stale =
    !Number.isFinite(source) ||
    Date.now() - source > 86400000 ||
    source > Date.now() + 300000;
  const chart = chartFor(tag, p, m, gates);
  return {
    tag,
    tone,
    state,
    failed,
    shortfall: gates
      .filter((gate) => gate.status === "FAIL")
      .reduce((total, gate) => total + gate.shortfall, 0),
    chip,
    verdict,
    summary,
    groups,
    nearSections: state === "near" ? nearSectionsFor(gates) : undefined,
    warnings:
      (tag === "Gem" || tag === "Watch") && p.breakout
        ? p.breakout.warnings
        : [],
    flip: state === "near" ? flipFor(tag, p, m, gates) : undefined,
    closest: state === "earned" ? closestFor(tag, gates) : undefined,
    chart,
    games: gamesFor(tag, p, m),
    // Only an editable setting makes the threshold-adjust action relevant.
    canAdjust: gates.some((gate) => gate.thresholdSource === "setting"),
    stale,
    details: {
      meaning: explanation.meaning,
      interpretation: explanation.interpretation,
      limitations: explanation.limitations,
      researchNote: labelResearchNote(tag),
      window: explanation.window,
      sourceUTC: m.dataset.sourceUTC ?? null,
      notes: detailsNotes(tag, p),
    },
  };
}

// Deduplicate near misses by their exact failing-gate set, keeping the earlier label in the registry.
function dedupeNear(candidates: LabelWhy[]) {
  const seen = new Set<string>();
  return candidates.filter((label) => {
    const key = label.groups
      .flatMap((group) => group.gates)
      .filter((gate) => gate.status === "FAIL")
      .map((gate) => gate.id)
      .sort()
      .join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Expose the sorted, deduplicated, capped panel records for a player.
export function labelWhy(p: Player, m: Model): LabelWhy[] {
  const active = new Set<string>([...playerSignals(p), p.regression]);
  const earned: LabelWhy[] = [];
  const near: LabelWhy[] = [];
  for (const tag of LABEL_TAGS) {
    if (!applicable(tag, p)) continue;
    const label = buildLabel(tag, p, m, active);
    if (!label) continue;
    if (label.state === "earned") earned.push(label);
    else near.push(label);
  }
  const earnedPrimary = earned.find((label) => label.tag in PRIMARY_RANK);
  // Keep at most one primary near miss, and only when it ranks above an earned primary.
  const primaryCandidates = near
    .filter((label) => label.tag in PRIMARY_RANK)
    .filter(
      (label) =>
        !earnedPrimary ||
        PRIMARY_RANK[label.tag]! < PRIMARY_RANK[earnedPrimary.tag]!,
    )
    .sort(
      (a, b) =>
        a.failed - b.failed ||
        a.shortfall - b.shortfall ||
        PRIMARY_RANK[a.tag]! - PRIMARY_RANK[b.tag]!,
    );
  const primary = primaryCandidates[0];
  const nonPrimary = near.filter((label) => !(label.tag in PRIMARY_RANK));
  let candidates = dedupeNear(
    [primary, ...nonPrimary].filter((label): label is LabelWhy => !!label),
  );
  // Regression labels are mutually exclusive with their opposite, and TD caution echoes SELL HIGH.
  const earnedRegression = earned.find(
    (label) => label.tag === "BUY LOW" || label.tag === "SELL HIGH",
  );
  if (earnedRegression?.tag === "SELL HIGH")
    candidates = candidates.filter(
      (label) => label.tag !== "BUY LOW" && label.tag !== "TD caution",
    );
  if (earnedRegression?.tag === "BUY LOW")
    candidates = candidates.filter(
      (label) => label.tag !== "SELL HIGH" && label.tag !== "TD caution",
    );
  const sell = candidates.find((label) => label.tag === "SELL HIGH");
  const td = candidates.find((label) => label.tag === "TD caution");
  if (sell && td) {
    const failing = (label: LabelWhy) =>
      label.groups
        .flatMap((group) => group.gates)
        .filter((gate) => gate.status === "FAIL")
        .map((gate) => gate.id)
        .sort()
        .join(",");
    if (failing(sell) === failing(td))
      candidates = candidates.filter((label) => label.tag !== "TD caution");
  }
  const orderIndex = (tag: LabelTag) =>
    POSITIVE_ORDER.includes(tag)
      ? POSITIVE_ORDER.indexOf(tag)
      : POSITIVE_ORDER.length + WARNING_ORDER.indexOf(tag);
  const earnedSorted = [...earned].sort(
    (a, b) => orderIndex(a.tag) - orderIndex(b.tag),
  );
  const nearSorted = [...candidates].sort(
    (a, b) =>
      a.failed - b.failed ||
      a.shortfall - b.shortfall ||
      LABEL_TAGS.indexOf(a.tag) - LABEL_TAGS.indexOf(b.tag),
  );
  // Earned labels are never dropped; the six-chip cap applies only to near misses.
  const nearCap =
    earnedSorted.length >= 6 ? 0 : Math.max(0, 6 - earnedSorted.length);
  return [...earnedSorted, ...nearSorted.slice(0, nearCap)];
}
