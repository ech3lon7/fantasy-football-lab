import { useEffect, useState } from "react";
import { lineupBasisLabel } from "../domain/trade-impact";
import { num, str, type AppState } from "../domain/contracts";
import { evidenceKey, roleScenarioKey } from "../domain/opportunity";
import {
  starterLineupsKey,
  tradeImpactVersion,
} from "../domain/starter-lineups";
import {
  ownsSavedDraft,
  readSavedTrades,
  savedTradesKey,
  summaryFromTrade,
  savedLineupBasis,
  originalLineupBasis,
  writeSavedTrades,
  type SavedTrade,
  type SavedTradeSummary,
} from "../domain/saved-trades";
import type { Model } from "../domain/valuation";
import { Panel } from "../ui/layout";
import { PlayerName } from "../ui/PlayerName";
import { fmt, signed, Signal } from "../ui/components";
import { sourceDataset } from "../domain/roster-scenarios";

// Saved summaries are recalculated by the existing trade worker, not on the interface thread.
export function SavedTrades({
  m,
  state,
  lineupsRaw,
  change,
  load,
}: {
  m: Model;
  state: AppState;
  lineupsRaw?: string;
  change: (raw: string) => void;
  load: (trade: SavedTrade) => void;
}) {
  const read = readSavedTrades(state.filters[savedTradesKey]);
  const [results, setResults] = useState<
    Record<string, { summary?: SavedTradeSummary; error?: string }>
  >({});
  const [message, setMessage] = useState("");
  // Hide old summaries immediately when the source/settings identity changes.
  const [evaluatedKey, setEvaluatedKey] = useState("");
  const evaluationKey = JSON.stringify([
    tradeImpactVersion,
    m.dataset.hash,
    m.analysisVersion,
    m.settings,
    m.evidenceRaw,
    m.roleScenarioWeight,
    lineupsRaw,
    read.trades.map((t) => [
      t.id,
      t.season,
      t.draft,
      t.scenario,
      savedLineupBasis(t),
    ]),
  ]);
  useEffect(() => {
    setResults({});
    setEvaluatedKey(evaluationKey);
    const eligible = read.trades.filter(
      (t) =>
        t.season === num(m.dataset.tables.ModelContext[0].Season) &&
        (!!t.scenario || ownsSavedDraft(sourceDataset(m), t.draft)),
    );
    if (!eligible.length) return;
    const worker = new Worker(
      new URL("../workers/model.worker.ts", import.meta.url),
      { type: "module" },
    );
    let alive = true;
    const requestId = crypto.randomUUID();
    worker.onmessage = (event) => {
      const { id, savedId, result, error } = event.data;
      if (!alive || id !== requestId) return;
      if (!savedId && error) {
        setResults(Object.fromEntries(eligible.map((t) => [t.id, { error }])));
        return;
      }
      if (!eligible.some((t) => t.id === savedId)) return;
      setResults((prior) => ({
        ...prior,
        [savedId]: error
          ? { error }
          : {
              summary: summaryFromTrade(
                result,
                savedLineupBasis(eligible.find((t) => t.id === savedId)!),
              ),
            },
      }));
    };
    worker.onerror = () => {
      if (!alive) return;
      setResults(
        Object.fromEntries(
          eligible.map((t) => [
            t.id,
            { error: "Saved trade calculation failed. Reload to retry." },
          ]),
        ),
      );
    };
    worker.postMessage({
      id: requestId,
      type: "saved-trades",
      dataset: sourceDataset(m),
      settings: m.settings,
      trades: eligible.map((t) => ({
        id: t.id,
        draft: t.draft,
        scenario: t.scenario,
      })),
      filters: {
        [evidenceKey]: m.evidenceRaw,
        [roleScenarioKey]: String(m.roleScenarioWeight),
        [starterLineupsKey]: state.filters[starterLineupsKey] ?? "",
      },
    });
    return () => {
      alive = false;
      worker.terminate();
    };
  }, [evaluationKey]);

  // Read the latest records for each edit so another card's name, notes or original summary is preserved.
  function edit(id: string, name?: string, notes?: string) {
    try {
      const next = read.trades.flatMap((trade) =>
        trade.id !== id
          ? [trade]
          : name === undefined
            ? []
            : [
                {
                  ...trade,
                  name: name.trim() || trade.name,
                  notes: notes ?? trade.notes,
                  updatedAt: new Date().toISOString(),
                },
              ],
      );
      change(writeSavedTrades(state, next));
      setMessage(
        name === undefined
          ? "Saved trade deleted."
          : "Saved trade details updated.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not update saved trade.",
      );
    }
  }
  return (
    <Panel
      title="Saved trades"
      note="Current results recalculate from the latest imported data and settings. Original summaries stay available for comparison."
    >
      <p>
        Saved with your account state for existing Supabase sync and local
        offline access. Trades invalidated by ownership changes are removed
        automatically. No workbook copies are stored.
      </p>
      {read.issue && (
        <p className="notice warning" role="alert">
          {read.issue}{" "}
          <button className="subtle" onClick={() => change("")}>
            Clear unreadable saved trades
          </button>
        </p>
      )}
      {message && <p aria-live="polite">{message}</p>}
      {!read.issue && !read.trades.length && (
        <p>
          No saved trades yet. Save one from the analyzer or a search result.
        </p>
      )}
      {read.trades.map((trade) => (
        <SavedTradeCard
          key={trade.id}
          trade={trade}
          m={m}
          current={
            evaluatedKey === evaluationKey ? results[trade.id] : undefined
          }
          edit={edit}
          load={() => load(trade)}
        />
      ))}
    </Panel>
  );
}

// Reuse existing controls, player inspection links and metric colors for each compact saved trade.
function SavedTradeCard({
  trade,
  m,
  current,
  edit,
  load,
}: {
  trade: SavedTrade;
  m: Model;
  current?: { summary?: SavedTradeSummary; error?: string };
  edit: (id: string, name?: string, notes?: string) => void;
  load: () => void;
}) {
  const [name, setName] = useState(trade.name),
    [notes, setNotes] = useState(trade.notes);
  useEffect(() => {
    setName(trade.name);
    setNotes(trade.notes);
  }, [trade.name, trade.notes]);
  const sameSeason =
    trade.season === num(m.dataset.tables.ModelContext[0].Season);
  const owned =
    !!trade.scenario || ownsSavedDraft(sourceDataset(m), trade.draft);
  const team = (id: string) =>
    str(
      m.dataset.tables.ModelTeams.find((t) => str(t.TeamID) === id)?.TeamName,
    ) || id;
  const names = (ids: string[]) =>
    ids.map((id, i) => (
      <span key={id}>
        {i > 0 && ", "}
        {m.byId.get(id) ? <PlayerName p={m.byId.get(id)!} /> : id}
      </span>
    ));
  const points = (value: number | null) =>
    value === null ? "Unavailable" : signed(value);
  return (
    <details>
      <summary>
        {trade.scenario && (
          <span className="signal conditional">
            Hypothetical · {trade.scenario.name}
          </span>
        )}
        {trade.name} ·{" "}
        {sameSeason
          ? (current?.summary?.grade ??
            (current?.error ? "Unavailable" : "Recalculating…"))
          : `Saved season ${trade.season}`}
      </summary>
      <p>
        {team(trade.draft.teamA)} offers {names(trade.draft.give)} to{" "}
        {team(trade.draft.teamB)} for {names(trade.draft.get)}.
      </p>
      <div className="toolbar">
        <label className="control">
          <span>Saved trade name</span>
          <input
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="control">
          <span>Saved trade notes</span>
          <textarea
            aria-label="Saved trade notes"
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
      <div className="toolbar">
        <button className="subtle" onClick={() => edit(trade.id, name, notes)}>
          Save details
        </button>
        {/* Saved offers use the same explicit Load button as search results. */}
        <button
          className="button"
          disabled={!sameSeason || !owned}
          onClick={load}
        >
          Load saved trade
        </button>
        <button className="subtle" onClick={() => edit(trade.id)}>
          Delete saved trade
        </button>
      </div>
      {!sameSeason && (
        <p className="notice warning">
          This trade belongs to another season. Its original summary is
          retained; current evaluation and loading are unavailable.
        </p>
      )}
      {sameSeason && current?.error && (
        <p className="notice warning">{current.error}</p>
      )}
      {sameSeason && !current && (
        <p aria-live="polite">Recalculating saved trade…</p>
      )}
      {/* Original numbers are immutable; incompatible baselines must never look like a performance comparison. */}
      {(!originalLineupBasis(trade.original) ||
        originalLineupBasis(trade.original) !== savedLineupBasis(trade)) && (
        <p className="notice warning">
          Original and current scoring bases differ or are unspecified; their
          gains are not directly comparable.
        </p>
      )}
      <div className="table-wrap">
        <table aria-label="Saved trade original and current results">
          <thead>
            <tr>
              <th>Result</th>
              <th className="model">Your gain/week</th>
              <th className="model">Their gain/week</th>
              <th>Grade</th>
              <th>Surplus test</th>
              <th>Points test</th>
              <th>Legality</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label: "Original", summary: trade.original },
              ...(sameSeason && current?.summary
                ? [{ label: "Current", summary: current.summary }]
                : []),
            ].map(({ label, summary }) => (
              <tr key={label}>
                <td>
                  {label}
                  <small>
                    {originalLineupBasis(summary)
                      ? lineupBasisLabel(originalLineupBasis(summary))
                      : "Legacy / unspecified basis"}
                  </small>
                  {/* Preserve historical summaries while making the change in scoring basis visible. */}
                  {label === "Original" &&
                    summary.impactVersion !== tradeImpactVersion && (
                      <small>Previous scoring method</small>
                    )}
                </td>
                <td className="model">
                  <strong>{points(summary.own)}</strong>
                  {summary.ownBefore !== undefined && (
                    <small>
                      Before {fmt(summary.ownBefore)} → After{" "}
                      {fmt(summary.ownAfter)}
                    </small>
                  )}
                </td>
                <td className="model">
                  <strong>{points(summary.other)}</strong>
                  {summary.otherBefore !== undefined && (
                    <small>
                      Before {fmt(summary.otherBefore)} → After{" "}
                      {fmt(summary.otherAfter)}
                    </small>
                  )}
                </td>
                <td>
                  {summary.grade}
                  {summary.conditional && <Signal text="CONDITIONAL" />}
                </td>
                <td>{summary.surplus}</td>
                <td>{summary.points}</td>
                <td>
                  {summary.legal === null
                    ? "Unavailable"
                    : summary.legal
                      ? "Legal"
                      : "Roster conflict"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <small>
          Current weekly values use {lineupBasisLabel(savedLineupBasis(trade))}{" "}
          for both teams, with consistent availability rules before and after.
          These are model estimates, not player PPG or ESPN weekly projections.
          Original source: {trade.original.sourceUTC ?? "Unavailable"}. Saved:{" "}
          {new Date(trade.createdAt).toLocaleString()}. Current source:{" "}
          {m.dataset.sourceUTC ?? "Unavailable"}. Loading restores the saved
          trade and its search settings; it does not submit a trade.
        </small>
      </p>
    </details>
  );
}
