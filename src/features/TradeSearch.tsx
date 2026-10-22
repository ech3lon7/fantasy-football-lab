import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { str, type Draft, type Position } from "../domain/contracts";
import type { Model } from "../domain/valuation";
import { readStarterLineup } from "../domain/starter-lineups";
import {
  positionGradeScale,
  type SearchLineupDetails,
  tradeSearchBounds,
  tradeSearchContext,
  type SearchProgress,
  type SearchRequest,
  type SearchResponse,
  type SearchRow,
  type SearchStats,
  type UpgradeFilter,
  type WeeklyRange,
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
  // Store only explanations explicitly opened in this completed search.
  lineups?: Record<string, { details?: SearchLineupDetails; error?: string }>;
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
  // Keep single-role and mixed-role counts separate so switching targets preserves each input's meaning.
  const [requiredUpgrades, setRequiredUpgrades] = useState("1"),
    [requiredStarters, setRequiredStarters] = useState("1"),
    [requiredBench, setRequiredBench] = useState("0");
  // Each team's weekly-point filter is optional; blank bounds remain unbounded and negative limits are allowed.
  const [ownWeekly, setOwnWeekly] = useState({
      enabled: false,
      minimum: "0",
      maximum: "",
    }),
    [otherWeekly, setOtherWeekly] = useState({
      enabled: false,
      minimum: "0",
      maximum: "",
    });
  // Keep the selected offered position explicit when the outgoing package changes.
  const [deficitOnly, setDeficitOnly] = useState(false),
    [deficitPosition, setDeficitPosition] = useState(""),
    [deficitCeiling, setDeficitCeiling] = useState("C+");
  const offeredPositions = [
    ...new Set(
      draft.give.flatMap((id) => {
        const position = m.byId.get(id)?.pos;
        return position ? [position] : [];
      }),
    ),
  ];
  const selectedPosition = deficitPosition || offeredPositions[0] || "";
  const [job, setJob] = useState<SearchJob | null>(null);
  const active = useRef<{ worker: Worker; id: string; context: string } | null>(
    null,
  );
  // Preserve invalid/empty edits as invalid input, instead of Number("") silently becoming zero.
  const parseOffset = (text: string) => (text.trim() ? Number(text) : NaN);
  // Keep blank weekly bounds distinct from invalid input and from a real numeric zero.
  const weeklyRange = (range: typeof ownWeekly): WeeklyRange | undefined =>
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
      ? {
          mode: upgradeMode,
          minimum: parseOffset(minimumUpgrade),
          requiredStarters:
            upgradeMode === "depth"
              ? 0
              : parseOffset(
                  upgradeMode === "either"
                    ? requiredStarters
                    : requiredUpgrades,
                ),
          requiredBench:
            upgradeMode === "starter"
              ? 0
              : parseOffset(
                  upgradeMode === "either" ? requiredBench : requiredUpgrades,
                ),
        }
      : undefined,
    deficit: deficitOnly
      ? { position: selectedPosition as Position, ceiling: deficitCeiling }
      : undefined,
    weekly:
      ownWeekly.enabled || otherWeekly.enabled
        ? { own: weeklyRange(ownWeekly), other: weeklyRange(otherWeekly) }
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
          // Detail replies enrich one expanded result without replacing rows or changing search status.
          if (message.type === "details")
            return {
              ...previous,
              lineups: {
                ...previous.lineups,
                [message.key]: {
                  details: message.details,
                  error: message.error,
                },
              },
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

  // Fetch actual weekly slot changes only when the matching result is opened.
  function inspect(row: SearchRow) {
    if (
      !job ||
      stale ||
      job.status !== "complete" ||
      active.current?.id !== job.id ||
      job.lineups?.[row.key]
    )
      return;
    setJob((previous) =>
      previous
        ? { ...previous, lineups: { ...previous.lineups, [row.key]: {} } }
        : previous,
    );
    const request: SearchRequest = {
      type: "details",
      id: job.id,
      context,
      key: row.key,
    };
    active.current.worker.postMessage(request);
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
  const weeklyControls = (
    label: "Your" | "Their",
    range: typeof ownWeekly,
    set: (range: typeof ownWeekly) => void,
  ) => {
    const values = [range.minimum, range.maximum]
      .map(Number)
      .filter(Number.isFinite);
    const trackMinimum = Math.min(-10, ...values),
      trackMaximum = Math.max(10, ...values);
    return (
      <div>
        <label className="check">
          <span>Filter {label.toLowerCase()} weekly gain</span>
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
                    {label} {bound} weekly gain (points/week)
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
                  aria-label={`${label} ${bound} weekly gain slider`}
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

  // Do not round an invalid fractional count into a different, apparently valid requirement in the help text.
  const formatUpgradeCount = (value: number | undefined) =>
    Number.isInteger(value) ? String(value) : "Unavailable";
  // Count controls require distinct outgoing players, with zero permitted only for one side of an Either mix.
  const upgradeCountControl = (
    label: string,
    value: string,
    set: (value: string) => void,
  ) => (
    <label className="control">
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        min={upgradeMode === "either" ? 0 : 1}
        max={draft.give.length}
        step="1"
        value={value}
        onChange={(event) => set(event.target.value)}
      />
    </label>
  );

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
            {/* Single targets use one minimum; Either requires both independently selected group minimums. */}
            {upgradeMode !== "depth" &&
              upgradeCountControl(
                "Minimum starter upgrades",
                upgradeMode === "either" ? requiredStarters : requiredUpgrades,
                upgradeMode === "either"
                  ? setRequiredStarters
                  : setRequiredUpgrades,
              )}
            {upgradeMode !== "starter" &&
              upgradeCountControl(
                "Minimum bench upgrades",
                upgradeMode === "either" ? requiredBench : requiredUpgrades,
                upgradeMode === "either"
                  ? setRequiredBench
                  : setRequiredUpgrades,
              )}
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
            Requires at least{" "}
            {formatUpgradeCount(query.upgrade?.requiredStarters)} starter
            upgrades and {formatUpgradeCount(query.upgrade?.requiredBench)}{" "}
            bench upgrades. Each qualifying offered player, including your
            bench, must exceed the same-position comparison by{" "}
            {fmt(query.upgrade?.minimum)} Expected PPG. Each offered and
            opposing player can appear only once. Starter uses same-position
            current starters (including FLEX); Depth uses their actual
            same-position bench, excluding IR. Either maximizes distinct starter
            upgrades first, then bench upgrades, among assignments meeting both
            minimums. Comparisons use their roster before the trade, including
            players they may send away. Teams failing either minimum or lacking
            enough usable comparisons are excluded. With the deficit filter
            enabled, at least one assigned upgrade must match its position;
            other upgrades may be at other positions. Net trade impact is shown
            separately.
          </small>
        </p>
      )}
      {/* Reuse existing league-relative team grades for one offered position. */}
      <div className="trade-search-controls">
        <label className="check">
          <span>Only teams with a positional deficit</span>
          <input
            type="checkbox"
            checked={deficitOnly}
            onChange={(event) => {
              // Freeze the initial position too, so changing offers cannot silently change the active criterion.
              if (event.target.checked && !deficitPosition)
                setDeficitPosition(selectedPosition);
              setDeficitOnly(event.target.checked);
            }}
          />
        </label>
        {deficitOnly && (
          <>
            <label className="control">
              <span>Deficit position</span>
              <select
                aria-label="Deficit position"
                value={
                  offeredPositions.includes(selectedPosition as Position)
                    ? selectedPosition
                    : ""
                }
                onChange={(event) => setDeficitPosition(event.target.value)}
              >
                <option value="" disabled>
                  Select an offered position
                </option>
                {offeredPositions.map((position) => (
                  <option key={position} value={position}>
                    {position}
                  </option>
                ))}
              </select>
            </label>
            <label className="control">
              <span>Maximum position grade</span>
              <select
                aria-label="Maximum position grade"
                value={deficitCeiling}
                onChange={(event) => setDeficitCeiling(event.target.value)}
              >
                {positionGradeScale.map((grade) => (
                  <option key={grade} value={grade}>
                    {grade} or lower
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      {deficitOnly && (
        <p>
          <small>
            Uses the other team's current roster grade from Team Rosters,
            relative to this fantasy league. The ceiling is inclusive;
            unavailable grades do not qualify. When positional upgrades are also
            enabled, an upgrade must qualify at this selected position.
          </small>
        </p>
      )}
      {/* Screen existing average lineup gains independently for either or both teams. */}
      {weeklyControls("Your", ownWeekly, setOwnWeekly)}
      {weeklyControls("Their", otherWeekly, setOtherWeekly)}
      {(ownWeekly.enabled || otherWeekly.enabled) && (
        <p>
          <small>
            Weekly gain is the total model expected starting-lineup gain divided
            by {m.weeks.length} remaining fantasy weeks (Weeks {m.current}–
            {m.final}). It is an average lineup change, not a player's actual
            PPG or ESPN's current-week projection. Both enabled ranges must
            pass. Blank limits are unbounded; moving a slider sets that limit.
            Negative limits are allowed. Unavailable gains cannot pass an active
            bound. Evaluation weeks are unchanged.
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
                        <details
                          onToggle={(event) => {
                            if (event.currentTarget.open) inspect(row);
                          }}
                        >
                          <summary>Trade details</summary>
                          {/* Display the exact pre-trade grade that qualified this team. */}
                          {row.deficit && (
                            <p>
                              Their {row.deficit.position} grade:{" "}
                              <span className="model">{row.deficit.grade}</span>{" "}
                              (required {row.deficit.ceiling} or lower).{" "}
                              {row.deficit.status}
                            </p>
                          )}
                          <p>
                            Your weekly lineup gain:{" "}
                            <span className="model">{scoring(row.own)}</span>{" "}
                            points/week. Their weekly lineup gain:{" "}
                            <span className="model">{scoring(row.other)}</span>{" "}
                            points/week.
                          </p>
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
                            </span>{" "}
                            total expected points across {m.weeks.length} weeks.
                          </p>
                          {/* Actual scoring replacements are separate from the positional-fit comparisons above. */}
                          <p>
                            <small>
                              Positional upgrades describe fit before the trade.
                              The scoring replacements below explain the modeled
                              gains.
                            </small>
                          </p>
                          {stale ? (
                            <p>
                              Search again to inspect current lineup changes.
                            </p>
                          ) : !job.lineups?.[row.key]?.details &&
                            !job.lineups?.[row.key]?.error ? (
                            <p role="status">Loading lineup changes…</p>
                          ) : job.lineups?.[row.key]?.error ? (
                            <p className="notice warning">
                              {job.lineups[row.key].error}
                            </p>
                          ) : (
                            (["own", "other"] as const).map((side) => {
                              const detail =
                                job.lineups![row.key].details![side];
                              return (
                                <div key={side}>
                                  <p>
                                    <strong>
                                      {side === "own"
                                        ? "Your scoring lineup"
                                        : "Their scoring lineup"}
                                    </strong>{" "}
                                    · {detail.source}
                                  </p>
                                  <p>
                                    Bench replacements:{" "}
                                    {names(detail.replacements)}. Incoming in
                                    scoring pool: {names(detail.incoming)}.{" "}
                                    Outgoing bench players:{" "}
                                    {names(detail.benchOutgoing)}.
                                  </p>
                                  {detail.issues.map((issue) => (
                                    <p className="notice warning" key={issue}>
                                      {issue}
                                    </p>
                                  ))}
                                  <details>
                                    <summary>
                                      {side === "own" ? "Your" : "Their"} weekly
                                      scoring replacements
                                    </summary>
                                    <p>
                                      <small>
                                        Same-slot before → after. Slot moves
                                        (including FLEX) can produce multiple
                                        rows; the weekly total includes all
                                        changes and byes.
                                      </small>
                                    </p>
                                    {detail.weekly.map((week) => (
                                      <div key={week.week}>
                                        <p>
                                          <strong>Week {week.week}</strong>:{" "}
                                          <span className="model">
                                            {fmt(week.before)} →{" "}
                                            {fmt(week.after)} (
                                            {scoring(week.gain)})
                                          </span>{" "}
                                          expected points.
                                        </p>
                                        {week.changes.length ? (
                                          week.changes.map((slot, i) => (
                                            <p key={i}>
                                              {slot.slot}:{" "}
                                              {slot.before
                                                ? names([slot.before])
                                                : "Unfilled"}{" "}
                                              →{" "}
                                              {slot.after
                                                ? names([slot.after])
                                                : "Unfilled"}{" "}
                                              ·{" "}
                                              <span className="model">
                                                {scoring(slot.gain)} points
                                              </span>
                                            </p>
                                          ))
                                        ) : (
                                          <p>No scoring-slot changes.</p>
                                        )}
                                      </div>
                                    ))}
                                  </details>
                                </div>
                              );
                            })
                          )}
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
                {query.weekly || query.deficit || query.upgrade
                  ? "No packages match this index range, incoming count and active filters."
                  : "No packages match this index range and incoming count."}
              </p>
            )}
            {/* Report post-evaluation filtering separately from index/positional eligibility. */}
            {job.stats?.weeklyExcluded !== undefined && (
              <p>
                Trades excluded by weekly-gain limits:{" "}
                {job.stats.weeklyExcluded}. All {job.stats.scored}{" "}
                index/positional matches were evaluated before filtering;
                unavailable bounded weekly gains are excluded.
              </p>
            )}
            {/* Count excluded teams separately from evaluated-package weekly-gain exclusions. */}
            {job.stats?.deficitExcluded !== undefined && (
              <p>
                Teams excluded by positional-deficit filter:{" "}
                {job.stats.deficitExcluded}. Includes unavailable grades.
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
