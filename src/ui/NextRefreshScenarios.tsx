import { useState } from "react";
import {
  nextRefreshContext,
  nextRefreshDefaults,
  nextRefreshEppg,
} from "../domain/next-refresh";
import type { Model, Player } from "../domain/valuation";
import { fmt, signed } from "./components";

// Local inputs reset for another snapshot/player/settings; no scenario is saved to valuation or trade state.
export function NextRefreshScenarios({
  m,
  p,
  defaultOpen = false,
}: {
  m: Model;
  p: Player;
  defaultOpen?: boolean;
}) {
  return (
    <ScenarioInputs
      key={JSON.stringify([
        m.dataset.hash,
        p.id,
        m.settings,
        p.blendedExpected,
      ])}
      m={m}
      p={p}
      defaultOpen={defaultOpen}
    />
  );
}

// Autofill once per player/snapshot, leaving each assumption independently editable and restoring all three only on Reset.
function ScenarioInputs({
  m,
  p,
  defaultOpen,
}: {
  m: Model;
  p: Player;
  defaultOpen: boolean;
}) {
  const automatic = nextRefreshDefaults(m, p);
  const defaults = [automatic.lower, automatic.base, automatic.higher].map(
    (value) => (value === null ? "" : String(Number(value.toFixed(2)))),
  );
  const [values, setValues] = useState(defaults);
  const context = nextRefreshContext(m, p);
  return (
    <details className="next-refresh-scenarios" open={defaultOpen || undefined}>
      <summary>Next-refresh EPPG scenarios</summary>
      <p className="gd-scenario-blend">
        Current scoring blend:{" "}
        <strong className="model">{fmt(p.blendedExpected)} EPPG</strong> · ESPN
        season PPG held fixed:{" "}
        <span className={p.projected === null ? "muted" : "projection"}>
          {fmt(p.projected)}
        </span>
      </p>
      {context.issue ? (
        <p className="muted">{context.issue}</p>
      ) : (
        <>
          {/* Numeric results are recalculated from domain logic; zero and negative assumptions remain valid. */}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Assumption</th>
                  <th>Next-game points</th>
                  <th>Next EPPG</th>
                  <th>EPPG change</th>
                </tr>
              </thead>
              <tbody>
                {["Lower", "Base", "Higher"].map((label, i) => {
                  const result = values[i].trim()
                    ? nextRefreshEppg(m, p, Number(values[i]), context)
                    : null;
                  return (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      <td>
                        <input
                          type="number"
                          step="any"
                          aria-label={`${label} next-game points`}
                          value={values[i]}
                          onChange={(e) =>
                            setValues(
                              values.map((v, j) =>
                                j === i ? e.target.value : v,
                              ),
                            )
                          }
                        />
                      </td>
                      <td
                        className={result?.expected == null ? "muted" : "model"}
                      >
                        {fmt(result?.expected ?? null)}
                      </td>
                      <td
                        className={result?.change == null ? "muted" : "model"}
                      >
                        {result?.change == null
                          ? "n.a."
                          : signed(result.change)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="gd-scenario-foot">
            <span className="muted">
              What his EPPG becomes after the next import if he scores at the
              floor, on expectation or at the ceiling.
            </span>
            <button className="subtle" onClick={() => setValues(defaults)}>
              Reset score assumptions
            </button>
          </div>
          {/* The method stays one click away so the panel leads with the numbers the owner changes. */}
          <details className="gd-how">
            <summary>How this works</summary>
            <p>
              Assume a score in the next game played to see how EPPG would
              update. These are your assumptions, not predicted scores or
              probability ranges. Byes and games not played do not count. A
              future ESPN update could change the result.
            </p>
            {/* Show the exact sources and spread used for initial scores without presenting historical variability as calibrated bounds. */}
            <p>
              Automatic base:{" "}
              <span className={automatic.useWeekly ? "projection" : "model"}>
                {automatic.source}
              </span>
              . Lower = base − scenario spread; higher = base + scenario spread.
              Scoring SD:{" "}
              <span className={automatic.personalSD === null ? "muted" : "fact"}>
                {fmt(automatic.personalSD)}
              </span>{" "}
              points, using variation around the actual season average across
              all verified played games.
              {automatic.personalSD === null &&
                " At least two played games are needed to measure the player's own SD."}{" "}
            </p>
            {/* Separate the blended scenario assumption from factual SD and explain its historical weight without claiming prediction accuracy. */}
            <p>
              Scenario spread:{" "}
              <span className={automatic.spread === null ? "muted" : "model"}>
                {fmt(automatic.spread)}
              </span>{" "}
              points.
              {automatic.reference ? (
                <>
                  {" "}
                  Blends recorded variance with a historical {p.pos} SD of{" "}
                  <span className="fact">{fmt(automatic.reference.sd)}</span>{" "}
                  (2023–2025; {automatic.reference.games.toLocaleString()}{" "}
                  games). Historical variance weight:{" "}
                  {Math.round((1 - automatic.personalWeight) * 100)}%. More
                  played games give your player's variance more weight. The
                  four-observation historical weight is provisional.
                </>
              ) : (
                <>
                  {" "}
                  Historical positional spread is unavailable for this scoring
                  setup; only the player's recorded SD is used.
                </>
              )}{" "}
              {automatic.spread === null &&
                " Enter lower/higher scores manually until usable variability is available. "}
              Edit scores independently; Reset restores these automatic
              assumptions.
            </p>
            {m.roleScenarioWeight > 0 && (
              <p className="muted">
                This tool uses the original scoring blend, excluding your
                optional workload-only blend.
              </p>
            )}
            <p className="muted">
              Adds one game to the season average and latest-three average, then
              updates the actual-results weight. With no season projection, at
              least four played games are required. Normal valuations and trades
              stay unchanged.
            </p>
          </details>
        </>
      )}
    </details>
  );
}
