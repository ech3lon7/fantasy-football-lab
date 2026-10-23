import { defaultGemRules, gemPositions } from "./gems";
import { playerSignals, type Model, type Player } from "./valuation";

// Explanations describe active analytical labels only; they never assign signals or change forecasts.
export interface TagEvidenceRow {
  check: string;
  required: string;
  actual: string;
  kind: "fact" | "projection" | "model";
  requiredKind?: "model";
}
export interface TagExplanation {
  tag: string;
  meaning: string;
  rows: TagEvidenceRow[];
  interpretation: string;
  limitations: string;
  window: string;
}
// Format evidence consistently without turning unavailable values into zero or changing comparison precision.
const value = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) : "Unavailable";
const percent = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n)
    ? `${(n * 100).toFixed(2)}%`
    : "Unavailable";
const row = (
  check: string,
  required: string,
  actual: string,
  kind: TagEvidenceRow["kind"] = "fact",
  requiredKind?: TagEvidenceRow["requiredKind"],
): TagEvidenceRow => ({ check, required, actual, kind, requiredKind });

// Read existing engine results and selected settings; all displayed comparisons stay in the domain layer.
export function activeTagExplanations(p: Player, m: Model): TagExplanation[] {
  const active = new Set([...playerSignals(p), p.regression]);
  const explanations: TagExplanation[] = [];
  const s = m.settings,
    o = p.opportunity,
    assessment = p.breakout;
  const scoringWindow = `Latest three played games versus ALL earlier played games (${p.games} total).`;
  const history = row(
    "Verified history and model",
    "Complete played-game history and usable model data",
    `${p.games} played games; ${p.historyComplete ? "history complete" : "history incomplete"}; ${p.value === null ? "model unavailable" : "model usable"}`,
  );
  const projection = row(
    "ESPN season projected PPG",
    "Comparison reference; not ESPN's current-week projection",
    value(p.projected),
    "projection",
  );

  // Watch uses its own workload branches, rather than presenting failed Gem scoring gates as the Watch requirements.
  if (
    active.has("Watch") &&
    assessment &&
    gemPositions.includes(p.pos as (typeof gemPositions)[number])
  ) {
    const rule =
      defaultGemRules.positions[p.pos as (typeof gemPositions)[number]];
    const unit = p.pos === "RB" ? "carries + targets/game" : "targets/game";
    const short = p.games < 5;
    explanations.push({
      tag: "Watch",
      meaning:
        "Workload shows a developing opportunity, but the player does not meet every Gem requirement.",
      rows: [
        row(
          "Verified history",
          "Complete played-game history and usable workload counts",
          `${p.games} played games; ${p.historyComplete ? "history complete" : "history incomplete"}`,
        ),
        row(
          "Recent workload",
          short ? `At least ${rule.mean} ${unit}` : "Latest three played games",
          `${value(assessment.recent)} ${unit}; weeks ${assessment.recentWeeks.join(", ")}`,
        ),
        ...(short
          ? []
          : [
              row(
                "Earlier workload",
                "Immediately preceding two or three played games",
                `${value(assessment.previous)} ${unit}; weeks ${assessment.previousWeeks.join(", ")}`,
              ),
              row(
                "Positive workload change",
                "Strictly greater than zero",
                `${value(assessment.increase)} ${unit}`,
              ),
              row(
                "Level OR growth route",
                `Recent workload ≥ ${rule.mean}, OR increase ≥ ${rule.growth} AND ≥ ${percent(defaultGemRules.growthPct)}`,
                `Recent ${value(assessment.recent)}; increase ${value(assessment.increase)}; growth ${assessment.previous === 0 ? "zero earlier workload; percentage requirement waived" : percent(assessment.growthPct)}`,
              ),
            ]),
        row(
          "Gem requirements not met",
          "At least one Gem gate is not PASS; otherwise the primary label is Gem",
          assessment.checks
            .filter((c) => c.status !== "PASS")
            .map((c) => `${c.check}: ${c.status}`)
            .join("; ") || "Unavailable",
          "model",
        ),
      ],
      interpretation:
        "The player's opportunity merits attention even when scoring confirmation is not yet strong enough for Gem.",
      limitations:
        "Watch is not a scoring forecast, a promise of a permanent role, or proof of an undervalued player. Injury uncertainty can remain. Workload and scoring rules are provisional; no manual approval is required.",
      window: short
        ? `Early sample: latest ${assessment.recentWeeks.length} played games; fewer than five games uses the workload-level branch without requiring growth.`
        : "Latest three played games versus the immediately preceding two or three, not all earlier games.",
    });
  }

  // The scoring watch uses actual scoring improvement and the long-term ESPN forecast, independently of workload growth.
  if (active.has("Scoring breakout watch"))
    explanations.push({
      tag: "Scoring breakout watch",
      meaning:
        "Recent actual scoring improved versus earlier games and meets or exceeds ESPN's season forecast.",
      rows: [
        history,
        row(
          "Played-game sample",
          `At least ${3 + s.GemMinPriorGames} games: three recent plus ${s.GemMinPriorGames} earlier`,
          `${p.games} games`,
        ),
        row(
          "Earlier actual PPG",
          "Average across every played game before the latest three",
          value(p.earlier),
        ),
        row(
          "Recent actual PPG",
          "At least ESPN season projected PPG",
          value(p.recent),
        ),
        row(
          "Scoring improvement",
          `Recent minus earlier PPG ≥ ${value(s.GemMinGap)}`,
          `${value(p.trendDelta)} PPG`,
        ),
        projection,
      ],
      interpretation:
        "The recent scoring record is stronger than the earlier record and the season forecast; investigate whether that production has repeatable support.",
      limitations:
        "No workload-growth requirement or percentage-growth test applies to this tag. A few big games or touchdowns can drive it. It does not automatically qualify a Gem or add a trade-value bonus.",
      window: scoringWindow,
    });

  // Role-growth uses the opportunity module's nonoverlapping all-earlier window, which differs from primary Watch.
  if (active.has("Role-growth watch")) {
    const unit =
      p.pos === "QB"
        ? "carries/game"
        : p.pos === "RB"
          ? "carries + targets/game"
          : "targets/game";
    const minimum =
      p.pos === "QB"
        ? 3
        : p.pos === "RB"
          ? s.GemRBOpportunities
          : p.pos === "WR"
            ? s.GemWRTargets
            : s.GemTETargets;
    explanations.push({
      tag: "Role-growth watch",
      meaning:
        "Recent workload increased substantially while reaching the position's minimum opportunity level.",
      rows: [
        history,
        row(
          "Workload sample",
          `Three recent games and at least ${s.GemMinPriorGames} earlier games`,
          `${o.recentGames} recent; ${o.priorGames} earlier`,
        ),
        row(
          "Recent workload",
          `At least ${value(minimum)} ${unit}`,
          `${value(o.recentRate)} ${unit}`,
        ),
        row(
          "Earlier workload",
          "Average across ALL earlier played games",
          `${value(o.priorRate)} ${unit}`,
        ),
        row(
          "Workload increase",
          `At least 2.00 AND at least 20% of the absolute earlier rate (${value(o.priorRate === null ? null : Math.abs(o.priorRate) * 0.2)})`,
          `${value(o.delta)} ${unit}`,
        ),
      ],
      interpretation:
        "More opportunities can support future production before the fantasy points arrive.",
      limitations:
        "This is distinct from the primary Watch label. It does not require scoring improvement or beating projections, establish a permanent role, or independently add a value bonus. QB workload here means rushing attempts, not pass attempts.",
      window: `Latest three played games versus ALL ${o.priorGames} earlier played games. ${o.source}.`,
    });
  }

  // Projection-gap watch retains the existing absolute/relative gap settings and recent-scoring confirmation.
  if (active.has("Projection-gap watch"))
    explanations.push({
      tag: "Projection-gap watch",
      meaning:
        "Actual season scoring exceeds the season forecast, with recent scoring still at or above that forecast.",
      rows: [
        history,
        row(
          "Played-game sample",
          `At least ${s.GemMinGames} games`,
          `${p.games} games`,
        ),
        row(
          "Actual season PPG",
          "Recorded points divided by played games",
          value(p.actual),
        ),
        projection,
        row(
          "Season scoring gap",
          `Actual minus projected PPG ≥ ${value(s.GemMinGap)}`,
          `${value(p.gap)} PPG`,
          "model",
        ),
        row(
          "Relative scoring gap",
          p.projected !== null && p.projected > 0
            ? `At least ${percent(s.GemMinGapPct)}`
            : "No percentage requirement when projected PPG is zero or negative",
          percent(p.gapPct),
          "model",
        ),
        row(
          "Recent actual PPG",
          "At least ESPN season projected PPG",
          value(p.recent),
        ),
      ],
      interpretation:
        "The imported season forecast may understate the player's recorded production.",
      limitations:
        "Workload support is not required. This is not a comparison with ESPN's current-week matchup projection and is not proof that the scoring advantage will persist or that the player is cheap to acquire.",
      window:
        "Season-to-date actual scoring, the latest three played games, and the imported ESPN season forecast.",
    });

  // Reduced workload reuses the classifier's exact recorded evidence and requirements without recalculating its gates.
  if (active.has("Reduced workload") && assessment?.reducedWorkload)
    explanations.push({
      tag: "Reduced workload",
      meaning:
        "Workload has fallen across multiple recent games, rather than just one isolated dip.",
      rows: [
        row(
          "Sustained workload decline",
          assessment.reducedWorkload.required,
          assessment.reducedWorkload.actual,
        ),
      ],
      interpretation:
        "The player is receiving less recent work relative to the earlier comparison window, even if the remaining workload is still strong.",
      limitations:
        "Injury-shortened games remain included. The signal does not identify the cause, establish a permanent role loss, or automatically reduce projections or trade value. It can coexist with Gem when scoring and workload remain above Gem thresholds.",
      window: `Latest three played games (weeks ${assessment.recentWeeks.join(", ")}) versus the immediately preceding two or three (weeks ${assessment.previousWeeks.join(", ")}).`,
    });

  // Regression explanations use the exact positional peer statistics retained by evaluate, not an alternate ranking or market formula.
  for (const tag of ["BUY LOW", "SELL HIGH", "TD caution"] as const) {
    if (!active.has(tag)) continue;
    const buy = tag === "BUY LOW",
      g = p.regressionEvidence;
    const cutoff = g ? g.meanRate + (buy ? -0.5 : 1.5) * g.rateSD : null;
    explanations.push({
      tag,
      meaning: buy
        ? "High opportunity volume is paired with a lower touchdown rate than positional peers."
        : "An elevated touchdown rate is paired with opportunity volume below the positional high-volume cutoff.",
      rows: [
        ...(tag === "TD caution"
          ? [
              history,
              row(
                "Played-game sample",
                `At least ${s.GemMinGames} games`,
                `${p.games} games`,
              ),
            ]
          : []),
        row(
          "Minimum opportunity sample",
          `At least ${value(s.MinOpportunity)} cumulative opportunities`,
          value(p.opportunities),
        ),
        row(
          "Positional volume test",
          `${buy ? "At least" : "Strictly below"} the 80th-percentile ${p.pos} cutoff: ${value(g?.highVolume)}`,
          value(p.opportunities),
          "fact",
          "model",
        ),
        row(
          "Recorded touchdowns",
          "Rushing + receiving TDs for RB; receiving TDs for WR/TE",
          value(p.td),
        ),
        row(
          "Player touchdown rate",
          `${buy ? "Strictly below" : "Strictly above"} ${percent(cutoff)} (${buy ? "peer mean − 0.5 × SD" : "peer mean + 1.5 × SD"})`,
          percent(p.tdRate),
          "fact",
          "model",
        ),
        row(
          "Positional peer mean TD rate",
          `Imported ${p.pos} players with at least ${value(s.MinOpportunity)} opportunities`,
          percent(g?.meanRate),
          "fact",
        ),
        row(
          "Positional TD-rate SD",
          "Population standard deviation of the same eligible peer rates",
          percent(g?.rateSD),
          "fact",
        ),
      ],
      interpretation: buy
        ? "The workload may support more touchdowns if the unusually low conversion rate moves toward its positional norm."
        : "Recent touchdown production may be difficult to sustain at this volume, so scoring could regress even if the player's role stays unchanged.",
      limitations:
        "This is a touchdown-regression screen, not a market-price judgment, a guarantee of future scoring, or an instruction to trade. Skill, role and team context can sustain different touchdown rates. The separate expected-TD estimate is not the trigger. TD caution repeats the SELL HIGH evidence rather than adding another penalty.",
      window:
        "Aligned completed-game cumulative workload and touchdowns. Peers include all same-position players in the imported dataset, owned or available; the volume cutoff uses positive-volume players.",
    });
  }
  return explanations;
}
