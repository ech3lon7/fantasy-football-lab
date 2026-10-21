import type { Player } from "./valuation";
import { playerSignals } from "./valuation";

// Primary breakout classifications stay separate from independent scoring and regression evidence.
export const gemSignals = [
  "Gem",
  "Watch",
  "Projection-gap watch",
  "TD caution",
  "No breakout signal",
  "Insufficient data",
  "Not applicable",
  "Role-growth watch",
  "Scoring breakout watch",
] as const;
export const gemClassifications = [
  "All classifications",
  "Gem only",
  "Gem + Watch",
] as const;
const candidateSignals = [
  "Gem",
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
};
export type GemQuery = Omit<GemDraft, Threshold> &
  Record<Threshold, number | null>;
export interface GemResult {
  player: Player;
  evidence: string[];
  missing: string[];
}

// Defaults retain the current screen's ownership, positions, and four signal types.
export function defaultGemDraft(team: string): GemDraft {
  return {
    pool: "Available",
    team,
    position: "RB / WR / TE",
    signals: [...candidateSignals],
    classification: "All classifications",
    injured: false,
    aboveReplacement: false,
    includeMissing: false,
    trendMin: "",
    indexMin: "",
    indexMax: "",
    recentMin: "",
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
    !["RB / WR / TE", "All", "QB", "RB", "WR", "TE", "K", "D/ST"].includes(
      d.position,
    )
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
  draft.classification = saved.gemClass ?? "All classifications";
  if (saved.gemFilterVersion !== undefined || saved.gemSignals !== undefined) {
    try {
      if (!["1", "2"].includes(saved.gemFilterVersion)) throw Error();
      const selected: unknown = JSON.parse(saved.gemSignals ?? "");
      if (
        !Array.isArray(selected) ||
        selected.some(
          (s) =>
            typeof s !== "string" ||
            (!gemSignals.includes(s as (typeof gemSignals)[number]) &&
              !Object.hasOwn(legacySignals, s)),
        )
      )
        throw Error();
      draft.signals = [
        ...new Set((selected as string[]).map((s) => legacySignals[s] ?? s)),
      ];
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
  } else if (saved.gemSignal === "All signals") draft.signals = [...gemSignals];
  else if (Object.hasOwn(legacySignals, saved.gemSignal ?? "")) {
    draft.signals = [legacySignals[saved.gemSignal]];
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
    gemFilterVersion: "2",
    gemClass: q.classification,
    gemPool: q.pool,
    gemTeam: q.team,
    gemPos: q.position,
    gemInjured: String(q.injured),
    gemSignals: JSON.stringify(signals),
    gemSignal:
      signals.length === 1
        ? signals[0]
        : signals.length === 0 || signals.length === gemSignals.length
          ? "All signals"
          : "Candidates and watches",
    gemAboveReplacement: String(q.aboveReplacement),
    gemIncludeMissing: String(q.includeMissing),
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
    signals: [...gemSignals.slice(0, 2), ...gemSignals.slice(-2)],
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
    q.signals.length && q.signals.length !== gemSignals.length
      ? `(${q.signals.join(" OR ")})`
      : "Any signal",
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
    q.injured ? "Injuries included" : "Active players only",
  ].join(" AND ");
}

// Known failures always exclude; missing active metrics never count as a pass.
export function screenGems(players: Player[], q: GemQuery) {
  const matches: GemResult[] = [],
    incomplete: GemResult[] = [];
  for (const p of players) {
    // Empty signal selections leave numeric, ownership and position filters in force.
    if (
      (q.classification === "Gem only" && p.gem !== "Gem") ||
      (q.classification === "Gem + Watch" &&
        !["Gem", "Watch"].includes(p.gem)) ||
      (q.signals.length > 0 &&
        !playerSignals(p).some((s) => q.signals.includes(s))) ||
      (q.pool === "Available" && p.owner !== "0") ||
      (q.pool === "Selected team" && p.owner !== q.team) ||
      (q.position !== "All" &&
        !(q.position === "RB / WR / TE"
          ? ["RB", "WR", "TE"].includes(p.pos)
          : p.pos === q.position)) ||
      (!q.injured && p.uncertain)
    )
      continue;
    const evidence = playerSignals(p),
      missing: string[] = [];
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
      gamesMin: p.games,
      gapMin: p.gap,
    };
    // Keep full precision in accessible evidence so rounded boundary values are explainable.
    for (const f of gemThresholds) {
      const threshold = q[f.key];
      if (threshold === null) continue;
      const value = values[f.key];
      if (value === null || !Number.isFinite(value))
        missing.push(
          f.key === "trendMin"
            ? "Trend PPG unavailable: insufficient usable earlier/recent history."
            : `${f.metric} unavailable.`,
        );
      else if (f.key === "indexMax" ? value > threshold : value < threshold)
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
