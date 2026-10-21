import { mean, n, num, str, type Dataset, type Row } from "./contracts";
import type { Player } from "./valuation";

// Versioned rules and reviews use existing private settings sync without changing workbook or database schemas.
export const gemVersion = "breakout-1";
export const gemRulesKey = "gemBreakoutRules";
export const gemContextKey = "gemRoleReviews";
export const gemPositions = ["RB", "WR", "TE"] as const;
type GemPosition = (typeof gemPositions)[number];
export interface GemRules {
  version: typeof gemVersion;
  growthPct: number;
  contextDays: number;
  positions: Record<
    GemPosition,
    { mean: number; floor: number; growth: number }
  >;
}
export const defaultGemRules: GemRules = {
  version: gemVersion,
  growthPct: 0.25,
  contextDays: 7,
  positions: {
    RB: { mean: 18, floor: 14, growth: 3 },
    WR: { mean: 7, floor: 5, growth: 2 },
    TE: { mean: 6, floor: 5, growth: 2 },
  },
};
export interface RoleReview {
  PlayerID: string;
  Week: number;
  ThroughWeek: number;
  Outlook:
    "Supported ongoing opportunity" | "Temporary opportunity" | "Unclear";
  Source: string;
  AsOfUTC: string;
  Reason: string;
}
export const roleOutlooks = [
  "Supported ongoing opportunity",
  "Temporary opportunity",
  "Unclear",
] as const;
export interface GemCheck {
  check: string;
  required: string;
  actual: string;
  status: "PASS" | "FAIL" | "UNKNOWN" | "SUPPORTED" | "UNRESOLVED";
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
  review: RoleReview | null;
  prompts: string[];
}

// Reject malformed configuration instead of quietly using a more permissive set of thresholds.
export function parseGemRules(raw?: string): GemRules {
  if (!raw) return structuredClone(defaultGemRules);
  const v = JSON.parse(raw);
  if (
    v.version !== gemVersion ||
    !Number.isFinite(v.growthPct) ||
    v.growthPct < 0 ||
    v.growthPct > 1 ||
    !Number.isFinite(v.contextDays) ||
    v.contextDays < 1 ||
    v.contextDays > 7
  )
    throw Error(
      "Invalid Gem rules: growth share must be 0–1 and review age 1–7 days.",
    );
  for (const pos of gemPositions) {
    const rule = v.positions?.[pos];
    if (
      !rule ||
      [rule.mean, rule.floor, rule.growth].some(
        (x) =>
          typeof x !== "number" || !Number.isFinite(x) || x <= 0 || x > 100,
      ) ||
      rule.floor > rule.mean
    )
      throw Error(
        `Invalid ${pos} Gem rules: use positive thresholds up to 100 and a floor no greater than the mean.`,
      );
  }
  return {
    version: gemVersion,
    growthPct: v.growthPct,
    contextDays: v.contextDays,
    positions: Object.fromEntries(
      gemPositions.map((pos) => [
        pos,
        {
          mean: v.positions[pos].mean,
          floor: v.positions[pos].floor,
          growth: v.positions[pos].growth,
        },
      ]),
    ) as GemRules["positions"],
  };
}

// Validate dated role context independently of market/usage sources, preserving their provenance.
export function parseRoleReviews(
  rows: Record<string, unknown>[],
  d: Dataset,
  now = Date.now(),
): RoleReview[] {
  if (rows.length > 200) throw Error("Use at most 200 role reviews.");
  const ids = new Set(
    d.tables.ModelPlayers.filter((p) =>
      gemPositions.includes(p.Position as GemPosition),
    ).map((p) => str(p.PlayerID)),
  );
  const current = num(d.tables.ModelContext[0].CurrentWeek),
    seen = new Set<string>();
  const result = rows.map((r, i) => {
    const p: RoleReview = {
      PlayerID: str(r.PlayerID).trim(),
      Week: Number(r.Week),
      ThroughWeek: Number(r.ThroughWeek),
      Outlook: r.Outlook as RoleReview["Outlook"],
      Source: str(r.Source).trim(),
      AsOfUTC: str(r.AsOfUTC).trim(),
      Reason: str(r.Reason).trim(),
    };
    if (
      !ids.has(p.PlayerID) ||
      seen.has(p.PlayerID) ||
      p.Week !== current ||
      !Number.isInteger(p.ThroughWeek) ||
      p.ThroughWeek < 1 ||
      p.ThroughWeek >= current ||
      !roleOutlooks.includes(p.Outlook) ||
      !p.Source ||
      p.Source.length > 120 ||
      !p.Reason ||
      p.Reason.length > 600 ||
      !p.AsOfUTC.endsWith("Z") ||
      !Number.isFinite(Date.parse(p.AsOfUTC)) ||
      Date.parse(p.AsOfUTC) > now + 300000
    )
      throw Error(
        `Role review ${i + 1}: use a unique RB/WR/TE, current week, completed ThroughWeek, outlook, source, UTC date and explanation (up to 600 characters).`,
      );
    seen.add(p.PlayerID);
    return p;
  });
  if (new TextEncoder().encode(JSON.stringify(result)).length > 40000)
    throw Error("Role reviews exceed 40 KB; import fewer reviews.");
  return result;
}

// Reviews must be rechecked for a new imported snapshot, and broken rules cannot silently award Gems.
export function readGemInputs(
  d: Dataset,
  rulesRaw?: string,
  reviewsRaw?: string,
  now = Date.now(),
) {
  let rules = structuredClone(defaultGemRules),
    reviews: RoleReview[] = [],
    issue = "";
  try {
    rules = parseGemRules(rulesRaw);
  } catch (e) {
    issue = e instanceof Error ? e.message : "Invalid Gem rules.";
  }
  try {
    if (reviewsRaw) {
      const v = JSON.parse(reviewsRaw);
      if (
        v.version !== gemVersion ||
        v.datasetHash !== d.hash ||
        !Array.isArray(v.rows)
      )
        throw Error(
          "Role reviews need review for this imported snapshot; previous reviews are not applied.",
        );
      reviews = parseRoleReviews(v.rows, d, now);
    }
  } catch (e) {
    issue = [issue, e instanceof Error ? e.message : "Invalid role reviews."]
      .filter(Boolean)
      .join(" ");
  }
  // Expose the next actual expiry so the UI and worker cannot retain a previously qualified stale Gem.
  const expirations = [
    Date.parse(d.sourceUTC || "") + 86400000,
    ...reviews.map((r) => Date.parse(r.AsOfUTC) + rules.contextDays * 86400000),
  ].filter((time) => Number.isFinite(time) && time >= now);
  return {
    rules,
    reviews,
    issue,
    expiresAt: expirations.length ? Math.min(...expirations) + 1 : null,
  };
}

// Assess developing opportunity only; no scoring forecast, surplus or trade formula is changed here.
export function assessGem(
  p: Player,
  rows: Row[],
  d: Dataset,
  rules: GemRules,
  reviews: RoleReview[],
  issue = "",
  now = Date.now(),
): GemAssessment {
  const recentRows = rows.slice(-3),
    previousRows = rows.slice(-6, -3);
  const base: GemAssessment = {
    classification: "Not applicable",
    checks: [],
    explanation:
      "Breakout workload rules apply to RB, WR and TE only. Other scoring and regression signals remain separate.",
    recentWeeks: recentRows.map((r) => num(r.Week)),
    previousWeeks: previousRows.map((r) => num(r.Week)),
    recent: null,
    previous: null,
    increase: null,
    growthPct: null,
    review: reviews.find((r) => r.PlayerID === p.id) ?? null,
    prompts: [],
  };
  if (!gemPositions.includes(p.pos as GemPosition)) return base;
  const rule = rules.positions[p.pos as GemPosition];
  // Explicit null counting stats mean zero in verified games; absent or invalid keys stay unavailable.
  const keys = p.pos === "RB" ? ["RushAttempts", "Targets"] : ["Targets"];
  const complete =
    p.historyComplete &&
    rows.length === p.games &&
    new Set(rows.map((r) => r.Week)).size === rows.length;
  const usable = [...recentRows, ...previousRows].every((r) =>
    keys.every(
      (k) =>
        Object.hasOwn(r, k) &&
        (r[k] === null || (n(r[k]) !== null && num(r[k]) >= 0)),
    ),
  );
  const amounts = (bag: Row[]) =>
    bag.map((r) => keys.reduce((total, k) => total + num(r[k]), 0));
  const recent = usable ? amounts(recentRows) : [],
    previous = usable ? amounts(previousRows) : [];
  base.recent = mean(recent);
  base.previous = mean(previous);
  base.increase =
    base.recent !== null && base.previous !== null
      ? base.recent - base.previous
      : null;
  base.growthPct =
    base.increase !== null && base.previous !== null && base.previous > 0
      ? base.increase / base.previous
      : null;
  const fmt = (v: number | null) => (v === null ? "unavailable" : v.toFixed(2));
  const historyPass = complete && rows.length >= 5;
  const meanPass = recent.length === 3 && base.recent! >= rule.mean;
  const floorPass = recent.length === 3 && recent.every((v) => v >= rule.floor);
  const growthPass =
    previous.length >= 2 &&
    base.increase !== null &&
    base.increase >= rule.growth &&
    (base.previous === 0 || base.growthPct! >= rules.growthPct);
  const review = base.review;
  const snapshotCurrent =
    !!d.sourceUTC &&
    Number.isFinite(Date.parse(d.sourceUTC)) &&
    now - Date.parse(d.sourceUTC) <= 86400000 &&
    Date.parse(d.sourceUTC) <= now + 300000;
  const contextCurrent =
    !!review &&
    review.Week === num(d.tables.ModelContext[0].CurrentWeek) &&
    review.ThroughWeek >= (base.recentWeeks.at(-1) ?? Infinity) &&
    now - Date.parse(review.AsOfUTC) <= rules.contextDays * 86400000;
  const supported =
    contextCurrent &&
    review!.Outlook === "Supported ongoing opportunity" &&
    !issue &&
    snapshotCurrent;
  const unit = p.pos === "RB" ? "carries + targets" : "targets";
  // Every gate is retained in the result so screens can explain failures and unknowns consistently.
  base.checks = [
    {
      check: "Verified history",
      required: "5+ played games; 3 recent and 2–3 immediately preceding",
      actual: `${rows.length} games; recent weeks ${base.recentWeeks.join(", ") || "none"}; previous weeks ${base.previousWeeks.join(", ") || "none"}`,
      status: !complete ? "UNKNOWN" : historyPass ? "PASS" : "FAIL",
    },
    {
      check: `Recent ${unit} / game`,
      required: `≥ ${rule.mean}`,
      actual: fmt(base.recent),
      status:
        !usable || !recent.length ? "UNKNOWN" : meanPass ? "PASS" : "FAIL",
    },
    {
      check: "Each of the last 3 games",
      required: `≥ ${rule.floor} ${unit} in EACH game`,
      actual: recent.length ? recent.join(", ") : "unavailable",
      status:
        !usable || !recent.length ? "UNKNOWN" : floorPass ? "PASS" : "FAIL",
    },
    {
      check: "Workload growth",
      required: `≥ +${rule.growth} AND ≥ ${(rules.growthPct * 100).toFixed(0)}%; previous zero: absolute gate only`,
      actual: `${fmt(base.previous)} → ${fmt(base.recent)}; change ${fmt(base.increase)}; ${base.growthPct === null ? "percentage unavailable" : (base.growthPct * 100).toFixed(2) + "%"}`,
      status:
        !usable || previous.length < 2
          ? "UNKNOWN"
          : growthPass
            ? "PASS"
            : "FAIL",
    },
    {
      check: "Availability",
      required: "Active; no unresolved return scenario; remaining games",
      actual: `${p.injury}; ${p.available} available games${p.opportunity.returnWeek !== null ? "; return scenario selected" : ""}`,
      status: !p.uncertain && p.available > 0 ? "PASS" : "UNRESOLVED",
    },
    {
      check: "Ongoing role context",
      required: `Sourced current-week review covering latest played game; ≤ ${rules.contextDays} days old`,
      actual: review
        ? `${review.Outlook}; covers Week ${review.ThroughWeek}; ${review.Source}; ${review.AsOfUTC}. ${review.Reason}${!contextCurrent ? " Review is stale or does not cover the latest played game." : ""}`
        : "No sourced role review",
      status: supported ? "SUPPORTED" : "UNRESOLVED",
    },
    {
      check: "Current snapshot / rules",
      required: "Snapshot ≤ 24 hours old; valid rules and reviews",
      actual:
        issue ||
        (snapshotCurrent
          ? `Snapshot ${d.sourceUTC}`
          : `Stale or undated snapshot: ${d.sourceUTC || "unavailable"}`),
      status: !issue && snapshotCurrent ? "PASS" : "UNRESOLVED",
    },
  ];
  // Injured same-team competitors are review prompts, never proof of a temporary or permanent promotion.
  base.prompts = d.tables.ModelPlayers.filter(
    (r) =>
      str(r.PlayerID) !== p.id &&
      str(r.ProTeamID) === p.nflId &&
      (p.pos === "RB"
        ? r.Position === "RB"
        : ["WR", "TE"].includes(str(r.Position))) &&
      !!r.InjuryStatus &&
      r.InjuryStatus !== "ACTIVE",
  ).map(
    (r) =>
      `${str(r.Player)}: ${str(r.InjuryStatus)}. Review returning competition; this flag does not establish why the role changed.`,
  );
  // A high but unchanged role is not a developing-role signal; scoring outperformance alone is insufficient.
  const promising =
    recent.length === 3 &&
    previous.length >= 2 &&
    base.increase !== null &&
    base.increase > 0 &&
    (meanPass || growthPass);
  const shortPromising =
    complete &&
    usable &&
    rows.length < 5 &&
    recent.length > 0 &&
    base.recent! >= rule.mean;
  base.classification =
    !complete || !usable || !rows.length
      ? "Insufficient data"
      : historyPass &&
          meanPass &&
          floorPass &&
          growthPass &&
          !p.uncertain &&
          p.available > 0 &&
          supported
        ? "Gem"
        : promising || shortPromising
          ? "Watch"
          : "No breakout signal";
  base.explanation =
    base.classification === "Gem"
      ? "Sustained starter-level workload, meaningful growth and current sourced support for an ongoing role. High potential is not a guaranteed breakout."
      : base.classification === "Watch"
        ? `Developing opportunity needs confirmation. ${base.checks
            .filter((c) => !["PASS", "SUPPORTED"].includes(c.status))
            .map((c) => c.check + ": " + c.status)
            .join("; ")}.`
        : base.classification === "Insufficient data"
          ? "Verified played-game workload is missing, inconsistent or invalid. Scoring signals alone cannot establish a Gem."
          : "No qualifying developing-role evidence. Strong established production alone is not a Gem.";
  return base;
}
