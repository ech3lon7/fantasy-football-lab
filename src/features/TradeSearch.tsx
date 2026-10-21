import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { str, type Draft } from "../domain/contracts";
import type { Model } from "../domain/valuation";
import { readStarterLineup } from "../domain/starter-lineups";
import {
  tradeSearchBounds,
  tradeSearchContext,
  type SearchProgress,
  type SearchRequest,
  type SearchResponse,
  type SearchRow,
  type SearchStats,
  type UpgradeFilter,
  type HorizonRange,
} from "../domain/trade-search";
import { Panel } from "../ui/layout";
import { PlayerName } from "../ui/PlayerName";
import { fmt, signed, Signal } from "../ui/components";

// Keep ephemeral search results out of the saved/synced trade draft until the user explicitly loads one.
interface SearchJob {
  id: string;
  context: string;
  status: "running" | "complete" | "cancelled" | "error" | "stale";
  progress?: SearchProgress;
  rows: SearchRow[];
  total: number;
  stats?: SearchStats;
  error?: string;
  paging?: boolean;
}
export function TradeSearch({
  m,
  draft,
  lineupsRaw,
  change,
}: {
  m: Model;
  draft: Draft;
  lineupsRaw?: string;
  change: (draft: Draft) => void;
}) {
  const [below, setBelow] = useState("5"),
    [above, setAbove] = useState("5");
  const [packages, setPackages] = useState(false),
    [count, setCount] = useState(2);
  // Keep optional fit controls local and disabled by default, like the existing search controls.
  const [upgradeOnly, setUpgradeOnly] = useState(false),
    [upgradeMode, setUpgradeMode] = useState<UpgradeFilter["mode"]>("starter"),
    [minimumUpgrade, setMinimumUpgrade] = useState("1");
  // Each team's total-point filter is optional; blank bounds remain unbounded and negative limits are allowed.
  const [ownHorizon, setOwnHorizon] = useState({
      enabled: false,
      minimum: "0",
      maximum: "",
    }),
    [otherHorizon, setOtherHorizon] = useState({
      enabled: false,
      minimum: "0",
      maximum: "",
    });
  const [job, setJob] = useState<SearchJob | null>(null);
  const active = useRef<{ worker: Worker; id: string; context: string } | null>(
    null,
  );
  // Preserve invalid/empty edits as invalid input, instead of Number("") silently becoming zero.
  const parseOffset = (text: string) => (text.trim() ? Number(text) : NaN);
  // Keep blank horizon bounds distinct from invalid input and from a real numeric zero.
  const horizonRange = (range: typeof ownHorizon): HorizonRange | undefined =>
    range.enabled
      ? {
          minimum: range.minimum.trim() ? Number(range.minimum) : null,
          maximum: range.maximum.trim() ? Number(range.maximum) : null,
        }
      : undefined;
  const query = {
    teamA: draft.teamA,
    give: draft.give,
    count: packages ? count : 1,
    below: parseOffset(below),
    above: parseOffset(above),
    upgrade: upgradeOnly
      ? { mode: upgradeMode, minimum: parseOffset(minimumUpgrade) }
      : undefined,
    horizon:
      ownHorizon.enabled || otherHorizon.enabled
        ? { own: horizonRange(ownHorizon), other: horizonRange(otherHorizon) }
        : undefined,
  };
  const bounds = tradeSearchBounds(m, query);
  const context = tradeSearchContext(m, query, lineupsRaw);
  const stale = !!job && (job.status === "stale" || job.context !== context);
  const running = !stale && job?.status === "running";
  const starter = readStarterLineup(m, draft.teamA, lineupsRaw);

  // Relevant input changes and unmount terminate synchronous worker work; stale rows cannot be loaded.
  useEffect(() => {
    // Once invalidated, reverting controls still requires a new worker rather than reviving terminated pages.
    setJob((previous) =>
      previous && previous.context !== context
        ? { ...previous, status: "stale", paging: false }
        : previous,
    );
    return () => {
      active.current?.worker.terminate();
      active.current = null;
    };
  }, [context]);

  // Start a captured immutable request; request/context checks reject late messages after cancel or restart.
  function search() {
    if (bounds.errors.length) return;
    active.current?.worker.terminate();
    const id = crypto.randomUUID();
    setJob({ id, context, status: "running", rows: [], total: 0 });
    try {
      const worker = new Worker(
        new URL("../workers/trade-search.worker.ts", import.meta.url),
        { type: "module" },
      );
      active.current = { worker, id, context };
      worker.onmessage = (event: MessageEvent<SearchResponse>) => {
        const message = event.data;
        if (
          active.current?.id !== message.id ||
          active.current.context !== message.context
        )
          return;
        setJob((previous) => {
          if (
            !previous ||
            previous.id !== message.id ||
            previous.context !== message.context
          )
            return previous;
          if (message.type === "progress")
            return { ...previous, progress: message.progress };
          if (message.type === "error")
            return {
              ...previous,
              status: "error",
              error: message.message,
              paging: false,
            };
          // Reject out-of-order pages instead of duplicating or skipping rows.
          if (
            message.type === "page" &&
            message.offset !== previous.rows.length
          )
            return { ...previous, paging: false };
          return {
            ...previous,
            status: "complete",
            rows:
              message.type === "complete"
                ? message.rows
                : [...previous.rows, ...message.rows],
            total: message.total,
            stats: message.stats,
            paging: false,
          };
        });
        if (message.type === "error") {
          worker.terminate();
          active.current = null;
        }
      };
      worker.onerror = () => {
        if (active.current?.id !== id) return;
        worker.terminate();
        active.current = null;
        setJob((previous) =>
          previous?.id === id
            ? {
                ...previous,
                status: "error",
                error: "Trade search failed. Please try again.",
                paging: false,
              }
            : previous,
        );
      };
      const request: SearchRequest = {
        type: "start",
        id,
        context,
        dataset: m.dataset,
        settings: m.settings,
        evidence: m.evidenceRaw,
        roleWeight: String(m.roleScenarioWeight),
        lineupsRaw,
        query,
      };
      worker.postMessage(request);
    } catch (error) {
      active.current?.worker.terminate();
      active.current = null;
      setJob({
        id,
        context,
        status: "error",
        rows: [],
        total: 0,
        error:
          error instanceof Error
            ? error.message
            : "Could not start trade search.",
      });
    }
  }

  // Termination is immediate even if the worker is busy in a large package enumeration/evaluation loop.
  function cancel() {
    active.current?.worker.terminate();
    active.current = null;
    setJob((previous) =>
      previous ? { ...previous, status: "cancelled", paging: false } : previous,
    );
  }

  // Loading changes only counterparty/incoming selections; normal analyzer persistence and evaluation take over.
  function load(row: SearchRow) {
    if (
      stale ||
      job?.status !== "complete" ||
      bounds.errors.length ||
      row.get.some((id) => m.byId.get(id)?.owner !== row.teamB)
    )
      return;
    change({ ...draft, teamB: row.teamB, get: [...row.get] });
  }

  // Fetch the next already-sorted page from the same completed search without rerunning calculations.
  function more() {
    if (
      !job ||
      stale ||
      job.status !== "complete" ||
      job.paging ||
      active.current?.id !== job.id
    )
      return;
    const message: SearchRequest = {
      type: "page",
      id: job.id,
      context,
      offset: job.rows.length,
    };
    setJob({ ...job, paging: true });
    active.current.worker.postMessage(message);
  }

  // Reuse existing player inspection links for outgoing summaries and proposed roster transactions.
  const names = (ids: string[]) =>
    ids.length
      ? ids.map((id, i) => (
          <span key={id}>
            {i > 0 && ", "}
            {m.byId.get(id) ? <PlayerName p={m.byId.get(id)!} /> : id}
          </span>
        ))
      : "None";
  const scoring = (value: number | null) =>
    value === null ? "Unavailable" : signed(value);
  const offsetControl = (
    label: string,
    text: string,
    set: (value: string) => void,
  ) => {
    const value = parseOffset(text),
      valid = Number.isFinite(value) && value >= 0;
    return (
      <div className="trade-search-offset">
        <label className="control">
          <span>{label} (index points)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={text}
            onChange={(event) => set(event.target.value)}
          />
        </label>
        <input
          aria-label={`${label} slider`}
          type="range"
          min="0"
          max={Math.max(100, valid ? value : 0)}
          step="0.01"
          value={valid ? value : 0}
          onChange={(event) => set(event.target.value)}
        />
      </div>
    );
  };

  // Numeric fields allow unbounded limits; moving a slider sets that bound without capping valid typed values.
  const horizonControls = (
    label: "Your" | "Their",
    range: typeof ownHorizon,
    set: (range: typeof ownHorizon) => void,
  ) => {
    const values = [range.minimum, range.maximum]
      .map(Number)
      .filter(Number.isFinite);
    const trackMinimum = Math.min(-100, ...values),
      trackMaximum = Math.max(100, ...values);
    return (
      <div>
        <label className="check">
          <span>Filter {label.toLowerCase()} horizon gain</span>
          <input
            type="checkbox"
            checked={range.enabled}
            onChange={(event) =>
              set({ ...range, enabled: event.target.checked })
            }
          />
        </label>
        {range.enabled && (
          <div className="trade-search-controls">
            {(["minimum", "maximum"] as const).map((bound) => (
              <div className="trade-search-offset" key={bound}>
                <label className="control">
                  <span>
                    {label} {bound} horizon gain (total points)
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    placeholder={`No ${bound}`}
                    value={range[bound]}
                    onChange={(event) =>
                      set({ ...range, [bound]: event.target.value })
                    }
                  />
                </label>
                <input
                  type="range"
                  aria-label={`${label} ${bound} horizon gain slider`}
                  min={trackMinimum}
                  max={trackMaximum}
                  step="0.01"
                  value={
                    range[bound].trim() && Number.isFinite(Number(range[bound]))
                      ? Number(range[bound])
                      : bound === "minimum"
                        ? trackMinimum
                        : trackMaximum
                  }
                  onChange={(event) =>
                    set({ ...range, [bound]: event.target.value })
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Controls express raw index matching; premiums and fairness remain visible only as separate evaluation outputs.
  return (
    <Panel
      title="Find matching trades"
      note="Match summed value indices, then compare each trade's effect on your starting lineup."
    >
      <p>
        Fixed outgoing: {names(draft.give)} · Combined index:{" "}
        <strong className="model">
          {bounds.errors.length ? "Unavailable" : fmt(bounds.outgoing)}
        </strong>
      </p>
      <div className="trade-search-controls">
        {offsetControl("Below outgoing total", below, setBelow)}
        {offsetControl("Above outgoing total", above, setAbove)}
        <label className="check">
          <span>Create package</span>
          <input
            type="checkbox"
            checked={packages}
            onChange={(event) => setPackages(event.target.checked)}
          />
        </label>
        {packages && (
          <label className="control">
            <span>Players to receive</span>
            <select
              aria-label="Players to receive"
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {/* Qualify teams using current positional needs; keep this separate from net trade impact and index bounds. */}
      <div className="trade-search-controls">
        <label className="check">
          <span>Only show positional upgrades for the other team</span>
          <input
            type="checkbox"
            checked={upgradeOnly}
            onChange={(event) => setUpgradeOnly(event.target.checked)}
          />
        </label>
        {upgradeOnly && (
          <>
            <label className="control">
              <span>Upgrade target</span>
              <select
                aria-label="Upgrade target"
                value={upgradeMode}
                onChange={(event) =>
                  setUpgradeMode(event.target.value as UpgradeFilter["mode"])
                }
              >
                <option value="starter">Starter</option>
                <option value="depth">Depth (bench)</option>
                <option value="either">Either</option>
              </select>
            </label>
            <label className="control">
              <span>Minimum Expected PPG upgrade</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={minimumUpgrade}
                onChange={(event) => setMinimumUpgrade(event.target.value)}
              />
            </label>
          </>
        )}
      </div>
      {upgradeOnly && (
        <p>
          <small>
            At least one offered player, including your bench, must exceed the
            same-position comparison by {fmt(query.upgrade?.minimum)} Expected
            PPG. Each offered and opposing player can appear only once. Starter
            uses same-position current starters (including FLEX); Depth uses
            their actual same-position bench, excluding IR. Either maximizes
            distinct starter upgrades first, then bench upgrades. Comparisons
            use their roster before the trade, including players they may send
            away. Missing forecasts/comparison players do not qualify; net trade
            impact is shown separately.
          </small>
        </p>
      )}
      {/* Screen the exact horizon totals shown in Trade details, independently for either or both teams. */}
      {horizonControls("Your", ownHorizon, setOwnHorizon)}
      {horizonControls("Their", otherHorizon, setOtherHorizon)}
      {(ownHorizon.enabled || otherHorizon.enabled) && (
        <p>
          <small>
            Horizon gain is the total model expected starting-lineup points
            gained/lost across Weeks {m.current}–{m.final}, as shown in Trade
            details. Both enabled ranges must pass. Blank limits are unbounded;
            moving a slider sets that limit. Negative limits are allowed.
            Unavailable totals cannot pass an active bound. This does not change
            the evaluation weeks.
          </small>
        </p>
      )}
      {!bounds.errors.length && (
        <p>
          Incoming index range:{" "}
          <strong
            className="model"
            title={`${bounds.lower} through ${bounds.upper}`}
          >
            {fmt(bounds.lower)}–{fmt(bounds.upper)}
          </strong>{" "}
          (inclusive) · Receive {query.count} player
          {query.count === 1 ? "" : "s"} from one other team.
        </p>
      )}
      {bounds.errors.length > 0 && (
        <p className="notice danger">{bounds.errors.join(" ")}</p>
      )}
      <p>
        <small>
          Lineup source: {starter.source}. Model expected lineup gain per week
          is averaged across Weeks {m.current}–{m.final}; it is not ESPN's
          current-week projection. Source refreshed:{" "}
          {m.dataset.sourceUTC
            ? new Date(m.dataset.sourceUTC).toLocaleString()
            : "Unavailable"}
          . Premiums do not affect this search range.
        </small>
      </p>
      <div className="toolbar">
        <button
          className="button primary"
          disabled={bounds.errors.length > 0}
          onClick={search}
        >
          {running ? "Restart search" : "Search"}
        </button>
        {running && (
          <button className="subtle" onClick={cancel}>
            Cancel
          </button>
        )}
      </div>
      {running && (
        <div
          className="notice trade-search-progress"
          role="status"
          aria-live="polite"
        >
          <LoaderCircle
            className="trade-search-spinner"
            size={18}
            aria-hidden="true"
          />
          <span>
            {job.progress?.phase ?? "Preparing search"}…
            {job.progress &&
              (job.progress.phase === "Evaluating trades"
                ? ` ${job.progress.stats.scored} of ${job.progress.stats.matched}`
                : ` ${job.progress.stats.checked}/${job.progress.stats.teams} teams; ${job.progress.stats.matched} matches`)}
            <small>
              {" "}
              Larger package searches can take several minutes. Results appear
              after every match is evaluated.
            </small>
          </span>
        </div>
      )}
      {stale && (
        <p className="notice warning" role="status">
          Search inputs changed. Search again; previous results cannot be
          loaded.
        </p>
      )}
      {!stale && job?.status === "cancelled" && (
        <p role="status">Search cancelled.</p>
      )}
      {!stale && job?.status === "error" && (
        <p className="notice danger" role="alert">
          {job.error}
        </p>
      )}
      {job &&
        (job.status === "complete" ||
          (job.status === "stale" && job.rows.length > 0)) && (
          <>
            <p role="status">
              {job.total} index matches. Ranked by your model expected lineup
              gain per week; an index match is not a fairness or acceptance
              guarantee.
            </p>
            <div className="table-wrap">
              <table className="trade-search-results">
                <thead>
                  <tr>
                    <th>Incoming / team</th>
                    <th className="model">Index / difference</th>
                    <th className="model">Your gain / week</th>
                    <th className="model">Their gain / week</th>
                    <th>Value exchange / tests</th>
                    <th>Details / load</th>
                  </tr>
                </thead>
                <tbody>
                  {job.rows.map((row) => (
                    <tr key={row.key}>
                      <td>
                        {names(row.get)}
                        <small>
                          {str(
                            m.dataset.tables.ModelTeams.find(
                              (t) => str(t.TeamID) === row.teamB,
                            )?.TeamName,
                          )}
                        </small>
                      </td>
                      <td
                        className="model"
                        title={`Incoming ${row.incoming}; outgoing ${row.outgoing}; difference ${row.difference}`}
                      >
                        {fmt(row.incoming)}
                        <small>{signed(row.difference)}</small>
                      </td>
                      <td className="model">{scoring(row.own)}</td>
                      <td className="model">{scoring(row.other)}</td>
                      <td>
                        {row.grade}
                        <small>
                          Surplus: <Signal text={row.surplus} />
                        </small>
                        <small>
                          Points: <Signal text={row.points} />
                        </small>
                      </td>
                      <td>
                        {row.warnings.length > 0 && (
                          <Signal text="CONDITIONAL" />
                        )}
                        <details>
                          <summary>Trade details</summary>
                          {/* Show the exact qualifying comparison instead of implying a guaranteed net improvement or acceptance. */}
                          {row.upgrades?.map((upgrade) => (
                            <p key={`${upgrade.offered}-${upgrade.group}`}>
                              {upgrade.group === "starter"
                                ? "Starter upgrade"
                                : "Depth upgrade"}
                              : {names([upgrade.offered])} (
                              <span className="model">
                                {fmt(upgrade.offeredPPG)}
                              </span>
                              ){" vs "}
                              {names([upgrade.compared])} (
                              <span className="model">
                                {fmt(upgrade.comparedPPG)}
                              </span>
                              ) ·{" "}
                              <span className="model">
                                {signed(upgrade.gain)} Expected PPG
                              </span>
                              . {upgrade.source}. Current-roster comparison
                              before trade.
                            </p>
                          ))}
                          {/* An unmatched offer must not borrow another assignment's opponent or imply an extra upgrade. */}
                          {row.upgrades &&
                            !stale &&
                            draft.give.some(
                              (id) =>
                                !row.upgrades!.some(
                                  (upgrade) => upgrade.offered === id,
                                ),
                            ) && (
                              <p>
                                No distinct qualifying upgrade for:{" "}
                                {names(
                                  draft.give.filter(
                                    (id) =>
                                      !row.upgrades!.some(
                                        (upgrade) => upgrade.offered === id,
                                      ),
                                  ),
                                )}
                                .
                              </p>
                            )}
                          <p>
                            Your horizon gain:{" "}
                            <span className="model">
                              {scoring(row.ownTotal)}
                            </span>
                            . Their horizon gain:{" "}
                            <span className="model">
                              {scoring(row.otherTotal)}
                            </span>
                            .
                          </p>
                          <p>
                            Legality:{" "}
                            {row.legal === null
                              ? "Unavailable"
                              : row.legal
                                ? "Legal modeled rosters"
                                : "Unresolved roster conflict"}
                            .
                          </p>
                          <p>
                            Your proposed drops: {names(row.dropsA)}. Their
                            proposed drops: {names(row.dropsB)}.
                          </p>
                          <p>
                            Your modeled IR: {names(row.irA)}. Their modeled IR:{" "}
                            {names(row.irB)}.
                          </p>
                          {row.warnings.map((warning) => (
                            <p className="notice warning" key={warning}>
                              {warning}
                            </p>
                          ))}
                        </details>
                        <button
                          className="subtle"
                          disabled={stale || bounds.errors.length > 0}
                          onClick={() => load(row)}
                        >
                          Load trade
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {job.total === 0 && (
              <p>
                {job.stats?.horizonExcluded !== undefined
                  ? "No packages match the index range, incoming count and active horizon-gain limits."
                  : "No packages match this index range and incoming count."}
              </p>
            )}
            {/* Report post-evaluation filtering separately from index/positional eligibility. */}
            {job.stats?.horizonExcluded !== undefined && (
              <p>
                Trades excluded by horizon-gain limits:{" "}
                {job.stats.horizonExcluded}. All {job.stats.scored}{" "}
                index/positional matches were evaluated before filtering;
                unavailable bounded totals are excluded.
              </p>
            )}
            {/* Report filtering independently of missing-index and package-size exclusions. */}
            {job.stats?.upgradeExcluded !== undefined && (
              <p>
                Teams excluded by positional-upgrade filter:{" "}
                {job.stats.upgradeExcluded}. Includes teams without usable
                comparison data.
              </p>
            )}
            <div className="table-footer">
              <span>
                {job.rows.length} of {job.total} matches · Missing-index players
                excluded: {job.stats?.excluded ?? 0} · Teams with too few
                eligible players: {job.stats?.thinTeams ?? 0}
              </span>
              {job.rows.length < job.total && (
                <button
                  className="subtle"
                  disabled={stale || job.paging}
                  onClick={more}
                >
                  {job.paging ? "Loading results…" : "Show more"}
                </button>
              )}
            </div>
          </>
        )}
    </Panel>
  );
}
