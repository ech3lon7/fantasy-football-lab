import type { Model } from "../domain/valuation";
import type { SurfaceEvidence } from "../domain/surface-appeal";
import { lineupBasisLabel } from "../domain/trade-impact";
import { PlayerName } from "../ui/PlayerName";
import { fmt, signed } from "../ui/components";

// Show the captured numerical evidence with the exact player/slot comparisons; no summed bench package is presented as starting-lineup gain.
export function SurfaceAppealView({
  value,
  m,
}: {
  value: SurfaceEvidence;
  m: Model;
}) {
  const names = (id: string | null) =>
    id && m.byId.has(id) ? (
      <PlayerName p={m.byId.get(id)!} />
    ) : (
      (id ?? "Unfilled")
    );
  const metrics = [
    {
      key: "average" as const,
      label: "Season-average lineup (PPG)",
      kind: "fact",
    },
    {
      key: "projection" as const,
      label: `ESPN Week ${value.week} lineup projection`,
      kind: "projection",
    },
  ];
  return (
    <div aria-label="Surface appeal evidence">
      <p>
        <strong>Their surface appeal</strong> · {lineupBasisLabel(value.basis)}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Their before</th>
              <th>Their after</th>
              <th>Apparent gain</th>
              <th>Filter</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map(({ key, label, kind }) => {
              const metric = value[key];
              return (
                <tr key={key}>
                  <td>{label}</td>
                  <td className={kind}>
                    {metric.before === null
                      ? "Unavailable"
                      : fmt(metric.before)}
                  </td>
                  <td className={kind}>
                    {metric.after === null ? "Unavailable" : fmt(metric.after)}
                  </td>
                  <td className={kind}>
                    {metric.gain === null ? "Unavailable" : signed(metric.gain)}
                  </td>
                  <td>
                    {value.filter.metric === "both" ||
                    value.filter.metric === key
                      ? `Positive and ≥ ${fmt(value.filter.minimum)}`
                      : "Reference only"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Season-average rates are bye-neutral; temporary absences are ignored and
        actual IR excluded. The ESPN row uses real availability for imported
        Week {value.week}, including in hypotheticals. Source refreshed:{" "}
        {value.sourceUTC
          ? new Date(value.sourceUTC).toLocaleString()
          : "Unavailable"}
        . Figures are snapshot comparisons, not live quotes or acceptance odds.
      </p>
      <details>
        <summary>Surface lineup player comparisons</summary>
        {metrics.map(({ key, label, kind }) => {
          const metric = value[key];
          return (
            <div key={key}>
              <h4>{label}</h4>
              {metric.issues.map((issue) => (
                <p className="notice warning" key={issue}>
                  {issue}
                </p>
              ))}
              {metric.missing.length > 0 && (
                <p>
                  Missing eligible data:{" "}
                  {metric.missing.map((id, i) => (
                    <span key={id}>
                      {i > 0 && ", "}
                      {names(id)}
                    </span>
                  ))}
                  .
                </p>
              )}
              {metric.slots.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Role</th>
                        <th>Before player</th>
                        <th>Source points</th>
                        <th>After player</th>
                        <th>Source points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metric.slots.map((slot, i) => {
                        const before = metric.beforeIds[i],
                          after = metric.afterIds[i];
                        const points = (id: string | null) => {
                          const p = id ? m.byId.get(id) : undefined;
                          const score =
                            key === "average" ? p?.actual : p?.weekly;
                          return !id
                            ? "0.00 (unfilled)"
                            : score == null
                              ? "Unavailable"
                              : fmt(score);
                        };
                        return (
                          <tr key={i}>
                            <td>{slot}</td>
                            <td>{names(before)}</td>
                            <td className={kind}>{points(before)}</td>
                            <td>{names(after)}</td>
                            <td className={kind}>{points(after)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </details>
    </div>
  );
}
