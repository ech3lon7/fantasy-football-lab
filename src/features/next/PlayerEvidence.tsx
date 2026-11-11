import { num } from "../../domain/contracts";
import { marketStatus, playedHistory } from "../../domain/opportunity";
import type { Model, Player } from "../../domain/valuation";
import { extendedColumns, fmt, pct } from "../../ui/components";

// The detailed evidence the current player popover kept in disclosures: every evaluation stat, workload and advanced
// evidence, completed-game scores and every imported field. It reads existing model fields and never recalculates.
export function PlayerEvidence({ p, m }: { p: Player; m: Model }) {
  const scores = playedHistory(m.dataset).get(p.id) ?? [];
  const advanced: [string, number | null, string, boolean?][] = [
    ["Recent opportunities / game", p.opportunity.recentRate, "fact"],
    ["Earlier opportunities / game", p.opportunity.priorRate, "fact"],
    ["Recent snap share", p.opportunity.snapShare, "fact", true],
    ["Recent route participation", p.opportunity.routes, "fact", true],
    ["Carries inside 5 / game", p.opportunity.rushInside5, "fact"],
    ["Red-zone targets / game", p.opportunity.redZoneTargets, "fact"],
    ["Original blended forecast PPG", p.blendedExpected, "model"],
    ["Scoring variability (sample SD)", p.scoringSD, "fact"],
  ];
  return (
    <div className="gd-evidence">
      <details>
        <summary>All evaluation stats</summary>
        <p>
          Workload-only scoring reference is an experimental points estimate
          from recent usage, not a prediction of the next updated EPPG.
        </p>
        <dl className="definition-grid">
          {extendedColumns
            .filter((c) => !["name", "gem", "trend"].includes(c.key))
            .map((c) => (
              <div
                key={c.key}
                className={c.value(p) == null ? "muted" : c.kind}
              >
                <dt>{c.label}</dt>
                <dd>
                  {c.render
                    ? c.render(p)
                    : typeof c.value(p) === "number"
                      ? fmt(c.value(p))
                      : String(c.value(p) ?? "n.a.")}
                </dd>
              </div>
            ))}
        </dl>
      </details>
      <details>
        <summary>Workload and advanced evidence</summary>
        <p>{p.opportunity.source}</p>
        <dl className="definition-grid">
          {advanced.map(([label, value, kind, percent]) => (
            <div key={label} className={value === null ? "muted" : kind}>
              <dt>{label}</dt>
              <dd>{percent ? pct(value) : fmt(value)}</dd>
            </div>
          ))}
        </dl>
        <p>
          {p.opportunity.recentGames} recent games; {p.opportunity.priorGames}{" "}
          earlier games.
        </p>
        <p>{p.opportunity.supplementalStatus}</p>
        <p>{marketStatus(p.opportunity.market)}</p>
        {p.opportunity.market && (
          <p>
            {p.opportunity.market.Source} · {p.opportunity.market.AsOfUTC}
          </p>
        )}
        {p.uncertain && (
          <p>
            {p.opportunity.returnWeek === null
              ? "Return date unknown; availability remains conditional."
              : `User-selected return scenario: Week ${p.opportunity.returnWeek}.`}
          </p>
        )}
      </details>
      <details>
        <summary>Completed-game scores</summary>
        {scores.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Points</th>
                  <th>Carries</th>
                  <th>Targets</th>
                  <th>Catches</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((r) => (
                  <tr key={num(r.Week)} className="fact">
                    <td>{r.Week}</td>
                    <td>{fmt(r.Points)}</td>
                    {["RushAttempts", "Targets", "Receptions"].map((key) => (
                      <td
                        key={key}
                        className={r[key] == null ? "muted" : "fact"}
                      >
                        {fmt(r[key], 0)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No verified completed-game history available.</p>
        )}
      </details>
      <details>
        <summary>All imported player fields</summary>
        <dl className="definition-grid">
          {Object.entries(p.raw).map(([label, value]) => (
            <div
              key={label}
              className={
                value === null
                  ? "muted"
                  : /Project/.test(label)
                    ? "projection"
                    : "fact"
              }
            >
              <dt>{label}</dt>
              <dd>{value === null ? "n.a." : String(value)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
