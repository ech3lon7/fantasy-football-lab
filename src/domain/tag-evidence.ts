// Reuse the classifier registry when displaying requirements; stored setting overrides remain authoritative.
import { defaultGemRules, gemPositions, labelPolicy } from "./label-rules";
import { n, num, type Row } from "./contracts";
import { playedHistory } from "./opportunity";
import { playerSignals, type Model, type Player } from "./valuation";
import {
  evidenceComparison,
  type EvidenceComparison,
} from "./evidence-comparison";

// Explanations describe active analytical labels only; they never assign signals or change forecasts.
export interface TagEvidenceRow {
  check: string;
  required: string;
  actual: string;
  kind: "fact" | "projection" | "model";
  requiredKind?: "model" | "projection";
  comparisons?: EvidenceComparison[];
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
  comparisons?: EvidenceComparison[],
): TagEvidenceRow => ({
  check,
  required,
  actual,
  kind,
  requiredKind,
  comparisons,
});

// Show the underlying recorded games using each tag's existing window, without changing its qualification rules.
function gameEvidence(
  p: Player,
  history: Row[],
  tag: string,
): TagEvidenceRow[] {
  const regression = ["BUY LOW", "SELL HIGH", "TD caution"].includes(tag);
  if (regression && !p.opportunity.source.startsWith("Completed-game history"))
    return [
      row(
        "Game-by-game evidence",
        "The label uses aligned season totals; a verified weekly workload breakdown is unavailable",
        "Unavailable",
      ),
    ];
  const workloadWindow = tag === "Watch" || tag === "Reduced workload";
  const windows = regression
    ? [
        {
          name: "Season played-game evidence",
          games: history,
          note: "Aligned cumulative opportunities and touchdowns; points are context",
        },
      ]
    : tag === "Projection-gap watch"
      ? [
          {
            name: "Season played-game evidence",
            games: history,
            note: "All recorded played games behind actual season PPG",
          },
          {
            name: "Recent played-game evidence",
            games: history.slice(-labelPolicy.window),
            note: "Latest three played games behind recent PPG",
          },
        ]
      : [
          {
            name: "Recent played-game evidence",
            games: history.slice(-labelPolicy.window),
            note: "Latest three played games",
          },
          {
            name: "Earlier played-game evidence",
            games: workloadWindow
              ? history.slice(-2 * labelPolicy.window, -labelPolicy.window)
              : history.slice(0, -labelPolicy.window),
            note: workloadWindow
              ? "Immediately preceding two or three played games"
              : "ALL earlier played games before the latest three",
          },
        ];
  // Explicit null counting stats mean zero in a verified game; absent or invalid counts stay unavailable.
  const count = (game: Row, key: string) =>
    Object.hasOwn(game, key) &&
    (game[key] === null || (n(game[key]) !== null && num(game[key]) >= 0))
      ? num(game[key])
      : null;
  return windows.map(({ name, games, note }) =>
    row(
      name,
      `${note}${workloadWindow ? "; workload drives this tag; points are context" : ""}`,
      games.length
        ? games
            .map((game) => {
              const details = [`${value(n(game.Points))} points`];
              if (["RB", "QB"].includes(p.pos))
                details.push(`${value(count(game, "RushAttempts"))} carries`);
              if (["RB", "WR", "TE"].includes(p.pos))
                details.push(`${value(count(game, "Targets"))} targets`);
              if (regression) {
                const receiving = count(game, "ReceivingTD"),
                  rushing = count(game, "RushTD");
                details.push(
                  `${value(receiving === null || (p.pos === "RB" && rushing === null) ? null : receiving + (p.pos === "RB" ? rushing! : 0))} TDs`,
                );
              }
              return `${game.Season} W${game.Week}: ${details.join("; ")}`;
            })
            .join(" | ")
        : "Unavailable",
    ),
  );
}

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
    const short = p.games < labelPolicy.watchGames;
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
          "fact",
          undefined,
          short
            ? [evidenceComparison(rule.mean, assessment.recent, unit)]
            : undefined,
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
                "fact",
                undefined,
                [evidenceComparison(0, assessment.increase, unit, ">")],
              ),
              row(
                "Level OR growth route",
                `Recent workload ≥ ${rule.mean}, OR increase ≥ ${rule.growth} AND ≥ ${percent(defaultGemRules.growthPct)}`,
                `Recent ${value(assessment.recent)}; increase ${value(assessment.increase)}; growth ${assessment.previous === 0 ? "zero earlier workload; percentage requirement waived" : percent(assessment.growthPct)}`,
                "fact",
                undefined,
                // Watch permits the level route OR both growth gates; failed alternatives do not invalidate a passing route.
                [
                  evidenceComparison(
                    rule.mean,
                    assessment.recent,
                    unit,
                    "≥",
                    "Level route — OR growth route below",
                  ),
                  evidenceComparison(
                    rule.growth,
                    assessment.increase,
                    unit,
                    "≥",
                    "Growth route — absolute AND percentage increase",
                  ),
                  ...(assessment.previous === 0
                    ? [
                        {
                          required: "Waived: earlier workload is zero",
                          actual: "Percentage undefined",
                          margin: "Not required",
                          note: "Growth route — percentage gate waived",
                        },
                      ]
                    : [
                        evidenceComparison(
                          defaultGemRules.growthPct,
                          assessment.growthPct,
                          "%",
                          "≥",
                          "Growth route — percentage AND absolute increase",
                        ),
                      ]),
                ],
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
          `At least ${labelPolicy.window + s.GemMinPriorGames} games: three recent plus ${s.GemMinPriorGames} earlier`,
          `${p.games} games`,
          "fact",
          undefined,
          [
            evidenceComparison(
              labelPolicy.window + s.GemMinPriorGames,
              p.games,
              "games",
            ),
          ],
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
          "fact",
          "projection",
          [
            evidenceComparison(
              p.projected,
              p.recent,
              "PPG",
              "≥",
              "Minimum is ESPN season projected PPG",
            ),
          ],
        ),
        row(
          "Scoring improvement",
          `Recent minus earlier PPG ≥ ${value(s.GemMinGap)}`,
          `${value(p.trendDelta)} PPG`,
          "fact",
          undefined,
          [evidenceComparison(s.GemMinGap, p.trendDelta, "PPG")],
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
        ? labelPolicy.qbCarries
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
          "fact",
          undefined,
          // Both nonoverlapping sample counts must qualify; their thresholds are not interchangeable.
          [
            evidenceComparison(
              3,
              o.recentGames,
              "games",
              "≥",
              "Recent played games",
            ),
            evidenceComparison(
              s.GemMinPriorGames,
              o.priorGames,
              "games",
              "≥",
              "Earlier played games",
            ),
          ],
        ),
        row(
          "Recent workload",
          `At least ${value(minimum)} ${unit}`,
          `${value(o.recentRate)} ${unit}`,
          "fact",
          undefined,
          [evidenceComparison(minimum, o.recentRate, unit)],
        ),
        row(
          "Earlier workload",
          "Average across ALL earlier played games",
          `${value(o.priorRate)} ${unit}`,
        ),
        row(
          "Workload increase",
          `At least ${value(labelPolicy.roleGrowth)} AND at least ${labelPolicy.roleGrowthPct * 100}% of the absolute earlier rate (${value(o.priorRate === null ? null : Math.abs(o.priorRate) * labelPolicy.roleGrowthPct)})`,
          `${value(o.delta)} ${unit}`,
          "fact",
          undefined,
          // Keep both absolute and relative growth gates visible, using the opportunity module's earlier average.
          [
            evidenceComparison(
              labelPolicy.roleGrowth,
              o.delta,
              unit,
              "≥",
              "Absolute increase — AND relative increase",
            ),
            evidenceComparison(
              o.priorRate === null
                ? null
                : Math.abs(o.priorRate) * labelPolicy.roleGrowthPct,
              o.delta,
              unit,
              "≥",
              `Relative gate: ${labelPolicy.roleGrowthPct * 100}% of the absolute earlier rate`,
            ),
          ],
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
          "fact",
          undefined,
          [evidenceComparison(s.GemMinGames, p.games, "games")],
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
          undefined,
          [evidenceComparison(s.GemMinGap, p.gap, "PPG")],
        ),
        row(
          "Relative scoring gap",
          p.projected !== null && p.projected > 0
            ? `At least ${percent(s.GemMinGapPct)}`
            : "No percentage requirement when projected PPG is zero or negative",
          percent(p.gapPct),
          "model",
          undefined,
          p.projected !== null && p.projected > 0
            ? [evidenceComparison(s.GemMinGapPct, p.gapPct, "%")]
            : [
                {
                  required: "Waived: projected PPG is zero or negative",
                  actual: percent(p.gapPct),
                  margin: "Not required",
                },
              ],
        ),
        row(
          "Recent actual PPG",
          "At least ESPN season projected PPG",
          value(p.recent),
          "fact",
          "projection",
          [
            evidenceComparison(
              p.projected,
              p.recent,
              "PPG",
              "≥",
              "Minimum is ESPN season projected PPG",
            ),
          ],
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
          "fact",
          undefined,
          assessment.reducedWorkload.comparisons,
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
    const cutoff = g
      ? g.meanRate +
        (buy ? -labelPolicy.buySigma : labelPolicy.sellSigma) * g.rateSD
      : null;
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
                "fact",
                undefined,
                [evidenceComparison(s.GemMinGames, p.games, "games")],
              ),
            ]
          : []),
        row(
          "Minimum opportunity sample",
          `At least ${value(s.MinOpportunity)} cumulative opportunities`,
          value(p.opportunities),
          "fact",
          undefined,
          [
            evidenceComparison(
              s.MinOpportunity,
              p.opportunities,
              "opportunities",
            ),
          ],
        ),
        row(
          "Positional volume test",
          `${buy ? "At least" : "Strictly below"} the ${labelPolicy.volumeQuantile * 100}th-percentile ${p.pos} cutoff: ${value(g?.highVolume)}`,
          value(p.opportunities),
          "fact",
          "model",
          [
            evidenceComparison(
              g?.highVolume,
              p.opportunities,
              "opportunities",
              buy ? "≥" : "<",
            ),
          ],
        ),
        row(
          "Recorded touchdowns",
          "Rushing + receiving TDs for RB; receiving TDs for WR/TE",
          value(p.td),
        ),
        row(
          "Player touchdown rate",
          `${buy ? "Strictly below" : "Strictly above"} ${percent(cutoff)} (${buy ? `peer mean − ${labelPolicy.buySigma} × SD` : `peer mean + ${labelPolicy.sellSigma} × SD`})`,
          percent(p.tdRate),
          "fact",
          "model",
          [evidenceComparison(cutoff, p.tdRate, "%", buy ? "<" : ">")],
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
  // Attach the numerical game trail only to active explanations; byes and nonparticipation use the engine's existing exclusions.
  const historyRows = explanations.length
    ? (playedHistory(m.dataset).get(p.id) ?? [])
    : [];
  return explanations.map((explanation) => ({
    ...explanation,
    rows: [
      ...explanation.rows,
      ...gameEvidence(p, historyRows, explanation.tag),
    ],
  }));
}
