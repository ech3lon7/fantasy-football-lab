import type { Model } from "../../../domain/valuation";
import type { SearchRow } from "../../../domain/trade-search";
import { defaultTradeFilters } from "../../../domain/trade-filters";
import { PlayerName } from "../../../ui/PlayerName";
import { tradeDebugReport } from "../../../domain/trade-tools";
import { ResultRow } from "./ResultRow";
import type { TradeSearchState } from "./useTradeSearch";

// Keep saved and analyzed trades tied to their captured, fully evaluated packages.
export function BroadResults({
  m,
  s,
  canSave,
  onAnalyze,
}: {
  m: Model;
  s: TradeSearchState;
  canSave: boolean;
  onAnalyze: () => void;
}) {
  const job = s.job,
    model = s.resultModel.current ?? m;
  const names = (ids: string[]) =>
    ids.map((id, i) => {
      const p = model.byId.get(id);
      return (
        <span key={id}>
          {i > 0 ? ", " : ""}
          {p ? <PlayerName p={p} /> : id}
        </span>
      );
    });
  // Expand internal filter keys into short explanations for trades shown by Show hidden.
  const reason: Record<string, string> = {
    yourGain: "Your EPPG gain",
    theirGain: "Their EPPG gain",
    ownWeek: "Your this-week MPPG gain",
    otherWeek: "Their this-week MPPG gain",
    receiveStarts: "Incoming players do not all start every week",
    giveStarts: "Outgoing players do not all start every week",
    gradeGoals: "Positional grade goals",
    mustGet: "Required incoming player",
    mustGive: "Required outgoing player",
    exclude: "Excluded player",
    getPositions: "Incoming position",
    givePositions: "Outgoing position",
    labels: "Incoming label",
    teams: "Opponent selection",
    teamGrade: "Opponent grade",
    giveSize: "Outgoing size",
    getSize: "Incoming size",
  };
  const show = (row: SearchRow, variant = false): React.ReactNode => (
    <div key={row.key} className="gd-res-group">
      <ResultRow
        model={model}
        row={row}
        s={s}
        canSave={canSave}
        onAnalyze={onAnalyze}
        variant={variant}
      />
      {!variant && !!row.variants?.length && (
        <details className="gd-variants">
          <summary>+{row.variants.length} variants</summary>
          {row.variants.map((v) => show(v, true))}
        </details>
      )}
      {!variant && !!row.related?.length && (
        <details className="gd-variants">
          <summary>More trades for this swap ({row.related.length})</summary>
          {row.related.map((v) => show(v))}
        </details>
      )}
    </div>
  );
  // The export is explicit and local: analysis data and the filters in force, never account or session credentials.
  const download = () => {
    const query = s.appliedSearch.current?.query ?? s.query;
    const report = {
      ...tradeDebugReport(
        model,
        query,
        { teamA: query.teamA, teamB: "", give: [], get: [] },
        s.resultPlans.current,
        s.appliedSearch.current,
        {
          status: job?.status ?? "not searched",
          stale: s.stale,
          stats: job?.stats,
          total: job?.total,
          loadedRows: job?.rows.length,
          coverage: job?.coverage,
        },
      ),
      appVersion: import.meta.env.VITE_APP_VERSION,
      filters: s.broad.filters,
      filterCounts: job?.filterCounts,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "fantasy-trade-debug.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  if (!job)
    return (
      <p>Press Search all trades to check every legal trade for your team</p>
    );
  if (s.stale)
    return (
      <p role="status">
        Your settings changed since this search. Search again to refresh.
      </p>
    );
  return (
    <section aria-label="Trade search results">
      {s.running && (
        <p role="status">
          {job.progress?.phase ?? "Searching trades"}…
          {job.progress?.phase === "Evaluating trades" &&
            ` ${job.progress.stats.scored} of ${job.progress.stats.matched} evaluated`}
        </p>
      )}
      {job.status === "error" && (
        <p role="alert">{job.error ?? "Trade search failed."}</p>
      )}
      <div className="gd-chips" aria-live="polite">
        <b>
          {job.visibleTotal ?? job.rows.length} of {job.total} trades
        </b>
        <label>
          Sort{" "}
          <select
            value={s.broadSort}
            onChange={(e) =>
              s.setBroadSort(e.target.value as typeof s.broadSort)
            }
          >
            <option value="own">Your EPPG gain</option>
            <option value="other">Their EPPG gain</option>
            <option value="week">Your this-week gain</option>
            <option value="both">Both sides</option>
            <option value="balance">Value balance</option>
            <option value="acceptance">Acceptance</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={s.showHidden}
            onChange={(e) => s.setShowHidden(e.target.checked)}
          />{" "}
          Show hidden
        </label>
      </div>
      <p className="gd-quiet">
        Lineup source: {s.starter.source}
        {m.ignoreByeWeeks &&
          " · Hypothetical: byes ignored; temporary injury absences ignored; IR excluded"}{" "}
        · Weeks {m.current}–{m.final} · Source refreshed:{" "}
        {m.dataset.sourceUTC
          ? new Date(m.dataset.sourceUTC).toLocaleString()
          : "Unavailable"}
        .
      </p>
      {job.coverage && (
        <p>
          All {job.coverage.singles.toLocaleString()} one-for-ones checked ·{" "}
          {job.coverage.extensions.toLocaleString()} larger packages evaluated ·{" "}
          {job.coverage.opponents} {job.coverage.opponents === 1 ? "team" : "teams"}
        </p>
      )}
      <div className="gd-card gd-res">
        <div className="gd-res-grid gd-res-head">
          <span>Offer → receive</span>
          <span>Your grade steps</span>
          <span>Their grade steps</span>
          <span>Lineup / wk</span>
          <span>Surplus</span>
          <span>Status</span>
          <span />
        </div>
        {job.rows.map((row) => show(row))}
      </div>
      {(job.groupsTotal ?? 0) > job.rows.length && (
        <button
          type="button"
          className="gd-cbtn"
          onClick={() => s.setBroadLimit(s.broadLimit + 50)}
        >
          Show more
        </button>
      )}
      {job.status === "complete" && !job.rows.length && (
        <p>
          No trades match these filters ·{" "}
          <button
            type="button"
            className="gd-cbtn"
            onClick={() => s.updateBroad({ filters: defaultTradeFilters() })}
          >
            Clear filters
          </button>
        </p>
      )}
      {s.showHidden &&
        job.hiddenRows?.map(({ row, reasons }) => (
          <div className="gd-quiet" key={`hidden-${row.key}`}>
            {names(row.give ?? [])} → {names(row.get)} · Hidden:{" "}
            {reasons.map((key) => reason[key] ?? key).join(", ")}
          </div>
        ))}
      <details className="gd-diag">
        <summary>Diagnostics</summary>
        <div className="gd-fg-body" style={{ marginTop: 10 }}>
          <button type="button" className="gd-cbtn" onClick={download}>
            Download search debug
          </button>
        </div>
      </details>
    </section>
  );
}
