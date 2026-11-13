import { useEffect, useRef, useState } from "react";
import type { Draft } from "../../../domain/contracts";
import { str } from "../../../domain/contracts";
import type { Model } from "../../../domain/valuation";
import type { LineupBasis } from "../../../domain/trade-impact";
import {
  applyLimitsToChainQuery,
  migrateStrictness,
  orderChainsByPrice,
  type SearchLimits,
} from "../../../domain/search-limits";
import {
  applyChainPresetKeepingLimits,
  presetContext,
  type ChainDiscovery,
} from "../../../domain/chain-discovery";
import {
  chainErrors,
  chainSearchVersion,
  defaultChainFit,
  defaultChainRecipient,
  mergeChainResults,
  type ChainLeg,
  type ChainQuery,
  type ChainResults,
  type ChainStats,
  type TradeChain,
} from "../../../domain/trade-chains";
import {
  defaultChainDependency,
  type ChainDependencySettings,
} from "../../../domain/chain-plausibility";
import { defaultDeficitProtection } from "../../../domain/trade-safeguards";
import { withoutLegacySurface } from "../../../domain/surface-appeal";
import {
  applyRosterScenario,
  sourceDataset,
} from "../../../domain/roster-scenarios";
import {
  summaryFromSearch,
  type SavedTradeSummary,
} from "../../../domain/saved-trades";
import {
  searchLineupDetails,
  type SearchLineupDetails,
  type TradeSearchQuery,
} from "../../../domain/trade-search";
import { opponentIncentive } from "../../../domain/trade-discovery";
import { tradeDebugReport } from "../../../domain/trade-tools";
import type { ChainRequest } from "../../../workers/trade-chains.worker";
import { searchCue, useFeedback } from "../../../ui/feel/feedback";
import { useNegotiations } from "../../Negotiations";
import { mergeTradeSettings, readTradeSettings } from "./tradeSettings";

// What the planner remembers: its editable controls only. Results and applied trades stay explicit actions.
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
  customPresets?: { id: string; name: string; query: ChainQuery }[];
}

const defaultLeg = (): ChainQuery["first"] => ({
  offer: { minimum: 1, maximum: 3 },
  receive: { minimum: 1, maximum: 3 },
  deficitProtection: { ...defaultDeficitProtection },
});

// Read the stored chain preferences from the shared record, or from the earlier separate chain record; strictness is dropped.
export function readChainPreferences(
  settingsRaw?: string,
  legacyRaw?: string,
): ChainPreferences | undefined {
  let value: unknown = readTradeSettings(settingsRaw).chain;
  if (!value && legacyRaw) {
    try {
      value = JSON.parse(legacyRaw);
    } catch {
      value = undefined;
    }
  }
  if (!value || typeof value !== "object") return undefined;
  const saved = value as ChainPreferences & { strictness?: unknown };
  if (!saved.query || !saved.controls) return undefined;
  const cleaned = migrateStrictness(saved) as ChainPreferences;
  return {
    ...cleaned,
    customPresets: cleaned.customPresets?.map(
      (p) =>
        migrateStrictness(
          p as typeof p & { strictness?: unknown },
        ) as NonNullable<ChainPreferences["customPresets"]>[number],
    ),
  };
}

export type ChainJob = {
  context: string;
  query: ChainQuery;
  status: "running" | "complete" | "cancelled" | "error" | "stale";
  stats?: ChainStats;
  result?: ChainResults;
  error?: string;
  elapsed?: number;
};

// The chain planner's state: its query, presets, the worker run and the per-step actions. Rendering lives in the components.
export function useChainSearch({
  m,
  draft,
  lineupsRaw,
  basis: initialBasis,
  limits,
  settingsRaw,
  legacySettingsRaw,
  saveSettings,
  save,
}: {
  m: Model;
  draft: Draft;
  lineupsRaw?: string;
  basis: LineupBasis;
  limits: SearchLimits;
  settingsRaw?: string;
  legacySettingsRaw?: string;
  saveSettings?: (raw: string) => void;
  save?: (
    draft: Draft,
    summary: SavedTradeSummary,
    query: TradeSearchQuery,
    context?: Model,
  ) => boolean | void;
}) {
  const notify = useFeedback();
  const journal = useNegotiations();
  const [initial] = useState(() =>
    readChainPreferences(settingsRaw, legacySettingsRaw),
  );

  const [team, setTeam] = useState(initial?.query.team ?? draft.teamA);
  const [pool, setPool] = useState<string[]>(
    initial?.query.pool ??
      draft.give
        .filter((id) => m.byId.get(id)?.owner === draft.teamA)
        .slice(0, 12),
  );
  const [basis, setBasis] = useState<LineupBasis>(
    initial?.query.basis ?? initialBasis,
  );
  const [selectedTeams, setSelectedTeams] = useState<string[] | undefined>(
    initial?.selectedTeams,
  );
  const [preset, setPreset] = useState(initial?.preset ?? "balanced");
  const presetQuery = useRef("");
  const [discovery, setDiscovery] = useState<ChainDiscovery>(
    initial?.query.discovery ?? { sequences: "connected", ranking: "own" },
  );
  const [customPresets, setCustomPresets] = useState(
    initial?.customPresets ?? [],
  );
  const [presetName, setPresetName] = useState("");
  const [depth, setDepth] = useState<ChainQuery["depth"]>(
    initial?.query.depth ?? "standard",
  );
  const [first, setFirst] = useState<ChainQuery["first"]>(
    withoutLegacySurface({ ...defaultLeg(), ...initial?.query.first }),
  );
  const [second, setSecond] = useState<ChainQuery["second"]>(
    withoutLegacySurface({ ...defaultLeg(), ...initial?.query.second }),
  );
  const [firstOverride, setFirstOverride] = useState(
    initial?.firstOverride ?? false,
  );
  const [secondOverride, setSecondOverride] = useState(
    initial?.secondOverride ?? false,
  );
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
  // Numeric limits come from the shared limits at search time; these hold the recipient gain floor and the values a saved search carried.
  const [recipientGain, setRecipientGain] = useState(
    initial?.controls.recipientGain ??
      String(defaultChainRecipient.minimumGain),
  );
  const [job, setJob] = useState<ChainJob | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [details, setDetails] = useState<Record<string, SearchLineupDetails>>(
    {},
  );
  const [detailError, setDetailError] = useState("");
  const active = useRef<Worker | null>(null);
  // Each displayed step is saved and inspected against the roster and starter plans it was searched on.
  const resultContext = useRef<{ model: Model; plans?: string } | null>(null);

  const legQuery = (
    leg: ChainQuery["first"],
    override: boolean,
  ): ChainQuery["first"] => ({
    ...leg,
    // Each step inherits only its own deficit threshold; Find trades controls never take part.
    deficitProtection: {
      ...(leg.deficitProtection ?? defaultDeficitProtection),
      enabled: !!leg.fit?.deficit?.enabled && !!leg.deficitProtection?.enabled,
      ceiling: leg.fit?.deficit?.grade ?? defaultChainFit("deficit").grade,
      minimum:
        (!leg.fit?.deficit?.enabled || !leg.deficitProtection?.enabled) &&
        (!Number.isFinite(leg.deficitProtection?.minimum) ||
          (leg.deficitProtection?.minimum ?? 0) <= 0)
          ? defaultDeficitProtection.minimum
          : (leg.deficitProtection?.minimum ??
            defaultDeficitProtection.minimum),
    },
    teams: override ? leg.teams : selectedTeams,
    manager: leg.manager
      ? { ...leg.manager, profiles: journal.profiles }
      : undefined,
  });

  const query: ChainQuery = {
    team,
    pool,
    discovery,
    mode: initial?.query.mode ?? "both",
    pricePolicy: "required",
    maximumLoss: initial?.query.maximumLoss ?? 3,
    minimumGain: initial?.query.minimumGain ?? 5,
    first: legQuery(first, firstOverride),
    second: legQuery(second, secondOverride),
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
      maximumValueLossPct: defaultChainRecipient.maximumValueLossPct,
      minimumGain: recipientGain.trim() ? Number(recipientGain) : NaN,
    },
  };
  // The query as searched: the shared limits set the final gain, temporary loss, recipient value loss and index window.
  const effective = applyLimitsToChainQuery(query, limits);

  const preference: ChainPreferences = {
    query: { ...query, first, second },
    controls: {
      loss: String(effective.maximumLoss),
      gain: String(effective.minimumGain),
      recipientLoss: String(
        (effective.recipient?.maximumValueLossPct ?? 0) * 100,
      ),
      recipientGain,
      acquiredShare,
      interactionGain,
    },
    selectedTeams,
    firstOverride,
    secondOverride,
    preset,
    customPresets,
  };
  const preferenceText = JSON.stringify(preference);
  const settingsRef = useRef(settingsRaw);
  settingsRef.current = settingsRaw;
  useEffect(() => {
    if (!saveSettings) return;
    const next = mergeTradeSettings(
      settingsRef.current,
      "chain",
      preferenceText,
    );
    if (next !== settingsRef.current) saveSettings(next);
    // Persist only when the preferences change.
  }, [preferenceText]);

  // A preset describes a kind of chain; editing anything afterwards makes the selection Custom.
  const queryText = JSON.stringify(query);
  useEffect(() => {
    if (!presetQuery.current || presetQuery.current === "pending")
      presetQuery.current = queryText;
    else if (presetQuery.current !== queryText && preset !== "custom")
      setPreset("custom");
  }, [queryText]);

  // Imports and hypothetical moves only prune stale ownership; they never add unprotected players to the pool.
  useEffect(() => {
    setPool((previous) =>
      previous.filter((id) => m.byId.get(id)?.owner === team),
    );
    const known = (id: string) =>
      id !== team &&
      m.dataset.tables.ModelTeams.some((t) => str(t.TeamID) === id);
    setSelectedTeams((previous) => previous?.filter(known));
    const prune = (previous: ChainQuery["first"]) => ({
      ...previous,
      teams: previous.teams?.filter(known),
    });
    setFirst(prune);
    setSecond(prune);
  }, [team, m.dataset.hash]);

  const context = JSON.stringify([
    chainSearchVersion,
    m.dataset.hash,
    m.analysisVersion,
    m.settings,
    m.evidenceRaw,
    m.roleScenarioWeight,
    lineupsRaw,
    effective,
  ]);
  const stale = !!job && job.context !== context;
  const errors = chainErrors(m, effective);
  if ((query.first.manager || query.second.manager) && !journal.ready)
    errors.push("Saved manager profiles are still loading.");

  // Any source, pool, basis, limit or control edit invalidates the captured work.
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

  function applyOptions(next: ChainQuery, label: string) {
    presetQuery.current = "pending";
    setFirst(next.first);
    setSecond(next.second);
    // Applying coverage restores the shared route default; other presets keep your materiality controls.
    if (label === "coverage") setDependencyRoute(defaultChainDependency.route);
    setDiscovery(next.discovery ?? { sequences: "connected", ranking: "own" });
    setPreset(label);
  }

  // A preset changes what kind of chain to look for. It never changes the shared limits, teams, pool or required targets.
  function choosePreset(id: string) {
    const savedPreset = customPresets.find((p) => p.id === id);
    if (savedPreset)
      applyOptions(
        {
          ...savedPreset.query,
          team,
          pool,
          first: { ...savedPreset.query.first, teams: first.teams },
          second: { ...savedPreset.query.second, teams: second.teams },
        },
        id,
      );
    else if (id === "custom") setPreset(id);
    else
      applyOptions(
        applyChainPresetKeepingLimits(
          query,
          id,
          limits,
          presetContext(m, team),
        ),
        id,
      );
  }

  function savePreset() {
    const name = presetName.trim();
    if (!name || errors.length) return;
    const existing = customPresets.find((p) => p.name === name);
    const id = existing?.id ?? crypto.randomUUID();
    setCustomPresets((old) =>
      [
        ...old.filter((p) => p.id !== id),
        { id, name, query: structuredClone(query) },
      ].slice(-10),
    );
    setPreset(id);
    setPresetName("");
  }

  function deletePreset() {
    setCustomPresets((old) => old.filter((p) => p.id !== preset));
    setPreset("custom");
  }

  function search(deeper = false) {
    if (errors.length) return;
    active.current?.terminate();
    const id = crypto.randomUUID();
    const base = deeper
      ? { ...effective, depth: "deeper" as const }
      : effective;
    const previous = deeper && !stale ? job?.result : undefined;
    resultContext.current = { model: m, plans: lineupsRaw };
    try {
      const worker = new Worker(
        new URL("../../../workers/trade-chains.worker.ts", import.meta.url),
        { type: "module" },
      );
      active.current = worker;
      setJob({ context, query: base, status: "running", result: previous });
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
            query: base,
            result: previous,
            status: "running",
            stats: message.stats,
            elapsed: message.elapsed,
          });
        else {
          if (message.type === "complete")
            notify(searchCue((message.result.plans?.length ?? 0) > 0));
          else notify("caution");
          setJob(
            message.type === "complete"
              ? {
                  context,
                  query: base,
                  status: "complete",
                  // Deeper work keeps the plans already found and refreshes matching evidence by stable identity.
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
              : {
                  context,
                  query: base,
                  status: "error",
                  error: message.message,
                },
          );
          worker.terminate();
          active.current = null;
        }
      };
      worker.onerror = () => {
        if (active.current !== worker) return;
        notify("caution");
        worker.terminate();
        active.current = null;
        setJob({
          context,
          query: base,
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
        query: base,
      };
      worker.postMessage(request);
    } catch (error) {
      active.current?.terminate();
      active.current = null;
      setJob({
        context,
        query: base,
        status: "error",
        error:
          error instanceof Error
            ? error.message
            : "Could not start chain search.",
      });
    }
  }

  function cancel() {
    active.current?.terminate();
    active.current = null;
    setJob((previous) =>
      previous ? { ...previous, status: "cancelled" } : previous,
    );
  }

  // Restore the defaults of this planner; the team, pool, scope and basis are kept.
  function clearFilters() {
    active.current?.terminate();
    active.current = null;
    setJob(null);
    setDependencyRoute(defaultChainDependency.route);
    setAcquiredShare(String(defaultChainDependency.minimumAcquiredShare * 100));
    setInteractionGain(String(defaultChainDependency.minimumInteractionGain));
    setRecipientGain(String(defaultChainRecipient.minimumGain));
    presetQuery.current = "pending";
    setPreset("balanced");
    setDiscovery({ sequences: "connected", ranking: "own" });
    setFirst({
      ...defaultLeg(),
      deficitProtection: { ...defaultDeficitProtection, enabled: false },
    });
    setSecond({
      ...defaultLeg(),
      deficitProtection: { ...defaultDeficitProtection, enabled: false },
    });
    setDepth("standard");
    setFirstOverride(false);
    setSecondOverride(false);
  }

  // Rebuild a step's prerequisite roster only for inspection or saving; the app's working roster never changes.
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

  function legSearchQuery(leg: ChainLeg, step: 1 | 2): TradeSearchQuery {
    return {
      // A stale result keeps the safeguard it was searched with, not the one being edited now.
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
          legSearchQuery(leg, step),
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
      const q = legSearchQuery(leg, step);
      setDetails((previous) => ({
        ...previous,
        [key]: {
          ...searchLineupDetails(model, q, leg.row, plans),
          incentive: opponentIncentive(model, q, leg.row, plans),
        },
      }));
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Could not inspect this step.",
      );
    }
  }

  // The local debug download: the controls, the captured query and the result, never credentials.
  function downloadDebug() {
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
      appVersion: import.meta.env.VITE_APP_VERSION,
      chainSearch: {
        searchVersion: chainSearchVersion,
        currentQuery: effective,
        appliedSearch: job ? { query: job.query, context: job.context } : null,
        status: job?.status ?? "not searched",
        stale,
        errors: [...errors, ...(job?.error ? [job.error] : [])],
        stats: job?.stats,
        result: job?.result,
        elapsed: job?.elapsed,
        teamScope: { selectedTeams, firstOverride, secondOverride },
        limits,
      },
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "fantasy-chain-debug.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const chains = job?.result ? orderChainsByPrice(job.result.chains) : [];

  return {
    team,
    setTeam,
    pool,
    setPool,
    basis,
    setBasis,
    selectedTeams,
    setSelectedTeams,
    preset,
    choosePreset,
    customPresets,
    presetName,
    setPresetName,
    savePreset,
    deletePreset,
    discovery,
    setDiscovery,
    depth,
    setDepth,
    first,
    setFirst,
    firstOverride,
    setFirstOverride,
    second,
    setSecond,
    secondOverride,
    setSecondOverride,
    dependencyRoute,
    setDependencyRoute,
    acquiredShare,
    setAcquiredShare,
    interactionGain,
    setInteractionGain,
    query: effective,
    resultModel: resultContext.current?.model ?? m,
    job,
    stale,
    errors,
    saved,
    details,
    detailError,
    chains,
    search,
    cancel,
    clearFilters,
    legContext,
    saveLeg,
    inspect,
    downloadDebug,
    running: job?.status === "running",
  };
}

export type ChainSearchState = ReturnType<typeof useChainSearch>;
