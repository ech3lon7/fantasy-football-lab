import {
  TradePortrait,
  TradeScoreStrip,
  TradeLineupField,
  TradeFiltersButton,
  TradeFiltersDrawer,
  type TradeWorkspaceMode,
  type TradeWorkspacePreview,
} from "./TradeWorkspace";
import { DirectManagerAssessment } from "./Negotiations";
import { FilterHelp } from "../ui/FilterHelp";
import {
  lineupBases,
  lineupBasisKey,
  readLineupBasis,
  lineupBasisLabel,
  tradeImpact,
  type LineupBasis,
} from "../domain/trade-impact";
// Keep optional next-refresh assumptions consistent with the player inspection card.
import {
  sourceDataset,
  scenarioTradeErrors,
  readRosterScenarios,
  rosterScenariosKey,
  type RosterScenario,
  type RosterSaveSlot,
} from "../domain/roster-scenarios";
import { chainPositionImpact } from "../domain/chain-position-impact";
// Performance momentum and dual moving average stock trends
import { Bookmark } from "lucide-react";
// Prospective tracking is an isolated read-only audit, not another input to the valuation model.
import { GemTracking } from "./GemTracking";
import type { GemTrackingState } from "../domain/gem-tracking";
// Label audit is read-only metadata; it cannot change the current model, filters or stored settings.
import { historicalLabelAudit } from "../domain/historical-label-reference";
import { effectiveLabelRules } from "../domain/label-rules";
// Trade discovery delegates scoring to its own worker without changing the existing analyzer.
import { TradeSearch } from "./TradeSearch";
import { SavedTrades } from "./SavedTrades";
// The optional manual scenario stays separate from normal valuation and all search controls.
import { TradeStressTest } from "./TradeStressTest";
import type { StressRecipe } from "../domain/trade-stress";
import {
  saveTrade,
  summaryFromTrade,
  savedLineupBasis,
  type SavedTrade,
  type SavedTradeSummary,
} from "../domain/saved-trades";
import type { TradeSearchQuery } from "../domain/trade-search";
import type { AppState } from "../domain/contracts";
import { starterLineupsKey } from "../domain/starter-lineups";
import { useState, useEffect, useMemo } from "react";
import { Upload, ArrowLeftRight, CheckCircle2, X } from "lucide-react";
import {
  str,
  tableNames,
  settingsSchema,
  type Settings,
  type Draft,
  type Workspace,
} from "../domain/contracts";
import type { Model } from "../domain/valuation";
import { evidenceKey, roleScenarioKey } from "../domain/opportunity";
// The screener consumes existing model outputs through one shared filter contract.
import {
  lineup,
  irAssignments,
  available,
  type PositionGrade,
} from "../domain/lineups";
import type { TradeResult } from "../domain/trades";
import type { cloudClient, CloudConfig } from "../sync/client";
import {
  Metric,
  Signal,
  DataTable,
  playerColumns,
  extendedColumns,
  fmt,
  signed,
  pct,
} from "../ui/components";
import { Panel, Select, TeamsOptions } from "../ui/layout";
import { PlayerName } from "../ui/PlayerName";
function GradeGrid({ rows }: { rows: PositionGrade[] }) {
  return (
    <div className="grade-grid">
      {rows.map((r) => (
        <div className="grade-card" key={r.position}>
          <span>{r.position}</span>
          <strong>{r.grade}</strong>
          <small>{r.balance}</small>
          <div className="mini-track">
            <i
              style={{
                width: `${Math.max(5, Math.min(100, 50 + (r.versus ?? -0.5) * 100))}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
export function TeamView({
  m,
  grades,
  team,
  change,
}: {
  m: Model;
  grades: Map<string, PositionGrade[]>;
  team: string;
  change: (v: string) => void;
}) {
  const [all, setAll] = useState(false);
  return (
    <>
      <div className="toolbar">
        <Select label="Team" value={team} change={change}>
          <TeamsOptions d={m.dataset} />
        </Select>
        <FilterHelp label={"All evaluation fields"}>
          <label className="check">
            <input
              type="checkbox"
              checked={all}
              onChange={(e) => setAll(e.target.checked)}
            />{" "}
            All evaluation fields
          </label>
        </FilterHelp>
      </div>
      <Panel
        title="Position grades and roster advice"
        note="Grades use modeled starter Value PPG per slot versus the fantasy-league median."
      >
        <GradeGrid rows={grades.get(team) ?? []} />
        <DataTable
          rows={grades.get(team) ?? []}
          id={(r) => r.position}
          columns={[
            { key: "pos", label: "Position", value: (r) => r.position },
            {
              key: "grade",
              label: "Grade",
              kind: "model",
              value: (r) => r.grade,
            },
            {
              key: "value",
              label: "Starter Value PPG",
              kind: "model",
              value: (r) => r.starterValue,
            },
            {
              key: "median",
              label: "League median",
              kind: "model",
              value: (r) => r.median,
            },
            {
              key: "vs",
              label: "Versus median",
              kind: "model",
              value: (r) => r.versus,
              render: (r) => pct(r.versus),
            },
            {
              key: "coverage",
              label: "Coverage",
              kind: "model",
              value: (r) => r.coverage,
              render: (r) => pct(r.coverage),
            },
            {
              key: "reserves",
              label: "Useful reserves",
              value: (r) => r.reserves.map((p) => p.name).join(", ") || "None",
              // Reserve names share the same quick inspection as the main roster.
              render: (r) =>
                r.reserves.length
                  ? r.reserves.map((p, i) => (
                      <span key={p.id}>
                        {i > 0 && ", "}
                        <PlayerName p={p} />
                      </span>
                    ))
                  : "None",
            },
            {
              key: "advice",
              label: "Advice / status",
              value: (r) => `${r.advice} ${r.status}`,
            },
          ]}
        />
      </Panel>
      <Panel
        title="Entire roster"
        note="Buy-low/sell-high and gem signals are separate from the surplus index."
      >
        <DataTable
          rows={m.players.filter((p) => p.owner === team)}
          columns={all ? extendedColumns : playerColumns}
          id={(p) => p.id}
          initialSort="index"
        />
      </Panel>
    </>
  );
}
export function TradeView({
  m: baseModel,
  draft: baseDraft,
  change: commitDraft,
  lineupsRaw: basePlans,
  state,
  saveTrades,
  restoreScenario,
  forceTrade,
  changeBasis,
  saveSearchSettings,
  saveManagerSettings,
  initialMode = "standard",
}: {
  // The tool shown first; the Gameday Plus Trade room chooses it from its own tabs.
  initialMode?: TradeWorkspaceMode;
  m: Model;
  draft: Draft;
  change: (d: Draft) => void;
  lineupsRaw?: string;
  state: AppState;
  saveTrades: (raw: string) => void;
  restoreScenario?: (scenario?: RosterScenario) => boolean;
  forceTrade?: (
    draft: Draft,
  ) => { ok: boolean; slot?: RosterSaveSlot } | boolean;
  changeBasis: (basis: LineupBasis) => void;
  saveSearchSettings: (raw: string) => void;
  saveManagerSettings: (raw: string) => void;
}) {
  // Inspection is a read-only view of a captured offer; only explicit editing/loading commits a new search draft.
  const [preview, setPreview] = useState<TradeWorkspacePreview>();
  // The active finder portals its own visual pool beside the existing player cards without sharing query state.
  const [poolHost, setPoolHost] = useState<HTMLDivElement | null>(null);
  // Follow-up search previews an exchange instead of committing it to the user's hypothetical roster.
  const [followupRequest, setFollowupRequest] = useState<{
    id: string;
    draft: Draft;
  }>();
  const [workspaceMode, setWorkspaceMode] =
    useState<TradeWorkspaceMode>(initialMode);
  const [manualFilters, setManualFilters] = useState(false),
    [analysisOpen, setAnalysisOpen] = useState(false),
    [savedOpen, setSavedOpen] = useState(false);
  const m = preview?.model ?? baseModel,
    draft = preview?.draft ?? baseDraft,
    lineupsRaw = preview ? preview.plans : basePlans;
  const change = (next: Draft) => {
    setPreview(undefined);
    commitDraft(next);
  };
  useEffect(() => {
    setPreview(undefined);
  }, [
    baseModel.dataset.hash,
    baseModel.analysisVersion,
    basePlans,
    JSON.stringify(baseModel.settings),
  ]);
  // The manual analyzer and standard finder retain this preference; the chain planner owns a separate choice.
  const lineupBasis =
    preview?.basis ?? readLineupBasis(state.filters[lineupBasisKey]);
  // Scope last-run assumptions to the displayed package; saved loads remount the editor even for the same trade.
  const stressKey = JSON.stringify(draft);
  const [stressState, setStressState] = useState<{
    key: string;
    recipe?: StressRecipe;
    restore: number;
  }>({ key: "", restore: 0 });
  const stressRecipe =
    stressState.key === stressKey ? stressState.recipe : undefined;
  const [result, setResult] = useState<TradeResult | null>(null),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [searchA, setSearchA] = useState(""),
    [searchB, setSearchB] = useState("");
  // Retain only the query being edited; completed search rows are saved solely by explicit user action.
  const [searchQuery, setSearchQuery] = useState<TradeSearchQuery>();
  const [restoreSearch, setRestoreSearch] = useState<{
    id: string;
    query: TradeSearchQuery;
  }>();
  const [saveMessage, setSaveMessage] = useState("");
  // Keep an applied-trade receipt separate from save/evaluation messages that reset when the consumed draft is cleared.
  const [forceMessage, setForceMessage] = useState("");
  // Auto-dismiss the applied hypothetical trade notification after 2.5 seconds
  useEffect(() => {
    if (!forceMessage) return;
    const timer = setTimeout(() => setForceMessage(""), 2500);
    return () => clearTimeout(timer);
  }, [forceMessage]);
  const [resultStamp, setResultStamp] = useState("");
  const evaluationStamp = JSON.stringify([
    m.dataset.hash,
    m.analysisVersion,
    m.settings,
    draft,
    m.evidenceRaw,
    m.roleScenarioWeight,
    lineupsRaw,
  ]);
  useEffect(() => {
    const worker = new Worker(
        new URL("../workers/model.worker.ts", import.meta.url),
        { type: "module" },
      ),
      id = crypto.randomUUID();
    setPending(true);
    setResult(null);
    // A previous save confirmation must not label a newly edited draft as already saved.
    setSaveMessage("");
    worker.onmessage = (e) => {
      if (e.data.id !== id) return;
      if (e.data.error) setMessage(e.data.error);
      else {
        setResult(e.data.result);
        setResultStamp(evaluationStamp);
        setMessage("");
      }
      setPending(false);
    };
    worker.onerror = () => {
      setMessage("Trade calculation failed.");
      setPending(false);
    };
    worker.postMessage({
      id,
      type: "trade",
      dataset: sourceDataset(m),
      scenario: m.simulation?.scenario,
      settings: m.settings,
      draft,
      // The trade worker uses the same supplemental sources and return scenarios as the player screens.
      filters: {
        [evidenceKey]: m.evidenceRaw,
        [roleScenarioKey]: String(m.roleScenarioWeight),
        [starterLineupsKey]: lineupsRaw ?? "",
      },
    });
    return () => worker.terminate();
  }, [
    m.dataset.hash,
    m.analysisVersion,
    JSON.stringify(m.settings),
    JSON.stringify(draft),
    m.evidenceRaw,
    m.roleScenarioWeight,
    lineupsRaw,
  ]);
  // Both save entry points share ownership validation, duplicate handling and workspace-size checks.
  function saveSelection(
    selected: Draft,
    summary: SavedTradeSummary,
    query?: TradeSearchQuery,
    // A chain's second leg saves its prerequisite roster recipe without applying it to the current workspace.
    context: Model = m,
    stressTest?: StressRecipe | null,
  ) {
    try {
      saveTrades(
        saveTrade(
          state,
          context,
          selected,
          summary,
          query,
          undefined,
          stressTest,
        ),
      );
      setSaveMessage(
        "Trade saved. Duplicate packages update the existing entry while preserving its name, notes and original summary.",
      );
      return true;
    } catch (error) {
      setSaveMessage(
        error instanceof Error ? error.message : "Could not save trade.",
      );
      return false;
    }
  }
  // Loading is an explicit draft replacement; newer data/settings continue to determine current results.
  function loadSaved(trade: SavedTrade) {
    setWorkspaceMode(trade.query ? "standard" : null);
    // Storage or recipe failures must not load a draft against the wrong roster context.
    if (restoreScenario?.(trade.scenario) === false) return;
    change(trade.draft);
    setStressState((prior) => ({
      key: JSON.stringify(trade.draft),
      recipe: trade.stressTest,
      restore: prior.restore + 1,
    }));
    changeBasis(savedLineupBasis(trade));
    if (trade.query)
      setRestoreSearch({
        id: crypto.randomUUID(),
        query: { ...trade.query, lineupBasis: savedLineupBasis(trade) },
      });
    setSaveMessage("Saved trade loaded into the analyzer.");
  }
  function side(isA: boolean) {
    const team = isA ? draft.teamA : draft.teamB,
      ids = isA ? draft.give : draft.get,
      search = isA ? searchA : searchB,
      setSearch = isA ? setSearchA : setSearchB,
      choose = (next: string[]) =>
        change({ ...draft, [isA ? "give" : "get"]: next });
    return (
      <div className="trade-side">
        <div className="eyebrow">
          {isA
            ? `You offer · ${ids.length} players`
            : `You receive · ${ids.length} players`}
        </div>
        <Select
          label={isA ? "Your team" : "Other team"}
          value={team}
          change={(v) =>
            change({
              ...draft,
              [isA ? "teamA" : "teamB"]: v,
              [isA ? "give" : "get"]: [],
            })
          }
        >
          <TeamsOptions d={m.dataset} />
        </Select>
        {/* Roster-search help follows the same compact treatment as the other player filters. */}
        <details className="trade-roster-search">
          <summary>Find a player</summary>
          <FilterHelp label="Search this roster">
            <label className="control">
              <span>Search this roster</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter player names…"
              />
            </label>
          </FilterHelp>
        </details>
        {/* Native options stay selectable; each chosen player gets a separate clickable name. */}
        {Array.from({ length: 5 }, (_, i) => (
          <div
            className={`trade-player-slot${ids[i] ? " has-player" : ""}`}
            key={i}
            hidden={i > ids.length}
          >
            {m.byId.get(ids[i]) && (
              <TradePortrait key={ids[i]} player={m.byId.get(ids[i])!} />
            )}
            <div className="trade-select-row">
              <span>{i + 1}</span>
              <select
                aria-label={`${isA ? "Outgoing" : "Incoming"} player ${i + 1}`}
                value={ids[i] ?? ""}
                onChange={(e) => {
                  const next = [...ids];
                  next[i] = e.target.value;
                  choose(next.filter(Boolean));
                }}
              >
                <option value="">Choose player</option>
                {m.players
                  .filter(
                    (p) =>
                      p.owner === team &&
                      (p.name.toLowerCase().includes(search.toLowerCase()) ||
                        ids.includes(p.id)),
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.pos} · {fmt(p.index)} index
                    </option>
                  ))}
              </select>
              {ids[i] && (
                <button
                  className="subtle"
                  aria-label={`Remove ${m.byId.get(ids[i])?.name ?? ids[i]}`}
                  onClick={() => choose(ids.filter((_, j) => j !== i))}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            {m.byId.get(ids[i]) && (
              <div className="trade-selected-player">
                <PlayerName p={m.byId.get(ids[i])!} />
                <small>
                  {m.byId.get(ids[i])!.pos} · {m.byId.get(ids[i])!.nfl}
                </small>
                <strong className="model">
                  {fmt(m.byId.get(ids[i])!.expected)}{" "}
                  <small>Expected PPG</small>
                </strong>
              </div>
            )}
          </div>
        ))}
        {/* Players are selected by name above; internal IDs are never an input. */}
      </div>
    );
  }
  const r = result?.valid && resultStamp === evaluationStamp ? result : null,
    primary = r ? tradeImpact(r, lineupBasis)! : null,
    // Calculate positional grade transitions for both teams from the valid trade evaluation result
    posImpact = useMemo(
      () => (r && r.valid ? chainPositionImpact(m, draft, r) : undefined),
      [
        m,
        draft.teamA,
        draft.teamB,
        draft.give.join(","),
        draft.get.join(","),
        r,
      ],
    ),
    alternative = r
      ? tradeImpact(
          r,
          lineupBasis === "best-available"
            ? "marked-starters"
            : "best-available",
        )!
      : null,
    tone =
      r?.advantage == null
        ? r && r.outgoing === 0 && r.incoming > 0
          ? "good"
          : "neutral"
        : r.advantage > 0
          ? "good"
          : r.advantage === 0
            ? "neutral"
            : r.advantage > -m.settings.BadLossPct
              ? "orange"
              : "bad",
    bar = r?.advantage ?? (r && r.outgoing === 0 && r.incoming > 0 ? 1 : 0),
    names = (ids: string[]) =>
      // Transaction suggestions can be inspected without navigating away from the draft.
      ids.length
        ? ids.map((id, i) => (
            <span key={`${id}-${i}`}>
              {i > 0 && ", "}
              {m.byId.get(id) ? <PlayerName p={m.byId.get(id)!} /> : id}
            </span>
          ))
        : "None";
  return (
    <div className="trade-workspace">
      <div className="trade-workspace-toolbar">
        <div className="trade-mode-tabs" aria-label="Trade tool">
          <button
            type="button"
            aria-pressed={workspaceMode === null}
            onClick={() => {
              setWorkspaceMode(null);
              setPreview(undefined);
            }}
          >
            Manual analyzer
          </button>
          <button
            type="button"
            aria-label="Find matching trades"
            aria-expanded={workspaceMode === "standard"}
            aria-pressed={workspaceMode === "standard"}
            onClick={() => {
              setWorkspaceMode("standard");
              setPreview(undefined);
            }}
          >
            Find trades
          </button>
          <button
            type="button"
            aria-label="Two-trade chain planner"
            aria-expanded={workspaceMode === "chain"}
            aria-pressed={workspaceMode === "chain"}
            onClick={() => {
              setWorkspaceMode("chain");
              setPreview(undefined);
            }}
          >
            Chain planner
          </button>
        </div>
        <div className="trade-workspace-tools">
          <button
            type="button"
            className="subtle"
            aria-expanded={analysisOpen}
            onClick={() => {
              setAnalysisOpen((open) => !open);
              requestAnimationFrame(() =>
                document
                  .querySelector(".trade-full-analysis")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" }),
              );
            }}
          >
            Full trade analysis
          </button>
          <button
            type="button"
            className="subtle"
            aria-expanded={savedOpen}
            onClick={() => {
              setSavedOpen((open) => !open);
              requestAnimationFrame(() =>
                document
                  .querySelector(".trade-saved-drawer")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" }),
              );
            }}
          >
            Saved trades
          </button>
        </div>
      </div>
      {workspaceMode === "chain" && !preview ? (
        <p className="trade-chain-intro">
          Search a chain, then inspect either step to compare its teams and
          lineups. Each step uses its own before-trade roster.
        </p>
      ) : (
        <TradeScoreStrip
          m={m}
          draft={draft}
          impact={pending || resultStamp !== evaluationStamp ? null : primary}
          pending={pending}
          label={preview?.label}
          dealGrade={r?.grade}
          dealTone={tone}
        />
      )}
      <div className="trade-workspace-grid">
        <div className="trade-workspace-left">
          <div className="trade-workspace-controls">
            <div
              className="trade-workspace-basis"
              hidden={workspaceMode === "chain"}
            >
              {/* This selector changes interpretation only; forecasts, transaction legality and asking-price tests stay independent. */}
              <FilterHelp
                label="Evaluate lineup impact using"
                help="Applies to both teams in the manual analyzer and standard finder, including its filters and ranking. The chain planner has its own independent basis. Best available compares the strongest full rosters before and after. Marked starters uses saved/imported roles; a bench departure costs zero direct starting points. Byes follow the current live or hypothetical policy. Changing basis requires a new search."
              >
                <Select
                  label="Evaluate lineup impact using"
                  value={lineupBasis}
                  change={(value) => {
                    setPreview(undefined);
                    changeBasis(readLineupBasis(value));
                  }}
                >
                  {lineupBases.map((basis) => (
                    <option key={basis} value={basis}>
                      {lineupBasisLabel(basis)}
                      {basis === "best-available" ? " — recommended" : ""}
                    </option>
                  ))}
                </Select>
              </FilterHelp>
              <p className="muted">
                Model Expected points/week · {lineupBasisLabel(lineupBasis)} ·{" "}
                {m.current}–{m.final} ({m.weeks.length} weeks) ·{" "}
                {m.ignoreByeWeeks
                  ? "Byes and temporary injury absences ignored; IR excluded"
                  : "Scheduled bye and availability rules"}
              </p>
            </div>
            {preview && (
              <p className="trade-preview-caption">
                <span>{preview.label}</span>
                <button
                  className="subtle"
                  type="button"
                  onClick={() => setPreview(undefined)}
                >
                  Return to draft
                </button>
              </p>
            )}
          </div>
          {/* Chain configuration stays independent; inspecting a leg never turns its prerequisite into a real draft. */}
          {workspaceMode === "chain" && !preview ? (
            <div ref={setPoolHost} />
          ) : (
            <>
              <fieldset
                className="trade-preview-offer"
                disabled={workspaceMode === "chain"}
              >
                <div className="trade-builder">
                  {side(true)}
                  <div className="trade-swap">
                    <ArrowLeftRight size={23} />
                  </div>
                  {side(false)}
                </div>
              </fieldset>
              {/* Drag/click pool selection leaves the offer photos and lineup field intact. */}
              <div ref={setPoolHost} />
              {/* Forcing records completion regardless of price/lineup verdicts; ownership validation still protects the simulation. */}
              {forceTrade && !preview?.prerequisite && (
                <div className="toolbar">
                  <FilterHelp
                    label="Apply trade to hypothetical roster"
                    help="Assume this trade is completed, regardless of its grade. Updates both simulated teams and future searches as one undoable move. Creates a simulation if needed. Arrivals stay on the bench; no automatic drops or live league transactions occur. Load a search result first to apply that particular package."
                  >
                    <button
                      className="button"
                      disabled={scenarioTradeErrors(m, draft).length > 0}
                      onClick={() => {
                        const exchange = `${draft.give.map((id) => m.byId.get(id)!.name).join(" + ")} ↔ ${draft.get.map((id) => m.byId.get(id)!.name).join(" + ")}`;
                        const res = forceTrade(draft);
                        if (res) {
                          // Determine the targeted slot from the operation result or active state configuration
                          const activeSlot =
                            typeof res === "object" && res.slot
                              ? res.slot
                              : (readRosterScenarios(
                                  state.filters[rosterScenariosKey],
                                ).collection.activeSlot ?? 1);
                          setForceMessage(
                            `Applied hypothetical trade: ${exchange}. Saved to Slot ${activeSlot}.`,
                          );
                        }
                      }}
                    >
                      Apply trade to hypothetical roster
                    </button>
                  </FilterHelp>
                </div>
              )}
              {forceMessage && (
                <p role="status" className="notice trade-toast">
                  {forceMessage}
                </p>
              )}
              <TradeLineupField
                m={m}
                draft={draft}
                impact={
                  pending || resultStamp !== evaluationStamp ? null : primary
                }
                basis={lineupBasis}
                plans={lineupsRaw}
                pending={pending}
                positionImpact={posImpact}
                // Captured search results cannot edit the live pool until explicitly loaded.
                poolScope={
                  !preview && workspaceMode === "standard"
                    ? "Standard"
                    : undefined
                }
              />
              {/* A completed manual offer exposes sensitivity without opening or changing finder filters. */}
              {r && (
                <TradeStressTest
                  key={`${stressKey}:${stressState.restore}`}
                  m={m}
                  draft={draft}
                  plans={lineupsRaw}
                  initial={stressRecipe}
                  change={(recipe) => {
                    setStressState((prior) => ({
                      ...prior,
                      key: stressKey,
                      recipe,
                    }));
                    setSaveMessage("");
                  }}
                />
              )}
            </>
          )}
          <div className="trade-workspace-save">
            <div>
              <span>Value exchange</span>
              <strong className="model">{r?.grade ?? "Choose an offer"}</strong>
              {r && r.uncertainty.length > 0 && <Signal text="CONDITIONAL" />}
            </div>
            {/* Keep saving and browsing within the existing analyzer, without adding navigation or changing scoring. */}
            <div className="toolbar">
              <button
                className="button primary"
                aria-label="Save current trade"
                disabled={
                  !r ||
                  pending ||
                  resultStamp !== evaluationStamp ||
                  (workspaceMode === "chain" && !preview)
                }
                onClick={() => {
                  if (r)
                    saveSelection(
                      draft,
                      summaryFromTrade(r, lineupBasis),
                      (preview?.query ?? searchQuery)
                        ? { ...(preview?.query ?? searchQuery)!, lineupBasis }
                        : undefined,
                      m,
                      stressRecipe ?? null,
                    );
                }}
              >
                <Bookmark size={16} aria-hidden="true" />{" "}
                {saveMessage.startsWith("Trade saved.")
                  ? "Saved"
                  : "Save current trade"}
              </button>
            </div>
            {saveMessage && <p aria-live="polite">{saveMessage}</p>}
          </div>
        </div>
        <div className="trade-workspace-right">
          {/* Search preserves the outgoing draft and loads only an explicitly selected counterparty/package. */}
          <TradeSearch
            poolHost={preview ? null : poolHost}
            m={baseModel}
            draft={baseDraft}
            lineupsRaw={basePlans}
            change={change}
            followupRequest={followupRequest}
            workspaceMode={workspaceMode}
            onModeChange={(mode) => {
              setWorkspaceMode(mode);
              setPreview(undefined);
            }}
            onClearPreview={() => setPreview(undefined)}
            onPreview={setPreview}
            lineupBasis={readLineupBasis(state.filters[lineupBasisKey])}
            onLineupBasisChange={changeBasis}
            onQueryChange={setSearchQuery}
            restore={restoreSearch}
            settingsRaw={state.filters.tradeSearchSettings}
            saveSettings={saveSearchSettings}
            save={saveSelection}
          />
          <section
            className="panel trade-manual-panel"
            hidden={workspaceMode !== null}
          >
            <div className="panel-head">
              <h2>Manual trade overview</h2>
              <TradeFiltersButton
                scope="Manual"
                open={manualFilters}
                toggle={() => setManualFilters((open) => !open)}
              />
            </div>
            <div
              className={`trade-finder-layout${manualFilters ? " filters-open" : ""}`}
            >
              <TradeFiltersDrawer
                scope="Manual"
                open={manualFilters}
                close={() => setManualFilters(false)}
              >
                <DirectManagerAssessment
                  m={m}
                  draft={draft}
                  result={resultStamp === evaluationStamp ? result : null}
                  raw={state.filters.managerExpectations}
                  change={saveManagerSettings}
                  basis={lineupBasis}
                  lineupsRaw={lineupsRaw}
                />
              </TradeFiltersDrawer>
              <div className="trade-finder-main">
                <h3>{r?.grade ?? "Build your offer"}</h3>
                <p className="muted">
                  Compare both teams above. Inspect the lineup on the left, then
                  review value, legality and conditions separately.
                </p>
                {r && (
                  <>
                    <div className="trade-compact-tests">
                      <Signal text={`${r.surplusTest} · surplus-value test`} />
                      <Signal text={`${r.pointsTest} · fantasy-points test`} />
                      <Signal
                        text={`${r.legality ? "PASS" : "FAIL"} · roster legality`}
                      />
                    </div>
                    <p>
                      Required drops · Yours: {names(r.dropsA)} · Theirs:{" "}
                      {names(r.dropsB)}
                    </p>
                    {r.uncertainty.length > 0 && (
                      <p className="notice warning">
                        {r.uncertainty.join("; ")}
                      </p>
                    )}
                  </>
                )}
                {pending && (
                  <div className="notice" role="status">
                    Evaluating both rosters and proposed transactions…
                  </div>
                )}
                {message && (
                  <p role="alert" className="notice danger">
                    {message}
                  </p>
                )}
                {result && !result.valid && (
                  <div className="notice">{result.errors.join(" ")}</div>
                )}
                {r && !preview?.prerequisite && (
                  <button
                    className="button"
                    disabled={!r.legality}
                    onClick={() => {
                      setFollowupRequest({
                        id: crypto.randomUUID(),
                        draft: structuredClone(draft),
                      });
                      setWorkspaceMode("chain");
                      setPreview(undefined);
                    }}
                  >
                    Find a follow-up
                  </button>
                )}
                <button
                  type="button"
                  className="button"
                  onClick={() => setAnalysisOpen(true)}
                >
                  Show full trade analysis
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
      <details
        className="trade-full-analysis"
        open={analysisOpen}
        onToggle={(event) => setAnalysisOpen(event.currentTarget.open)}
      >
        <summary>Detailed trade calculations</summary>
        {r && (
          <>
            <Panel
              title="Surplus exchange"
              note="Your perspective. Deal grade excludes the consolidation premium and lineup impact."
            >
              <div className={`deal-heading ${tone}`}>
                <div>
                  <span className="eyebrow">SURPLUS DEAL GRADE</span>
                  <h2>{r.grade}</h2>
                  {r.uncertainty.length > 0 && <Signal text="CONDITIONAL" />}
                </div>
                <strong>
                  {r.advantage === null ? "Percentage n.a." : pct(r.advantage)}
                </strong>
              </div>
              <div className="advantage-labels">
                <span>Favors the other team</span>
                <b>Even</b>
                <span>Favors you</span>
              </div>
              <div
                className={`advantage-bar ${tone}`}
                role="meter"
                aria-label="Surplus advantage"
                aria-valuemin={-100}
                aria-valuemax={100}
                aria-valuenow={Math.round(Math.max(-1, Math.min(1, bar)) * 100)}
                aria-valuetext={
                  r.advantage === null
                    ? r.grade
                    : `${pct(r.advantage)} surplus advantage`
                }
              >
                <i
                  style={{
                    left: bar >= 0 ? "50%" : `${50 + Math.max(-1, bar) * 50}%`,
                    width: `${Math.abs(Math.max(-1, Math.min(1, bar))) * 50}%`,
                  }}
                />
                <b />
              </div>
              <p className="muted">
                Bar caps at ±100%; the percentage and grade remain uncapped. A
                large percentage can represent a small absolute gain.
              </p>
              <div className="metric-grid">
                <Metric
                  label="Outgoing surplus points"
                  value={fmt(r.outgoing)}
                />
                <Metric
                  label="Incoming surplus points"
                  value={fmt(r.incoming)}
                />
                <Metric
                  label="Surplus difference"
                  value={signed(r.difference)}
                />
                <Metric
                  label="Needed to enter fair band"
                  value={fmt(r.neededFair)}
                />
              </div>
            </Panel>
            {/* Primary and alternate summaries are selected in the domain; each keeps its own before/after baseline. */}
            <Panel
              title="Expected team gain per week"
              note={`${lineupBasisLabel(lineupBasis)} · Average model Expected points over Weeks ${m.current}–${m.final}. Required drops included; waiver proposals excluded. ${m.ignoreByeWeeks ? "Byes and temporary injury absences ignored; IR excluded." : "Scheduled bye, injury and IR rules retained."}`}
            >
              <div className="metric-grid two">
                <Metric
                  label="Your gain / week"
                  value={signed(primary!.own.expectedPerWeek)}
                />
                <Metric
                  label="Their gain / week"
                  value={signed(primary!.other.expectedPerWeek)}
                />
              </div>
              {(
                [
                  ["Your", primary!.own],
                  ["Their", primary!.other],
                ] as const
              ).map(([label, impact]) => (
                <div key={label}>
                  <p className="model">
                    <strong>{label} Expected points/week:</strong> Before{" "}
                    {fmt(impact.beforePerWeek)} → After{" "}
                    {fmt(impact.afterPerWeek)} · Gain{" "}
                    {signed(impact.expectedPerWeek)}
                  </p>
                  <p className="muted">{impact.source}</p>
                  {[...impact.errors, ...impact.warnings].map((issue) => (
                    <p className="notice warning" key={issue}>
                      {issue}
                    </p>
                  ))}
                  <details>
                    <summary>
                      {label} weekly lineups · {lineupBasisLabel(lineupBasis)}
                    </summary>
                    {impact.weekly.map((week) => (
                      <div key={week.week}>
                        <p>
                          <strong>Week {week.week}:</strong>{" "}
                          <span className="model">
                            {fmt(week.beforeExpected)} →{" "}
                            {fmt(week.afterExpected)} (
                            {signed(week.expectedGain)})
                          </span>{" "}
                          expected points.
                        </p>
                        <p>
                          Before:{" "}
                          {names(
                            week.beforeIds.filter((id): id is string => !!id),
                          )}
                          . After:{" "}
                          {names(week.ids.filter((id): id is string => !!id))}.
                        </p>
                      </div>
                    ))}
                  </details>
                </div>
              ))}
            </Panel>
            {/* The alternative is explanatory only and cannot silently supply the selected search's numbers. */}
            <details>
              <summary>
                Compare with {lineupBasisLabel(alternative!.basis)}
              </summary>
              <p className="muted">
                This uses a different starting baseline. Its gain cannot be
                added to the primary Before total.
              </p>
              {(
                [
                  ["Your", alternative!.own],
                  ["Their", alternative!.other],
                ] as const
              ).map(([label, impact]) => (
                <Panel
                  key={label}
                  title={`${label} ${alternative!.basis === "marked-starters" ? "direct starter impact" : "best available lineup"}`}
                  note={impact.source}
                >
                  <Metric
                    label="Expected scoring gain / week"
                    value={signed(impact.expectedPerWeek)}
                  />
                  <p className="model">
                    Before {fmt(impact.beforePerWeek)} → After{" "}
                    {fmt(impact.afterPerWeek)} · Gain{" "}
                    {signed(impact.expectedPerWeek)} points/week
                  </p>
                  <p>
                    Existing bench replacements: {names(impact.replacements)}.
                    Modeled incoming starters: {names(impact.promotedIncoming)}.
                  </p>
                  <details>
                    <summary>{label} alternative weekly lineups</summary>
                    {impact.weekly.map((week) => (
                      <div key={week.week}>
                        <p>
                          <strong>Week {week.week}:</strong>{" "}
                          <span className="model">
                            {fmt(week.beforeExpected)} →{" "}
                            {fmt(week.afterExpected)} (
                            {signed(week.expectedGain)})
                          </span>
                        </p>
                        <p>
                          Before:{" "}
                          {names(
                            week.beforeIds.filter((id): id is string => !!id),
                          )}
                          . After:{" "}
                          {names(week.ids.filter((id): id is string => !!id))}.
                        </p>
                      </div>
                    ))}
                  </details>
                  {[...impact.errors, ...impact.warnings].map((issue) => (
                    <p className="notice warning" key={issue}>
                      {issue}
                    </p>
                  ))}
                </Panel>
              ))}
            </details>
            {/* The former all-roster optimization remains separate for hypothetical future backup/bye coverage. */}
            <details>
              <summary>Modeled future coverage impact (includes bench)</summary>
              <Panel
                title="Optimized future lineups and coverage"
                note="Assumes the app can start any available rostered player. This may include a benched QB during a bye; it is separate from your direct starter score."
              >
                <div className="metric-grid">
                  <Metric
                    label="Your modeled coverage gain / week"
                    value={signed(r.a.expectedPerWeek)}
                  />
                  <Metric
                    label="Their modeled coverage gain / week"
                    value={signed(r.b.expectedPerWeek)}
                  />
                  <Metric
                    label="Your downside value gain total"
                    value={signed(r.a.downside)}
                  />
                  <Metric
                    label="Their downside value gain total"
                    value={signed(r.b.downside)}
                  />
                </div>
              </Panel>
            </details>
            {/* Current provider references are kept distinct from model surplus and lineup gains. */}
            <Panel title="Market reference" note={r.market.status}>
              <div className="metric-grid two">
                <Metric
                  label="Outgoing external value"
                  value={fmt(r.market.outgoing)}
                />
                <Metric
                  label="Incoming external value"
                  value={fmt(r.market.incoming)}
                />
              </div>
              <p>
                {r.market.source || "No complete comparable source supplied."}{" "}
                Provider units differ from surplus points. These sums do not
                apply the consolidation premium and do not predict whether a
                manager will accept.
              </p>
            </Panel>
            <Panel
              title="Requirements and conditions"
              note="Package requirements are separate from the deal grade."
            >
              <div className="three-col">
                <div className="requirement">
                  <Signal text={`${r.surplusTest} · surplus-value test`} />
                  <p>
                    Actual {fmt(r.actualSurplus)} / required{" "}
                    {fmt(r.requiredSurplus)} surplus points
                  </p>
                  <strong className="model">
                    Shortfall {fmt(r.surplusShortfall)}
                  </strong>
                </div>
                <div className="requirement">
                  <Signal text={`${r.pointsTest} · fantasy-points test`} />
                  <p>
                    Actual {fmt(r.actualPoints)} / required{" "}
                    {fmt(r.requiredPoints)} adjusted points
                  </p>
                  <strong className="model">
                    Shortfall {fmt(r.pointsShortfall)}
                  </strong>
                </div>
                <div className="requirement">
                  <Signal
                    text={`${r.legality ? "PASS" : "FAIL"} · roster legality`}
                  />
                  <p>
                    {draft.give.length === draft.get.length
                      ? "Equal size: no premium."
                      : `${fmt(m.settings.Premium * 100, 0)}% applied once to the smaller package.`}
                  </p>
                  <p>
                    Drop replacement cost:{" "}
                    <span className="model">{fmt(r.dropCost)} points</span>
                  </p>
                </div>
              </div>
              {r.uncertainty.length > 0 ? (
                <div className="notice warning">
                  CONDITIONAL: {r.uncertainty.join("; ")}.
                </div>
              ) : (
                <p>No flagged uncertainty.</p>
              )}
            </Panel>
            <Panel
              title={`Weekly lineup impact · ${lineupBasisLabel(lineupBasis)}`}
              note={`Same selected basis as search and headline totals: ${lineupBasisLabel(lineupBasis)}. Model Expected points, not ESPN’s weekly forecast.`}
            >
              <DataTable
                rows={primary!.own.weekly.map((w, i) => ({
                  ...w,
                  their: primary!.other.weekly[i].expectedGain,
                }))}
                id={(w) => str(w.week)}
                columns={[
                  {
                    key: "week",
                    label: "Week",
                    kind: "fact",
                    value: (w) => w.week,
                  },
                  {
                    key: "before",
                    label: "Your before expected",
                    kind: "model",
                    value: (w) => w.beforeExpected,
                  },
                  {
                    key: "after",
                    label: "Your after expected",
                    kind: "model",
                    value: (w) => w.afterExpected,
                  },
                  {
                    key: "gain",
                    label: "Your expected gain",
                    kind: "model",
                    value: (w) => w.expectedGain,
                  },
                  {
                    key: "their",
                    label: "Their expected gain",
                    kind: "model",
                    value: (w) => w.their,
                  },
                  {
                    key: "value",
                    label: "Your value gain",
                    kind: "model",
                    value: (w) => w.valueGain,
                  },
                  {
                    key: "unfilled",
                    label: "Your unfilled slots",
                    kind: "model",
                    value: (w) => w.unfilled,
                  },
                ]}
              />
              <details>
                <summary>Inspect your before/after starters</summary>
                {primary!.own.weekly.map((w) => (
                  <p key={w.week}>
                    <b>Week {w.week}:</b>{" "}
                    <span>
                      Before:{" "}
                      {w.beforeIds
                        .map((id) => (id ? m.byId.get(id)?.name : "Unfilled"))
                        .join(" · ")}
                      . After:{" "}
                    </span>
                    {/* Keep every automatically selected incoming upgrade or replacement inspectable. */}
                    {w.ids.map((id, i) => (
                      <span key={i}>
                        {i > 0 && " · "}
                        {w.slots[i]}:{" "}
                        {id && m.byId.get(id) ? (
                          <PlayerName p={m.byId.get(id)!} />
                        ) : (
                          "Unfilled"
                        )}
                      </span>
                    ))}
                  </p>
                ))}
              </details>
            </Panel>
            <Panel
              title="Required changes and optional pickups"
              note="Waiver claims are proposals. Their gains are not attributed to the trade alone."
            >
              <div className="two-col">
                <div>
                  <h3>Your roster</h3>
                  <p>Required drops: {names(r.dropsA)}</p>
                  <p>IR assignments: {names(r.irA)}</p>
                  <p>Proposed waiver adds: {names(r.addsA)}</p>
                  <p>
                    Additional waiver expected gain:{" "}
                    <span className="model">
                      {signed(r.a.waiverExpected)} total points
                    </span>
                  </p>
                </div>
                <div>
                  <h3>Other roster</h3>
                  <p>Required drops: {names(r.dropsB)}</p>
                  <p>IR assignments: {names(r.irB)}</p>
                  <p>Proposed waiver adds: {names(r.addsB)}</p>
                  <p>
                    Additional waiver expected gain:{" "}
                    <span className="model">
                      {signed(r.b.waiverExpected)} total points
                    </span>
                  </p>
                </div>
              </div>
              <details>
                <summary>Counts and current-week backup depth</summary>
                <Depth
                  m={m}
                  before={r.initialA}
                  after={r.legalA}
                  otherBefore={r.initialB}
                  otherAfter={r.legalB}
                />
              </details>
            </Panel>
          </>
        )}
      </details>
      <details
        className="trade-saved-drawer"
        open={savedOpen}
        onToggle={(event) => setSavedOpen(event.currentTarget.open)}
      >
        <summary>Browse saved trades</summary>
        <SavedTrades
          m={baseModel}
          state={state}
          lineupsRaw={basePlans}
          change={saveTrades}
          load={loadSaved}
        />
      </details>
    </div>
  );
}

function Depth({
  m,
  before,
  after,
  otherBefore,
  otherAfter,
}: {
  m: Model;
  before: string[];
  after: string[];
  otherBefore: string[];
  otherAfter: string[];
}) {
  function backups(ids: string[], pos: string) {
    const used = new Set(lineup(m, ids, m.current).ids),
      ir = new Set(irAssignments(m, ids));
    return ids.filter((id) => {
      const p = m.byId.get(id)!;
      return (
        p.pos === pos &&
        available(m, p, m.current) &&
        !used.has(id) &&
        !ir.has(id)
      );
    }).length;
  }
  return (
    <DataTable
      rows={["QB", "RB", "WR", "TE", "K", "D/ST"]}
      id={(x) => x}
      columns={[
        { key: "pos", label: "Position", value: (x) => x },
        {
          key: "yourBefore",
          label: "Your before backups",
          kind: "model",
          value: (x) => backups(before, x),
        },
        {
          key: "yourAfter",
          label: "Your trade backups",
          kind: "model",
          value: (x) => backups(after, x),
        },
        {
          key: "theirBefore",
          label: "Their before backups",
          kind: "model",
          value: (x) => backups(otherBefore, x),
        },
        {
          key: "theirAfter",
          label: "Their trade backups",
          kind: "model",
          value: (x) => backups(otherAfter, x),
        },
      ]}
    />
  );
}
export function ModelView({
  m,
  change,
  tracking = null,
  part,
}: {
  // The Gameday Plus Lab shows the settings and the audits on separate pages; omitted shows everything, as before.
  part?: "settings" | "audits";
  m: Model;
  change: (s: Settings) => void;
  tracking?: Promise<GemTrackingState> | null;
}) {
  const [message, setMessage] = useState("");
  // Build compact method context from aggregate-only evidence and the same effective settings used by classification.
  const labelAudit = historicalLabelAudit(m);
  const labelRules = effectiveLabelRules(m.settings);
  const settingLabels: Record<string, string> = {
    PriorGames: "Prior games for forecast confidence",
    RecentWeight: "Recent PPG weight",
    ConsistencyCoefficient: "Consistency coefficient",
    ConsistencyCap: "Consistency cap",
    MinConsistencyGames: "Minimum games for consistency",
    Premium: "Consolidation premium (0.25–0.35)",
    FairBandPct: "Fair band",
    ExcellentPct: "Excellent begins",
    StealPct: "Steal begins",
    BadLossPct: "Bad loss begins",
    HorribleLossPct: "Horrible loss begins",
  };
  return (
    <>
      {(!part || part === "settings") && (
      <Panel
        title="Model settings"
        note="Provisional assumptions. Changing these recalculates values; it does not change recorded scoring or ESPN projections."
      >
        {message && (
          <p className="notice danger" role="alert">
            {message}
          </p>
        )}
        <div className="settings-grid">
          {Object.entries(m.settings).map(([key, value]) => (
            <label className="control" key={key}>
              <span>
                {settingLabels[key] ?? key.replace(/([A-Z])/g, " $1").trim()}
              </span>
              <input
                type="number"
                step="any"
                value={value}
                onChange={(e) => {
                  const candidate = {
                    ...m.settings,
                    [key]: e.target.valueAsNumber,
                  };
                  const result = settingsSchema.safeParse(candidate);
                  if (result.success) {
                    change(result.data);
                    setMessage("");
                  } else
                    setMessage(
                      `${key}: ${result.error.issues.map((x) => x.message).join("; ")}`,
                    );
                }}
              />
            </label>
          ))}
        </div>
        <p>
          Expected PPG is the scoring forecast. Value PPG adjusts it for
          consistency. Surplus index measures value above available
          replacements.
        </p>
      </Panel>
      )}
      {/* Automatic dated comparisons remain separate from current settings, historical summaries and live labels. */}
      {!part && <GemTracking tracking={tracking} />}
      {(!part || part === "audits") && (
        <>
      {/* Keep research and rule inventories collapsed while preserving the existing settings and baseline workflow. */}
      <Panel title="Player-label evidence" note={labelAudit.version}>
        <p>{labelAudit.status}</p>
        <details>
          <summary>Historical label research</summary>
          <p>{labelAudit.outcome}</p>
          <p>{labelAudit.volume}</p>
          <DataTable
            rows={labelAudit.rows}
            id={(r) => r.id}
            columns={[
              { key: "tag", label: "Label", value: (r) => r.tag },
              { key: "unit", label: "Unit", value: (r) => r.unit },
              {
                key: "sample",
                label: "Successes / labels",
                kind: "fact",
                value: (r) => r.sample,
              },
              {
                key: "rate",
                label: "Historical rate",
                kind: "fact",
                value: (r) => r.rate,
              },
              {
                key: "base",
                label: "Matched base rate",
                kind: "fact",
                value: (r) => r.base,
              },
              {
                key: "lift",
                label: "Lift over base",
                kind: "fact",
                value: (r) => r.lift,
              },
              {
                key: "volume",
                label: "Label volume",
                kind: "fact",
                value: (r) => r.volume,
              },
              {
                key: "followup",
                label: "Missing outcomes",
                value: (r) => r.followup,
              },
              {
                key: "seasons",
                label: "Successes / labels by season",
                value: (r) => r.seasons,
              },
            ]}
          />
          <p>
            <small>{labelAudit.baseline}</small>
          </p>
          <p>{labelAudit.scoring}</p>
          <p>
            <small>{labelAudit.limitations}</small>
          </p>
          {/* Fingerprints are unbroken identifiers; wrap this new audit line so it cannot widen the mobile page. */}
          <p style={{ overflowWrap: "anywhere" }}>
            <small>
              Evidence binding: {labelAudit.binding.researchSHA256}; aggregate:{" "}
              {labelAudit.binding.aggregateSHA256}.
            </small>
          </p>
        </details>
        <details>
          <summary>Active label rules and parameters</summary>
          <p>{labelAudit.policy}</p>
          <DataTable
            rows={labelRules}
            id={(r) => r.id}
            columns={[
              { key: "id", label: "Rule", value: (r) => r.id },
              {
                key: "positions",
                label: "Positions",
                value: (r) => r.positions,
              },
              {
                key: "window",
                label: "Windows / routes",
                value: (r) => r.window,
              },
              {
                key: "parameters",
                label: "Effective parameters",
                kind: "model",
                value: (r) =>
                  r.parameters
                    .map(
                      (p) =>
                        `${p.id}: ${p.operator} ${p.value} ${p.unit} (${p.binding})`,
                    )
                    .join("; "),
              },
              {
                key: "evidence",
                label: "Evidence status",
                value: (r) => r.evidence,
              },
            ]}
          />
        </details>
      </Panel>
      <Panel
        title="Replacement baseline audit"
        note="Mean of the top three eligible available players. Hypothetical trades do not change these pools."
      >
        <DataTable
          rows={m.pools}
          id={(p) => p.position}
          columns={[
            {
              key: "pos",
              label: "Position",
              kind: "fact",
              value: (p) => p.position,
            },
            {
              key: "count",
              label: "Eligible count",
              kind: "model",
              value: (p) => p.eligible,
            },
            {
              key: "used",
              label: "Pool used",
              kind: "model",
              value: (p) => p.candidates.length,
            },
            {
              key: "avg",
              label: "Mean Value PPG",
              kind: "model",
              value: (p) => p.value,
            },
            {
              key: "names",
              label: "Selected candidates",
              value: (p) =>
                p.candidates
                  .map((x) => `${x.name}: ${fmt(x.value)}`)
                  .join("; "),
              // Replacement candidates expose the same stats as rostered players.
              render: (p) =>
                p.candidates.map((x, i) => (
                  <span key={x.id}>
                    {i > 0 && "; "}
                    <PlayerName p={x} />: {fmt(x.value)}
                  </span>
                )),
            },
            { key: "status", label: "Status", value: (p) => p.status },
          ]}
        />
      </Panel>
      <Panel
        title="Source data audit"
        note="Only supported model tables are imported. Connections, credentials and workbook instructions are excluded."
      >
        {m.dataset.issues.map((x, i) => (
          <p key={i} className="warning-text">
            {x}
          </p>
        ))}
        {tableNames.map((name) => (
          <details key={name}>
            <summary>
              {name} · {m.dataset.tables[name].length} records
            </summary>
            <DataTable
              rows={m.dataset.tables[name]}
              id={(r) => JSON.stringify(r)}
              columns={Object.keys(m.dataset.tables[name][0] ?? {})
                .filter((key) => key !== "PlayerID")
                .map((key) => ({
                  key,
                  label: key,
                  value: (r: Record<string, unknown>) => r[key],
                }))}
            />
          </details>
        ))}
      </Panel>
        </>
      )}
    </>
  );
}
export function Account({
  w,
  config,
  email,
  configure,
  client,
  runSync,
  signOut,
  status,
  notify,
  importClick,
  clear,
}: {
  w: Workspace | null;
  config: CloudConfig;
  email: string;
  configure: (c: CloudConfig) => void;
  client: ReturnType<typeof cloudClient>;
  runSync: () => void;
  signOut: () => void;
  status: string;
  notify: (s: string) => void;
  importClick: () => void;
  clear: (cloud: boolean) => void;
}) {
  const [url, setUrl] = useState(config.url),
    [key, setKey] = useState(config.key),
    [login, setLogin] = useState(""),
    [password, setPassword] = useState(""),
    [authBusy, setAuthBusy] = useState(false);
  async function auth(signup = false) {
    if (!client) return;
    setAuthBusy(true);
    try {
      const { error } = signup
        ? await client.auth.signUp({
            email: login,
            password,
            options: {
              emailRedirectTo: location.origin + import.meta.env.BASE_URL,
            },
          })
        : await client.auth.signInWithPassword({ email: login, password });
      if (error) throw error;
      setPassword("");
      notify(
        signup
          ? "Account request submitted. Check your email if confirmation is enabled."
          : "",
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthBusy(false);
    }
  }
  return (
    <>
      <Panel
        title="Current dataset"
        note="Refresh All in Excel, wait, recalculate, save, then import."
      >
        <div className="metric-grid">
          <Metric
            label="Players"
            value={w?.dataset?.tables.ModelPlayers.length ?? "None"}
            kind="fact"
          />
          <Metric
            label="Source refresh"
            value={
              w?.dataset?.sourceUTC
                ? new Date(w.dataset.sourceUTC).toLocaleString()
                : "Unavailable"
            }
            kind="fact"
          />
          <Metric
            label="Imported"
            value={
              w?.dataset
                ? new Date(w.dataset.importedAt).toLocaleString()
                : "Not imported"
            }
            kind="fact"
          />
          <Metric label="Sync" value={status} kind="note" />
        </div>
        <div className="button-row">
          <button className="button primary" onClick={importClick}>
            <Upload size={16} />
            Import / replace
          </button>
          <button className="button" onClick={runSync} disabled={!email || !w}>
            Sync now
          </button>
          <button className="subtle" disabled={!w} onClick={() => clear(false)}>
            Remove from this device
          </button>
          <button
            className="subtle danger-text"
            disabled={!email || !w}
            onClick={() => clear(true)}
          >
            Delete cloud workspace
          </button>
        </div>
        <p>
          The app retains the current extracted dataset, not the Excel file.
          Older offline devices update when they reconnect. Provider backups
          follow your Supabase plan’s retention.
        </p>
      </Panel>
      <Panel
        title="Supabase synchronization"
        note="Uses Trainwise’s Supabase project with separate fantasy storage."
      >
        {!config.url && (
          <div className="notice warning">
            Cloud sync needs your Supabase project and the included database
            migration. Local import and analysis already work.
          </div>
        )}
        <p>
          Sign in with your Trainwise account once this project is configured.
          Fantasy keeps its own login session and workspace. Signing out here
          leaves your Trainwise sessions active.
        </p>
        <details open={!config.url}>
          <summary>Project configuration</summary>
          <p>
            Apply <code>supabase/migrations/001_workspace.sql</code> from this
            app’s repository in your selected project. Never enter a
            secret/service-role key.
          </p>
          <div className="two-col">
            <label className="control">
              <span>Project URL</span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-project.supabase.co"
              />
            </label>
            <label className="control">
              <span>Publishable key</span>
              <input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="sb_publishable_…"
                autoComplete="off"
              />
            </label>
          </div>
          <button
            className="button"
            onClick={() => {
              try {
                configure({ url, key });
              } catch (e) {
                notify(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Save public configuration
          </button>
        </details>
        {email ? (
          <div className="signed-in">
            <CheckCircle2 size={22} />
            <p>
              Signed in as <b>{email}</b>
            </p>
            <button className="button" onClick={signOut}>
              Sign out and clear local account data
            </button>
          </div>
        ) : client ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void auth();
            }}
          >
            <div className="two-col">
              <label className="control">
                <span>Email</span>
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                />
              </label>
              <label className="control">
                <span>Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            </div>
            <div className="button-row">
              <button className="button primary" disabled={authBusy}>
                Sign in
              </button>
              <button
                className="button"
                type="button"
                disabled={authBusy}
                onClick={() => auth(true)}
              >
                Create account
              </button>
              <button
                type="button"
                className="subtle"
                onClick={async () => {
                  if (!login) {
                    notify("Enter your email first.");
                    return;
                  }
                  const { error } = await client.auth.resetPasswordForEmail(
                    login,
                    {
                      redirectTo:
                        location.origin + import.meta.env.BASE_URL + "#/data",
                    },
                  );
                  notify(error?.message ?? "Password reset email requested.");
                }}
              >
                Reset password
              </button>
            </div>
          </form>
        ) : null}
      </Panel>
    </>
  );
}
