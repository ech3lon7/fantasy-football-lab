import type { Model } from "../domain/valuation";
import type { SurfaceEvidence, SurfaceFilter } from "../domain/surface-appeal";
import { lineupBasisLabel } from "../domain/trade-impact";
import { FilterHelp } from "../ui/FilterHelp";
import { PlayerName } from "../ui/PlayerName";
import { fmt, signed } from "../ui/components";

// Source-based discovery stays opt-in, with the existing unobtrusive hover-help and editable-control styles.
export function SurfaceAppealControls({
  value,
  change,
  week,
}: {
  value?: SurfaceFilter;
  change: (value?: SurfaceFilter) => void;
  week: number;
}) {
  return (
    <fieldset className="trade-search-group">
      <legend>Surface stats</legend>
      <FilterHelp
        label="Find trades with surface appeal"
        help="Require a positive modeled lineup gain for you and a positive source-based lineup gain for the recipient. Season average and ESPN weekly projections stay separate. Existing package, index, team and other filters still apply; choose the Surface appeal search goal for a broad starting preset. This estimates scoring appeal, not market price or acceptance probability."
      >
        <label className="check">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) =>
              change(
                e.target.checked
                  ? { metric: "both", minimum: 0, requireValueTests: false }
                  : undefined,
              )
            }
          />
          Find trades with surface appeal
        </label>
      </FilterHelp>
      {value && (
        <div className="trade-search-controls">
          <FilterHelp
            label="Surface metric"
            help="Both requires each comparison to improve independently; there is no arbitrary weighted score. Each comparison uses the selected lineup basis and the evaluator's legal roster after required drops. Season-average scoring rates ignore known byes/temporary absences; actual IR stays excluded. ESPN projections use the imported week's real availability, including in a hypothetical roster."
          >
            <label className="control">
              <span>Surface metric</span>
              <select
                value={value.metric}
                onChange={(e) =>
                  change({
                    ...value,
                    metric: e.target.value as SurfaceFilter["metric"],
                  })
                }
              >
                <option value="both">Both — each must improve</option>
                <option value="average">Actual season average</option>
                <option value="projection">
                  ESPN Week {week} projection (snapshot)
                </option>
              </select>
            </label>
          </FilterHelp>
          <FilterHelp
            label="Minimum apparent lineup gain"
            help="Minimum recipient lineup improvement for each selected source, in points per lineup. Zero still requires a strictly positive gain; a positive threshold is inclusive. Missing eligible data is unavailable, not zero."
          >
            <label className="control">
              <span>Minimum apparent lineup gain</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={Number.isFinite(value.minimum) ? value.minimum : ""}
                onChange={(e) =>
                  change({
                    ...value,
                    minimum: e.target.value.trim()
                      ? Number(e.target.value)
                      : NaN,
                  })
                }
              />
            </label>
          </FilterHelp>
          <FilterHelp
            label="Require both model value tests"
            help="When enabled, both the surplus-value and fantasy-points asking-price tests must pass. When disabled, failures stay visible but do not exclude the trade. This affects surface discovery only; the strict two-trade chain planner remains unchanged."
          >
            <label className="check">
              <input
                type="checkbox"
                checked={value.requireValueTests}
                onChange={(e) =>
                  change({ ...value, requireValueTests: e.target.checked })
                }
              />
              Require both model value tests
            </label>
          </FilterHelp>
        </div>
      )}
    </fieldset>
  );
}

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
