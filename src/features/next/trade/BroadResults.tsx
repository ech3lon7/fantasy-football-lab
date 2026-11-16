import { useDeferredValue, useRef, useState, type ReactNode } from "react";
import type { Model } from "../../../domain/valuation";
import type { SearchRow } from "../../../domain/trade-search";
import { defaultTradeFilters, showAllTradeFilters } from "../../../domain/trade-filters";
import { PlayerName } from "../../../ui/PlayerName";
import { tradeDebugReport } from "../../../domain/trade-tools";
import { ResultRow } from "./ResultRow";
import { useFlipList } from "./wheel/useFlipList";
import { TweenCount } from "./wheel/TweenCount";
import type { TradeSearchState } from "./useTradeSearch";

// A disclosure that builds its rows only once it is open: each row is a fully evaluated trade, and a closed list of hundreds of
// variants must not be evaluated on every change of the filters.
function Lazy({
  className,
  summary,
  children,
}: {
  className: string;
  summary: string;
  children: () => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className={className}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>{summary}</summary>
      {open && children()}
    </details>
  );
}

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
  // The results are rendered from a deferred copy of the job, so a big batch of rows is built in short slices between frames and never
  // freezes the board's animations in one long task.
  const job = useDeferredValue(s.job),
    model = s.resultModel.current ?? m;
  const listRef = useRef<HTMLDivElement>(null);
  // Rows slide, collapse and draw in as filters, sort and the search change them (A11, A13).
  useFlipList(
    listRef,
    job?.rows.map((r) => r.key) ?? [],
    s.running,
    job?.filters
      ? `${job.visibleTotal}:${job.sort ?? "own"}:${JSON.stringify(job.filters)}`
      : undefined,
  );
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
    ownWeek: "Your MPPG gain",
    otherWeek: "Their MPPG gain",
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
    <div key={row.key} data-key={row.key} className="gd-res-group">
      <ResultRow
        model={model}
        row={row}
        s={s}
        canSave={canSave}
        onAnalyze={onAnalyze}
        variant={variant}
      />
      {/* One disclosure lists the differences for packages built from this seed. */}
      {!variant && !!row.related?.length && (
        <Lazy
          className="gd-variants"
          summary={`${row.related.length} similar trade${row.related.length === 1 ? "" : "s"}`}
        >
          {() => row.related!.map((v) => {
            const oldIds = [...(row.give ?? []), ...row.get], newIds = [...(v.give ?? []), ...v.get];
            const added = newIds.filter((id) => !oldIds.includes(id)), removed = oldIds.filter((id) => !newIds.includes(id));
            const difference = [...added.map((id) => `+ ${model.byId.get(id)?.name ?? id}`), ...removed.map((id) => `instead of ${model.byId.get(id)?.name ?? id}`)].join(" ");
            const delta = (a: number | null, b: number | null) => a === null || b === null ? "—" : `${a - b > 0 ? "+" : ""}${(a - b).toFixed(1)}`;
            return <div key={v.key} data-key={v.key} className="gd-res-group"><button type="button" className="gd-cbtn" onClick={() => { s.load(v); onAnalyze(); }}>
              {difference} · you {delta(v.own, row.own)} · them {delta(v.other, row.other)}
            </button></div>;
          })}
        </Lazy>
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
    return <section aria-label="Trade search results"><p>Press Search to check every legal trade for your team.</p></section>;
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
          <TweenCount value={job.groupsTotal ?? job.rows.length} /> ideas ·{" "}
          <TweenCount value={job.visibleTotal ?? job.rows.length} /> trades of{" "}
          {job.total.toLocaleString()} found
        </b>
        {job.visibleTotal !== undefined && job.total > job.visibleTotal && (
          <button type="button" className="gd-cbtn" onClick={() => s.setShowHidden(true)}>{(job.total - job.visibleTotal).toLocaleString()} hidden by filters</button>
        )}
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
      {job.coverage && (
        <p>
          All {job.coverage.singles.toLocaleString()} one-for-ones checked ·{" "}
          {job.coverage.extensions.toLocaleString()} larger packages evaluated ·{" "}
          {job.coverage.opponents}{" "}
          {job.coverage.opponents === 1 ? "team" : "teams"}
          {job.coverage.missingTeams?.length ? ` · Couldn't search: ${job.coverage.missingTeams.map((id) => String(m.dataset.tables.ModelTeams.find((team) => String(team.TeamID) === id)?.TeamName ?? id)).join(", ")}` : ""}
        </p>
      )}
      <div ref={listRef} className="gd-card gd-res" data-motion="M22">
        <div className="gd-res-grid gd-res-head">
          <span>You give → You get</span>
          <span>Your EPPG gain</span>
          <span>Their EPPG gain</span>
          <span>This week</span>
          <span>Grade steps</span>
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
      {/* Explain whether the search found nothing or filters hid its retained trades. */}
      {job.status === "complete" && job.total === 0 && (
        <p>No legal trades change anyone's lineup with these players and teams. Try loosening I give, I get, Exclude, Teams or Never trade.</p>
      )}
      {job.status === "complete" && job.total > 0 && job.visibleTotal === 0 && (
        <div>
          <p>Found {job.total.toLocaleString()} trades · your filters hide all of them.</p>
          <p>{Object.entries(job.filterBlocks ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([key, count]) => `${reason[key] ?? key} hides ${count.toLocaleString()}`).join(" · ")}</p>
          <button type="button" className="gd-cbtn" onClick={() => s.updateBroad({ filters: showAllTradeFilters(s.broad.filters) })}>Show all</button>{" "}
          <button type="button" className="gd-cbtn" onClick={() => s.updateBroad({ filters: defaultTradeFilters(s.broad.filters) })}>Reset to defaults</button>
        </div>
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
