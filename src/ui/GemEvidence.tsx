import type { Model, Player } from "../domain/valuation";
import { activeTagExplanations } from "../domain/tag-evidence";

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
          <div className="table-wrap gem-checks">
            <table aria-label="Breakout evidence checks">
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Required</th>
                  <th>Actual evidence</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {assessment.checks.map((c) => (
                  <tr key={c.check}>
                    <td>{c.check}</td>
                    <td className="input-text">{c.required}</td>
                    <td className={c.status === "UNKNOWN" ? "muted" : "fact"}>
                      {c.actual}
                    </td>
                    <td
                      className={
                        c.status === "PASS" ? "model" : "notice warning"
                      }
                    >
                      {c.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          <div className="table-wrap gem-checks">
            <table aria-label={`${explanation.tag} evidence checks`}>
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Required</th>
                  <th>Actual evidence</th>
                </tr>
              </thead>
              <tbody>
                {explanation.rows.map((row) => (
                  <tr key={row.check}>
                    <td className={row.kind}>{row.check}</td>
                    <td className={row.requiredKind}>{row.required}</td>
                    <td
                      className={
                        row.actual === "Unavailable" ? "muted" : row.kind
                      }
                    >
                      {row.actual}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
