import data from "./historical-label-reference.json";
import {
  defaultGemRules,
  gemVersion,
  labelPolicy,
  labelRuleVersion,
} from "./label-rules";
import { labelEvidenceBinding } from "./label-evidence-binding";
import { n, str } from "./contracts";
import type { Model, Player } from "./valuation";

// References expose formatted descriptive context only; classification cannot consume percentiles as predicates.
export interface HistoricalContext {
  text: string;
  note: string;
  unavailable?: boolean;
}
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const configurationMatches = () =>
  gemVersion === data.classifierVersion &&
  labelRuleVersion === data.registryVersion &&
  JSON.stringify(defaultGemRules) === JSON.stringify(data.gemConfiguration) &&
  JSON.stringify(labelPolicy) === JSON.stringify(data.policyConfiguration);

// Verify the observed historical offensive scoring weights before placing PPG distributions beside current scoring.
function scoringMatches(m: Model) {
  try {
    const items = JSON.parse(
      str(m.dataset.tables.ModelContext[0].ScoringItemsJSON),
    );
    if (!Array.isArray(items)) return false;
    const weights = new Map(items.map((r) => [String(r.statId), r]));
    return Object.entries(data.observedScoringWeights)
      .filter(([id]) =>
        [3, 4, 19, 20, 24, 25, 26, 42, 43, 44, 53, 63, 72].includes(Number(id)),
      )
      .every(([id, value]) => {
        const rule = weights.get(id);
        return (
          rule &&
          n(rule.points) === value &&
          !rule.isReverseItem &&
          Object.keys(rule.pointsOverrides ?? {}).length === 0
        );
      });
  } catch {
    return false;
  }
}

// Match a row only to a distribution with the same numerator, per-game unit and played-game window.
export function historicalLabelContext(
  tag: string,
  check: string,
  p: Player,
  m: Model,
): HistoricalContext | undefined {
  let metric = "";
  if (tag === "Gem" && check === "Recent window actual PPG")
    metric = "recentPPG";
  if (
    tag === "Gem" &&
    /^Recent window (targets|carries \+ targets) \/ game$/.test(check)
  )
    metric = "workload";
  if (
    ["Watch", "Role-growth watch"].includes(tag) &&
    check === "Recent workload"
  )
    metric = "workload";
  if (tag === "Watch" && check === "Positive workload change")
    metric = "watchGrowth";
  if (tag === "Role-growth watch" && check === "Workload increase")
    metric = "roleGrowth";
  if (tag === "Scoring breakout watch" && check === "Recent actual PPG")
    metric = "recentPPG";
  if (tag === "Scoring breakout watch" && check === "Scoring improvement")
    metric = "scoringTrend";
  if (!metric || !p.historyComplete || p.games < labelPolicy.window) return;
  if (
    ["watchGrowth", "roleGrowth", "scoringTrend"].includes(metric) &&
    p.games < labelPolicy.watchGames
  )
    return;
  if (
    ["recentPPG", "seasonPPG", "scoringTrend"].includes(metric) &&
    !scoringMatches(m)
  )
    return {
      text: "Historical PPG comparison unavailable: scoring compatibility is not fully verified.",
      unavailable: true,
      note: "The current player numbers and label are unchanged. Historical observed scoring weights are not enough to verify every current scoring item or bonus.",
    };
  const ref = data.references.find(
    (r) => r.position === p.pos && r.metric === metric,
  );
  if (!ref) return;
  const unit =
    metric === "workload" || metric === "watchGrowth" || metric === "roleGrowth"
      ? p.pos === "RB"
        ? "carries + targets/game"
        : p.pos === "QB"
          ? "carries/game"
          : "targets/game"
      : ref.unit;
  return {
    text: `Historical nine-team modeled starter-quality ${p.pos}: median ${ref.median.toFixed(2)} ${unit} (2023–2025; ${ref.observations} observations). Descriptive reference, not a qualification cutoff.`,
    note: `${data.method.referenceWindows[metric as keyof typeof data.method.referenceWindows]}. Middle 50%: ${ref.p25.toFixed(2)}–${ref.p75.toFixed(2)} ${unit}; ${ref.players} distinct players, ${ref.playerSeasons} player-seasons. After Weeks 4, 8 and 12. ${data.method.cohort} ${data.method.quantiles} Repeated observations are correlated. The historical scoring/roster cohort may differ from this import; no dated fantasy lineups or team-share history is assumed.`,
  };
}

// Explain unsupported row comparisons and redundant floors without inventing a distribution or a success probability.
export function labelResearchNote(tag: string) {
  if (tag === "Gem")
    return "The individual-game workload floor remains mandatory but provisional. Removing that support check while retaining the other current gates changed zero labels in the 2023–2025 study (494 weekly labels; 154 first alerts). It was historically redundant within this combined rule, not independently validated as necessary or optimal; it may matter in future data. Scoring and average-workload gates remain unchanged. TE tuning was underpowered.";
  if (tag === "Watch")
    return "Broad Watch is unchanged. The proposed stricter WR growth filter is deferred pending comparison against simple scoring and target filters. Early samples below three games have no matching three-game historical reference.";
  if (["Scoring breakout watch", "Projection-gap watch"].includes(tag))
    return "Archived ESPN forecasts are unavailable, so the complete projection-dependent label was not historically validated. PPG context is omitted when scoring compatibility cannot be verified.";
  if (["BUY LOW", "SELL HIGH", "TD caution"].includes(tag))
    return "These are cumulative touchdown-regression comparisons. Recent per-game percentiles do not match their denominator and are omitted. Fixed percentile/SD policy settings produce snapshot-dependent numerical cutoffs; acquisition profit is untested.";
  if (tag === "Reduced workload")
    return "The decline rule is unchanged. No compatible historical individual-game support reference is supplied; injury-shortened games remain included. A decline is context, not a forecast penalty.";
  return "Historical context describes recorded positional distributions. It does not validate a permanent role or introduce a scoring/trade-value bonus; dated team-share comparisons remain unsupported.";
}

// Keep aggregate method results in audit, with aligned denominators and outcomes rather than player-level probabilities.
export function historicalLabelAudit(m: Model) {
  const compatible = configurationMatches();
  const rows = compatible
    ? (["Gem", "Watch"] as const).flatMap((tag) => {
        const result = data.calibration[tag];
        return (["firstAlert", "weekly"] as const).map((unit) => {
          const x = result[unit];
          return {
            id: `${tag}:${unit}`,
            tag,
            unit:
              unit === "firstAlert"
                ? "First qualifying player per season"
                : "Repeated weekly labels",
            sample: `${x.hits}/${x.labels}`,
            rate: pct(x.rate),
            base: pct(x.matchedBaseRate),
            lift: `${x.lift.toFixed(2)}×`,
            volume:
              unit === "weekly"
                ? `${(x.labels / result.calendarSeasonWeeks).toFixed(2)} / season-week (42, Weeks 1–14)`
                : `${(x.labels / 3).toFixed(2)} new players / season`,
            followup: `${x.insufficientFollowup} insufficient-follow-up failures`,
            seasons: Object.entries(x.perSeason)
              .map(([year, s]) => `${year}: ${s.hits}/${s.labels}`)
              .join("; "),
          };
        });
      })
    : [];
  return {
    version: `${labelRuleVersion} / ${gemVersion} / ${data.version}`,
    binding: labelEvidenceBinding,
    status: compatible
      ? "Research applies to the recorded default Gem/Watch policy; it does not validate arbitrary user settings for other labels."
      : "Research configuration mismatch: calibration results withheld; current labels continue using the active rules.",
    scoring: scoringMatches(m)
      ? "Observed offensive scoring weights match. Unobserved bonuses remain unverified."
      : "Current scoring compatibility is not fully verified; player-level historical PPG references are withheld. Workload references identify their historical nine-team cohort.",
    outcome: data.method.outcome,
    baseline: data.method.baseline,
    limitations: data.method.limitations,
    rows,
    volume:
      "Gem requires four played games: 494 repeated labels across 33 season-weeks (Weeks 4–14), or 14.97/week. Including early Weeks 1–3 gives 11.76/week across 42 season-weeks. These are repeated labels, not new discoveries.",
    policy:
      "Fixed policy parameters stay unchanged between reviewed recalibrations. Snapshot-derived percentiles and TD-rate means/SDs update normally. Review requires new usable outcomes and a frozen comparison protocol; calendar dates alone do not change rules. Stricter Watch and new rarity/composite rules are deferred.",
  };
}
