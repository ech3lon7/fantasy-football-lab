import { useEffect, useRef, useState } from "react";
import type { Draft } from "../domain/contracts";
import type { Model } from "../domain/valuation";
import { sourceDataset } from "../domain/roster-scenarios";
import { evidenceKey, roleScenarioKey } from "../domain/opportunity";
import { starterLineupsKey } from "../domain/starter-lineups";
import {
  stressRecipeSchema,
  type StressRecipe,
  type StressResult,
} from "../domain/trade-stress";
import { fmt, signed } from "../ui/components";
import { PlayerName } from "../ui/PlayerName";
import { FilterHelp } from "../ui/FilterHelp";

// The collapsed manual tool owns its drafts/results; running it never edits the normal model or finder settings.
export function TradeStressTest({
  m,
  draft,
  plans,
  initial,
  change,
}: {
  m: Model;
  draft: Draft;
  plans?: string;
  initial?: StressRecipe;
  change: (recipe?: StressRecipe) => void;
}) {
  const selected = [...draft.give, ...draft.get]
    .map((id) => m.byId.get(id)!)
    .filter(Boolean);
  const [edits, setEdits] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initial?.adjustments.map((a) => [a.player, String(a.ppg)]) ?? [],
    ),
  );
  const [result, setResult] = useState<StressResult>();
  const [applied, setApplied] = useState<StressRecipe>();
  const [resultContext, setResultContext] = useState("");
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const worker = useRef<Worker | null>(null),
    request = useRef("");
  const context = JSON.stringify([
    m.dataset.hash,
    m.analysisVersion,
    m.settings,
    m.evidenceRaw,
    m.roleScenarioWeight,
    m.simulation?.scenario,
    plans,
    draft,
  ]);
  // Changing data, simulation or a field invalidates results and cancels old replies before another run.
  function invalidate() {
    request.current = "";
    worker.current?.terminate();
    worker.current = null;
    setPending(false);
    setResult(undefined);
    setApplied(undefined);
    setError("");
  }
  useEffect(() => {
    invalidate();
    return () => {
      worker.current?.terminate();
    };
  }, [context]);
  function edit(next: Record<string, string>) {
    invalidate();
    setEdits(next);
    change(undefined);
  }
  function run() {
    invalidate();
    const parsed = stressRecipeSchema.safeParse({
      version: 1,
      adjustments: Object.entries(edits).map(([player, value]) => ({
        player,
        ppg: value.trim() ? Number(value) : NaN,
      })),
    });
    if (!parsed.success) {
      setError(
        "Select at least one player and enter a valid assumed PPG for each.",
      );
      return;
    }
    const recipe = parsed.data,
      id = crypto.randomUUID();
    const job = new Worker(
      new URL("../workers/model.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = job;
    request.current = id;
    setPending(true);
    job.onmessage = (event) => {
      if (event.data.id !== request.current) return;
      setPending(false);
      job.terminate();
      worker.current = null;
      if (event.data.error) {
        setError(event.data.error);
        return;
      }
      const value = event.data.result as StressResult;
      setResult(value);
      setResultContext(context);
      if (!value.errors.length) {
        setApplied(recipe);
        change(recipe);
      }
    };
    job.onerror = () => {
      if (request.current !== id) return;
      setPending(false);
      setError("Stress-test calculation failed. Run it again to retry.");
      job.terminate();
      worker.current = null;
    };
    job.postMessage({
      id,
      type: "trade-stress",
      dataset: sourceDataset(m),
      settings: m.settings,
      draft,
      scenario: m.simulation?.scenario,
      stress: recipe,
      filters: {
        [evidenceKey]: m.evidenceRaw,
        [roleScenarioKey]: String(m.roleScenarioWeight),
        [starterLineupsKey]: plans ?? "",
      },
    });
  }
  const names = (ids: string[]) =>
    ids.length
      ? ids.map((id) => m.byId.get(id)?.name ?? "Unavailable player").join(", ")
      : "None";
  return (
    <details className="trade-stress-test">
      <summary>Stress test · optional scoring assumptions</summary>
      <p>
        Compare current EPPG with a what-if scenario using both teams’ best
        available lineups. Assumptions are not proven forecasts; normal EPPG,
        value tests and search stay unchanged.
      </p>
      <small className="muted">
        Weeks {m.current}–{m.final} ·{" "}
        {m.ignoreTemporaryAbsences
          ? "Byes and temporary absences ignored; IR excluded."
          : m.ignoreByeWeeks
            ? "Byes ignored; injury/IR rules retained."
            : "Scheduled byes and injury/IR rules retained."}{" "}
        Required drops included; waiver pickups excluded.
      </small>
      {/* Each name is selectable, while optional shortcuts expose their distinct scoring sources without inventing missing values. */}
      <div className="trade-stress-players">
        {selected.map((p) => (
          <div className="trade-stress-player" key={p.id}>
            <label className="check">
              <input
                type="checkbox"
                aria-label={`Adjust ${p.name}`}
                checked={p.id in edits}
                onChange={(e) => {
                  const next = { ...edits };
                  if (e.target.checked)
                    next[p.id] = p.expected === null ? "" : String(p.expected);
                  else delete next[p.id];
                  edit(next);
                }}
              />
              {p.name}{" "}
              <small className="model">Current {fmt(p.expected)} PPG</small>
            </label>
            {p.id in edits && (
              <div className="toolbar">
                <FilterHelp
                  label={`Assumed PPG for ${p.name}`}
                  help="An explicit average-points assumption, applied to this player before and after the trade; negative values remain valid."
                >
                  <label className="control">
                    <span>Assumed PPG</span>
                    <input
                      aria-label={`Assumed PPG for ${p.name}`}
                      type="number"
                      step="any"
                      value={edits[p.id]}
                      onChange={(e) =>
                        edit({ ...edits, [p.id]: e.target.value })
                      }
                    />
                  </label>
                </FilterHelp>
                <label className="control">
                  <span>Use scoring reference</span>
                  <select
                    aria-label={`Scoring reference for ${p.name}`}
                    value=""
                    onChange={(e) => edit({ ...edits, [p.id]: e.target.value })}
                  >
                    <option value="" disabled>
                      Choose a reference
                    </option>
                    {(
                      [
                        ["Current EPPG", p.expected],
                        ["Recent actual PPG", p.recent],
                        ["Season actual PPG", p.actual],
                        ["Experimental role forecast", p.roleForecast],
                      ] as const
                    ).map(([label, value]) => (
                      <option
                        key={label}
                        value={value ?? ""}
                        disabled={value === null}
                      >
                        {label}: {fmt(value)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="toolbar">
        <button className="button" onClick={run} disabled={pending}>
          {pending ? "Running stress test…" : "Run stress test"}
        </button>
        <button className="button" onClick={() => edit({})}>
          Clear assumptions
        </button>
      </div>
      {initial && !result && (
        <small>
          Saved assumptions restored; run to calculate against current data.
        </small>
      )}
      {error || result?.errors.length ? (
        <p className="notice danger" role="alert">
          {error || result!.errors.join(" ")}
        </p>
      ) : null}
      {pending && (
        <p role="status">Rebuilding both teams’ lineups and required drops…</p>
      )}
      {/* Only completed, matching runs are displayed or exported; pink numbers remain model outputs in both cases. */}
      {resultContext === context &&
        result?.baseline &&
        result.scenario &&
        applied && (
          <div aria-live="polite">
            <p>
              {applied.adjustments
                .map((a) => `${m.byId.get(a.player)!.name}: ${fmt(a.ppg)} PPG`)
                .join("; ")}
            </p>
            <div className="table-wrap">
              <table aria-label="Stress-test scoring comparison">
                <thead>
                  <tr>
                    <th>Scenario</th>
                    <th>Your before → after</th>
                    <th>Your gain/week</th>
                    <th>Their before → after</th>
                    <th>Their gain/week</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Current model", result.baseline],
                      ["Your assumptions", result.scenario],
                    ] as const
                  ).map(([label, row]) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      <td className="model">
                        {fmt(row.own.before)} → {fmt(row.own.after)}
                      </td>
                      <td className="model">{signed(row.own.gain)}</td>
                      <td className="model">
                        {fmt(row.other.before)} → {fmt(row.other.after)}
                      </td>
                      <td className="model">{signed(row.other.gain)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p
              className={
                result.scenario.own.gain! < 0 || !result.scenario.legal
                  ? "notice warning"
                  : ""
              }
            >
              {result.conclusion}
            </p>
            {result.breakEven && (
              <p>
                {result.breakEven.ppg === null ? (
                  result.breakEven.note
                ) : (
                  <>
                    <PlayerName p={m.byId.get(result.breakEven.player)!} />{" "}
                    needs {result.breakEven.direction}{" "}
                    <strong className="model">
                      {fmt(result.breakEven.ppg)} PPG
                    </strong>{" "}
                    for your team to break even. {result.breakEven.note}
                  </>
                )}
              </p>
            )}
            <details>
              <summary>Required drops and conditions</summary>
              <p>
                Current model — yours: {names(result.baseline.dropsA)}; theirs:{" "}
                {names(result.baseline.dropsB)}.
              </p>
              <p>
                Scenario — yours: {names(result.scenario.dropsA)}; theirs:{" "}
                {names(result.scenario.dropsB)}.
              </p>
              {[
                ...new Set([
                  ...result.baseline.warnings,
                  ...result.scenario.warnings,
                ]),
              ].map((w) => (
                <p key={w}>{w}</p>
              ))}
            </details>
            <small>
              Save current trade to keep these assumptions; loading restores the
              inputs and requires a new run.
            </small>
            <p>
              <button
                className="button"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob(
                      [
                        JSON.stringify(
                          {
                            version: 1,
                            type: "trade-stress",
                            datasetHash: m.dataset.hash,
                            sourceUTC: m.dataset.sourceUTC,
                            appVersion: import.meta.env.VITE_APP_VERSION,
                            analysisVersion: m.analysisVersion,
                            settings: m.settings,
                            lineupBasis: "best-available",
                            scenario: m.simulation?.scenario,
                            draft,
                            assumptions: applied,
                            references: selected.map((p) => ({
                              player: p.id,
                              name: p.name,
                              expected: p.expected,
                              recent: p.recent,
                              actual: p.actual,
                              role: p.roleForecast,
                            })),
                            availability: {
                              ignoreByeWeeks: !!m.ignoreByeWeeks,
                              ignoreTemporaryAbsences:
                                !!m.ignoreTemporaryAbsences,
                            },
                            result,
                          },
                          null,
                          2,
                        ),
                      ],
                      { type: "application/json" },
                    ),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = "fantasy-trade-stress-debug.json";
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 0);
                }}
              >
                Download stress-test debug
              </button>
            </p>
          </div>
        )}
    </details>
  );
}
