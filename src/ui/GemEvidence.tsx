import type { Model, Player } from "../domain/valuation";
import {
  activeTagExplanations,
  type TagEvidenceRow,
} from "../domain/tag-evidence";
import type { GemCheck } from "../domain/gems";
import {
  historicalLabelContext,
  labelResearchNote,
  type HistoricalContext,
} from "../domain/historical-label-reference";
import { FilterHelp } from "./FilterHelp";
import { EvidenceMeter, EvidenceStatus, EvidenceText } from "./EvidenceMeter";

// All active tags share compact meters; classification, source scores and exact AND/OR requirements remain domain-owned.
function EvidenceChecks({
  rows,
  label,
  tag,
  remainingWeeks,
}: {
  rows: (TagEvidenceRow & {
    status?: GemCheck["status"];
    historical?: HistoricalContext;
    provisionalFloor?: boolean;
  })[];
  label: string;
  tag: string;
  remainingWeeks: number;
}) {
  return (
    <div className="evidence-panel">
      <div className="evidence-checks" role="group" aria-label={label}>
        {rows.map((row, i) => {
          const numeric = !!row.comparisons?.length;
          return (
            <article
              className={`evidence-card${numeric ? "" : " evidence-card--context"}${(row.comparisons?.length ?? 0) > 1 ? " evidence-card--compound" : ""}`}
              key={`${row.check}:${i}`}
            >
              <header className="evidence-card-heading">
                <h4 className={row.kind}>{row.check}</h4>
                {row.status && <EvidenceStatus status={row.status} />}
              </header>
              {/* Every compound condition keeps its own marker and numeric comparison; a passing OR route does not hide failed alternatives. */}
              <div className="evidence-comparisons">
                {row.comparisons?.map((comparison, j) => (
                  <EvidenceMeter
                    key={j}
                    comparison={comparison}
                    tag={tag}
                    remainingWeeks={remainingWeeks}
                    check={row.check}
                    kind={row.kind}
                    requiredKind={row.requiredKind ?? "input-text"}
                    status={row.status}
                    showStatus={!row.status || row.comparisons!.length > 1}
                  />
                ))}
              </div>
              <p className={row.requiredKind ?? "explanation"}>
                <EvidenceText text={row.required} />
              </p>
              {(!numeric ||
                !row.comparisons!.some((c) =>
                  c.actual.startsWith(row.actual),
                )) && (
                <p
                  className={
                    row.actual === "Unavailable" || row.status === "UNKNOWN"
                      ? "muted"
                      : row.kind
                  }
                >
                  <EvidenceText text={row.actual} />
                </p>
              )}
              {/* Preserve the exact games, weeks, research context and provisional-floor notes alongside the new visual. */}
              {row.provisionalFloor && (
                <small className="evidence-note">
                  Provisional floor; historically redundant alongside the other
                  current Gem gates.
                </small>
              )}
              {row.historical && (
                <small className="evidence-note">
                  <FilterHelp
                    label="Historical reference"
                    help={row.historical.note}
                  >
                    <span
                      className={row.historical.unavailable ? "muted" : "fact"}
                    >
                      {row.historical.text}
                    </span>
                  </FilterHelp>
                </small>
              )}
            </article>
          );
        })}
      </div>
      {/* Keep scale interpretation available without repeating a large legend below every badge. */}
      <details className="evidence-meter-legend">
        <summary>How to read meters</summary>
        <small>
          Diamond: player value. Dashed line: badge threshold. Red to green
          means less to more favorable player evidence, not stronger
          qualification for a negative badge. Checkmarks and Xs indicate whether
          a criterion is met. Axis endpoints are display limits, not league
          extremes or predicted outcomes. Margins use the required direction;
          strict limits exclude equality. All AND/OR routes still apply. Yes/no
          requirements use Not met and Met endpoints; gray tracks mean
          unavailable or waived evidence. Recorded context has no invented
          cutoff.
        </small>
      </details>
    </div>
  );
}

// Render shared checks verbatim; UI code never repeats the breakout thresholds or calculations.
export function GemEvidence({ p, m }: { p: Player; m: Model }) {
  const assessment = p.breakout;
  const explanations = activeTagExplanations(p, m);
  // Only active analytical tags get sections; injury/data labels and trend arrows stay unchanged.
  const gem = p.gem === "Gem" && assessment;
  if (!gem && !explanations.length) return null;
  // Source age remains separate from qualification: an active tag can describe an older imported snapshot.
  const source = Date.parse(m.dataset.sourceUTC ?? "");
  const stale =
    !Number.isFinite(source) ||
    Date.now() - source > 86400000 ||
    source > Date.now() + 300000;
  return (
    <>
      {gem && (
        <details>
          <summary className="model">Why Gem?</summary>
          <p>{assessment.explanation}</p>
          <EvidenceChecks
            remainingWeeks={m.weeks.length}
            label="Breakout evidence checks"
            rows={assessment.checks.map((check) => ({
              ...check,
              kind: "fact",
              // The domain accessor suppresses incompatible windows/scoring and exposes descriptive text only.
              historical: historicalLabelContext("Gem", check.check, p, m),
              // Annotate only individual-game workload support; scoring and mean-workload requirements remain unchanged.
              provisionalFloor: check.check.endsWith("workload support"),
            }))}
            tag="Gem"
          />
          {/* Floor sensitivity describes the complete researched rule, never an independently optimized cutoff. */}
          <p>
            <small>{labelResearchNote("Gem")}</small>
          </p>
          {p.pos === "RB" && (
            <p className="fact">
              Recent carries / game:{" "}
              {p.opportunity.recentCarries?.toFixed(2) ?? "unavailable"};
              targets / game:{" "}
              {p.opportunity.recentTargets?.toFixed(2) ?? "unavailable"}. Their
              sum measures work, not equal fantasy scoring value.
            </p>
          )}
          {assessment.warnings.map((prompt) => (
            <p className="notice warning" key={prompt}>
              {prompt}
            </p>
          ))}
          {/* Explain the distinct windows without duplicating the domain's positional thresholds. */}
          <p>
            Gem requires both actual scoring and workload in the latest three
            played games and the previous overlapping three-game window,
            starting after four played games. Stable strong workload can
            qualify; growth and a prior Watch label are not required. Watch and
            Reduced workload retain their separate opportunity rules.
          </p>
          <p>
            Scoring Trend PPG still compares the last three played games with
            ALL earlier games. Watch workload growth and Reduced workload
            compare only the immediately preceding two or three.
            Scoring/projection gaps and touchdown cautions remain supporting
            signals. Gems are identified automatically; no manual role review,
            approval or news entry is required. The data does not establish
            whether a player is undervalued or the role is permanent. Rules
            remain provisional, not calibrated individual success probabilities;
            TE evidence is weaker.
          </p>
        </details>
      )}
      {/* Every supporting signal has its own collapsed evidence section, shared by popovers and full profiles. */}
      {explanations.map((explanation) => (
        <details key={explanation.tag}>
          <summary className="model">Why {explanation.tag}?</summary>
          <p>{explanation.meaning}</p>
          <EvidenceChecks
            remainingWeeks={m.weeks.length}
            label={`${explanation.tag} evidence checks`}
            tag={explanation.tag}
            rows={explanation.rows.map((row) => ({
              ...row,
              historical: historicalLabelContext(
                explanation.tag,
                row.check,
                p,
                m,
              ),
            }))}
          />
          {/* Unsupported historical comparisons are stated explicitly instead of filled with mismatched percentiles. */}
          <p>
            <small>{labelResearchNote(explanation.tag)}</small>
          </p>
          <p>{explanation.interpretation}</p>
          <p>{explanation.limitations}</p>
          <p>
            <small>
              {explanation.window} Source refreshed:{" "}
              {m.dataset.sourceUTC ?? "Unavailable"}. Displayed numbers are
              rounded; labels use unrounded calculations.
            </small>
          </p>
          {/* Preserve primary Watch's existing automatic source/competition warnings beside its new workload evidence. */}
          {explanation.tag === "Watch" &&
            assessment?.warnings.map((warning) => (
              <p className="notice warning" key={warning}>
                {warning}
              </p>
            ))}
          {stale && explanation.tag !== "Watch" && (
            <p className="notice warning">
              Stale or undated snapshot. This explanation describes imported
              evidence, not verified current conditions.
            </p>
          )}
        </details>
      ))}
    </>
  );
}
