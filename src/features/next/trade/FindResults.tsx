import { useMemo, useState } from "react";
import type { Model } from "../../../domain/valuation";
import { str } from "../../../domain/contracts";
import { readLineupBasis } from "../../../domain/trade-impact";
import { emptyTradeBrowse } from "../../../domain/trade-result-groups";
import {
  orderResultRows,
  resultRowView,
  resultSummary,
  type ResultRowView,
} from "../../../domain/view/search-rows";
import type { GradeChip } from "../../../domain/view/trade-room";
import { PlayerPhoto } from "../../../ui/PlayerPhoto";
import { PlayerName } from "../../../ui/PlayerName";
import { searchDuration, type TradeSearchState } from "./useTradeSearch";

const pageStep = 25;

const signedOne = (x: number | null) =>
  x === null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(1)}`;

function Chips({ chips, label }: { chips: GradeChip[]; label: string }) {
  if (!chips.length) return <span className="gd-quiet">—</span>;
  return (
    <span className="gd-chips" role="list" aria-label={label}>
      {chips.map((c) => (
        <span
          key={c.position}
          role="listitem"
          className="gd-chipg"
          data-tone={c.tone}
          title={`${c.position} grade ${c.before} to ${c.after}`}
        >
          {c.text}
        </span>
      ))}
    </span>
  );
}

// The summary line, the results table with real values only, near misses and the search within the results.
export function FindResults({
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
  const { job, stale, running } = s;
  const [limit, setLimit] = useState(pageStep);
  const captured = s.appliedSearch.current?.query;
  const resultModel = s.resultModel.current ?? m;

  const views = useMemo<ResultRowView[]>(() => {
    if (!job || !captured || job.status === "running") return [];
    const context = {
      teamA: captured.teamA,
      give: captured.give,
      basis: readLineupBasis(captured.lineupBasis),
      lineupsRaw: s.resultPlans.current,
    };
    return orderResultRows(
      job.rows.map((row) => resultRowView(resultModel, row, context)),
    );
    // The rows and the executed query define the view; the refs are captured with them.
  }, [job?.id, job?.rows, job?.status]);

  const name = (id: string) => resultModel.byId.get(id);
  const shown = views.slice(0, limit);
  const done = !!job && job.status === "complete" && !stale;
  const suggestions = job?.suggestions ?? [];

  let empty = "";
  if (!job) empty = "Run a search to see the trades that meet your goals.";
  else if (stale)
    empty = "Your settings changed since this search. Search again to refresh.";
  else if (job.status === "cancelled") empty = "The search was cancelled.";
  else if (job.status === "complete" && views.length === 0)
    empty = "No trades met every goal. Loosen a goal, or add a team.";

  return (
    <>
      <div className="gd-applied">
        {job && job.status === "complete" && !stale ? (
          <b>{resultSummary(job.total, job.stats)}</b>
        ) : (
          "No results yet for the current settings."
        )}
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

      {running && (
        <div className="gd-status" role="status" aria-live="polite">
          {job?.progress?.phase ?? "Preparing search"}…
          {job?.progress &&
            (job.progress.phase === "Evaluating trades"
              ? ` ${job.progress.stats.scored.toLocaleString()} of ${job.progress.stats.matched.toLocaleString()} evaluated`
              : ` ${job.progress.stats.checked}/${job.progress.stats.teams} checked`)}
          {job?.progress?.elapsedMs !== undefined && (
            <small>
              {" "}
              Elapsed: {searchDuration(job.progress.elapsedMs)}.
              {job.progress.remainingMs !== undefined &&
                ` Estimated remaining: ${searchDuration(job.progress.remainingMs)} (may change).`}
            </small>
          )}
        </div>
      )}
      {job?.status === "error" && (
        <div className="gd-status" role="alert">
          {job.error ?? "The search failed."}
        </div>
      )}

      {job && job.total > 0 && (
        <section className="gd-card" aria-label="Search within results">
          <h3>Search within results</h3>
          <div className="gd-row2">
            <label className="gd-field">
              <span>Offered players in results</span>
              <input
                type="text"
                placeholder="Walker"
                disabled={stale}
                value={s.resultBrowse.offered}
                onChange={(e) =>
                  s.browseResults({
                    ...emptyTradeBrowse(),
                    offered: e.target.value,
                    received: s.resultBrowse.received,
                    excluded: s.resultBrowse.excluded,
                    exact: s.resultBrowse.exact,
                  })
                }
              />
            </label>
            <label className="gd-field">
              <span>Received players in results</span>
              <input
                type="text"
                placeholder="Jacobs, Swift"
                disabled={stale}
                value={s.resultBrowse.received}
                onChange={(e) =>
                  s.browseResults({
                    ...emptyTradeBrowse(),
                    offered: s.resultBrowse.offered,
                    received: e.target.value,
                    excluded: s.resultBrowse.excluded,
                    exact: s.resultBrowse.exact,
                  })
                }
              />
            </label>
            <label className="gd-field">
              <span>Exclude players from results</span>
              <input
                type="text"
                placeholder="49ers, Higgins, Swift"
                disabled={stale}
                value={s.resultBrowse.excluded ?? ""}
                onChange={(e) =>
                  s.browseResults({
                    ...emptyTradeBrowse(),
                    offered: s.resultBrowse.offered,
                    received: s.resultBrowse.received,
                    excluded: e.target.value,
                    exact: s.resultBrowse.exact,
                  })
                }
              />
            </label>
            <label className="gd-chk">
              <input
                type="checkbox"
                disabled={stale}
                checked={s.resultBrowse.exact}
                onChange={(e) =>
                  s.browseResults({
                    ...emptyTradeBrowse(),
                    offered: s.resultBrowse.offered,
                    received: s.resultBrowse.received,
                    excluded: s.resultBrowse.excluded,
                    exact: e.target.checked,
                  })
                }
              />
              <span>Exact player lists</span>
            </label>
          </div>
        </section>
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
        {shown.map((v) => {
          const row = job!.rows.find((r) => r.key === v.key)!;
          const give = v.give.map(name).filter((p) => !!p);
          const get = v.get.map(name).filter((p) => !!p);
          return (
            <div key={v.key} className="gd-res-grid gd-res-row">
              <span className="gd-who">
                <span className="gd-photos">
                  {get.slice(0, 3).map((p) => (
                    <PlayerPhoto
                      key={p!.id}
                      player={p!}
                      size={30}
                      className="gd-photo"
                    />
                  ))}
                </span>
                <span>
                  {give.map((p, i) => (
                    <span key={p!.id}>
                      {i > 0 && ", "}
                      <PlayerName p={p!} />
                    </span>
                  ))}{" "}
                  <span className="gd-quiet">→</span>{" "}
                  <b>
                    {get.map((p, i) => (
                      <span key={p!.id}>
                        {i > 0 && ", "}
                        <PlayerName p={p!} />
                      </span>
                    ))}
                  </b>
                  <br />
                  <span className="gd-quiet">{v.teamName}</span>
                </span>
              </span>
              <Chips chips={v.ownChips} label="Your grade steps" />
              <Chips chips={v.otherChips} label="Their grade steps" />
              <span className="gd-gain" title={v.gain.reason || undefined}>
                <b>{signedOne(v.gain.gain)}</b>
                <small>
                  ± {v.gain.spread === null ? "n/a" : v.gain.spread.toFixed(1)}
                  {v.gain.sharesNflTeam && " (slightly understated)"}
                </small>
              </span>
              <span>{v.surplus}</span>
              <span>
                <span className="gd-stag" data-kind={v.status.kind}>
                  {v.status.label}
                </span>
                {v.status.detail && (
                  <small className="gd-quiet" style={{ display: "block" }}>
                    {v.status.detail}
                  </small>
                )}
              </span>
              <span className="gd-chips">
                <button
                  type="button"
                  className="gd-cbtn"
                  onClick={() => {
                    s.load(row);
                    onAnalyze();
                  }}
                >
                  Analyze
                </button>
                {canSave && (
                  <button
                    type="button"
                    className="gd-cbtn"
                    aria-label={`Save trade ${v.key}`}
                    onClick={() => s.saveRow(row)}
                  >
                    {s.savedRow === v.key ? "Saved" : "Save"}
                  </button>
                )}
              </span>
            </div>
          );
        })}
        {empty && <p className="gd-empty">{empty}</p>}
      </div>
      {views.length > limit && (
        <button
          type="button"
          className="gd-cbtn"
          onClick={() => setLimit(limit + pageStep)}
        >
          Show {Math.min(pageStep, views.length - limit)} more of{" "}
          {views.length - limit}
        </button>
      )}

      {done && (
        <details className="gd-nm">
          <summary>Near misses ({suggestions.length})</summary>
          <div className="gd-nm-list">
            {suggestions.length === 0 && (
              <p className="gd-quiet">
                None listed. Turn on “Show near misses and adjustments” in
                Ranking to see alternatives that just missed a limit.
              </p>
            )}
            {suggestions.map((row) => (
              <div key={row.key} className="gd-quiet">
                {(row.give ?? captured?.give ?? [])
                  .map((id) => name(id)?.name ?? id)
                  .join(", ")}{" "}
                → {row.get.map((id) => name(id)?.name ?? id).join(", ")} ·{" "}
                {str(
                  resultModel.dataset.tables.ModelTeams.find(
                    (t) => str(t.TeamID) === row.teamB,
                  )?.TeamName,
                ) || row.teamB}
                : {row.nearMiss?.reasons.join("; ") || "Below a limit"}{" "}
                <button
                  type="button"
                  className="gd-cbtn"
                  onClick={() => {
                    s.load(row);
                    onAnalyze();
                  }}
                >
                  Inspect this alternative
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
