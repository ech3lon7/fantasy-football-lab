import type { Player } from "./valuation";
import { playerSignals } from "./valuation";
import { signalAppearance } from "./signal-appearance";
import { isGoldenCross, isDeathCross } from "./player-trend";

// Primary breakout classifications stay separate from independent scoring and regression evidence.
export const gemSignals = [
  "Gem",
  "Pre-gem",
  "Watch",
  "Projection-gap watch",
  "TD caution",
  "No breakout signal",
  // Make decline explicitly selectable without changing default candidate signals or the existing rising preset.
  "Reduced workload",
  "Role-growth watch",
  "Scoring breakout watch",
] as const;
// Data-coverage statuses remain player warnings, but are no longer selectable screening signals.
const retiredSignalSelections = ["Insufficient data", "Not applicable"];
export const gemClassifications = [
  "All classifications",
  "Gem only",
  "Pre-gem only",
  "Watch only",
  "Gem + Watch",
  "Gem + Pre-gem + Watch",
] as const;
// Recognize the previous automatic alternatives only during migration; they are never preselected as AND requirements.
const candidateSignals = [
  "Gem",
  "Pre-gem",
  "Watch",
  "Projection-gap watch",
  "Role-growth watch",
  "Scoring breakout watch",
];
// Translate earlier labels automatically; numeric thresholds and cleared-signal searches retain their saved meaning.
const legacySignals: Record<string, string> = {
  "Gem candidate": "Gem",
  "Opportunity watch": "Watch",
  Emerging: "Watch",
  "No gem signal": "No breakout signal",
  "Limited history": "Insufficient data",
  "Projection only": "Insufficient data",
  "Data issue": "Insufficient data",
};
export const gemThresholds = [
  {
    key: "roleMin",
    label: "Minimum role increase / game",
    metric: "Role increase / game",
    stored: "gemRoleMin",
    advanced: true,
  },
  {
    key: "targetsMin",
    label: "Minimum recent targets / game",
    metric: "Recent targets / game",
    stored: "gemTargetsMin",
    advanced: true,
  },
  {
    key: "carriesMin",
    label: "Minimum recent carries / game",
    metric: "Recent carries / game",
    stored: "gemCarriesMin",
    advanced: true,
  },
  {
    key: "routesMin",
    label: "Minimum route participation (0–1)",
    metric: "Route participation",
    stored: "gemRoutesMin",
    advanced: true,
  },
  {
    key: "trendMin",
    label: "Minimum trend PPG",
    metric: "Trend PPG",
    stored: "gemTrendMin",
    advanced: false,
  },
  {
    key: "indexMin",
    label: "Minimum surplus index",
    metric: "Surplus index minimum",
    stored: "gemIndexMin",
    advanced: false,
  },
  {
    key: "indexMax",
    label: "Maximum surplus index",
    metric: "Surplus index maximum",
    stored: "gemIndexMax",
    advanced: false,
  },
  {
    key: "recentMin",
    label: "Minimum recent PPG",
    metric: "Recent PPG",
    stored: "gemRecentMin",
    advanced: false,
  },
  {
    key: "mppgMin",
    label: "Minimum MPPG",
    metric: "MPPG",
    stored: "gemMppgMin",
    advanced: false,
  },
  {
    key: "gamesMin",
    label: "Minimum games played",
    metric: "Games played",
    stored: "gemGamesMin",
    advanced: true,
  },
  {
    key: "gapMin",
    label: "Minimum projection gap PPG",
    metric: "Projection gap PPG",
    stored: "gemGapMin",
    advanced: true,
  },
] as const;
type Threshold = (typeof gemThresholds)[number]["key"];
export type GemDraft = Record<Threshold, string> & {
  pool: string;
  team: string;
  position: string;
  signals: string[];
  classification: string;
  injured: boolean;
  aboveReplacement: boolean;
  includeMissing: boolean;
  positiveOnly: boolean;
  goldenCross: boolean;
  deathCross: boolean;
  // Optional so earlier drafts stay valid: signals are all required unless this is "any".
  signalMode?: "all" | "any";
  // Optional regression-label filter used by the Buy low / sell high search.
  regression?: "" | "BUY LOW" | "SELL HIGH" | "either";
};
export type GemQuery = Omit<GemDraft, Threshold> &
  Record<Threshold, number | null>;
export interface GemResult {
  player: Player;
  evidence: string[];
  missing: string[];
}

// Start without required labels so mutually exclusive primary stages are never preselected together under AND matching.
export function defaultGemDraft(team: string): GemDraft {
  return {
    pool: "Available",
    team,
    position: "RB / WR / TE",
    signals: [],
    classification: "All classifications",
    injured: false,
    aboveReplacement: false,
    includeMissing: false,
    positiveOnly: false,
    goldenCross: false,
    deathCross: false,
    trendMin: "",
    indexMin: "",
    indexMax: "",
    recentMin: "",
    mppgMin: "",
    gamesMin: "",
    gapMin: "",
    roleMin: "",
    targetsMin: "",
    carriesMin: "",
    routesMin: "",
  };
}

// Validate complete drafts without treating a blank threshold as numeric zero.
export function validateGemDraft(d: GemDraft, teams: string[]) {
  const errors: Record<string, string> = {};
  const numbers = {} as Record<Threshold, number | null>;
  for (const f of gemThresholds) {
    const raw = d[f.key].trim();
    const value =
      raw === ""
        ? null
        : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)
          ? Number(raw)
          : NaN;
    numbers[f.key] = value;
    if (value !== null && !Number.isFinite(value))
      errors[f.key] = "Enter a finite decimal number or leave blank.";
    else if (
      value !== null &&
      f.key.startsWith("index") &&
      (value < 0 || value > 100)
    )
      errors[f.key] = "Use a value from 0 to 100.";
    else if (
      value !== null &&
      f.key === "routesMin" &&
      (value < 0 || value > 1)
    )
      errors[f.key] = "Use a share from 0 to 1.";
    else if (
      value !== null &&
      f.key === "gamesMin" &&
      (!Number.isInteger(value) || value < 0 || value > 17)
    )
      errors[f.key] = "Use a whole number from 0 to 17.";
  }
  // Bounds and categorical selections must also be valid before results change.
  if (
    numbers.indexMin !== null &&
    numbers.indexMax !== null &&
    numbers.indexMin > numbers.indexMax
  )
    errors.indexMax = "Maximum must be at least the minimum.";
  if (!["Available", "All", "Selected team"].includes(d.pool))
    errors.pool = "Choose a player pool.";
  if (
    ![
      "RB / WR / TE",
      "All",
      "QB",
      "RB",
      "WR",
      "TE",
      "K",
      "D/ST",
      "K / D/ST",
    ].includes(d.position)
  )
    errors.position = "Choose a position.";
  if (
    !gemClassifications.includes(
      d.classification as (typeof gemClassifications)[number],
    )
  )
    errors.classification = "Choose a recognized breakout classification.";
  if (d.pool === "Selected team" && !teams.includes(d.team))
    errors.team = "Choose a team in the current snapshot.";
  if (
    d.signals.some(
      (s) => !gemSignals.includes(s as (typeof gemSignals)[number]),
    )
  )
    errors.signals = "Choose recognized gem signals.";
  if (d.signalMode !== undefined && !["all", "any"].includes(d.signalMode))
    errors.signalMode =
      "Choose whether all or any selected signals are required.";
  if (
    d.regression !== undefined &&
    !["", "BUY LOW", "SELL HIGH", "either"].includes(d.regression)
  )
    errors.regression = "Choose a recognized regression label.";
  // Keep the opt-in flag boolean rather than interpreting malformed saved values as permission to broaden a search.
  if (typeof d.positiveOnly !== "boolean")
    errors.positiveOnly = "Choose whether to show positive labels only.";
  if (typeof d.goldenCross !== "boolean")
    errors.goldenCross = "Choose whether to show bullish MA crossovers only.";
  if (typeof d.deathCross !== "boolean")
    errors.deathCross = "Choose whether to show bearish MA crossovers only.";
  return {
    errors,
    query: Object.keys(errors).length
      ? null
      : ({ ...d, ...numbers } as GemQuery),
  };
}

// Read old selections without broadening malformed or unsupported new searches.
export function decodeGemFilters(saved: Record<string, string>, team: string) {
  const draft = defaultGemDraft(saved.gemTeam ?? team);
  let issue = "";
  draft.pool = saved.gemPool ?? draft.pool;
  draft.position = saved.gemPos ?? draft.position;
  draft.injured = saved.gemInjured === "true";
  // Earlier searches remain unrestricted; the new flag persists through the same string-valued sync state.
  draft.positiveOnly = saved.gemPositiveOnly === "true";
  draft.goldenCross = saved.gemGoldenCross === "true";
  draft.deathCross = saved.gemDeathCross === "true";
  if (
    saved.gemPositiveOnly !== undefined &&
    !["true", "false"].includes(saved.gemPositiveOnly)
  )
    issue =
      "Saved positive-label filter is invalid. Correct the controls and Apply, or Reset screener.";
  draft.classification = saved.gemClass ?? "All classifications";
  // New optional criteria are read only when saved, so earlier searches keep their exact meaning.
  if (saved.gemSignalMode === "any") draft.signalMode = "any";
  if (["BUY LOW", "SELL HIGH", "either"].includes(saved.gemRegression ?? ""))
    draft.regression = saved.gemRegression as GemDraft["regression"];
  if (saved.gemFilterVersion !== undefined || saved.gemSignals !== undefined) {
    try {
      if (!["1", "2", "3", "4"].includes(saved.gemFilterVersion)) throw Error();
      const selected: unknown = JSON.parse(saved.gemSignals ?? "");
      if (
        !Array.isArray(selected) ||
        selected.some(
          (s) =>
            typeof s !== "string" ||
            (!gemSignals.includes(s as (typeof gemSignals)[number]) &&
              !retiredSignalSelections.includes(s) &&
              !Object.hasOwn(legacySignals, s)),
        )
      )
        throw Error();
      // Drop retired selections from older saved searches while retaining all other criteria.
      draft.signals = [
        ...new Set((selected as string[]).map((s) => legacySignals[s] ?? s)),
      ].filter((s) => !retiredSignalSelections.includes(s));
      // Old broad/default selections meant alternatives or Any signal; migrate only those exact sets to no requirements.
      if (saved.gemFilterVersion !== "4") {
        const same = (values: readonly string[]) =>
          draft.signals.length === values.length &&
          values.every((s) => draft.signals.includes(s));
        if (
          same(gemSignals) ||
          same(candidateSignals) ||
          same(gemSignals.filter((s) => s !== "Pre-gem")) ||
          same(candidateSignals.filter((s) => s !== "Pre-gem"))
        )
          draft.signals = [];
      }
      for (const f of gemThresholds) draft[f.key] = saved[f.stored] ?? "";
      for (const k of [
        "gemAboveReplacement",
        "gemIncludeMissing",
        "gemInjured",
      ])
        if (saved[k] !== undefined && !["true", "false"].includes(saved[k]))
          throw Error();
      draft.aboveReplacement = saved.gemAboveReplacement === "true";
      draft.includeMissing = saved.gemIncludeMissing === "true";
    } catch {
      issue =
        "Saved gem filters are invalid or unsupported. Correct the controls and Apply, or Reset screener.";
    }
  } else if (saved.gemSignal === "All signals") draft.signals = [];
  else if (
    Object.hasOwn(legacySignals, saved.gemSignal ?? "") ||
    retiredSignalSelections.includes(saved.gemSignal ?? "")
  ) {
    // Older single-choice aliases receive the same retirement handling as newer saved arrays.
    draft.signals = [legacySignals[saved.gemSignal] ?? saved.gemSignal].filter(
      (s) => !retiredSignalSelections.includes(s),
    );
  } else if (
    gemSignals.includes(saved.gemSignal as (typeof gemSignals)[number])
  )
    draft.signals = [saved.gemSignal];
  // Keep prior thresholds while translating labels automatically; valid imports never require a review or Apply step.
  for (const f of gemThresholds) draft[f.key] = saved[f.stored] ?? "";
  return { draft, issue };
}

// Persist applied queries through the existing string-valued state/sync contract.
export function encodeGemFilters(q: GemQuery): Record<string, string> {
  const signals = gemSignals.filter((s) => q.signals.includes(s));
  return {
    gemFilterVersion: "4",
    gemClass: q.classification,
    gemPool: q.pool,
    gemTeam: q.team,
    gemPos: q.position,
    gemInjured: String(q.injured),
    gemSignals: JSON.stringify(signals),
    gemSignal:
      signals.length === 1
        ? signals[0]
        : signals.length === 0
          ? "All signals"
          : "All selected signals",
    gemAboveReplacement: String(q.aboveReplacement),
    gemIncludeMissing: String(q.includeMissing),
    gemPositiveOnly: String(q.positiveOnly),
    gemGoldenCross: String(q.goldenCross),
    gemDeathCross: String(q.deathCross),
    // Written only when set; callers clear them explicitly when switching back to the defaults.
    ...(q.signalMode === "any" ? { gemSignalMode: "any" } : {}),
    ...(q.regression ? { gemRegression: q.regression } : {}),
    ...Object.fromEntries(
      gemThresholds.map((f) => [
        f.stored,
        q[f.key] === null ? "" : String(q[f.key]),
      ]),
    ),
  };
}

// The optional preset is an editable example, never a new global default.
export function risingGemDraft(team: string): GemDraft {
  return {
    ...defaultGemDraft(team),
    pool: "All",
    // Preserve this preset's numeric rising-player search without imposing incompatible primary labels.
    signals: [],
    trendMin: "2",
    indexMin: "10",
    indexMax: "40",
    recentMin: "12",
    gamesMin: "5",
  };
}

// Summaries use the same applied thresholds as filtering and keep units explicit.
export function gemQuerySummary(q: GemQuery): string {
  return [
    // Clearing signal choices means no signal restriction, including for saved searches.
    q.signals.length
      ? `(${q.signals.join(q.signalMode === "any" ? " OR " : " AND ")})`
      : "Any signal",
    ...(q.regression
      ? [
          q.regression === "either"
            ? "BUY LOW or SELL HIGH"
            : `${q.regression} label`,
        ]
      : []),
    `Pool: ${q.pool}${q.pool === "Selected team" ? ` ${q.team}` : ""}`,
    `Position: ${q.position}`,
    ...(q.classification !== "All classifications"
      ? [`Classification: ${q.classification}`]
      : []),
    ...gemThresholds
      .filter((f) => q[f.key] !== null)
      .map(
        (f) => `${f.metric} ${f.key === "indexMax" ? "≤" : "≥"} ${q[f.key]}`,
      ),
    ...(q.aboveReplacement ? ["Above replacement PPG > 0"] : []),
    ...(q.positiveOnly ? ["Positive labels only (no red labels)"] : []),
    ...(q.goldenCross ? ["Bullish MA crossover (golden cross)"] : []),
    ...(q.deathCross ? ["Bearish MA crossover (death cross)"] : []),
    q.injured ? "Injuries included" : "Active players only",
  ].join(" AND ");
}

// Known failures always exclude; missing active metrics never count as a pass.
export function screenGems(players: Player[], q: GemQuery) {
  const matches: GemResult[] = [],
    incomplete: GemResult[] = [];
  for (const p of players) {
    // A positive signal cannot override a red label, regression warning or downtrend badge; apply to both results sections.
    if (q.positiveOnly) {
      const appearances = [...playerSignals(p), p.regression].map(
        signalAppearance,
      );
      if (
        p.arrow === "↓" ||
        appearances.includes("caution") ||
        !appearances.some((kind) =>
          ["candidate", "pre-gem", "watch", "buy-low"].includes(kind),
        )
      )
        continue;
    }
    // Every selected signal is required, even when all boxes are selected; only an empty selection is unrestricted.
    if (
      (q.classification === "Gem only" && p.gem !== "Gem") ||
      (q.classification === "Pre-gem only" && p.gem !== "Pre-gem") ||
      (q.classification === "Watch only" && p.gem !== "Watch") ||
      (q.classification === "Gem + Pre-gem + Watch" &&
        !["Gem", "Pre-gem", "Watch"].includes(p.gem)) ||
      (q.classification === "Gem + Watch" &&
        !["Gem", "Watch"].includes(p.gem)) ||
      !(q.signalMode === "any" && q.signals.length
        ? q.signals.some((s) => playerSignals(p).includes(s))
        : q.signals.every((s) => playerSignals(p).includes(s))) ||
      (q.regression === "either" &&
        !["BUY LOW", "SELL HIGH"].includes(p.regression)) ||
      (q.regression &&
        q.regression !== "either" &&
        p.regression !== q.regression) ||
      (q.pool === "Available" && p.owner !== "0") ||
      (q.pool === "Selected team" && p.owner !== q.team) ||
      (q.position !== "All" &&
        !(q.position === "RB / WR / TE"
          ? ["RB", "WR", "TE"].includes(p.pos)
          : q.position === "K / D/ST"
            ? ["K", "D/ST"].includes(p.pos)
            : p.pos === q.position)) ||
      (!q.injured && p.uncertain) ||
      (q.goldenCross && !isGoldenCross(p.trend)) ||
      (q.deathCross && !isDeathCross(p.trend))
    )
      continue;
    const evidence = playerSignals(p);
    if (q.goldenCross) {
      evidence.push("Bullish MA crossover (golden cross)");
    }
    if (q.deathCross) {
      evidence.push("Bearish MA crossover (death cross)");
    }
    const missing: string[] = [];
    let failed = false;
    const values: Record<Threshold, number | null> = {
      roleMin: p.opportunity.delta,
      targetsMin: p.opportunity.recentTargets,
      carriesMin: p.opportunity.recentCarries,
      routesMin: p.opportunity.routes,
      trendMin: p.trendDelta,
      indexMin: p.index,
      indexMax: p.index,
      recentMin: p.recent,
      mppgMin: p.mppg ?? null,
      gamesMin: p.games,
      gapMin: p.gap,
    };
    // Keep full precision in accessible evidence so rounded boundary values are explainable.
    for (const f of gemThresholds) {
      const threshold = q[f.key];
      if (threshold === null) continue;
      const value = values[f.key];
      if (value === null || !Number.isFinite(value)) {
        if (f.key === "mppgMin") {
          failed = true;
        } else {
          missing.push(
            f.key === "trendMin"
              ? "Trend PPG unavailable: insufficient usable earlier/recent history."
              : `${f.metric} unavailable.`,
          );
        }
      } else if (f.key === "indexMax" ? value > threshold : value < threshold)
        failed = true;
      else
        evidence.push(
          `${f.metric}: ${value} ${f.key === "indexMax" ? "≤" : "≥"} ${threshold}`,
        );
    }
    // Replacement advantage uses PPG rather than remaining-game-dependent VORP.
    if (q.aboveReplacement) {
      const gap =
        p.value === null || p.baseline === null ? null : p.value - p.baseline;
      if (gap === null || !Number.isFinite(gap))
        missing.push("Value or replacement PPG unavailable.");
      else if (gap <= 0) failed = true;
      else evidence.push(`Vs replacement PPG: ${gap} > 0`);
    }
    if (!failed)
      (missing.length ? incomplete : matches).push({
        player: p,
        evidence,
        missing,
      });
  }
  return { matches, incomplete };
}
