import type { Player } from "../domain/valuation";

// Render shared checks verbatim; UI code never repeats the breakout thresholds or calculations.
export function GemEvidence({ p }: { p: Player }) {
  const assessment = p.breakout;
  if (!assessment) return null;
  return (
    <details>
      <summary className="model">
        Why{" "}
        {assessment.classification === "Gem"
          ? "Gem"
          : assessment.classification === "Watch"
            ? "Watch"
            : assessment.classification}
        ?
      </summary>
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
                  className={c.status === "PASS" ? "model" : "notice warning"}
                >
                  {c.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Display the unchanged decline calculation separately from Gem's scoring/workload checks. */}
      {assessment.reducedWorkload?.status === "PASS" && (
        <p className="notice warning">
          <b className="model">Reduced workload.</b>{" "}
          {assessment.reducedWorkload.actual}. Requirements:{" "}
          {assessment.reducedWorkload.required}. Injury-shortened games remain
          included; a reduction does not establish a permanent role change or
          poor overall workload.
        </p>
      )}
      {p.pos === "RB" && (
        <p className="fact">
          Recent carries / game:{" "}
          {p.opportunity.recentCarries?.toFixed(2) ?? "unavailable"}; targets /
          game: {p.opportunity.recentTargets?.toFixed(2) ?? "unavailable"}.
          Their sum measures work, not equal fantasy scoring value.
        </p>
      )}
      {assessment.warnings.map((prompt) => (
        <p className="notice warning" key={prompt}>
          {prompt}
        </p>
      ))}
      {/* Explain the distinct windows without duplicating the domain's positional thresholds. */}
      <p>
        Gem requires both actual scoring and workload in the latest three played
        games and the previous overlapping three-game window, starting after
        four played games. Stable strong workload can qualify; growth and a
        prior Watch label are not required. Watch and Reduced workload retain
        their separate opportunity rules.
      </p>
      <p>
        Scoring Trend PPG still compares the last three played games with ALL
        earlier games. Watch workload growth and Reduced workload compare only
        the immediately preceding two or three. Scoring/projection gaps and
        touchdown cautions remain supporting signals. Gems are identified
        automatically; no manual role review, approval or news entry is
        required. The data does not establish whether a player is undervalued or
        the role is permanent. Rules remain provisional, not calibrated
        individual success probabilities; TE evidence is weaker.
      </p>
    </details>
  );
}
