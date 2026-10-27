import { useEffect, useRef, useState } from "react";
import { Bookmark, LoaderCircle } from "lucide-react";
import {
  chainErrors,
  type ChainQuery,
  type ChainResults,
  type ChainStats,
  type TradeChain,
  type ChainLeg,
} from "../domain/trade-chains";
import { applyRosterScenario, sourceDataset } from "../domain/roster-scenarios";
import {
  summaryFromSearch,
  type SavedTradeSummary,
} from "../domain/saved-trades";
import {
  searchLineupDetails,
  type SearchLineupDetails,
  type TradeSearchQuery,
} from "../domain/trade-search";
import { lineupBasisLabel, type LineupBasis } from "../domain/trade-impact";
import { str, type Draft } from "../domain/contracts";
import type { Model } from "../domain/valuation";
import type { ChainRequest } from "../workers/trade-chains.worker";
import { Panel } from "../ui/layout";
import { FilterHelp } from "../ui/FilterHelp";
import { PlayerName } from "../ui/PlayerName";
import { fmt, signed, Signal } from "../ui/components";

// Store no chain results or roster moves automatically; each saved leg uses the existing explicit saved-trade action.
export function TradeChains({
  m,
  team,
  pool,
  basis,
  lineupsRaw,
  save,
}: {
  m: Model;
  team: string;
  pool: string[];
  basis: LineupBasis;
  lineupsRaw?: string;
  save?: (
    draft: Draft,
    summary: SavedTradeSummary,
    query: TradeSearchQuery,
    context?: Model,
  ) => boolean | void;
}) {
  const [mode, setMode] = useState<ChainQuery["mode"]>("both");
  const [loss, setLoss] = useState("3"),
    [gain, setGain] = useState("5");
  const [first, setFirst] = useState<ChainQuery["first"]>({
    offer: { minimum: 1, maximum: 3 },
    receive: { minimum: 1, maximum: 3 },
  });
  const [second, setSecond] = useState<ChainQuery["second"]>({
    offer: { minimum: 1, maximum: 3 },
    receive: { minimum: 1, maximum: 3 },
  });
  const [depth, setDepth] = useState<ChainQuery["depth"]>("standard");
  const [job, setJob] = useState<{
    context: string;
    status: "running" | "complete" | "cancelled" | "error" | "stale";
    stats?: ChainStats;
    result?: ChainResults;
    error?: string;
    elapsed?: number;
  } | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [details, setDetails] = useState<Record<string, SearchLineupDetails>>(
    {},
  );
  const [detailError, setDetailError] = useState("");
  const active = useRef<Worker | null>(null);
  const query: ChainQuery = {
    team,
    pool,
    mode,
    maximumLoss: loss.trim() ? Number(loss) : NaN,
    minimumGain: gain.trim() ? Number(gain) : NaN,
    first,
    second,
    basis,
    depth,
  };
  const context = JSON.stringify([
    m.dataset.hash,
    m.analysisVersion,
    m.settings,
    m.evidenceRaw,
    m.roleScenarioWeight,
    lineupsRaw,
    query,
  ]);
  const stale = !!job && job.context !== context;
  const errors = chainErrors(m, query);
  const opponents = m.dataset.tables.ModelTeams.filter(
    (t) => str(t.TeamID) !== "0" && str(t.TeamID) !== team,
  );
  const teamName = (id: string) =>
    str(
      m.dataset.tables.ModelTeams.find((t) => str(t.TeamID) === id)?.TeamName,
    ) || id;
  const names = (ids: string[]) =>
    ids.length
      ? ids.map((id, i) => (
          <span key={id}>
            {i > 0 && ", "}
            {m.byId.has(id) ? <PlayerName p={m.byId.get(id)!} /> : id}
          </span>
        ))
      : "None";

  // Any source, pool, basis, or control edit invalidates the captured work; unrelated single-trade controls never affect this search.
  useEffect(() => {
    active.current?.terminate();
    active.current = null;
    setJob((previous) =>
      previous && previous.context !== context
        ? { ...previous, status: "stale" }
        : previous,
    );
    setDetails({});
    setSaved([]);
    setDetailError("");
    return () => {
      active.current?.terminate();
      active.current = null;
    };
  }, [context]);

  // Send only the real source plus the existing ownership recipe, reproducing the same live/hypothetical policy in the worker.
  function search() {
    if (errors.length) return;
    active.current?.terminate();
    const id = crypto.randomUUID();
    try {
      const worker = new Worker(
        new URL("../workers/trade-chains.worker.ts", import.meta.url),
        { type: "module" },
      );
      active.current = worker;
      setJob({ context, status: "running" });
      setSaved([]);
      setDetails({});
      setDetailError("");
      worker.onmessage = (event) => {
        const message = event.data;
        if (
          active.current !== worker ||
          message.id !== id ||
          message.context !== context
        )
          return;
        if (message.type === "progress")
          setJob({
            context,
            status: "running",
            stats: message.stats,
            elapsed: message.elapsed,
          });
        else {
          setJob(
            message.type === "complete"
              ? {
                  context,
                  status: "complete",
                  result: message.result,
                  stats: message.result.stats,
                  elapsed: message.elapsed,
                }
              : { context, status: "error", error: message.message },
          );
          worker.terminate();
          active.current = null;
        }
      };
      worker.onerror = () => {
        if (active.current !== worker) return;
        worker.terminate();
        active.current = null;
        setJob({
          context,
          status: "error",
          error: "Chain worker failed. Try again or use standard depth.",
        });
      };
      const request: ChainRequest = {
        id,
        context,
        dataset: sourceDataset(m),
        settings: m.settings,
        evidence: m.evidenceRaw,
        roleWeight: String(m.roleScenarioWeight),
        scenario: m.simulation?.scenario,
        lineupsRaw,
        query,
      };
      worker.postMessage(request);
    } catch (error) {
      active.current?.terminate();
      active.current = null;
      setJob({
        context,
        status: "error",
        error:
          error instanceof Error
            ? error.message
            : "Could not start chain search.",
      });
    }
  }

  // Reconstruct a leg's prerequisite only for inspection or saving; this never changes the app's working or saved roster.
  function legContext(chain: TradeChain, step: 1 | 2) {
    const model =
      step === 1 ? m : applyRosterScenario(m, chain.afterFirst, lineupsRaw);
    return {
      model,
      plans: step === 1 ? lineupsRaw : model.simulation?.lineupsRaw,
    };
  }
  function legQuery(leg: ChainLeg): TradeSearchQuery {
    return {
      teamA: team,
      give: leg.draft.give,
      count: leg.draft.get.length,
      below: 0,
      above: 0,
      indexMode: "automatic",
      lineupBasis: basis,
    };
  }
  function saveLeg(chain: TradeChain, step: 1 | 2) {
    if (stale || !save) return;
    try {
      const leg = step === 1 ? chain.first : chain.second;
      const { model } = legContext(chain, step);
      if (
        save(leg.draft, summaryFromSearch(leg.row), legQuery(leg), model) !==
        false
      )
        setSaved((previous) => [...previous, `${chain.key}:${step}`]);
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Could not save this step.",
      );
    }
  }
  function inspect(chain: TradeChain, step: 1 | 2) {
    const key = `${chain.key}:${step}`;
    if (stale || details[key]) return;
    try {
      const leg = step === 1 ? chain.first : chain.second;
      const { model, plans } = legContext(chain, step);
      const detail = searchLineupDetails(model, legQuery(leg), leg.row, plans);
      setDetails((previous) => ({ ...previous, [key]: detail }));
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Could not inspect this step.",
      );
    }
  }

  // All new controls reuse existing styles and unobtrusive hover help, including editable ranges and optional per-step team scopes.
  const number = (
    label: string,
    value: string,
    change: (value: string) => void,
    minimum: number,
  ) => (
    <FilterHelp
      label={label}
      help="Adjustable search preference in model Expected points per remaining fantasy week; not a historically validated threshold."
    >
      <label className="control">
        <span>{label}</span>
        <input
          type="number"
          step="0.1"
          min={minimum}
          value={value}
          onChange={(e) => change(e.target.value)}
        />
      </label>
    </FilterHelp>
  );
  const stepControls = (
    label: string,
    value: ChainQuery["first"],
    change: (value: ChainQuery["first"]) => void,
  ) => (
    <fieldset className="trade-search-group">
      <legend>{label}</legend>
      <div className="trade-search-controls">
        {(["offer", "receive"] as const).map((direction) => (
          <div key={direction}>
            {(["minimum", "maximum"] as const).map((bound) => (
              <label className="control" key={bound}>
                <span>
                  {label} {direction} {bound}
                </span>
                <select
                  value={value[direction][bound]}
                  onChange={(e) =>
                    change({
                      ...value,
                      [direction]: {
                        ...value[direction],
                        [bound]: Number(e.target.value),
                      },
                    })
                  }
                >
                  {[1, 2, 3, 4, 5].map((count) => (
                    <option key={count}>{count}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ))}
        <details>
          <summary>
            {label} teams (
            {value.teams === undefined ? "all" : value.teams.length})
          </summary>
          <div className="button-row">
            <button
              className="subtle"
              onClick={() => change({ ...value, teams: undefined })}
            >
              Select all
            </button>
            <button
              className="subtle"
              onClick={() => change({ ...value, teams: [] })}
            >
              Clear selection
            </button>
          </div>
          {opponents.map((t) => {
            const id = str(t.TeamID);
            return (
              <label className="check" key={id}>
                <input
                  type="checkbox"
                  aria-label={`${label} team: ${str(t.TeamName)}`}
                  checked={
                    value.teams === undefined || value.teams.includes(id)
                  }
                  onChange={(e) => {
                    const selected =
                      value.teams ?? opponents.map((t) => str(t.TeamID));
                    change({
                      ...value,
                      teams: e.target.checked
                        ? [...selected, id]
                        : selected.filter((team) => team !== id),
                    });
                  }}
                />
                {str(t.TeamName)}
              </label>
            );
          })}
        </details>
      </div>
    </fieldset>
  );

  // Display both counterparties' actual before/after totals and weekly player replacements; a passing price test never implies acceptance.
  const renderLeg = (chain: TradeChain, step: 1 | 2) => {
    const leg = step === 1 ? chain.first : chain.second;
    const row = leg.row,
      key = `${chain.key}:${step}`,
      detail = details[key];
    return (
      <div key={step} className="trade-search-group">
        <h4>
          Step {step} · {teamName(leg.draft.teamB)}
        </h4>
        <p>
          Offer: {names(leg.draft.give)}. Receive: {names(leg.draft.get)}.
        </p>
        {step === 2 && (
          <p className="muted">
            Requires step one to be completed first; saved with that roster
            prerequisite.
          </p>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Team</th>
                <th>Before EPPG</th>
                <th>After EPPG</th>
                <th>Gain/week</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{teamName(team)}</td>
                <td className="model">{fmt(row.ownBefore ?? null)}</td>
                <td className="model">{fmt(row.ownAfter ?? null)}</td>
                <td className="model">{signed(row.own)}</td>
              </tr>
              <tr>
                <td>{teamName(leg.draft.teamB)}</td>
                <td className="model">{fmt(row.otherBefore ?? null)}</td>
                <td className="model">{fmt(row.otherAfter ?? null)}</td>
                <td className="model">{signed(row.other)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {row.other !== null && row.other < 0 && (
          <p className="notice warning">
            Acceptance concern: this team loses {fmt(-row.other)} EPPG.
          </p>
        )}
        <p>
          Surplus: <Signal text={row.surplus} /> Points:{" "}
          <Signal text={row.points} /> · Legal modeled rosters.
        </p>
        <p>
          Your required drops: {names(row.dropsA)}. Their required drops:{" "}
          {names(row.dropsB)}.
        </p>
        <details
          onToggle={(e) => {
            if (e.currentTarget.open) inspect(chain, step);
          }}
        >
          <summary>Step {step} lineup replacements and warnings</summary>
          {detail &&
            (["own", "other"] as const).map((side) => (
              <div key={side}>
                <strong>
                  {side === "own" ? "Your" : "Their"} weekly replacements
                </strong>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Week / role</th>
                        <th>Before</th>
                        <th>After</th>
                        <th>Gain</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail[side].weekly.flatMap((week) =>
                        week.changes.map((change, i) => (
                          <tr key={`${week.week}:${i}`}>
                            <td>
                              {week.week} · {change.slot}
                            </td>
                            <td>
                              {names(change.before ? [change.before] : [])}
                            </td>
                            <td>{names(change.after ? [change.after] : [])}</td>
                            <td className="model">
                              {change.gain === null
                                ? "Unavailable"
                                : signed(change.gain)}
                            </td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          {row.warnings.length ? (
            row.warnings.map((warning) => (
              <p className="notice warning" key={warning}>
                {warning}
              </p>
            ))
          ) : (
            <p>No additional model warnings.</p>
          )}
        </details>
        {save && (
          <button
            className="button primary"
            disabled={stale || saved.includes(key)}
            onClick={() => saveLeg(chain, step)}
          >
            <Bookmark size={16} aria-hidden="true" />
            {saved.includes(key) ? `Step ${step} saved` : `Save step ${step}`}
          </button>
        )}
      </div>
    );
  };

  return (
    <Panel
      title="Two-trade chain planner"
      note={`Scoring basis: ${lineupBasisLabel(basis)}. Uses the tradable pool above; ordinary single-trade filters are separate.`}
    >
      <details>
        <summary>Plan two trades</summary>
        <p>
          Tradable pool: {names(pool)}. Other original roster players stay
          protected. Newly acquired players may also be offered in step two.
        </p>
        <div className="trade-search-controls">
          <FilterHelp
            label="Chain mode"
            help="Safe requires a positive first-step EPPG gain and both price tests passing. Speculative allows a flat or losing first step within your temporary-loss limit. Both price tests must pass on both steps. Neither label guarantees acceptance."
          >
            <label className="control">
              <span>Chain mode</span>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as ChainQuery["mode"])}
              >
                <option value="both">Safe and speculative</option>
                <option value="safe">Safe only</option>
                <option value="speculative">Speculative only</option>
              </select>
            </label>
          </FilterHelp>
          {number("Maximum temporary loss (EPPG)", loss, setLoss, 0)}
          {number("Minimum final gain (EPPG)", gain, setGain, 0.1)}
          <FilterHelp
            label="Chain search depth"
            help="Standard and deeper searches use explicit work budgets and shortlist first trades by intermediate EPPG gain, keeping separate safe/speculative candidates. Deeper examines more candidates; neither guarantees the best chain or exhaustive coverage."
          >
            <label className="control">
              <span>Chain search depth</span>
              <select
                value={depth}
                onChange={(e) =>
                  setDepth(e.target.value as ChainQuery["depth"])
                }
              >
                <option value="standard">Standard</option>
                <option value="deeper">Deeper</option>
              </select>
            </label>
          </FilterHelp>
        </div>
        {stepControls("First trade", first, setFirst)}
        {stepControls("Second trade", second, setSecond)}
        {errors.map((error) => (
          <p className="notice warning" key={error}>
            {error}
          </p>
        ))}
        <div className="button-row">
          <button
            className="button primary"
            disabled={!!errors.length || job?.status === "running"}
            onClick={search}
          >
            {job?.status === "running" ? (
              <LoaderCircle size={16} aria-hidden="true" />
            ) : null}
            Search trade chains
          </button>
          {job?.status === "running" && (
            <button
              className="button"
              onClick={() => {
                active.current?.terminate();
                active.current = null;
                setJob((previous) =>
                  previous ? { ...previous, status: "cancelled" } : previous,
                );
              }}
            >
              Cancel chain search
            </button>
          )}
          <button
            className="subtle"
            onClick={() => {
              active.current?.terminate();
              active.current = null;
              setJob(null);
              setMode("both");
              setLoss("3");
              setGain("5");
              setFirst({
                offer: { minimum: 1, maximum: 3 },
                receive: { minimum: 1, maximum: 3 },
              });
              setSecond({
                offer: { minimum: 1, maximum: 3 },
                receive: { minimum: 1, maximum: 3 },
              });
              setDepth("standard");
            }}
          >
            Clear chain filters
          </button>
        </div>
        {job?.status === "running" && (
          <p className="notice" role="status">
            {job.stats?.phase ?? "Starting chain search"} ·{" "}
            {job.stats?.evaluated ?? 0} trades evaluated ·{" "}
            {job.stats?.firstExplored ?? 0} first steps explored.
          </p>
        )}
        {job?.status === "cancelled" && (
          <p role="status">
            Chain search cancelled. No roster changes were applied.
          </p>
        )}
        {stale && (
          <p className="notice warning">
            Chain results are stale. Search again with the current roster and
            controls.
          </p>
        )}
        {job?.error && <p className="notice warning">{job.error}</p>}
        {detailError && <p role="status">{detailError}</p>}
        {job?.result && (
          <>
            <p role="status">
              {job.result.stats.found} qualifying chains found; showing the best{" "}
              {job.result.chains.length} within the explored candidates.{" "}
              {job.result.stats.evaluated} trades evaluated in{" "}
              {fmt((job.elapsed ?? 0) / 1000)} seconds.
            </p>
            <p className="notice warning">
              {job.result.stats.limited
                ? "Search budget or shortlist limit reached: coverage is incomplete."
                : "All combinations within these selected sizes and teams were examined."}{" "}
              Results are modeled possibilities, not agreed trades. Opponent
              losses are allowed and flagged. No automatic waiver additions.
            </p>
            {!job.result.chains.length && (
              <p>
                No qualifying chains found in this search. This does not prove
                none exist; try deeper search, broader sizes/teams, or a lower
                final-gain minimum.
              </p>
            )}
            <details>
              <summary>Chain search exclusions</summary>
              <p>
                Price failures: {job.result.stats.rejectedValue}.
                Roster/protection failures: {job.result.stats.rejectedRoster}.
                Scoring/mode/gain failures: {job.result.stats.rejectedGain}.
                Eligible first trades: {job.result.stats.firstEligible};
                explored: {job.result.stats.firstExplored}.
              </p>
            </details>
            {job.result.chains.map((chain, i) => (
              <article className="trade-search-group" key={chain.key}>
                <h3>
                  Chain {i + 1} ·{" "}
                  {chain.mode === "safe" ? "Safe" : "Speculative"} ·{" "}
                  <span className="model">
                    {signed(chain.gain)} EPPG overall
                  </span>
                  {(chain.first.row.warnings.length > 0 ||
                    chain.second.row.warnings.length > 0) && (
                    <Signal text="CONDITIONAL" />
                  )}
                </h3>
                <p className="model">
                  Your roster: {fmt(chain.before)} → {fmt(chain.intermediate)} →{" "}
                  {fmt(chain.after)} EPPG.
                </p>
                <p>
                  {chain.mode === "safe"
                    ? "First trade improves scoring even if the follow-up never happens."
                    : `If the follow-up fails, step one leaves you at ${fmt(chain.intermediate)} EPPG (${signed(chain.first.row.own)}).`}
                </p>
                <p>
                  {chain.second.draft.give.some((id) =>
                    chain.first.draft.get.includes(id),
                  ) ? (
                    <>
                      Newly acquired players reoffered:{" "}
                      {names(
                        chain.second.draft.give.filter((id) =>
                          chain.first.draft.get.includes(id),
                        ),
                      )}
                      .
                    </>
                  ) : (
                    "Step two uses existing tradable players; the trades need not depend on one another."
                  )}
                </p>
                {renderLeg(chain, 1)}
                {renderLeg(chain, 2)}
              </article>
            ))}
          </>
        )}
      </details>
    </Panel>
  );
}
