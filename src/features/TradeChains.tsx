import {
  TradeFiltersButton,
  TradeFiltersDrawer,
  type TradeWorkspacePreview,
} from "./TradeWorkspace";
import { createPortal } from "react-dom";
import {
  TradeFilterGroup,
  TradePoolBoard,
  TeamNeedsPreview,
  TradePositionChips,
} from "./TradeSearchControls";
import { GroupedChains } from "./TradeResultGroups";
import {
  ManagerControls,
  ManagerEvidence,
  useNegotiations,
} from "./Negotiations";
import { useEffect, useRef, useState } from "react";
import { Bookmark, LoaderCircle } from "lucide-react";
import {
  chainErrors,
  mergeChainResults,
  chainSearchVersion,
  chainPresets,
  applyChainPreset,
  defaultChainFit,
  type ChainFitRule,
  defaultChainRecipient,
  type ChainQuery,
  type ChainResults,
  type ChainStats,
  type TradeChain,
  type ChainLeg,
} from "../domain/trade-chains";
import {
  defaultChainDependency,
  type ChainDependencySettings,
  type ChainDependencyEvidence,
} from "../domain/chain-plausibility";
import {
  applyChainStrictness,
  type ChainDiscovery,
  type ChainStrictness,
} from "../domain/chain-discovery";
import { opponentIncentive } from "../domain/trade-discovery";
import { OpponentIncentiveView } from "./TradeDiscovery";
import { SurfaceAppealView } from "./SurfaceAppeal";
import { withoutLegacySurface } from "../domain/surface-appeal";
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
import { positions, str, type Draft } from "../domain/contracts";
import type { Model } from "../domain/valuation";
import type { ChainRequest } from "../workers/trade-chains.worker";
import { SearchSection } from "../ui/SearchSection";
import { TeamsOptions } from "../ui/layout";
import { positionGradeScale } from "../domain/trade-search";
import { tradeDebugReport } from "../domain/trade-tools";
import { FilterHelp } from "../ui/FilterHelp";
import { DeficitProtectionControls } from "./DeficitProtectionControls";
import { defaultDeficitProtection } from "../domain/trade-safeguards";
import { PlayerName } from "../ui/PlayerName";
import { fmt, signed, Signal } from "../ui/components";

// Chain diagnostics list only independent controls; imported league facts and the selected roster data remain common inputs.
const chainFilterScope = {
  "Independent chain controls": [
    "selected team",
    "scoring basis",
    "tradable pool/protection",
    "first/second opponent teams",
    "package sizes",
    "mode",
    "temporary loss",
    "final gain",
    "recipient limits",
    "price-test policy",
    "search depth",
    "optional surplus/deficit targeting",
    "connected or independent sequence types",
    "materiality for connected chains",
    "scenario and strictness",
    "ranking and final positional/player targets",
    "temporary locked first trade",
    "bounded automatic broadening",
    "per-leg raw index windows",
    "per-leg Surface Trading",
    "per-leg weak-position protection",
  ],
  "Single-trade only": [
    "search goal",
    "standard-finder index range",
    "target player",
    "weekly-gain limits",
    "positional upgrades",
    "usefulness",
    "Gem/Pre-gem/Watch",
    "standard-finder Surface Trading",
    "near misses/recovery",
  ],
};
// Persist only editable preferences, including raw numeric text; results and applied trades remain explicit actions.
export interface ChainPreferences {
  query: ChainQuery;
  controls: {
    loss: string;
    gain: string;
    recipientLoss: string;
    recipientGain: string;
    acquiredShare?: string;
    interactionGain?: string;
  };
  selectedTeams?: string[];
  firstOverride: boolean;
  secondOverride: boolean;
  preset: string;
  strictness?: ChainStrictness;
  customPresets?: {
    id: string;
    name: string;
    query: ChainQuery;
    strictness?: ChainStrictness;
  }[];
}

// The existing debug download receives captured chain controls/results without persisting another workspace or dataset.
export interface ChainDebugReport {
  // Carry build identity through both chain-only and combined debug downloads without changing the app version.
  searchVersion: string;
  appBuild: { build: string; commit: string; builtAt: string };
  currentQuery: ChainQuery;
  appliedSearch: { query: ChainQuery; context: string } | null;
  status: string;
  stale: boolean;
  errors: string[];
  elapsed?: number;
  stats?: ChainStats;
  result?: ChainResults;
  teamScope: {
    selectedTeams?: string[];
    firstOverride: boolean;
    secondOverride: boolean;
  };
  controls: {
    loss: string;
    gain: string;
    recipientLoss: string;
    recipientGain: string;
    acquiredShare?: string;
    interactionGain?: string;
  };
  filterScope: typeof chainFilterScope;
}

// Store no chain results or roster moves automatically; each saved leg uses the existing explicit saved-trade action.
export function TradeChains({
  m,
  poolHost,
  team: initialTeam,
  pool: initialPool,
  basis: initialBasis,
  lineupsRaw,
  save,
  selectedTeams: initialTeams,
  debug,
  initial,
  remember,
  open,
  toggle,
  onPreview,
  onPool,
  followup,
}: {
  followup?: { id: string; draft: Draft };
  poolHost?: HTMLElement | null;
  onPool?: (value: {
    team: string;
    pool: string[];
    basis: LineupBasis;
  }) => void;
  onPreview?: (value: TradeWorkspacePreview) => void;
  initial?: ChainPreferences;
  remember?: (value: ChainPreferences) => void;
  open: boolean;
  toggle: () => void;
  m: Model;
  team: string;
  pool: string[];
  basis: LineupBasis;
  lineupsRaw?: string;
  selectedTeams?: string[];
  debug?: (value: ChainDebugReport) => void;
  save?: (
    draft: Draft,
    summary: SavedTradeSummary,
    query: TradeSearchQuery,
    context?: Model,
  ) => boolean | void;
}) {
  // Seed once from the previous selections; subsequent single-trade edits cannot change any chain option.
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [team, setTeam] = useState(initial?.query.team ?? initialTeam);
  const [pool, setPool] = useState(initial?.query.pool ?? [...initialPool]);
  const [basis, setBasis] = useState(initial?.query.basis ?? initialBasis);
  const [selectedTeams, setSelectedTeams] = useState(
    initial?.selectedTeams ?? initialTeams,
  );
  const [pricePolicy, setPricePolicy] = useState<
    NonNullable<ChainQuery["pricePolicy"]>
  >(initial?.query.pricePolicy ?? "required");
  // Restore the explicit saved scenario or custom preset without inferring it from its concession threshold.
  const [preset, setPreset] = useState(
    initial?.strictness ? (initial.preset ?? "custom") : "custom",
  );
  const presetQuery = useRef("");
  // New discovery preferences live only in this planner and persist with its existing workspace settings.
  const [strictness, setStrictness] = useState<ChainStrictness>(
    initial?.strictness ?? "balanced",
  );
  const [discovery, setDiscovery] = useState<ChainDiscovery>(
    initial?.query.discovery ?? { sequences: "connected", ranking: "own" },
  );
  const [customPresets, setCustomPresets] = useState(
    initial?.customPresets ?? [],
  );
  const [presetName, setPresetName] = useState("");
  const [mode, setMode] = useState<ChainQuery["mode"]>(
    initial?.query.mode ?? "both",
  );
  const [loss, setLoss] = useState(initial?.controls.loss ?? "3"),
    [gain, setGain] = useState(initial?.controls.gain ?? "5");
  const journal = useNegotiations();
  const [first, setFirst] = useState<ChainQuery["first"]>(
    withoutLegacySurface({
      ...(initial?.query.first ?? {
        offer: { minimum: 1, maximum: 3 },
        receive: { minimum: 1, maximum: 3 },
      }),
      // New protection defaults do not reset any saved leg filters; an explicit disabled choice stays disabled.
      deficitProtection: initial?.query.first.deficitProtection ?? {
        ...defaultDeficitProtection,
      },
    }),
  );
  const [second, setSecond] = useState<ChainQuery["second"]>(
    withoutLegacySurface({
      ...(initial?.query.second ?? {
        offer: { minimum: 1, maximum: 3 },
        receive: { minimum: 1, maximum: 3 },
      }),
      deficitProtection: initial?.query.second.deficitProtection ?? {
        ...defaultDeficitProtection,
      },
    }),
  );
  const [depth, setDepth] = useState<ChainQuery["depth"]>(
    initial?.query.depth ?? "standard",
  );
  // Per-step scopes inherit only this planner's independently remembered opponent selection.
  const [firstOverride, setFirstOverride] = useState(
      initial?.firstOverride ?? false,
    ),
    [secondOverride, setSecondOverride] = useState(
      initial?.secondOverride ?? false,
    );
  const [recipientLoss, setRecipientLoss] = useState(
      initial?.controls.recipientLoss ??
        String(defaultChainRecipient.maximumValueLossPct * 100),
    ),
    [recipientGain, setRecipientGain] = useState(
      initial?.controls.recipientGain ??
        String(defaultChainRecipient.minimumGain),
    );
  // New dependency defaults normalize old saved preferences while preserving raw editable thresholds and every unrelated selection.
  const [dependencyRoute, setDependencyRoute] = useState<
    ChainDependencySettings["route"]
  >(initial?.query.dependency?.route ?? defaultChainDependency.route);
  const [acquiredShare, setAcquiredShare] = useState(
    initial?.controls.acquiredShare ??
      String(
        (initial?.query.dependency?.minimumAcquiredShare ??
          defaultChainDependency.minimumAcquiredShare) * 100,
      ),
  );
  const [interactionGain, setInteractionGain] = useState(
    initial?.controls.interactionGain ??
      String(
        initial?.query.dependency?.minimumInteractionGain ??
          defaultChainDependency.minimumInteractionGain,
      ),
  );
  const [job, setJob] = useState<{
    context: string;
    query: ChainQuery;
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
  // Save each displayed leg against its executed roster and starter plans, independently of subsequent chain-control edits.
  const resultContext = useRef<{ model: Model; plans?: string } | null>(null);
  const query: ChainQuery = {
    team,
    pool,
    discovery,
    mode,
    pricePolicy,
    maximumLoss: loss.trim() ? Number(loss) : NaN,
    minimumGain: gain.trim() ? Number(gain) : NaN,
    first: {
      ...first,
      // Each leg inherits only its own deficit threshold; standard-search controls never participate.
      deficitProtection: {
        ...(first.deficitProtection ?? defaultDeficitProtection),
        enabled:
          !!first.fit?.deficit?.enabled && !!first.deficitProtection?.enabled,
        ceiling: first.fit?.deficit?.grade ?? defaultChainFit("deficit").grade,
        minimum:
          (!first.fit?.deficit?.enabled || !first.deficitProtection?.enabled) &&
          (!Number.isFinite(first.deficitProtection?.minimum) ||
            (first.deficitProtection?.minimum ?? 0) <= 0)
            ? defaultDeficitProtection.minimum
            : (first.deficitProtection?.minimum ??
              defaultDeficitProtection.minimum),
      },
      teams: firstOverride ? first.teams : selectedTeams,
      manager: first.manager
        ? { ...first.manager, profiles: journal.profiles }
        : undefined,
    },
    second: {
      ...second,
      // Each leg inherits only its own deficit threshold; standard-search controls never participate.
      deficitProtection: {
        ...(second.deficitProtection ?? defaultDeficitProtection),
        enabled:
          !!second.fit?.deficit?.enabled && !!second.deficitProtection?.enabled,
        ceiling: second.fit?.deficit?.grade ?? defaultChainFit("deficit").grade,
        minimum:
          (!second.fit?.deficit?.enabled ||
            !second.deficitProtection?.enabled) &&
          (!Number.isFinite(second.deficitProtection?.minimum) ||
            (second.deficitProtection?.minimum ?? 0) <= 0)
            ? defaultDeficitProtection.minimum
            : (second.deficitProtection?.minimum ??
              defaultDeficitProtection.minimum),
      },
      teams: secondOverride ? second.teams : selectedTeams,
      manager: second.manager
        ? { ...second.manager, profiles: journal.profiles }
        : undefined,
    },
    basis,
    depth,
    dependency: {
      route: dependencyRoute,
      minimumAcquiredShare: acquiredShare.trim()
        ? Number(acquiredShare) / 100
        : NaN,
      minimumInteractionGain: interactionGain.trim()
        ? Number(interactionGain)
        : NaN,
    },
    recipient: {
      maximumValueLossPct: recipientLoss.trim()
        ? Number(recipientLoss) / 100
        : NaN,
      minimumGain: recipientGain.trim() ? Number(recipientGain) : NaN,
    },
  };
  // Save each planner independently, and mark any edited preset Custom without overwriting protected selections.
  const preference: ChainPreferences = {
    // Save dormant per-step overrides too; the worker/debug query separately carries effective scopes.
    query: { ...query, first, second },
    controls: {
      loss,
      gain,
      recipientLoss,
      recipientGain,
      acquiredShare,
      interactionGain,
    },
    selectedTeams,
    firstOverride,
    secondOverride,
    preset,
    strictness,
    customPresets,
  };
  const preferenceText = JSON.stringify(preference);
  useEffect(() => {
    remember?.(preference);
  }, [preferenceText]);
  // Publish only the visual chain pool; this never changes the manual or standard-search selections.
  useEffect(() => {
    onPool?.({ team, pool, basis });
  }, [team, pool.join(","), basis]);
  const queryText = JSON.stringify(query);
  useEffect(() => {
    if (!presetQuery.current || presetQuery.current === "pending")
      presetQuery.current = queryText;
    else if (presetQuery.current !== queryText && preset !== "custom")
      setPreset("custom");
  }, [queryText]);
  // Loading a first trade is a temporary search constraint, not a forced move or a saved-roster edit.
  useEffect(() => {
    if (!followup) return;
    const d = followup.draft;
    setTeam(d.teamA);
    setPool((old) =>
      [
        ...new Set([
          ...d.give,
          ...old.filter((id) => m.byId.get(id)?.owner === d.teamA),
        ]),
      ].slice(0, 12),
    );
    setFirst((old) => ({
      ...old,
      teams: [d.teamB],
      offer: { minimum: d.give.length, maximum: d.give.length },
      receive: { minimum: d.get.length, maximum: d.get.length },
    }));
    setFirstOverride(true);
    setDiscovery((old) => ({ ...old, pinnedFirst: d }));
    setFiltersOpen(true);
  }, [followup?.id]);
  // Imports and hypothetical moves only prune stale ownership; they never add unprotected players to the pool.
  useEffect(() => {
    setPool((previous) =>
      previous.filter((id) => m.byId.get(id)?.owner === team),
    );
    setSelectedTeams((previous) =>
      previous?.filter(
        (id) =>
          id !== team &&
          m.dataset.tables.ModelTeams.some((t) => str(t.TeamID) === id),
      ),
    );
    const prune = (previous: ChainQuery["first"]) => ({
      ...previous,
      teams: previous.teams?.filter(
        (id) =>
          id !== team &&
          m.dataset.tables.ModelTeams.some((t) => str(t.TeamID) === id),
      ),
    });
    setFirst(prune);
    setSecond(prune);
  }, [team, m.dataset.hash]);
  const debugValue = useRef<ChainDebugReport | null>(null);
  const context = JSON.stringify([
    chainSearchVersion,
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
  if ((query.first.manager || query.second.manager) && !journal.ready)
    errors.push("Saved manager profiles are still loading.");
  // Capture executed preferences separately from current edits, so stale results and per-leg overrides remain auditable.
  useEffect(() => {
    const report: ChainDebugReport = {
      searchVersion: chainSearchVersion,
      appBuild: {
        build: import.meta.env.VITE_APP_BUILD,
        commit: import.meta.env.VITE_APP_COMMIT,
        builtAt: import.meta.env.VITE_APP_BUILT_AT,
      },
      currentQuery: query,
      appliedSearch: job ? { query: job.query, context: job.context } : null,
      status: job?.status ?? "not searched",
      stale,
      errors: [...errors, ...(job?.error ? [job.error] : [])],
      stats: job?.stats,
      result: job?.result,
      elapsed: job?.elapsed,
      teamScope: { selectedTeams, firstOverride, secondOverride },
      controls: {
        loss,
        gain,
        recipientLoss,
        recipientGain,
        acquiredShare,
        interactionGain,
      },
      filterScope: chainFilterScope,
    };
    debugValue.current = report;
    debug?.(report);
  }, [
    debug,
    query,
    job,
    stale,
    errors,
    selectedTeams,
    firstOverride,
    secondOverride,
    loss,
    gain,
    recipientLoss,
    recipientGain,
  ]);
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
  function search(deeper = false) {
    if (errors.length) return;
    active.current?.terminate();
    const id = crypto.randomUUID();
    const executedQuery = deeper
      ? { ...query, depth: "deeper" as const }
      : query;
    const previous = deeper && !stale ? job?.result : undefined;
    resultContext.current = { model: m, plans: lineupsRaw };
    try {
      const worker = new Worker(
        new URL("../workers/trade-chains.worker.ts", import.meta.url),
        { type: "module" },
      );
      active.current = worker;
      setJob({
        context,
        query: executedQuery,
        status: "running",
        result: previous,
      });
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
            query: executedQuery,
            result: previous,
            status: "running",
            stats: message.stats,
            elapsed: message.elapsed,
          });
        else {
          setJob(
            message.type === "complete"
              ? {
                  context,
                  query: executedQuery,
                  status: "complete",
                  // Deeper work preserves already found plans and refreshes matching evidence by stable identity.
                  result: previous
                    ? mergeChainResults(
                        previous,
                        message.result,
                        query.discovery?.ranking,
                      )
                    : message.result,
                  stats: message.result.stats,
                  elapsed:
                    (previous ? (job?.elapsed ?? 0) : 0) + message.elapsed,
                }
              : { context, query, status: "error", error: message.message },
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
          query,
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
        query: executedQuery,
      };
      worker.postMessage(request);
    } catch (error) {
      active.current?.terminate();
      active.current = null;
      setJob({
        context,
        query,
        status: "error",
        error:
          error instanceof Error
            ? error.message
            : "Could not start chain search.",
      });
    }
  }

  // Explicit preset selection can change its documented defaults; search recovery cannot alter these hard requirements.
  function applyOptions(next: ChainQuery, label: string) {
    presetQuery.current = "pending";
    setGain(String(next.minimumGain));
    setLoss(String(next.maximumLoss));
    setMode(next.mode);
    setRecipientLoss(String(next.recipient!.maximumValueLossPct * 100));
    setRecipientGain(String(next.recipient!.minimumGain));
    setPricePolicy(next.pricePolicy ?? "required");
    setFirst(next.first);
    setSecond(next.second);
    setDiscovery(next.discovery ?? { sequences: "connected", ranking: "own" });
    setPreset(label);
  }
  // Reconstruct a leg's prerequisite only for inspection or saving; this never changes the app's working or saved roster.
  function legContext(chain: TradeChain, step: 1 | 2) {
    const captured = resultContext.current ?? { model: m, plans: lineupsRaw };
    const model =
      step === 1
        ? captured.model
        : applyRosterScenario(captured.model, chain.afterFirst, captured.plans);
    return {
      model,
      plans: step === 1 ? captured.plans : model.simulation?.lineupsRaw,
    };
  }
  function legQuery(leg: ChainLeg, step: 1 | 2): TradeSearchQuery {
    return {
      // Saving or inspecting a stale result must retain that executed leg's safeguard, not the currently edited controls.
      deficitProtection: (step === 1 ? job?.query.first : job?.query.second)
        ?.deficitProtection,
      teamA: leg.draft.teamA,
      give: leg.draft.give,
      count: leg.draft.get.length,
      below: 0,
      above: 0,
      indexMode: "automatic",
      lineupBasis: leg.row.lineupBasis,
    };
  }
  function saveLeg(chain: TradeChain, step: 1 | 2) {
    if (!save) return;
    try {
      const leg = step === 1 ? chain.first : chain.second;
      const { model } = legContext(chain, step);
      if (
        save(
          leg.draft,
          summaryFromSearch(leg.row),
          legQuery(leg, step),
          model,
        ) !== false
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
      // Step two uses its actual post-step-one roster for both named upgrades and affected position grades.
      const detail = {
        ...searchLineupDetails(model, legQuery(leg, step), leg.row, plans),
        incentive: opponentIncentive(
          model,
          legQuery(leg, step),
          leg.row,
          plans,
        ),
      };
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
    help = "Adjustable search preference in model Expected points per remaining fantasy week; not a historically validated threshold.",
    maximum?: number,
  ) => (
    <FilterHelp label={label} help={help}>
      <label className="control">
        <span>{label}</span>
        <input
          type="number"
          step="0.1"
          min={minimum}
          max={maximum}
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
    override: boolean,
    changeOverride: (value: boolean) => void,
  ) => (
    <fieldset className="trade-search-group">
      <legend>{label}</legend>
      {/* Per-leg package and value options stay nearby but folded until needed; both legs remain independently mounted. */}
      <TradeFilterGroup
        title={`${label}: Players & packages`}
        summary={`Offer ${value.offer.minimum}–${value.offer.maximum} · Receive ${value.receive.minimum}–${value.receive.maximum}`}
      >
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
              {label} teams ({override ? "override: " : "planner scope: "}
              {(override ? value.teams : selectedTeams)?.length ?? "all"})
            </summary>
            {/* Custom team choices are available only after explicitly overriding the inherited search scope. */}
            <FilterHelp
              label={`Override ${label.toLowerCase()} teams`}
              help="Replaces this chain planner’s opponent scope for this step only. Turn off to follow Chain teams to search. The standard finder is independent."
            >
              <label className="check">
                <input
                  type="checkbox"
                  checked={override}
                  aria-label={`Override ${label.toLowerCase()} teams`}
                  onChange={(e) => {
                    changeOverride(e.target.checked);
                    if (e.target.checked)
                      change({
                        ...value,
                        teams: selectedTeams ? [...selectedTeams] : undefined,
                      });
                  }}
                />
                Override {label.toLowerCase()} teams
              </label>
            </FilterHelp>
            {!override && (
              <p className="muted">
                Uses Chain teams to search. Enable the override to choose a
                different scope for this step.
              </p>
            )}
            {override && (
              <>
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
              </>
            )}
          </details>
        </div>
      </TradeFilterGroup>
      <TradeFilterGroup
        title={`${label}: Value & acceptance`}
        summary={value.indexWindow ? "Index window on" : "No index window"}
      >
        {/* Each leg owns its optional plausibility inputs; raw sums never silently inherit package premiums or standard-search settings. */}
        <div className="trade-search-controls">
          <div>
            <FilterHelp
              label={`${label} index window`}
              help="Require the raw incoming index sum to lie within this leg's below/above range around its outgoing sum. Inclusive and unrounded. Premium and recipient checks still apply separately; unequal packages may need a wider window."
            >
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!value.indexWindow}
                  onChange={(e) =>
                    change({
                      ...value,
                      indexWindow: e.target.checked
                        ? { below: 5, above: 5 }
                        : undefined,
                    })
                  }
                />
                {label} index window
              </label>
            </FilterHelp>
            {value.indexWindow && (
              <>
                {number(
                  `${label} index below`,
                  Number.isFinite(value.indexWindow.below)
                    ? String(value.indexWindow.below)
                    : "",
                  (text) =>
                    change({
                      ...value,
                      indexWindow: {
                        ...value.indexWindow!,
                        below: text.trim() ? Number(text) : NaN,
                      },
                    }),
                  0,
                  "Allowed raw index points below the outgoing sum. Blank is invalid; zero means no downward allowance.",
                )}
                {number(
                  `${label} index above`,
                  Number.isFinite(value.indexWindow.above)
                    ? String(value.indexWindow.above)
                    : "",
                  (text) =>
                    change({
                      ...value,
                      indexWindow: {
                        ...value.indexWindow!,
                        above: text.trim() ? Number(text) : NaN,
                      },
                    }),
                  0,
                  "Allowed raw index points above the outgoing sum. This does not imply that the opponent accepts a concession.",
                )}
              </>
            )}
          </div>
          <div>
            <ManagerControls
              label={`${label}: Enable Surface Trading`}
              value={value.manager}
              change={(manager) => change({ ...value, manager })}
            />
          </div>
        </div>
      </TradeFilterGroup>
      {/* Each leg previews its own selected teams; the second leg's executed roster is explained in results. */}
      <TeamNeedsPreview
        m={m}
        teams={opponents
          .filter(
            (t) =>
              value.teams === undefined || value.teams.includes(str(t.TeamID)),
          )
          .map((t) => str(t.TeamID))}
        scope={label}
      />
      {(["surplus", "deficit"] as const).map((kind) => {
        const rule = value.fit?.[kind] ?? defaultChainFit(kind);
        const update = (patch: Partial<ChainFitRule>) =>
          change({
            ...value,
            fit: { ...value.fit, [kind]: { ...rule, ...patch } },
            ...(kind === "deficit" && patch.grade
              ? {
                  deficitProtection: {
                    ...(value.deficitProtection ?? defaultDeficitProtection),
                    ceiling: patch.grade,
                  },
                }
              : {}),
          });
        const title =
          kind === "surplus"
            ? "Receive from their surplus"
            : "Offer into their deficit";
        return (
          <div key={kind} className="trade-search-group">
            <FilterHelp
              label={`${label}: ${title}`}
              help="Optional fit targeting uses the same league-relative grades as Teams. Prefer explores matches first but allows alternatives; Require excludes nonmatches. Step two recalculates grades after trade one. An empty position selection follows the actual package. Example: receive an RB from a surplus first, then offer that RB into a deficit."
            >
              <label className="check">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) => update({ enabled: e.target.checked })}
                />
                {label}: {title}
              </label>
            </FilterHelp>
            {rule.enabled && (
              <div className="trade-search-controls">
                <FilterHelp
                  label={`${label} ${kind} targeting`}
                  help="Prefer explores matches first while allowing alternatives. Require excludes packages without a qualifying fit. Final chain ranking stays primarily your EPPG gain."
                >
                  <label className="control">
                    <span>
                      {label} {kind} targeting
                    </span>
                    <select
                      value={rule.mode}
                      onChange={(e) =>
                        update({ mode: e.target.value as ChainFitRule["mode"] })
                      }
                    >
                      <option value="prefer">Prefer matches</option>
                      <option value="require">Require matches</option>
                    </select>
                  </label>
                </FilterHelp>
                <FilterHelp
                  label={`${label} ${kind} grade`}
                  help="Inclusive threshold using the same league-relative position grades as Teams. Deficit accepts the selected grade and lower; surplus accepts it and higher. Grades are recalculated before each leg."
                >
                  <label className="control">
                    <span>
                      {label} {kind} grade
                    </span>
                    <select
                      value={rule.grade}
                      onChange={(e) => update({ grade: e.target.value })}
                    >
                      {positionGradeScale.map((grade) => (
                        <option key={grade} value={grade}>
                          {grade} or {kind === "deficit" ? "lower" : "higher"}
                        </option>
                      ))}
                    </select>
                  </label>
                </FilterHelp>
                <FilterHelp
                  label={`${label} ${kind} positions match`}
                  help="Any requires at least one qualifying package position. All requires every relevant position to qualify. Duplicate positions count once; unavailable grades cannot match."
                >
                  <label className="control">
                    <span>
                      {label} {kind} positions match
                    </span>
                    <select
                      value={rule.match}
                      onChange={(e) =>
                        update({
                          match: e.target.value as ChainFitRule["match"],
                        })
                      }
                    >
                      <option value="any">
                        At least one relevant position
                      </option>
                      <option value="all">All relevant positions</option>
                    </select>
                  </label>
                </FilterHelp>
                <TradePositionChips
                  scope={`${label} ${kind}`}
                  positions={positions}
                  selected={rule.positions}
                  change={(position) =>
                    update({
                      positions: rule.positions.includes(position)
                        ? rule.positions.filter((p) => p !== position)
                        : [...rule.positions, position],
                    })
                  }
                />
                <fieldset>
                  <legend>
                    {label} {kind} positions (none selected = automatic)
                  </legend>
                  {positions.map((position) => (
                    <label className="check" key={position}>
                      <input
                        type="checkbox"
                        aria-label={`${label} ${kind} position: ${position}`}
                        checked={rule.positions.includes(position)}
                        onChange={(e) =>
                          update({
                            positions: e.target.checked
                              ? [...rule.positions, position]
                              : rule.positions.filter((p) => p !== position),
                          })
                        }
                      />
                      {position}
                    </label>
                  ))}
                </fieldset>
              </div>
            )}
            {kind === "deficit" && (
              <DeficitProtectionControls
                scope={label}
                value={value.deficitProtection}
                change={(deficitProtection) =>
                  change({ ...value, deficitProtection })
                }
                targeting={rule.enabled}
                ceiling={rule.grade}
              />
            )}
          </div>
        );
      })}
    </fieldset>
  );

  // Dependency evidence displays recorded domain outputs; presentation groups named coverage weeks without recalculating trade formulas.
  const dependencyDetails = (value: ChainDependencyEvidence) => {
    const roles = new Map<
      string,
      { acquired: string; outgoing: string; slot: string; weeks: number[] }
    >();
    for (const role of value.retained.coverage) {
      const key = JSON.stringify([role.acquired, role.outgoing, role.slot]);
      const entry = roles.get(key) ?? { ...role, weeks: [] };
      entry.weeks.push(role.week);
      roles.set(key, entry);
    }
    return (
      <details>
        <summary>How trade 1 enables trade 2</summary>
        <p className="model">
          Route:{" "}
          {value.route === "retrade"
            ? "Meaningful re-trade"
            : value.route === "retain"
              ? "Keep-and-release"
              : "No qualifying dependency"}
          .
        </p>
        <p>Acquired players reoffered: {names(value.retrade.acquired)}.</p>
        <p className="model">
          Acquired contribution: {fmt(value.retrade.numerator)} /{" "}
          {fmt(value.retrade.denominator)}{" "}
          {value.retrade.metric === "index"
            ? "surplus index"
            : value.retrade.metric === "points"
              ? "positive remaining-season points (zero-index fallback)"
              : "— unavailable contribution"}
          ;{" "}
          {value.retrade.share === null
            ? "unavailable"
            : `${fmt(value.retrade.share * 100)}%`}
          . Requires{" "}
          <span className="input">≥ {fmt(value.retrade.required * 100)}%</span>.{" "}
          <Signal text={value.retrade.passed ? "PASS" : "FAIL"} />
        </p>
        {value.route !== "retrade" && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Keep-and-release evidence</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Trade 2 gain after trade 1</td>
                    <td className="model">
                      {signed(value.retained.actualSecondGain)} EPPG
                    </td>
                  </tr>
                  <tr>
                    <td>Trade 2 gain alone</td>
                    <td className="model">
                      {signed(value.retained.standaloneSecondGain)} EPPG
                    </td>
                  </tr>
                  <tr>
                    <td>Interaction gain</td>
                    <td className="model">
                      {signed(value.retained.interactionGain)} EPPG
                    </td>
                  </tr>
                  <tr>
                    <td>Required interaction</td>
                    <td className="input">
                      ≥ {fmt(value.retained.required)} EPPG
                    </td>
                  </tr>
                  <tr>
                    <td>Retained roster lift (supporting only)</td>
                    <td className="model">
                      {signed(value.retained.retainedLift)} EPPG
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {value.retained.issue && (
              <p className="notice warning">{value.retained.issue}</p>
            )}
            {[...roles.entries()].map(([key, role]) => (
              <p key={key}>
                {names([role.acquired])} provides {role.slot} coverage relevant
                to offering {names([role.outgoing])}; weeks{" "}
                {role.weeks.join(", ")}.
              </p>
            ))}
          </>
        )}
        <p className="muted">
          Interaction measures how trade 1 changes the effect of trade 2. Two
          independent upgrades do not qualify. Contribution and interaction
          thresholds are provisional preferences, not acceptance probabilities.
        </p>
      </details>
    );
  };

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
        {onPreview && (
          <button
            type="button"
            className="subtle"
            onClick={() => {
              const { model, plans } = legContext(chain, step);
              onPreview({
                prerequisite: step === 2,
                key,
                draft: leg.draft,
                model,
                plans,
                basis: leg.row.lineupBasis ?? basis,
                label: `Chain step ${step} preview`,
              });
            }}
          >
            Inspect step {step}
          </button>
        )}
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
        {/* Match the standard finder’s compact recipient upgrades on each independently evaluated chain leg. */}
        <OpponentIncentiveView
          m={m}
          value={detail?.incentive}
          inspect={() => inspect(chain, step)}
          stale={stale}
        />
        {/* Per-leg range and source comparisons show exact applied bounds and the recipient's actual legal lineup losses. */}
        {leg.indexWindow && (
          <p className="model">
            Raw index window: outgoing {fmt(leg.indexWindow.outgoing)}; incoming{" "}
            {fmt(leg.indexWindow.incoming)}; difference{" "}
            {signed(leg.indexWindow.difference)}. Requires{" "}
            <span className="input">
              {fmt(leg.indexWindow.minimum)}–{fmt(leg.indexWindow.maximum)}
            </span>
            . <Signal text={leg.indexWindow.passed ? "PASS" : "FAIL"} />
          </p>
        )}
        {leg.row.manager && (
          <ManagerEvidence
            value={leg.row.manager}
            m={legContext(chain, step).model}
            draft={leg.draft}
            allowLog={false}
          />
        )}
        {leg.surface && (
          <details>
            <summary>Step {step} surface evidence</summary>
            <SurfaceAppealView value={leg.surface} m={m} />
          </details>
        )}
        {/* Fit evidence reports actual grades against inclusive thresholds separately from the scoring and price tests. */}
        {leg.fit?.map((fit) => (
          <p
            className={fit.matched ? "model" : "notice warning"}
            key={fit.kind}
          >
            {fit.kind === "surplus"
              ? "Receive from surplus"
              : "Offer into deficit"}
            : {fit.mode} · {fit.match === "any" ? "Any" : "All"} · requires{" "}
            {fit.threshold} or {fit.kind === "surplus" ? "higher" : "lower"}.{" "}
            {fit.positions
              .map(
                (p) =>
                  `${p.position}: ${p.grade} (${p.qualifies ? "match" : "no match"}; ${p.status})`,
              )
              .join("; ")}
            . {fit.matched ? "MATCH" : "NO MATCH"}.
          </p>
        ))}
        {job?.query.pricePolicy === "warnings" &&
          (row.surplus !== "PASS" || row.points !== "PASS") && (
            <p className="notice warning">
              Price tests are advisory for this search. A failed test remains a
              value concern.
            </p>
          )}
        {/* Recipient fairness shows source index sums and exact policy units separately from the existing one-sided price tests. */}
        <p className="model">
          Their surplus index: give {fmt(leg.recipient.surrenderedIndex)} →
          receive {fmt(leg.recipient.receivedIndex)}. Value concession:{" "}
          {fmt(leg.recipient.lossPct * 100)}% (maximum{" "}
          {fmt(leg.recipient.maximumValueLossPct * 100)}%). Their gain:{" "}
          {signed(leg.recipient.gain)} EPPG (requires ≥{" "}
          {fmt(leg.recipient.minimumGain)}). Their lineup change:{" "}
          {leg.recipient.gainPct == null
            ? "unavailable"
            : `${signed(leg.recipient.gainPct * 100)}%`}
          . Recipient checks:{" "}
          <Signal text={leg.recipient.failures.length ? "FAIL" : "PASS"} />
        </p>
        {/* Keep the raw indices visible beside the premium-aware concession comparison for unequal packages. */}
        {leg.recipient.comparisonPremium > 0 && (
          <p className="model">
            Premium-adjusted comparison: give{" "}
            {fmt(leg.recipient.surrenderedComparableIndex)} / receive{" "}
            {fmt(leg.recipient.receivedComparableIndex)}. The smaller package is
            scaled once by {fmt(leg.recipient.comparisonPremium * 100)}% for
            this concession check; raw player indices are unchanged.
          </p>
        )}
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
            disabled={saved.includes(key)}
            onClick={() => saveLeg(chain, step)}
          >
            <Bookmark size={16} aria-hidden="true" />
            {saved.includes(key) ? `Step ${step} saved` : `Save step ${step}`}
          </button>
        )}
      </div>
    );
  };

  // Reuse the displayed roster order for bulk selection without changing the chain's independent pool or search limits.
  const poolPlayers = m.players
    .filter((p) => p.owner === team)
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <SearchSection
      title="Two-trade chain planner"
      open={open}
      toggle={toggle}
      note={`Independent chain controls · ${lineupBasisLabel(basis)} · ${m.simulation ? "Hypothetical roster" : "Imported roster"}`}
      compact
      action={
        <div className="trade-finder-actions">
          {/* This shortcut runs only this planner's own captured settings. */}
          <button
            type="button"
            className="button primary"
            aria-label="Run chain trade search"
            disabled={!!errors.length || job?.status === "running"}
            onClick={() => search()}
          >
            Search chains
          </button>
          <TradeFiltersButton
            scope="Chain"
            open={filtersOpen}
            toggle={() => setFiltersOpen((value) => !value)}
          />
        </div>
      }
    >
      {open &&
        poolHost &&
        createPortal(
          <TradePoolBoard
            m={m}
            team={team}
            pool={pool}
            scope="Chain"
            move={(id, destination) =>
              setPool((old) =>
                destination === "protected"
                  ? old.filter((player) => player !== id)
                  : old.includes(id) || old.length >= 12
                    ? old
                    : [...old, id],
              )
            }
          />,
          poolHost,
        )}
      <div
        className={`trade-finder-layout${filtersOpen ? " filters-open" : ""}`}
      >
        <div
          className="active-filter-chips"
          aria-label="Active chain-search filters"
        >
          <span>Final gain ≥ {gain} EPPG</span>
          {(
            [
              ["First trade", first, setFirst],
              ["Second trade", second, setSecond],
            ] as const
          ).flatMap(([label, leg, set]) =>
            (["surplus", "deficit"] as const).map((kind) =>
              leg.fit?.[kind]?.enabled ? (
                <button
                  type="button"
                  key={`${label}-${kind}`}
                  aria-label={`Remove ${label} ${kind} targeting`}
                  onClick={() =>
                    set({
                      ...leg,
                      fit: {
                        ...leg.fit,
                        [kind]: { ...leg.fit![kind]!, enabled: false },
                      },
                    })
                  }
                >
                  {label}: {kind} {leg.fit[kind]!.grade} ×
                </button>
              ) : null,
            ),
          )}
          {(
            [
              ["First trade", query.first, setFirst],
              ["Second trade", query.second, setSecond],
            ] as const
          ).map(([label, leg, set]) =>
            leg.deficitProtection?.enabled ? (
              <button
                type="button"
                key={label}
                aria-label={`Remove ${label} protection`}
                onClick={() =>
                  set((old) => ({
                    ...old,
                    deficitProtection: {
                      ...old.deficitProtection!,
                      enabled: false,
                    },
                  }))
                }
              >
                {label}: protect ≥ +{leg.deficitProtection.minimum} ×
              </button>
            ) : null,
          )}
        </div>
        <TradeFiltersDrawer
          scope="Chain"
          open={filtersOpen}
          close={() => setFiltersOpen(false)}
        >
          {/* The same four categories contain this planner's own controls; no settings are shared with standard search. */}
          <TradeFilterGroup
            title="Players & packages"
            summary={`${pool.length}/12 tradable · ${selectedTeams?.length ?? "All"} teams`}
          >
            {/* Each search owns its team, basis, outgoing pool and opponents, copied only once from prior selections. */}
            <div className="trade-search-controls">
              <FilterHelp
                label="Chain team"
                help="Choose the team for this chain only. Its own tradable pool, team scopes and results remain independent of the standard finder."
              >
                <label className="control">
                  <span>Chain team</span>
                  <select
                    value={team}
                    onChange={(e) => setTeam(e.target.value)}
                  >
                    <TeamsOptions d={m.dataset} />
                  </select>
                </label>
              </FilterHelp>
              <FilterHelp
                label="Chain lineup impact basis"
                help="Best available uses each full roster’s strongest lineup; Marked starters uses saved or imported starter roles. Both legs and both teams use this chain’s own basis."
              >
                <label className="control">
                  <span>Chain lineup impact basis</span>
                  <select
                    value={basis}
                    onChange={(e) => setBasis(e.target.value as LineupBasis)}
                  >
                    <option value="best-available">
                      Best available lineup
                    </option>
                    <option value="marked-starters">Marked starters</option>
                  </select>
                </label>
              </FilterHelp>
              <FilterHelp
                label="Chain preset"
                help="Seven provisional trading scenarios, with separate strictness. Explicit selection changes gain, package and recipient defaults while preserving team scopes, protected players, targets and optional fit requirements. Subsequent edits become Custom."
              >
                <label className="control">
                  <span>Chain preset</span>
                  <select
                    value={preset}
                    onChange={(e) => {
                      const id = e.target.value;
                      const savedPreset = customPresets.find(
                        (p) => p.id === id,
                      );
                      if (savedPreset) {
                        setStrictness(savedPreset.strictness ?? "balanced");
                        applyOptions(
                          {
                            ...savedPreset.query,
                            team,
                            pool,
                            first: {
                              ...savedPreset.query.first,
                              teams: first.teams,
                            },
                            second: {
                              ...savedPreset.query.second,
                              teams: second.teams,
                            },
                          },
                          id,
                        );
                      } else if (id === "custom") setPreset(id);
                      else
                        applyOptions(
                          applyChainPreset(query, id, strictness),
                          id,
                        );
                    }}
                  >
                    <option value="custom">Custom</option>
                    {chainPresets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                    {customPresets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </FilterHelp>
            </div>
            {/* Scenario modifiers and named saves reuse existing controls and leave the standard finder untouched. */}
            <div className="trade-search-controls">
              <label className="control">
                <span>Chain strictness</span>
                <select
                  value={strictness}
                  onChange={(e) => {
                    const next = e.target.value as ChainStrictness;
                    setStrictness(next);
                    applyOptions(
                      applyChainStrictness(query, next, preset === "mutual"),
                      chainPresets.some((p) => p.id === preset)
                        ? preset
                        : "custom",
                    );
                  }}
                >
                  <option value="conservative">Conservative</option>
                  <option value="balanced">Balanced</option>
                  <option value="negotiable">Negotiable</option>
                </select>
              </label>
              <FilterHelp
                label="Sequence types"
                help="Connected chains re-trade acquisitions or gain meaningful coverage. Sequential upgrades are independent moves, clearly labeled separately."
              >
                <label className="control">
                  <span>Sequence types</span>
                  <select
                    value={discovery.sequences}
                    onChange={(e) =>
                      setDiscovery({
                        ...discovery,
                        sequences: e.target
                          .value as ChainDiscovery["sequences"],
                      })
                    }
                  >
                    <option value="connected">Connected chains</option>
                    <option value="sequential">
                      Independent sequential upgrades
                    </option>
                    <option value="both">Both types</option>
                  </select>
                </label>
              </FilterHelp>
              <FilterHelp
                label="Rank plans by"
                help="Surface appeal ranks recipient season-average and ESPN projection changes when available; otherwise modeled recipient gain. It does not predict acceptance."
              >
                <label className="control">
                  <span>Rank plans by</span>
                  <select
                    value={discovery.ranking}
                    onChange={(e) =>
                      setDiscovery({
                        ...discovery,
                        ranking: e.target.value as ChainDiscovery["ranking"],
                      })
                    }
                  >
                    <option value="own">Your EPPG gain</option>
                    <option value="mutual">Benefit to both sides</option>
                    <option value="appeal">Apparent recipient appeal</option>
                  </select>
                </label>
              </FilterHelp>
              <FilterHelp
                label="Target roster need"
                help="Require a final retained acquisition at this position. Depth requires a retained acquisition outside the modeled starting lineups. Applies across all scenarios."
              >
                <label className="control">
                  <span>Target roster need</span>
                  <select
                    value={discovery.position ?? "any"}
                    onChange={(e) =>
                      setDiscovery({
                        ...discovery,
                        position:
                          e.target.value === "any"
                            ? undefined
                            : (e.target.value as ChainDiscovery["position"]),
                      })
                    }
                  >
                    <option value="any">Any position</option>
                    {positions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                    <option value="depth">Depth</option>
                  </select>
                </label>
              </FilterHelp>
              <label className="control">
                <span>Add required final target</span>
                <select
                  value=""
                  onChange={(e) =>
                    setDiscovery({
                      ...discovery,
                      requiredTargets: e.target.value
                        ? [
                            ...new Set([
                              ...(discovery.requiredTargets ?? []),
                              e.target.value,
                            ]),
                          ]
                        : discovery.requiredTargets,
                    })
                  }
                >
                  <option value="">Choose a player</option>
                  {m.players
                    .filter((p) => p.owner !== team && p.owner !== "0")
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} - {p.pos}
                      </option>
                    ))}
                </select>
              </label>
              {(discovery.requiredTargets ?? []).map((id) => (
                <button
                  key={id}
                  className="button"
                  aria-label={`Remove required target ${m.byId.get(id)?.name ?? "unavailable player"}`}
                  onClick={() =>
                    setDiscovery({
                      ...discovery,
                      requiredTargets: discovery.requiredTargets!.filter(
                        (other) => other !== id,
                      ),
                    })
                  }
                >
                  {m.byId.get(id)?.name ?? "Unavailable target"} x
                </button>
              ))}
              <label className="control">
                <span>Custom preset name</span>
                <input
                  value={presetName}
                  maxLength={60}
                  onChange={(e) => setPresetName(e.target.value)}
                />
              </label>
              <button
                className="button"
                disabled={!presetName.trim() || !!errors.length}
                onClick={() => {
                  const name = presetName.trim(),
                    existing = customPresets.find((p) => p.name === name),
                    id = existing?.id ?? crypto.randomUUID();
                  setCustomPresets((old) =>
                    [
                      ...old.filter((p) => p.id !== id),
                      { id, name, query: structuredClone(query), strictness },
                    ].slice(-10),
                  );
                  setPreset(id);
                  setPresetName("");
                }}
              >
                Save custom preset
              </button>
              {customPresets.some((p) => p.id === preset) && (
                <button
                  className="button"
                  onClick={() => {
                    setCustomPresets((old) =>
                      old.filter((p) => p.id !== preset),
                    );
                    setPreset("custom");
                  }}
                >
                  Delete custom preset
                </button>
              )}
            </div>
            {discovery.pinnedFirst && (
              <div className="trade-search-group">
                <strong>Locked first trade</strong>
                <p>
                  {names(discovery.pinnedFirst.give)} for{" "}
                  {names(discovery.pinnedFirst.get)} -{" "}
                  {teamName(discovery.pinnedFirst.teamB)}. Preview only; saved
                  rosters are unchanged.
                </p>
                <button
                  className="button"
                  onClick={() =>
                    setDiscovery({ ...discovery, pinnedFirst: undefined })
                  }
                >
                  Unlock first trade
                </button>
              </div>
            )}
            <details className="trade-search-group">
              <summary>Chain tradable pool ({pool.length}/12)</summary>
              <FilterHelp
                label="Select all chain tradable players"
                help="Keep current chain selections and add players in the displayed order, up to the existing 12-player pool limit. This does not change the standard search pool."
              >
                <button
                  type="button"
                  className="subtle"
                  disabled={
                    pool.length >= 12 ||
                    poolPlayers.every((p) => pool.includes(p.id))
                  }
                  onClick={() =>
                    setPool((old) =>
                      [
                        ...new Set([
                          ...old.filter((id) =>
                            poolPlayers.some((p) => p.id === id),
                          ),
                          ...poolPlayers.map((p) => p.id),
                        ]),
                      ].slice(0, 12),
                    )
                  }
                >
                  Select all{poolPlayers.length > 12 ? " (up to 12)" : ""}
                </button>
              </FilterHelp>
              {poolPlayers.map((p) => (
                <label className="check" key={p.id}>
                  <input
                    type="checkbox"
                    aria-label={`Chain tradable player: ${p.name}`}
                    checked={pool.includes(p.id)}
                    disabled={!pool.includes(p.id) && pool.length >= 12}
                    onChange={(e) =>
                      setPool((old) =>
                        e.target.checked
                          ? [...old, p.id]
                          : old.filter((id) => id !== p.id),
                      )
                    }
                  />
                  {p.name} · {p.pos} ·{" "}
                  <span className="model">{fmt(p.index)}</span>
                </label>
              ))}
            </details>
            <details className="trade-search-group">
              <summary>
                Chain teams to search ({selectedTeams?.length ?? "all"})
              </summary>
              <div className="button-row">
                <button
                  className="subtle"
                  onClick={() => setSelectedTeams(undefined)}
                >
                  Select all chain teams
                </button>
                <button className="subtle" onClick={() => setSelectedTeams([])}>
                  Clear chain team selection
                </button>
              </div>
              {opponents.map((t) => {
                const id = str(t.TeamID);
                return (
                  <label className="check" key={id}>
                    <input
                      type="checkbox"
                      aria-label={`Chain search team: ${str(t.TeamName)}`}
                      checked={
                        selectedTeams === undefined ||
                        selectedTeams.includes(id)
                      }
                      onChange={(e) =>
                        setSelectedTeams((previous) => {
                          const selected =
                            previous ?? opponents.map((t) => str(t.TeamID));
                          return e.target.checked
                            ? [...selected, id]
                            : selected.filter((value) => value !== id);
                        })
                      }
                    />
                    {str(t.TeamName)}
                  </label>
                );
              })}
            </details>
            <details>
              <summary>Which filters apply to chains?</summary>
              {Object.entries(chainFilterScope).map(([label, fields]) => (
                <p key={label}>
                  <strong>{label}:</strong> {fields.join(", ")}.
                </p>
              ))}
              <p>
                Recipient, roster and gain checks apply separately on each step.
                Price tests are required or advisory according to this planner’s
                own control.
              </p>
            </details>
            <p>
              Tradable pool: {names(pool)}. Other original roster players stay
              protected. Newly acquired players may also be offered in step two.
            </p>
          </TradeFilterGroup>
          <TradeFilterGroup
            title="Team needs"
            summary="Independent settings for each trade"
            open
          >
            <details className="trade-chain-leg" open>
              <summary>First trade · acquire your next move</summary>
              {stepControls(
                "First trade",
                first,
                setFirst,
                firstOverride,
                setFirstOverride,
              )}
            </details>
            <details className="trade-chain-leg">
              <summary>Second trade · complete the chain</summary>
              {stepControls(
                "Second trade",
                second,
                setSecond,
                secondOverride,
                setSecondOverride,
              )}
            </details>
          </TradeFilterGroup>
          <TradeFilterGroup
            title="Value & acceptance"
            summary={
              pricePolicy === "required"
                ? "Price tests required"
                : "Price tests advisory"
            }
          >
            <FilterHelp
              label="Chain price tests"
              help="Required rejects a candidate unless both existing price tests pass on each step. Warning only keeps the calculated tests visible without excluding a trade. Roster legality, protected players, recipient limits and scoring requirements always apply."
            >
              <label className="control">
                <span>Chain price tests</span>
                <select
                  value={pricePolicy}
                  onChange={(e) =>
                    setPricePolicy(e.target.value as typeof pricePolicy)
                  }
                >
                  <option value="required">Both must pass</option>
                  <option value="warnings">Warnings only</option>
                </select>
              </label>
            </FilterHelp>
            {/* Dependency stays required in every preset; all new controls remain local to this planner. */}
            <details className="trade-search-group">
              <summary>Chain dependency</summary>
              <div className="trade-search-controls">
                <FilterHelp
                  label="Dependency route"
                  help="These materiality settings classify connected chains: trade 1 funds trade 2 or supplies meaningful coverage. Independent sequential upgrades are proved separately using trade two on its own. Either permits both connected routes."
                >
                  <label className="control">
                    <span>Dependency route</span>
                    <select
                      value={dependencyRoute}
                      onChange={(e) =>
                        setDependencyRoute(
                          e.target.value as ChainDependencySettings["route"],
                        )
                      }
                    >
                      <option value="either">Either connected route</option>
                      <option value="retrade">Re-trade acquisition</option>
                      <option value="retain">Keep-and-release</option>
                    </select>
                  </label>
                </FilterHelp>
                {number(
                  "Minimum acquired contribution (%)",
                  acquiredShare,
                  setAcquiredShare,
                  0.1,
                  "Minimum acquired share of the second offer for the re-trade route. Zero-index packages use a separately labeled remaining-points fallback. A token card does not qualify. Provisional default 25%.",
                  100,
                )}
                {number(
                  "Minimum interaction gain (EPPG)",
                  interactionGain,
                  setInteractionGain,
                  0.1,
                  "Keep-and-release: trade 2's gain after trade 1 minus its gain when performed alone. Example: +5 after coverage versus −3 alone gives +8 interaction. Provisional default +2.",
                )}
              </div>
            </details>
            {/* Recipient concessions are explained by the control's hover help; no obsolete fixed-10% preset banner. */}
          </TradeFilterGroup>
          <TradeFilterGroup
            title="Scoring impact"
            summary={`Final gain ≥ ${gain} EPPG`}
          >
            <div className="trade-search-controls">
              <FilterHelp
                label="Chain mode"
                help="Safe refers to your positive first-step scoring gain. Speculative allows your flat or losing first step within the temporary-loss limit. Recipient concession/gain checks apply on both steps; price checks follow Chain price tests. These are modeled preferences, not acceptance guarantees."
              >
                <label className="control">
                  <span>Chain mode</span>
                  <select
                    value={mode}
                    onChange={(e) =>
                      setMode(e.target.value as ChainQuery["mode"])
                    }
                  >
                    <option value="both">Safe and speculative</option>
                    <option value="safe">Safe only</option>
                    <option value="speculative">Speculative only</option>
                  </select>
                </label>
              </FilterHelp>
              {number("Maximum temporary loss (EPPG)", loss, setLoss, 0)}
              {number("Minimum final gain (EPPG)", gain, setGain, 0.1)}
              {number(
                "Maximum recipient value loss (%)",
                recipientLoss,
                setRecipientLoss,
                0,
                "Each recipient must receive at least (1 − this percentage) of the comparable surplus they surrender. Equal-size trades use raw index sums. Unequal trades scale the smaller package once by the existing consolidation premium before comparing concessions; both raw and adjusted numbers are shown. The selected limit is a provisional preference, not a market price or validated acceptance probability. Existing price tests remain unchanged.",
                100,
              )}
              {number(
                "Minimum recipient gain (EPPG)",
                recipientGain,
                setRecipientGain,
                -1000,
                "Minimum recipient points/week after required drops. A negative value explicitly permits a modeled loss. This is separate from your first-trade loss limit and is not a prediction of acceptance.",
              )}
              {/* Recovery is bounded and only changes recipient gain, value concession and active index windows. */}
              <FilterHelp
                label="Automatically broaden empty searches"
                help="Only recipient scoring-loss/value limits and active index windows may widen, within the ceilings below. Your final gain, first-step loss, teams, protected players, required targets, sizes, surface and needs filters stay fixed. Each attempt is reported."
              >
                <label className="control checkbox">
                  <input
                    type="checkbox"
                    checked={!!discovery.broaden?.enabled}
                    onChange={(e) =>
                      setDiscovery({
                        ...discovery,
                        broaden: {
                          maximumRecipientLoss: 4,
                          maximumValueLossPct: 0.35,
                          indexExtra: 20,
                          ...discovery.broaden,
                          enabled: e.target.checked,
                        },
                      })
                    }
                  />
                  Automatically broaden empty searches
                </label>
              </FilterHelp>
              {discovery.broaden?.enabled && (
                <div className="trade-search-controls">
                  {number(
                    "Broadening: maximum recipient loss (EPPG)",
                    String(discovery.broaden.maximumRecipientLoss),
                    (v) =>
                      setDiscovery({
                        ...discovery,
                        broaden: {
                          ...discovery.broaden!,
                          maximumRecipientLoss: v.trim() ? Number(v) : NaN,
                        },
                      }),
                    0,
                  )}
                  {number(
                    "Broadening: maximum value concession (%)",
                    String(discovery.broaden.maximumValueLossPct * 100),
                    (v) =>
                      setDiscovery({
                        ...discovery,
                        broaden: {
                          ...discovery.broaden!,
                          maximumValueLossPct: v.trim() ? Number(v) / 100 : NaN,
                        },
                      }),
                    0,
                    undefined,
                    100,
                  )}
                  {number(
                    "Broadening: extra index points per side",
                    String(discovery.broaden.indexExtra),
                    (v) =>
                      setDiscovery({
                        ...discovery,
                        broaden: {
                          ...discovery.broaden!,
                          indexExtra: v.trim() ? Number(v) : NaN,
                        },
                      }),
                    0,
                  )}
                </div>
              )}
              <FilterHelp
                label="Chain search depth"
                help="Standard and deeper searches retain deferred bridges and interleave acquired positions, players, teams, package sizes and modes. Follow-ups share remaining work as branches finish. Deeper expands the allowance; the result states whether exploration finished."
              >
                <label className="control">
                  <span>Chain search depth</span>
                  <select
                    value={depth}
                    onChange={(e) =>
                      setDepth(e.target.value as ChainQuery["depth"])
                    }
                  >
                    <option value="standard">
                      Broad — up to 16,000 evaluations per attempt
                    </option>
                    <option value="deeper">
                      Deeper — up to 60,000 evaluations per attempt
                    </option>
                  </select>
                </label>
              </FilterHelp>
            </div>
          </TradeFilterGroup>
          {errors.map((error) => (
            <p className="notice warning" key={error}>
              {error}
            </p>
          ))}
        </TradeFiltersDrawer>
        <div className="trade-finder-main">
          <div className="button-row">
            <button
              className="button primary"
              disabled={!!errors.length || job?.status === "running"}
              onClick={() => search()}
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
            {/* Reset keeps the established defaults and selections; hover help makes its stricter thresholds explicit. */}
            <FilterHelp
              label="Clear chain filters"
              help="Restore defaults: final gain 5 EPPG, recipient gain 1 EPPG, maximum concession 10%, required price tests, and no position targeting. Restore dependency to either route, 25% contribution and +2 interaction; disable optional per-leg windows/Surface Trading. Keep your team, pool, opponent scope and scoring basis. Choose a scenario with Negotiable strictness for broader discovery."
            >
              <button
                className="subtle"
                onClick={() => {
                  active.current?.terminate();
                  active.current = null;
                  setJob(null);
                  setDependencyRoute(defaultChainDependency.route);
                  setAcquiredShare(
                    String(defaultChainDependency.minimumAcquiredShare * 100),
                  );
                  setInteractionGain(
                    String(defaultChainDependency.minimumInteractionGain),
                  );
                  setMode("both");
                  setLoss("3");
                  setGain("5");
                  setPricePolicy("required");
                  setPreset("custom");
                  setDiscovery({ sequences: "connected", ranking: "own" });
                  setFirst({
                    deficitProtection: {
                      ...defaultDeficitProtection,
                      enabled: false,
                    },
                    offer: { minimum: 1, maximum: 3 },
                    receive: { minimum: 1, maximum: 3 },
                  });
                  setSecond({
                    deficitProtection: {
                      ...defaultDeficitProtection,
                      enabled: false,
                    },
                    offer: { minimum: 1, maximum: 3 },
                    receive: { minimum: 1, maximum: 3 },
                  });
                  setDepth("standard");
                  setFirstOverride(false);
                  setSecondOverride(false);
                  setRecipientLoss(
                    String(defaultChainRecipient.maximumValueLossPct * 100),
                  );
                  setRecipientGain(String(defaultChainRecipient.minimumGain));
                }}
              >
                Clear chain filters
              </button>
            </FilterHelp>
          </div>
          {/* A chain-local debug action remains available while the independent standard finder is collapsed. */}
          <button
            className="button"
            onClick={() => {
              const report = {
                ...tradeDebugReport(
                  m,
                  {
                    teamA: team,
                    give: pool,
                    count: 1,
                    below: 0,
                    above: 0,
                    indexMode: "automatic",
                    lineupBasis: basis,
                  },
                  { teamA: team, teamB: "", give: pool, get: [] },
                  lineupsRaw,
                  null,
                  { status: job?.status ?? "not searched", stale },
                ),
                // Existing build stamps distinguish deployments that share the same user-managed app version.
                appVersion: import.meta.env.VITE_APP_VERSION,
                appBuild: {
                  build: import.meta.env.VITE_APP_BUILD,
                  commit: import.meta.env.VITE_APP_COMMIT,
                  builtAt: import.meta.env.VITE_APP_BUILT_AT,
                },
                chainSearch: debugValue.current,
              };
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(report, null, 2)], {
                  type: "application/json",
                }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "fantasy-chain-debug.json";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 0);
            }}
          >
            Download chain debug
          </button>
          {job?.status === "running" && (
            <p className="notice" role="status">
              {job.stats?.phase ?? "Starting chain search"} ·{" "}
              {job.stats?.evaluated ?? 0} trades evaluated ·{" "}
              {job.stats?.firstExplored ?? 0} first steps explored.
              {job.stats?.limits &&
                ` Evaluation limit: ${job.stats.limits.totalEvaluations.toLocaleString()}; scanned ${job.stats.scanned.toLocaleString()} candidates. Cancel stops the search immediately.`}
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
                {job.result.stats.found} qualifying chains found; showing the
                best {job.result.chains.length} within the explored candidates.{" "}
                {job.result.stats.evaluated} trades evaluated in{" "}
                {fmt((job.elapsed ?? 0) / 1000)} seconds.
                {job.result.stats.limited && " Search coverage is incomplete."}
              </p>
              {/* Exhaustive exploration and a capped display are separate statuses; neither changes any acceptance threshold. */}
              <p>
                {job.result.stats.limited
                  ? `Search limit reached${job.result.stats.limits ? ` (${job.result.stats.limits.totalEvaluations.toLocaleString()} evaluations or ${job.result.stats.limits.scans.toLocaleString()} candidate scans)` : ""}: more possibilities may exist.`
                  : "All eligible combinations within these selected sizes and teams were examined."}{" "}
                {job.result.stats.resultCapped &&
                  "Some qualifying plans are omitted by the per-search display limit. "}
                Results are modeled possibilities, not agreed trades or
                acceptance predictions. Opponent gains and value concessions
                must satisfy the recipient checks on each step. No automatic
                waiver additions.
              </p>
              {/* Preserved results stay visible during deeper exploration; recovery reports its exact applied limits. */}
              {job.status !== "running" && !stale && (
                <button
                  className="button"
                  disabled={job.query.depth === "deeper"}
                  onClick={() => search(true)}
                >
                  Search deeper (keep results)
                </button>
              )}
              {job.result.attempts && (
                <details>
                  <summary>Search attempts and relaxed limits</summary>
                  {job.result.attempts.map((a, i) => (
                    <p key={i}>
                      Attempt {i + 1}: {a.found} qualifying plans,{" "}
                      {a.stats.evaluated} evaluations.{" "}
                      {a.changes.length
                        ? a.changes.join("; ")
                        : "Original limits."}{" "}
                      {a.stats.limited
                        ? "Search limit reached; unexplored possibilities remain."
                        : "Selected combinations examined."}
                    </p>
                  ))}
                </details>
              )}
              {/* Keep actual safeguard exclusions visible in diagnostics, without adding permanent top-of-page notices. */}
              {!!job.result.stats.rejectedDeficit && (
                <p>
                  Excluded for insufficient improvement at the other team's weak
                  position: {job.result.stats.rejectedDeficit}.
                </p>
              )}
              {!job.result.chains.length && (
                <p>
                  {job.result.stats.limited
                    ? "No qualifying chains found within the explored work. This does not prove none exist; try deeper search or broader sizes/teams."
                    : "No chains meet all applied rules within the fully searched eligible sizes and teams. Review the exclusions below or adjust your filters."}
                </p>
              )}
              {/* A failed final-gain threshold is distinct from never finding an acceptable pair of trades. */}
              {!job.result.chains.length &&
                job.result.stats.bestFinalGain !== null && (
                  <p className="model">
                    Best inspected chain passing the other checks:{" "}
                    {signed(job.result.stats.bestFinalGain)} EPPG overall.
                    Requested minimum: {fmt(job.query.minimumGain)} EPPG. This
                    is the best inspected result, not proof of a global maximum.
                  </p>
                )}
              <details>
                <summary>Chain search exclusions</summary>
                {(job.result.attempts?.length ?? 0) > 1 && (
                  <p>
                    Evaluation totals and limits include all attempts. The
                    stream and exclusion counts below describe the latest
                    attempt; earlier attempts are listed above.
                  </p>
                )}
                {/* Show remaining work and exact stopping limits alongside rejection counts instead of implying a zero-result proof. */}
                <p>
                  Search coverage:{" "}
                  {job.result.stats.limited ? "incomplete" : "complete"}.
                  First-trade stream:{" "}
                  {job.result.stats.coverage.first.complete
                    ? "exhausted"
                    : "unfinished"}
                  . Follow-up branches completed:{" "}
                  {job.result.stats.coverage.followups.completed}; unfinished:{" "}
                  {job.result.stats.coverage.followups.unfinished}; deferred
                  first trades: {job.result.stats.coverage.followups.deferred}.
                  Stop reasons:{" "}
                  {job.result.stats.coverage.stopReasons
                    .map((reason) => reason.replaceAll("-", " "))
                    .join(", ") || "streams exhausted"}
                  .
                </p>
                <p>
                  Full evaluations: first{" "}
                  {job.result.stats.coverage.first.evaluated}, follow-up{" "}
                  {job.result.stats.coverage.followups.evaluated};
                  counterfactual {job.result.stats.dependencyEvaluated}{" "}
                  (included in the shared allowance). Pending dependency
                  evaluations: {job.result.stats.dependencyPending}. Candidate
                  scans: first {job.result.stats.coverage.first.scanned},
                  follow-up {job.result.stats.coverage.followups.scanned}.
                  Unused evaluation allowance:{" "}
                  {job.result.stats.coverage.unusedEvaluations}; unused scan
                  allowance: {job.result.stats.coverage.unusedScans}. Search
                  method: {job.result.stats.searchVersion}.
                </p>
                <p>
                  Dependency exclusions: {job.result.stats.rejectedDependency}.
                  Surface Trading exclusions:{" "}
                  {job.result.stats.rejectedManager ?? 0}. Index-window
                  exclusions: {job.result.stats.rejectedIndex}. Required-price
                  failures: {job.result.stats.rejectedValue}. Surplus/deficit
                  exclusions: {job.result.stats.rejectedFit ?? 0}.
                  Roster/protection failures: {job.result.stats.rejectedRoster}.
                  Scoring/mode/gain failures: {job.result.stats.rejectedGain}.
                  Recipient fairness/benefit failures:{" "}
                  {job.result.stats.rejectedRecipient}. Eligible first trades:{" "}
                  {job.result.stats.firstEligible}; explored:{" "}
                  {job.result.stats.firstExplored}.
                </p>
                <p>
                  Obvious recipient-value mismatches rejected before full
                  scoring: {job.result.stats.rejectedRecipientBeforeScoring}.
                  These do not consume the full-evaluation budget.
                </p>
                {/* Explain the safe scoring shortcut separately from full evaluations and ordinary filter exclusions. */}
                <p>
                  Skipped full scoring for{" "}
                  {job.result.stats.skippedImpossibleGain ?? 0} candidates that
                  could not reach your minimum gain, even with an optimistic
                  lineup. These still count as scanned candidates.
                </p>
                <p>
                  Fully evaluated first-trade sizes:{" "}
                  {Object.entries(job.result.stats.firstEvaluatedBySize)
                    .map(([size, count]) => `${size}: ${count}`)
                    .join("; ") || "None"}
                  .
                </p>
                <p>
                  Fully evaluated follow-up sizes:{" "}
                  {Object.entries(job.result.stats.secondEvaluatedBySize)
                    .map(([size, count]) => `${size}: ${count}`)
                    .join("; ") || "None"}
                  .
                </p>
                <p className="muted">
                  Up to five recipient-rejection examples per step are shown
                  below and included in Download search debug.
                </p>
                {/* A small separate sample explains disconnected pairs and per-leg plausibility failures without implying exhaustive coverage. */}
                {job.result.plausibilityRejections.map((entry, i) => (
                  <div key={`plausibility:${i}`}>
                    <p>
                      Step {entry.step}: {names(entry.draft.give)} →{" "}
                      {names(entry.draft.get)}. {entry.failures.join(" ")}
                    </p>
                    {entry.indexWindow && (
                      <p className="model">
                        Incoming {fmt(entry.indexWindow.incoming)}; required{" "}
                        <span className="input">
                          {fmt(entry.indexWindow.minimum)}–
                          {fmt(entry.indexWindow.maximum)}
                        </span>
                        .
                      </p>
                    )}
                    {entry.surface && (
                      <SurfaceAppealView value={entry.surface} m={m} />
                    )}
                  </div>
                ))}
                {job.result.dependencyRejections.map((entry, i) => (
                  <div key={`dependency:${i}`}>
                    <p>
                      Disconnected / insufficient enabling impact:{" "}
                      {names(entry.first.give)} → {names(entry.first.get)}; then{" "}
                      {names(entry.second.give)} → {names(entry.second.get)}.
                    </p>
                    {dependencyDetails(entry.evidence)}
                  </div>
                ))}
                {job.result.recipientRejections.map((entry, i) => (
                  <p key={i} className="model">
                    Step {entry.step} · {teamName(entry.draft.teamB)} · Offer{" "}
                    {names(entry.draft.give)} for {names(entry.draft.get)}:{" "}
                    {entry.evidence.failures.join(" ")}
                    {!entry.evidence.scored &&
                      " Rejected on value before lineup scoring; recipient EPPG was not calculated."}
                  </p>
                ))}
              </details>
              {(["connected", "sequential"] as const).map(
                (kind) =>
                  job.result!.chains.some(
                    (c) => (c.kind ?? "connected") === kind,
                  ) && (
                    <section
                      key={kind}
                      aria-label={
                        kind === "connected"
                          ? "Connected chains"
                          : "Independent sequential upgrades"
                      }
                    >
                      <h3>
                        {kind === "connected"
                          ? "Connected chains"
                          : "Independent sequential upgrades"}
                      </h3>
                      <GroupedChains
                        chains={job.result!.chains.filter(
                          (c) => (c.kind ?? "connected") === kind,
                        )}
                        m={resultContext.current?.model ?? m}
                        render={(chain, i) => (
                          <article
                            className="trade-search-group"
                            key={chain.key}
                          >
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
                              Your roster: {fmt(chain.before)} →{" "}
                              {fmt(chain.intermediate)} → {fmt(chain.after)}{" "}
                              EPPG.
                            </p>
                            <p>
                              {chain.mode === "safe"
                                ? "First trade does not reduce scoring even if the follow-up never happens."
                                : `If the follow-up fails, step one leaves you at ${fmt(chain.intermediate)} EPPG (${signed(chain.first.row.own)}).`}
                            </p>
                            <p>
                              <strong>
                                {chain.kind === "sequential"
                                  ? "Independent sequential upgrades"
                                  : "Connected chain"}
                              </strong>
                              .{" "}
                              {chain.relaxations?.length
                                ? `Relaxed limits: ${chain.relaxations.join("; ")}`
                                : "Original search limits."}
                            </p>
                            {chain.kind !== "sequential" &&
                              chain.dependency && (
                                <>
                                  <p className="model">
                                    Connected route:{" "}
                                    {chain.dependency.route === "retrade"
                                      ? "Re-trade acquisition"
                                      : "Keep-and-release"}
                                    .
                                  </p>
                                  {dependencyDetails(chain.dependency)}
                                </>
                              )}
                            {renderLeg(chain, 1)}
                            {renderLeg(chain, 2)}
                          </article>
                        )}
                      />
                    </section>
                  ),
              )}
            </>
          )}
        </div>
      </div>
    </SearchSection>
  );
}
