import { GroupedTradeRows } from "./TradeResultGroups";
import {
  ManagerControls,
  ManagerEvidence,
  useNegotiations,
} from "./Negotiations";
import type { ManagerSettings } from "../domain/manager-expectations";
import { SurfaceAppealControls, SurfaceAppealView } from "./SurfaceAppeal";
import type { SurfaceFilter } from "../domain/surface-appeal";
import {
  TradeChains,
  type ChainDebugReport,
  type ChainPreferences,
} from "./TradeChains";
import { guidedQuery } from "../domain/trade-guidance";
import {
  lineupBasisLabel,
  readLineupBasis,
  type LineupBasis,
} from "../domain/trade-impact";
import { useEffect, useRef, useState } from "react";
import { Bookmark, LoaderCircle } from "lucide-react";
import { sourceDataset } from "../domain/roster-scenarios";
import {
  diagnoseTradeCandidate,
  poolIndexRanges,
  tradeDebugReport,
} from "../domain/trade-tools";
import { positions, str, type Draft, type Position } from "../domain/contracts";
import {
  summaryFromSearch,
  type SavedTradeSummary,
} from "../domain/saved-trades";
import type { Model } from "../domain/valuation";
import { readStarterLineup } from "../domain/starter-lineups";
import {
  positionGradeScale,
  type SearchLineupDetails,
  tradeSearchBounds,
  tradeSearchContext,
  incomingCountRange,
  type SearchRecovery,
  type SearchProgress,
  type SearchRequest,
  type SearchResponse,
  type SearchRow,
  type SearchStats,
  type UpgradeFilter,
  type WeeklyRange,
  type TradeSearchQuery,
} from "../domain/trade-search";
import { SearchSection } from "../ui/SearchSection";
import { TeamsOptions } from "../ui/layout";
import { FilterHelp } from "../ui/FilterHelp";
import { PlayerName } from "../ui/PlayerName";
import { fmt, signed, Signal } from "../ui/components";
import {
  initialDiscovery,
  OpponentIncentiveView,
  TradeDiscoveryControls,
} from "./TradeDiscovery";

// Keep ephemeral search results out of the saved/synced trade draft until the user explicitly loads one.
interface SearchJob {
  id: string;
  context: string;
  status: "running" | "complete" | "cancelled" | "error" | "stale";
  progress?: SearchProgress;
  rows: SearchRow[];
  suggestions?: SearchRow[];
  total: number;
  stats?: SearchStats;
  error?: string;
  paging?: boolean;
  // Recovery previews belong to this captured search and cannot silently modify its filters.
  recovery?: {
    busy: boolean;
    options?: SearchRecovery[];
    checked?: number;
    total?: number;
    error?: string;
  };
  // Store only explanations explicitly opened in this completed search.
  lineups?: Record<string, { details?: SearchLineupDetails; error?: string }>;
}
// Keep long-running search timings readable without implying the estimated finish time is guaranteed.
function searchDuration(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
export function TradeSearch({
  m,
  draft,
  lineupsRaw,
  change,
  save,
  onQueryChange,
  lineupBasis = "best-available",
  onLineupBasisChange,
  restore,
  settingsRaw,
  saveSettings,
}: {
  settingsRaw?: string;
  saveSettings?: (raw: string) => void;
  m: Model;
  draft: Draft;
  lineupsRaw?: string;
  change: (draft: Draft) => void;
  save?: (
    draft: Draft,
    summary: SavedTradeSummary,
    query: TradeSearchQuery,
    context?: Model,
  ) => boolean | void;
  onQueryChange?: (query: TradeSearchQuery) => void;
  lineupBasis?: LineupBasis;
  onLineupBasisChange?: (basis: LineupBasis) => void;
  restore?: { id: string; query: TradeSearchQuery };
}) {
  // Restore each finder from its own preference record; never store ephemeral results or change the other finder's query.
  const [initialSettings] = useState(() => {
    try {
      const value = JSON.parse(settingsRaw ?? "{}");
      return value.version === 1 ? value : {};
    } catch {
      return {};
    }
  });
  const [openFinder, setOpenFinder] = useState<"standard" | "chain" | null>(
    "standard",
  );
  const [chainSettings, setChainSettings] = useState<
    ChainPreferences | undefined
  >(initialSettings.chain);
  const lastSettings = useRef(settingsRaw ?? "");
  const [below, setBelow] = useState("5"),
    [above, setAbove] = useState("5");
  // New searches start broad; legacy saved searches restore their strict offsets explicitly.
  const [indexMode, setIndexMode] = useState<"automatic" | "strict">(
    "automatic",
  );
  const [goal, setGoal] =
    useState<NonNullable<TradeSearchQuery["goal"]>>("explore");
  const [goalPosition, setGoalPosition] = useState<Position>("WR");
  // Surface discovery is disabled for ordinary searches and restored explicitly from a saved query.
  const [surface, setSurface] = useState<SurfaceFilter>();
  // Only profiles are shared; this finder owns its independent optional enablement and override.
  const journal = useNegotiations();
  const [manager, setManager] = useState<ManagerSettings>();
  const [advanced, setAdvanced] = useState(false);
  const [pendingSearch, setPendingSearch] = useState<TradeSearchQuery | null>(
    null,
  );
  // Discovery is opt-in; default controls preserve fixed outgoing packages and the existing ranking.
  const [discovery, setDiscovery] = useState(initialDiscovery);
  // Undefined keeps the default all-opponent search; an empty explicit selection disables searching until a team is chosen.
  const [selectedTeams, setSelectedTeams] = useState<string[] | undefined>();
  const opponents = m.dataset.tables.ModelTeams.filter(
    (team) => str(team.TeamID) !== "0" && str(team.TeamID) !== draft.teamA,
  );
  const [packages, setPackages] = useState(true),
    // Package searches can return singles as well as larger packages within these inclusive limits.
    [minimumCount, setMinimumCount] = useState(1),
    [count, setCount] = useState(3);
  // Empty selections disable each category; active categories count only the same qualifying incoming players.
  const [signals, setSignals] = useState<("Gem" | "Watch")[]>([]),
    [incomingPositions, setIncomingPositions] = useState<Position[]>([]),
    [minimumSignals, setMinimumSignals] = useState("1"),
    [minimumPositions, setMinimumPositions] = useState("1");
  // Keep optional fit controls local and disabled by default, like the existing search controls.
  const [upgradeOnly, setUpgradeOnly] = useState(false),
    [upgradeMode, setUpgradeMode] = useState<UpgradeFilter["mode"]>("starter"),
    [minimumUpgrade, setMinimumUpgrade] = useState("1");
  // Require full-package usefulness only when selected; legacy upgrade targets remain independent.
  const [usefulnessOnly, setUsefulnessOnly] = useState(false),
    [minimumUsefulness, setMinimumUsefulness] = useState("1");
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
      (discovery.flexible ? discovery.pool : draft.give).flatMap((id) => {
        const position = m.byId.get(id)?.pos;
        return position ? [position] : [];
      }),
    ),
  ];
  const selectedPosition = deficitPosition || offeredPositions[0] || "";
  const [job, setJob] = useState<SearchJob | null>(null);
  // Preserve the executed controls independently from later edits, so a debug export can identify stale results precisely.
  const appliedSearch = useRef<{
    query: TradeSearchQuery;
    context: string;
  } | null>(null);
  // Retain the result's original valuation/roster context so later control edits never relabel saved figures as current.
  const resultModel = useRef<Model | null>(null);
  // Chain diagnostics are transient and captured by the existing download; they never alter the workspace or ordinary search.
  const chainDebug = useRef<ChainDebugReport | null>(null);
  const [diagnostic, setDiagnostic] = useState(""),
    [savedRow, setSavedRow] = useState("");
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
  const query: TradeSearchQuery = {
    lineupBasis,
    teamA: draft.teamA,
    give: draft.give,
    indexMode,
    goal,
    surface,
    manager: manager ? { ...manager, profiles: journal.profiles } : undefined,
    count: packages ? count : 1,
    // Disabled strict inputs cannot make an automatic search unsaveable; keep raw edits in the controls/debug report.
    below:
      indexMode === "automatic" &&
      (!Number.isFinite(parseOffset(below)) || parseOffset(below) < 0)
        ? 5
        : parseOffset(below),
    above:
      indexMode === "automatic" &&
      (!Number.isFinite(parseOffset(above)) || parseOffset(above) < 0)
        ? 5
        : parseOffset(above),
    discovery:
      packages ||
      discovery.flexible ||
      discovery.target ||
      discovery.nearMisses ||
      discovery.ranking !== "own" ||
      selectedTeams !== undefined
        ? {
            teams: selectedTeams,
            receive: packages
              ? { minimum: minimumCount, maximum: count }
              : undefined,
            flexible: discovery.flexible
              ? {
                  pool: discovery.pool,
                  minimum: parseOffset(discovery.minimum),
                  maximum: parseOffset(discovery.maximum),
                }
              : undefined,
            target: discovery.target || undefined,
            ranking: discovery.ranking,
            nearMisses: discovery.nearMisses,
          }
        : undefined,
    usefulness: usefulnessOnly
      ? { minimum: parseOffset(minimumUsefulness) }
      : undefined,
    incoming:
      signals.length || incomingPositions.length
        ? {
            signals,
            positions: incomingPositions,
            ...(signals.length
              ? { minimumSignals: parseOffset(minimumSignals) }
              : {}),
            ...(incomingPositions.length
              ? { minimumPositions: parseOffset(minimumPositions) }
              : {}),
          }
        : undefined,
    upgrade: upgradeOnly
      ? {
          mode: upgradeMode,
          minimum: parseOffset(minimumUpgrade),
          requiredStarters:
            upgradeMode === "depth" || upgradeMode === "best"
              ? 0
              : parseOffset(
                  upgradeMode === "either"
                    ? requiredStarters
                    : requiredUpgrades,
                ),
          requiredBest:
            upgradeMode === "best" ? parseOffset(requiredUpgrades) : undefined,
          requiredBench:
            upgradeMode === "starter" || upgradeMode === "best"
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
  const standardControls = {
    below,
    above,
    indexMode,
    goal,
    goalPosition,
    surface,
    manager,
    advanced,
    discovery,
    selectedTeams,
    packages,
    minimumCount,
    count,
    signals,
    incomingPositions,
    minimumSignals,
    minimumPositions,
    upgradeOnly,
    upgradeMode,
    minimumUpgrade,
    usefulnessOnly,
    minimumUsefulness,
    requiredUpgrades,
    requiredStarters,
    requiredBench,
    ownWeekly,
    otherWeekly,
    deficitOnly,
    deficitPosition,
    deficitCeiling,
  };
  const settingsText = JSON.stringify({
    version: 1,
    standard: { query, controls: standardControls },
    chain: chainSettings,
  });
  // Merge independently remembered chain and standard controls into one account-scoped workspace key, without saving search results.
  const settingsReady = useRef(false);
  useEffect(() => {
    if (!settingsReady.current) return;
    if (lastSettings.current !== settingsText) {
      lastSettings.current = settingsText;
      saveSettings?.(settingsText);
    }
  }, [settingsText, saveSettings]);
  // Display and progress labels follow the same incoming bounds used by discovery and saved searches.
  const receive = incomingCountRange(query);
  // Make outgoing pool sizes and incoming package sizes visible as separate search choices.
  const poolRange = poolIndexRanges(m, query);
  const multiplePackages =
    discovery.flexible ||
    discovery.nearMisses ||
    receive.minimum !== receive.maximum;
  const bounds = tradeSearchBounds(m, query);
  if (manager && !journal.ready)
    bounds.errors.push("Saved manager profiles are still loading.");
  const context = tradeSearchContext(m, query, lineupsRaw);
  const stale = !!job && (job.status === "stale" || job.context !== context);
  const running = !stale && job?.status === "running";
  const starter = readStarterLineup(m, draft.teamA, lineupsRaw);
  // Team/import changes remove stale ownership from the candidate pool without adding newly unprotected players.
  useEffect(() => {
    setDiscovery((previous) => ({
      ...previous,
      pool: previous.pool.filter((id) => m.byId.get(id)?.owner === draft.teamA),
    }));
    // Drop stale/self IDs after a team or import change, preserving an empty explicit scope rather than selecting everybody.
    setSelectedTeams((previous) =>
      previous?.filter((id) =>
        opponents.some((team) => str(team.TeamID) === id),
      ),
    );
  }, [draft.teamA, m.dataset.hash]);

  // Parent saves capture the current query without persisting temporary result rows on every search.
  useEffect(() => {
    onQueryChange?.(query);
  }, [JSON.stringify(query), onQueryChange]);
  // Explicit saved-trade loading restores every search control; ordinary rerenders never reset user edits.
  function restoreQuery(q: TradeSearchQuery) {
    setIndexMode(q.indexMode ?? "strict");
    setGoal(q.goal ?? "custom");
    setSurface(q.surface);
    setManager(q.manager);
    // Restore the saved opponent filter independently of the analyzer's one selected counterparty.
    setSelectedTeams(q.discovery?.teams);
    setGoalPosition(q.incoming?.positions?.[0] ?? "WR");
    setBelow(String(q.below));
    setAbove(String(q.above));
    // Saved discovery restores protected/tradable choices and the target without storing temporary search results.
    setDiscovery({
      ...initialDiscovery,
      flexible: !!q.discovery?.flexible,
      pool: (q.discovery?.flexible?.pool ?? []).filter(
        (id) => m.byId.get(id)?.owner === q.teamA,
      ),
      minimum: String(q.discovery?.flexible?.minimum ?? 1),
      maximum: String(q.discovery?.flexible?.maximum ?? 3),
      target: q.discovery?.target ?? "",
      ranking: q.discovery?.ranking ?? "own",
      nearMisses: !!q.discovery?.nearMisses,
    });
    setPackages(!!q.discovery?.receive || q.count !== 1);
    setMinimumCount(incomingCountRange(q).minimum);
    setCount(incomingCountRange(q).maximum);
    setUpgradeOnly(!!q.upgrade);
    setUsefulnessOnly(!!q.usefulness);
    setMinimumUsefulness(String(q.usefulness?.minimum ?? 1));
    setUpgradeMode(q.upgrade?.mode ?? "starter");
    setMinimumUpgrade(String(q.upgrade?.minimum ?? 1));
    setRequiredUpgrades(
      String(
        q.upgrade?.mode === "best"
          ? (q.upgrade.requiredBest ?? 1)
          : q.upgrade?.mode === "depth"
            ? (q.upgrade.requiredBench ?? 1)
            : (q.upgrade?.requiredStarters ?? 1),
      ),
    );
    setRequiredStarters(String(q.upgrade?.requiredStarters ?? 1));
    setRequiredBench(String(q.upgrade?.requiredBench ?? 0));
    setDeficitOnly(!!q.deficit);
    setDeficitPosition(q.deficit?.position ?? "");
    setDeficitCeiling(q.deficit?.ceiling ?? "C+");
    const range = (r?: WeeklyRange) => ({
      enabled: !!r,
      minimum: r?.minimum == null ? "" : String(r.minimum),
      maximum: r?.maximum == null ? "" : String(r.maximum),
    });
    setOwnWeekly(range(q.weekly?.own));
    setOtherWeekly(range(q.weekly?.other));
    setSignals(q.incoming?.signals ?? []);
    setIncomingPositions(q.incoming?.positions ?? []);
    setMinimumSignals(String(q.incoming?.minimumSignals ?? 1));
    setMinimumPositions(String(q.incoming?.minimumPositions ?? 1));
  }
  // Existing controls migrate once; later edits remain independent across route changes and reloads.
  useEffect(() => {
    const previous = initialSettings.standard;
    if (previous?.query) {
      restoreQuery(previous.query);
      const c = previous.controls ?? {};
      if (Object.hasOwn(c, "below")) setBelow(c.below);
      if (Object.hasOwn(c, "above")) setAbove(c.above);
      if (Object.hasOwn(c, "indexMode")) setIndexMode(c.indexMode);
      if (Object.hasOwn(c, "goal")) setGoal(c.goal);
      if (Object.hasOwn(c, "goalPosition")) setGoalPosition(c.goalPosition);
      if (Object.hasOwn(c, "surface")) setSurface(c.surface);
      if (Object.hasOwn(c, "manager")) setManager(c.manager);
      if (Object.hasOwn(c, "advanced")) setAdvanced(c.advanced);
      if (Object.hasOwn(c, "discovery")) setDiscovery(c.discovery);
      if (Object.hasOwn(c, "selectedTeams")) setSelectedTeams(c.selectedTeams);
      if (Object.hasOwn(c, "packages")) setPackages(c.packages);
      if (Object.hasOwn(c, "minimumCount")) setMinimumCount(c.minimumCount);
      if (Object.hasOwn(c, "count")) setCount(c.count);
      if (Object.hasOwn(c, "signals")) setSignals(c.signals);
      if (Object.hasOwn(c, "incomingPositions"))
        setIncomingPositions(c.incomingPositions);
      if (Object.hasOwn(c, "minimumSignals"))
        setMinimumSignals(c.minimumSignals);
      if (Object.hasOwn(c, "minimumPositions"))
        setMinimumPositions(c.minimumPositions);
      if (Object.hasOwn(c, "upgradeOnly")) setUpgradeOnly(c.upgradeOnly);
      if (Object.hasOwn(c, "upgradeMode")) setUpgradeMode(c.upgradeMode);
      if (Object.hasOwn(c, "minimumUpgrade"))
        setMinimumUpgrade(c.minimumUpgrade);
      if (Object.hasOwn(c, "usefulnessOnly"))
        setUsefulnessOnly(c.usefulnessOnly);
      if (Object.hasOwn(c, "minimumUsefulness"))
        setMinimumUsefulness(c.minimumUsefulness);
      if (Object.hasOwn(c, "requiredUpgrades"))
        setRequiredUpgrades(c.requiredUpgrades);
      if (Object.hasOwn(c, "requiredStarters"))
        setRequiredStarters(c.requiredStarters);
      if (Object.hasOwn(c, "requiredBench")) setRequiredBench(c.requiredBench);
      if (Object.hasOwn(c, "ownWeekly")) setOwnWeekly(c.ownWeekly);
      if (Object.hasOwn(c, "otherWeekly")) setOtherWeekly(c.otherWeekly);
      if (Object.hasOwn(c, "deficitOnly")) setDeficitOnly(c.deficitOnly);
      if (Object.hasOwn(c, "deficitPosition"))
        setDeficitPosition(c.deficitPosition);
      if (Object.hasOwn(c, "deficitCeiling"))
        setDeficitCeiling(c.deficitCeiling);
      onLineupBasisChange?.(readLineupBasis(previous.query.lineupBasis));
      if (
        previous.query.teamA &&
        m.dataset.tables.ModelTeams.some(
          (t) => str(t.TeamID) === previous.query.teamA,
        )
      )
        change({
          ...draft,
          teamA: previous.query.teamA,
          give: previous.query.give.filter(
            (id: string) => m.byId.get(id)?.owner === previous.query.teamA,
          ),
          get: draft.teamA === previous.query.teamA ? draft.get : [],
        });
    }
    settingsReady.current = true;
  }, []);
  // Legacy saved queries retain their original criteria and expose the advanced controls for review.
  useEffect(() => {
    if (!restore) return;
    onLineupBasisChange?.(readLineupBasis(restore.query.lineupBasis));
    restoreQuery(restore.query);
    setAdvanced(true);
  }, [restore?.id]);

  // Relevant input changes stop worker work; completed trade ideas remain available for saving and loading.
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
    // Clear feedback from the previous captured result set.
    setSavedRow("");
    setDiagnostic("");
    appliedSearch.current = { query: structuredClone(query), context };
    resultModel.current = m;
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
          if (message.type === "recovery")
            return {
              ...previous,
              recovery: {
                busy: !message.options && !message.error,
                options: message.options,
                checked: message.checked,
                total: message.total,
                error: message.error,
              },
            };
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
            suggestions: message.suggestions ?? previous.suggestions,
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
        dataset: sourceDataset(m),
        scenario: m.simulation?.scenario,
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

  // Applying a preview restores all controls first, then starts the exact previewed query after context cleanup.
  useEffect(() => {
    // React batches restored controls with this request; optional defaults need not serialize identically.
    if (!pendingSearch) return;
    setPendingSearch(null);
    search();
  }, [pendingSearch, context]);

  // Termination is immediate even if the worker is busy in a large package enumeration/evaluation loop.
  function cancel() {
    active.current?.worker.terminate();
    active.current = null;
    setJob((previous) =>
      previous
        ? {
            ...previous,
            status: "cancelled",
            paging: false,
            recovery: previous.recovery
              ? { ...previous.recovery, busy: false }
              : undefined,
          }
        : previous,
    );
  }

  // Clear screening restrictions and stop stale work while preserving the trade draft, protected pool and package sizes.
  function clearFilters() {
    active.current?.worker.terminate();
    active.current = null;
    setJob(null);
    setPendingSearch(null);
    setGoal("custom");
    setSurface(undefined);
    setManager(undefined);
    setIndexMode("automatic");
    setSelectedTeams(undefined);
    setBelow("5");
    setAbove("5");
    setDiscovery((previous) => ({
      ...previous,
      target: "",
      targetSearch: "",
      ranking: "own",
      nearMisses: false,
    }));
    setSignals([]);
    setIncomingPositions([]);
    setMinimumSignals("1");
    setMinimumPositions("1");
    setUsefulnessOnly(false);
    setMinimumUsefulness("1");
    setUpgradeOnly(false);
    setUpgradeMode("starter");
    setMinimumUpgrade("1");
    setRequiredUpgrades("1");
    setRequiredStarters("1");
    setRequiredBench("0");
    setDeficitOnly(false);
    setDeficitPosition("");
    setDeficitCeiling("C+");
    setOwnWeekly({ enabled: false, minimum: "0", maximum: "" });
    setOtherWeekly({ enabled: false, minimum: "0", maximum: "" });
  }

  // Loading copies the displayed package, not newly edited filters or outgoing selections; the analyzer recalculates it against current inputs.
  function load(row: SearchRow) {
    const captured = appliedSearch.current?.query;
    if (!captured) return;
    change({
      teamA: captured.teamA,
      teamB: row.teamB,
      give: [...(row.give ?? captured.give)],
      get: [...row.get],
    });
  }

  // A bookmark preserves the evaluated package, query and source context even after filters become stale or invalid.
  function saveRow(row: SearchRow) {
    const captured = appliedSearch.current?.query,
      model = resultModel.current;
    if (!save || !captured || !model) return;
    const success = save(
      {
        teamA: captured.teamA,
        teamB: row.teamB,
        give: [...(row.give ?? captured.give)],
        get: [...row.get],
      },
      summaryFromSearch(row),
      captured,
      model,
    );
    if (success !== false) setSavedRow(row.key);
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
        <FilterHelp
          label={`${label} (index points)`}
          help={
            "Search the sum of incoming surplus indices within these offsets from your fixed outgoing sum. Example: outgoing 45 with 5 below and 5 above searches 40–50. This is index matching, not projected points, fair market value or a premium test."
          }
        >
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
        </FilterHelp>
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
        <FilterHelp
          label={`Filter ${label.toLowerCase()} weekly gain`}
          help={`${lineupBasisLabel(lineupBasis)} for both teams, before and after, with required drops and ${m.ignoreByeWeeks ? "byes and temporary injury absences ignored; IR excluded" : "scheduled availability and byes"}. Total model Expected gain divided by ${m.weeks.length} weeks (${m.current}–${m.final}). Example: +24 over 12 weeks is +2/week. The other basis is shown separately. Blank bounds are unbounded; negatives are allowed.`}
        >
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
        </FilterHelp>
        {range.enabled && (
          <div className="trade-search-controls">
            {(["minimum", "maximum"] as const).map((bound) => (
              <div className="trade-search-offset" key={bound}>
                <FilterHelp
                  label={`${label} ${bound} weekly gain (points/week)`}
                  help={
                    "An inclusive bound on average model Expected starting-lineup gain per remaining fantasy week. Blank means no bound; negative numbers allow losses. Example: minimum +2 and blank maximum requires at least +2 points/week. Moving the slider sets its numeric bound."
                  }
                >
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
                </FilterHelp>
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
    <FilterHelp
      label={label}
      help="Require this many distinct offered players to improve the selected role. Either mode permits zero in one group but needs at least one total upgrade. Best counts distinct positions; a player and comparison cannot count twice."
    >
      {" "}
      <label className="control">
        <span>{label}</span>
        <input
          aria-label={label}
          type="number"
          min={upgradeMode === "either" ? 0 : 1}
          max={
            upgradeMode === "best" ? offeredPositions.length : draft.give.length
          }
          step="1"
          value={value}
          onChange={(event) => set(event.target.value)}
        />
      </label>
    </FilterHelp>
  );

  // Chips describe current controls; removing one invalidates old results through the existing context mechanism.
  const chips: { label: string; remove: () => void }[] = [
    // Surface restrictions can be removed without changing the outgoing pool or the other search controls.
    ...(surface
      ? [
          {
            label: `Surface appeal: ${surface.metric}; > 0 and ≥ ${surface.minimum}; ${surface.requireValueTests ? "both value tests required" : "value tests shown"}`,
            remove: () => {
              setSurface(undefined);
              if (goal === "surface") setGoal("custom");
            },
          },
        ]
      : []),
    // Opponent scope participates in the query/context and can be removed without changing other criteria.
    ...(selectedTeams !== undefined
      ? [
          {
            label: `Teams: ${
              selectedTeams.length
                ? opponents
                    .filter((team) => selectedTeams.includes(str(team.TeamID)))
                    .map((team) => str(team.TeamName))
                    .join(", ")
                : "None selected"
            }`,
            remove: () => setSelectedTeams(undefined),
          },
        ]
      : []),
    // Optional discovery criteria use the same removable chips and stale-result protection as existing filters.
    ...(discovery.flexible
      ? [
          {
            label: `Outgoing pool: ${discovery.pool.length}; offer ${discovery.minimum}–${discovery.maximum}`,
            remove: () => setDiscovery({ ...discovery, flexible: false }),
          },
        ]
      : []),
    ...(discovery.target
      ? [
          {
            label: `Target: ${m.byId.get(discovery.target)?.name ?? discovery.target}`,
            remove: () => setDiscovery({ ...discovery, target: "" }),
          },
        ]
      : []),
    ...(discovery.ranking !== "own"
      ? [
          {
            label: `Ranking: ${discovery.ranking}`,
            remove: () => setDiscovery({ ...discovery, ranking: "own" }),
          },
        ]
      : []),
    ...(discovery.nearMisses
      ? [
          {
            label: "Near misses and adjustments",
            remove: () => setDiscovery({ ...discovery, nearMisses: false }),
          },
        ]
      : []),
    ...(packages
      ? [
          {
            // The chip shows the inclusive range, not just its maximum.
            label: `Receive ${receive.minimum === receive.maximum ? receive.minimum : `${receive.minimum}–${receive.maximum}`} player${receive.maximum === 1 ? "" : "s"}`,
            remove: () => setPackages(false),
          },
        ]
      : []),
    ...(signals.length
      ? [
          {
            label: `Incoming ${signals.join(" or ")} (minimum ${minimumSignals})`,
            remove: () => setSignals([]),
          },
        ]
      : []),
    ...(incomingPositions.length
      ? [
          {
            label: `Receive ${incomingPositions.join(" or ")} (minimum ${minimumPositions})`,
            remove: () => setIncomingPositions([]),
          },
        ]
      : []),
    ...(usefulnessOnly
      ? [
          {
            label: `Every offer useful ≥ ${minimumUsefulness} Expected PPG`,
            remove: () => setUsefulnessOnly(false),
          },
        ]
      : []),
    ...(upgradeOnly
      ? [
          {
            label: `Positional upgrades: ${upgradeMode}; ${upgradeMode === "either" ? `${requiredStarters} starter + ${requiredBench} bench` : requiredUpgrades}; ≥ ${minimumUpgrade} Expected PPG`,
            remove: () => setUpgradeOnly(false),
          },
        ]
      : []),
    ...(deficitOnly
      ? [
          {
            label: `Their ${selectedPosition}: ${deficitCeiling} or lower`,
            remove: () => setDeficitOnly(false),
          },
        ]
      : []),
    ...(
      [
        ["Your", ownWeekly, setOwnWeekly],
        ["Their", otherWeekly, setOtherWeekly],
      ] as const
    ).flatMap(([label, range, set]) =>
      range.enabled
        ? [
            {
              label: `${label} weekly gain: ${range.minimum || "any"} to ${range.maximum || "any"} points/week`,
              remove: () => set({ ...range, enabled: false }),
            },
          ]
        : [],
    ),
  ];

  // Controls express raw index matching; premiums and fairness remain visible only as separate evaluation outputs.
  const searchPanel = (
    <SearchSection
      title="Find matching trades"
      open={openFinder === "standard"}
      toggle={() =>
        setOpenFinder((old) => (old === "standard" ? null : "standard"))
      }
      note={`Independent standard-search controls · Scoring basis: ${lineupBasisLabel(lineupBasis)}`}
    >
      {/* Keep every standard search selection inside its own disclosure; none of these setters affects chain controls. */}
      <div className="trade-search-controls">
        <FilterHelp
          label="Standard search team"
          help="Choose the standard finder’s team and outgoing players. This also updates the manual analyzer; it does not change chain settings."
        >
          <label className="control">
            <span>Standard search team</span>
            <select
              value={draft.teamA}
              onChange={(e) =>
                change({ ...draft, teamA: e.target.value, give: [], get: [] })
              }
            >
              <TeamsOptions d={m.dataset} />
            </select>
          </label>
        </FilterHelp>
        <FilterHelp
          label="Standard lineup impact basis"
          help="Choose the scoring basis for this finder and the manual analyzer. The chain planner remembers its own independent choice."
        >
          <label className="control">
            <span>Standard lineup impact basis</span>
            <select
              value={lineupBasis}
              onChange={(e) =>
                onLineupBasisChange?.(readLineupBasis(e.target.value))
              }
            >
              <option value="best-available">Best available lineup</option>
              <option value="marked-starters">Marked starters</option>
            </select>
          </label>
        </FilterHelp>
      </div>
      <details className="trade-search-group">
        <summary>
          Standard fixed outgoing players ({draft.give.length}/5)
        </summary>
        {m.players
          .filter((p) => p.owner === draft.teamA)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => (
            <label className="check" key={p.id}>
              <input
                type="checkbox"
                aria-label={`Standard outgoing player: ${p.name}`}
                checked={draft.give.includes(p.id)}
                disabled={!draft.give.includes(p.id) && draft.give.length >= 5}
                onChange={(e) =>
                  change({
                    ...draft,
                    give: e.target.checked
                      ? [...draft.give, p.id]
                      : draft.give.filter((id) => id !== p.id),
                  })
                }
              />
              {p.name} · {p.pos}
            </label>
          ))}
      </details>
      {/* Goal presets are explicit, reversible shortcuts; advanced criteria remain available without changing valuations. */}
      <div className="trade-search-controls">
        <FilterHelp
          label="Search goal"
          help="Choosing a preset resets screening filters and searches 1–3 incoming players with automatic index matching. Keeps your offered/protected players, required target and selected teams. Surface appeal requires your gain ≥ +1, positive recipient gains under both surface sources, and leaves model value tests optional. Improve scoring requires your gain ≥ +1 and theirs ≥ 0 points/week. Find a position also requires that position's scoring contribution to your optimized lineup to increase, including FLEX. Review value, depth and legality separately."
        >
          <label className="control">
            <span>Search goal</span>
            <select
              aria-label="Search goal"
              value={goal}
              onChange={(e) => {
                const next = e.target.value as typeof goal;
                restoreQuery(guidedQuery(query, next, goalPosition));
                setAdvanced(next === "custom");
              }}
            >
              <option value="explore">Trade away these players</option>
              <option value="improve">Improve my weekly scoring</option>
              <option value="position">Find a position upgrade</option>
              <option value="surface">
                Improve my lineup with surface appeal
              </option>
              <option value="custom">Custom search</option>
            </select>
          </label>
        </FilterHelp>
        {goal === "position" && (
          <label className="control">
            <span>Position to receive</span>
            <select
              aria-label="Position to receive"
              value={goalPosition}
              onChange={(e) =>
                restoreQuery(
                  guidedQuery(query, "position", e.target.value as Position),
                )
              }
            >
              {positions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {/* Source-based appeal is a separate filter; the recipient's modeled loss remains visible beside its apparent source-based gain. */}
      <ManagerControls value={manager} change={setManager} />
      <SurfaceAppealControls
        value={surface}
        week={m.current}
        change={(value) => {
          setSurface(value);
          if (!value && goal === "surface") setGoal("custom");
        }}
      />
      {/* Opponent checkboxes are a search-only scope; all other filters and manual trade selections remain independent. */}
      <details className="trade-search-group">
        <summary>
          <FilterHelp
            label="Teams to search"
            help="Standard finder scope only: applies to singles, packages, near misses and recovery suggestions. Chain teams are configured independently inside the chain planner. A required single-trade target must belong to a selected team."
          >
            <span>
              Teams to search:{" "}
              {selectedTeams === undefined
                ? "All other teams"
                : `${selectedTeams.length} of ${opponents.length} selected`}
            </span>
          </FilterHelp>
        </summary>
        <div className="toolbar">
          <button
            type="button"
            className="subtle"
            onClick={() => setSelectedTeams(undefined)}
          >
            Select all teams
          </button>
          <button
            type="button"
            className="subtle"
            onClick={() => setSelectedTeams([])}
          >
            Clear team selection
          </button>
        </div>
        <div className="trade-search-controls">
          {opponents.map((team) => {
            const id = str(team.TeamID);
            return (
              <label className="check" key={id}>
                <input
                  type="checkbox"
                  aria-label={`Search team: ${str(team.TeamName)}`}
                  checked={
                    selectedTeams === undefined || selectedTeams.includes(id)
                  }
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSelectedTeams((previous) => {
                      const selected =
                        previous ??
                        opponents.map((opponent) => str(opponent.TeamID));
                      return checked
                        ? [...selected, id]
                        : selected.filter((teamID) => teamID !== id);
                    });
                  }}
                />{" "}
                {str(team.TeamName)}
              </label>
            );
          })}
        </div>
      </details>
      <p>
        Receive{" "}
        {receive.minimum === receive.maximum
          ? receive.minimum
          : `${receive.minimum}–${receive.maximum}`}{" "}
        player{receive.maximum === 1 ? "" : "s"}.{" "}
        {indexMode === "automatic"
          ? "Automatic index matching; value differences stay visible."
          : "Strict index range enabled."}
      </p>
      <p>
        Offering: {names(discovery.flexible ? discovery.pool : draft.give)}
        {discovery.flexible &&
          ` (offer ${discovery.minimum}–${discovery.maximum} from this pool)`}
      </p>
      <details
        open={advanced}
        onToggle={(e) => setAdvanced(e.currentTarget.open)}
      >
        <summary>Advanced search controls</summary>
        <TradeDiscoveryControls
          m={m}
          draft={draft}
          value={discovery}
          change={setDiscovery}
          starters={starter.ids}
          startersKnown={!starter.errors.length}
        />
        <p>
          {discovery.flexible ? (
            <>
              Tradable pool: {names(discovery.pool)} · Offer {discovery.minimum}
              –{discovery.maximum} players.
            </>
          ) : (
            <>
              Fixed outgoing: {names(draft.give)} · Combined index:{" "}
              <strong className="model">
                {bounds.errors.length ? "Unavailable" : fmt(bounds.outgoing)}
              </strong>
            </>
          )}
        </p>
        <fieldset className="trade-search-group">
          <legend>Value range</legend>
          <div className="trade-search-controls">
            {/* A strict price window is opt-in; hiding its fields must not leave a hidden active ±5 limit. */}
            <FilterHelp
              label="Use strict index range"
              help="Limit incoming summed indices to your below/above offsets. Automatic matching checks all usable indices and keeps price tests separate from scoring gains."
            >
              <label className="check">
                <input
                  type="checkbox"
                  checked={indexMode === "strict"}
                  onChange={(e) =>
                    setIndexMode(e.target.checked ? "strict" : "automatic")
                  }
                />
                Use strict index range
              </label>
            </FilterHelp>
            {indexMode === "strict" &&
              offsetControl("Below outgoing total", below, setBelow)}
            {indexMode === "strict" &&
              offsetControl("Above outgoing total", above, setAbove)}
            <FilterHelp
              label={"Create package"}
              help={
                discovery.flexible
                  ? "Search a range of incoming sizes for each outgoing subset. Example: receive 1–3 returns singles, pairs and three-player packages from one team. Every package must still meet your index and active filters."
                  : "Keep your outgoing players fixed and search a range of incoming sizes from one team. Example: receive 1–3 checks singles, pairs and three-player packages together. Equal minimum and maximum searches one exact size."
              }
            >
              <label className="check">
                <span>Create package</span>
                <input
                  type="checkbox"
                  checked={packages}
                  onChange={(event) => setPackages(event.target.checked)}
                />
              </label>
            </FilterHelp>
            {/* Inclusive incoming bounds search all selected sizes, independently of outgoing pool combinations. */}
            {packages &&
              (
                [
                  ["Minimum players to receive", minimumCount, setMinimumCount],
                  ["Maximum players to receive", count, setCount],
                ] as const
              ).map(([label, value, set]) => (
                <FilterHelp
                  key={label}
                  label={label}
                  help="Choose an inclusive range from one through five incoming players, all from the same other team. A 1–3 range returns singles, pairs and triples; 2–2 returns exactly two. All active filters still apply to each package."
                >
                  <label className="control">
                    <span>{label}</span>
                    <select
                      aria-label={label}
                      value={value}
                      onChange={(event) => set(Number(event.target.value))}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </FilterHelp>
              ))}
          </div>
        </fieldset>
        {/* Incoming categories combine with all existing criteria and count the same matching players. */}
        <fieldset className="trade-search-group">
          <legend>Incoming players</legend>
          <div className="toolbar">
            {(["Gem", "Watch"] as const).map((label) => (
              <FilterHelp
                key={label}
                label={label}
                help={
                  "Receive at least the selected minimum players labeled Gem or Watch; selecting both labels matches either. With positions enabled, the same counted players must also match those positions. Example: at least two WR players labeled Gem or Watch."
                }
              >
                <label className="check" key={label}>
                  <input
                    type="checkbox"
                    checked={signals.includes(label)}
                    onChange={(e) =>
                      setSignals(
                        e.target.checked
                          ? [...signals, label]
                          : signals.filter((s) => s !== label),
                      )
                    }
                  />
                  {label}
                </label>
              </FilterHelp>
            ))}
          </div>
          {signals.length > 0 && (
            <FilterHelp
              label={"Minimum incoming Gem/Watch matches"}
              help={
                "Minimum number of received players that satisfy the selected signal category and any enabled positions. It cannot exceed the number of players to receive."
              }
            >
              <label className="control">
                <span>Minimum incoming Gem/Watch matches</span>
                <input
                  type="number"
                  min="1"
                  max={query.count}
                  step="1"
                  value={minimumSignals}
                  onChange={(e) => setMinimumSignals(e.target.value)}
                />
              </label>
            </FilterHelp>
          )}
          <div className="toolbar">
            {positions.map((position) => (
              <FilterHelp
                key={position}
                label={`Receive ${position}`}
                help={
                  "Receive players at any selected position. The minimum counts players, not distinct positions. If Gem/Watch is enabled, the same players must satisfy both categories. No position selections means no position restriction."
                }
              >
                <label className="check" key={position}>
                  <input
                    type="checkbox"
                    aria-label={`Receive ${position}`}
                    checked={incomingPositions.includes(position)}
                    onChange={(e) =>
                      setIncomingPositions(
                        e.target.checked
                          ? [...incomingPositions, position]
                          : incomingPositions.filter((p) => p !== position),
                      )
                    }
                  />
                  {position}
                </label>
              </FilterHelp>
            ))}
          </div>
          {incomingPositions.length > 0 && (
            <FilterHelp
              label={"Minimum incoming position matches"}
              help={
                "Minimum number of received players at any selected position, also satisfying selected Gem/Watch signals if enabled. It cannot exceed the number of players to receive."
              }
            >
              <label className="control">
                <span>Minimum incoming position matches</span>
                <input
                  type="number"
                  min="1"
                  max={query.count}
                  step="1"
                  value={minimumPositions}
                  onChange={(e) => setMinimumPositions(e.target.value)}
                />
              </label>
            </FilterHelp>
          )}
        </fieldset>
        <fieldset className="trade-search-group">
          <legend>Roster fit</legend>
          {/* Original-roster comparisons establish improvement; complete-package roles still account for departures and drops. */}
          <div className="trade-search-controls">
            <FilterHelp
              label={"Every offered player must be useful to the other team"}
              help={
                "Every offer must improve a distinct modeled starter or best-backup role compared with the team's roster before the trade, including players traded away or dropped. Departures cannot create zero-point comparison vacancies. The offer must still fill that role after departures and required drops. Uses model Expected PPG, independently of marked starters. Default: +1.0 PPG. Backups must also beat displaced-player competition; missing comparisons do not qualify. Example: one QB starter upgrade plus one WR backup upgrade. This does not establish net weekly gain or fair value."
              }
            >
              <label className="check">
                <span>
                  Every offered player must be useful to the other team
                </span>
                <input
                  type="checkbox"
                  checked={usefulnessOnly}
                  onChange={(e) => setUsefulnessOnly(e.target.checked)}
                />
              </label>
            </FilterHelp>
            {usefulnessOnly && (
              <FilterHelp
                label={"Minimum usefulness improvement (Expected PPG)"}
                help={
                  "Every offered player must improve its distinct role by at least this much model Expected PPG. Default +1.0. A backup must also beat the strongest other resulting reserve by that amount. Example: +0.5 does not meet +1.0."
                }
              >
                <label className="control">
                  <span>Minimum usefulness improvement (Expected PPG)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={minimumUsefulness}
                    onChange={(e) => setMinimumUsefulness(e.target.value)}
                  />
                </label>
              </FilterHelp>
            )}
          </div>
          {/* Qualify teams using current positional needs; keep this separate from net trade impact and index bounds. */}
          <div className="trade-search-controls">
            <FilterHelp
              label={"Only show positional upgrades for the other team"}
              help={`${upgradeOnly ? (upgradeMode === "best" ? `Requires at least ${formatUpgradeCount(query.upgrade?.requiredBest)} distinct positions upgraded.` : `Requires at least ${formatUpgradeCount(query.upgrade?.requiredStarters)} starter upgrades and ${formatUpgradeCount(query.upgrade?.requiredBench)} bench upgrades.`) : "Require your selected number of distinct positional upgrades."} Uses Expected PPG against their pre-trade roster, including players they send away. Comparisons are distinct. Starter uses marked/imported starters; Depth uses actual bench; Best includes the entire position, including IR. Net scoring gain is separate.`}
            >
              <label className="check">
                <span>Only show positional upgrades for the other team</span>
                <input
                  type="checkbox"
                  checked={upgradeOnly}
                  onChange={(event) => setUpgradeOnly(event.target.checked)}
                />
              </label>
            </FilterHelp>
            {upgradeOnly && (
              <>
                <FilterHelp
                  label={"Upgrade target"}
                  help={
                    "Starter compares same-position marked/imported starters, including FLEX. Depth compares actual bench players, excluding IR. Either allows both with separate minimums. Best compares the strongest Expected PPG player at each position anywhere on their roster, including bench and IR."
                  }
                >
                  <label className="control">
                    <span>Upgrade target</span>
                    <select
                      aria-label="Upgrade target"
                      value={upgradeMode}
                      onChange={(event) =>
                        setUpgradeMode(
                          event.target.value as UpgradeFilter["mode"],
                        )
                      }
                    >
                      <option value="starter">Starter</option>
                      <option value="depth">Depth (bench)</option>
                      <option value="either">Either</option>
                      <option value="best">Best at position</option>
                    </select>
                  </label>
                </FilterHelp>
                {/* Single targets use one minimum; Either requires both independently selected group minimums. */}
                {upgradeMode !== "depth" &&
                  upgradeMode !== "best" &&
                  upgradeCountControl(
                    "Minimum starter upgrades",
                    upgradeMode === "either"
                      ? requiredStarters
                      : requiredUpgrades,
                    upgradeMode === "either"
                      ? setRequiredStarters
                      : setRequiredUpgrades,
                  )}
                {upgradeMode !== "starter" &&
                  upgradeMode !== "best" &&
                  upgradeCountControl(
                    "Minimum bench upgrades",
                    upgradeMode === "either" ? requiredBench : requiredUpgrades,
                    upgradeMode === "either"
                      ? setRequiredBench
                      : setRequiredUpgrades,
                  )}
                {/* Best-roster matches count positions, with one comparison for the team's strongest owned player at each. */}
                {upgradeMode === "best" &&
                  upgradeCountControl(
                    "Minimum positions upgraded",
                    requiredUpgrades,
                    setRequiredUpgrades,
                  )}
                <FilterHelp
                  label={"Minimum Expected PPG upgrade"}
                  help={
                    "Each counted comparison must improve model Expected PPG by this inclusive amount, without rounding. Example: 18 versus 16 meets a +2 minimum. A zero threshold still requires a positive gain."
                  }
                >
                  <label className="control">
                    <span>Minimum Expected PPG upgrade</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={minimumUpgrade}
                      onChange={(event) =>
                        setMinimumUpgrade(event.target.value)
                      }
                    />
                  </label>
                </FilterHelp>
              </>
            )}
          </div>
          {/* Reuse existing league-relative team grades for one offered position. */}
          <div className="trade-search-controls">
            <FilterHelp
              label={"Only teams with a positional deficit"}
              help={
                "Use their current position grade relative to this fantasy league, as shown in League teams. The ceiling is inclusive: QB C+ includes C+ and lower. Unavailable grades cannot qualify. When positional upgrades are enabled, an upgrade must match this selected position."
              }
            >
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
            </FilterHelp>
            {deficitOnly && (
              <>
                <FilterHelp
                  label={"Deficit position"}
                  help={
                    "Choose one position represented among your offered players. Its grade controls the deficit test even when your package also contains other positions."
                  }
                >
                  <label className="control">
                    <span>Deficit position</span>
                    <select
                      aria-label="Deficit position"
                      value={
                        offeredPositions.includes(selectedPosition as Position)
                          ? selectedPosition
                          : ""
                      }
                      onChange={(event) =>
                        setDeficitPosition(event.target.value)
                      }
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
                </FilterHelp>
                <FilterHelp
                  label={"Maximum position grade"}
                  help={
                    "The selected grade and every lower grade qualify. Grades compare modeled starter Value PPG per slot with this fantasy league’s median, not the entire NFL."
                  }
                >
                  <label className="control">
                    <span>Maximum position grade</span>
                    <select
                      aria-label="Maximum position grade"
                      value={deficitCeiling}
                      onChange={(event) =>
                        setDeficitCeiling(event.target.value)
                      }
                    >
                      {positionGradeScale.map((grade) => (
                        <option key={grade} value={grade}>
                          {grade} or lower
                        </option>
                      ))}
                    </select>
                  </label>
                </FilterHelp>
              </>
            )}
          </div>
        </fieldset>
        <fieldset className="trade-search-group">
          <legend>Scoring impact</legend>
          {/* Screen existing average lineup gains independently for either or both teams. */}
          {weeklyControls("Your", ownWeekly, setOwnWeekly)}
          {weeklyControls("Their", otherWeekly, setOtherWeekly)}
        </fieldset>
      </details>
      <div
        className="active-filter-chips"
        aria-label="Active trade-search filters"
      >
        {chips.map((chip) => (
          <button
            type="button"
            key={chip.label}
            aria-label={`Remove ${chip.label}`}
            onClick={chip.remove}
          >
            {chip.label} ×
          </button>
        ))}
      </div>
      {!bounds.errors.length &&
        !discovery.flexible &&
        indexMode === "strict" && (
          <p>
            Incoming index range:{" "}
            <strong
              className="model"
              title={`${bounds.lower} through ${bounds.upper}`}
            >
              {fmt(bounds.lower)}–{fmt(bounds.upper)}
            </strong>{" "}
            (inclusive) · Receive{" "}
            {receive.minimum === receive.maximum
              ? receive.minimum
              : `${receive.minimum}–${receive.maximum}`}{" "}
            player
            {receive.maximum === 1 ? "" : "s"} from one other team.
          </p>
        )}
      {/* These are exact raw offer extrema, never premium-adjusted and never a promise that every interior value is attainable. */}
      {discovery.flexible && poolRange && (
        <div className="notice">
          <p aria-label="Search package scope">
            Offer{" "}
            {poolRange.counts[0].count === poolRange.counts.at(-1)!.count
              ? poolRange.counts[0].count
              : `${poolRange.counts[0].count}–${poolRange.counts.at(-1)!.count}`}{" "}
            of {discovery.pool.length} pooled players · Receive{" "}
            {receive.minimum === receive.maximum
              ? receive.minimum
              : `${receive.minimum}–${receive.maximum}`}{" "}
            player{receive.maximum === 1 ? "" : "s"} from one team.
          </p>
          <strong className="model">
            Pool offer index: {fmt(poolRange.minimum)}–{fmt(poolRange.maximum)}
          </strong>
          <div>
            {poolRange.counts.map((r) => (
              <span key={r.count}>
                {r.count} player{r.count === 1 ? "" : "s"}:{" "}
                <span className="model">
                  {fmt(r.minimum)}–{fmt(r.maximum)}
                </span>
                {" · "}
              </span>
            ))}
          </div>
          <small>
            Raw achievable minimum–maximum before search filters. Values inside
            the range may have gaps.
          </small>
        </div>
      )}
      {bounds.errors.length > 0 && (
        <p className="notice danger">{bounds.errors.join(" ")}</p>
      )}
      <p>
        <small>
          Lineup source: {starter.source}
          {m.ignoreByeWeeks &&
            " · Hypothetical: byes ignored; temporary injury absences ignored; IR excluded"}{" "}
          · Weeks {m.current}–{m.final} · Source refreshed:{" "}
          {m.dataset.sourceUTC
            ? new Date(m.dataset.sourceUTC).toLocaleString()
            : "Unavailable"}
          .
        </small>
      </p>
      <div className="toolbar">
        {/* Export is explicit and local; the report contains analysis data and controls, never account/session credentials. */}
        <button
          className="button"
          onClick={() => {
            const report = {
              ...tradeDebugReport(
                m,
                query,
                draft,
                lineupsRaw,
                appliedSearch.current,
                {
                  status: job?.status ?? "not searched",
                  stale,
                  stats: job?.stats,
                  total: job?.total,
                  loadedRows: job?.rows.length,
                },
              ),
              appVersion: import.meta.env.VITE_APP_VERSION,
              // Include chain current/applied controls, per-leg evidence, rejection examples and stale status in the same debug file.
              chainSearch: chainDebug.current,
              controls: {
                below,
                above,
                packages,
                minimumCount,
                count,
                discovery,
                selectedTeams,
                signals,
                incomingPositions,
                minimumSignals,
                minimumPositions,
                upgradeOnly,
                upgradeMode,
                minimumUpgrade,
                usefulnessOnly,
                minimumUsefulness,
                requiredUpgrades,
                requiredStarters,
                requiredBench,
                ownWeekly,
                otherWeekly,
                deficitOnly,
                deficitPosition,
                deficitCeiling,
              },
              loadedCandidate: job?.rows.some(
                (r) =>
                  JSON.stringify([...(r.give ?? query.give)].sort()) ===
                    JSON.stringify([...draft.give].sort()) &&
                  JSON.stringify([...r.get].sort()) ===
                    JSON.stringify([...draft.get].sort()),
              ),
            };
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(report, null, 2)], {
                type: "application/json",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "fantasy-trade-debug.json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 0);
          }}
        >
          Download search debug
        </button>
        <button
          className="button"
          onClick={() => {
            const result = diagnoseTradeCandidate(m, query, draft, lineupsRaw);
            // Explain one exact candidate on both bases while preserving every active filter.
            const scoring =
              result.beforeAfter && result.alternative
                ? `${result.basisLabel}: your Before ${fmt(result.beforeAfter.ownBefore)} → After ${fmt(result.beforeAfter.ownAfter)} (${signed(result.ownGainPerWeek ?? null)} points/week); their Before ${fmt(result.beforeAfter.otherBefore)} → After ${fmt(result.beforeAfter.otherAfter)} (${signed(result.otherGainPerWeek ?? null)} points/week). Alternative ${lineupBasisLabel(result.alternative.basis)}: your Before ${fmt(result.alternative.ownBefore)} → After ${fmt(result.alternative.ownAfter)} (${signed(result.alternative.own)}); their Before ${fmt(result.alternative.otherBefore)} → After ${fmt(result.alternative.otherAfter)} (${signed(result.alternative.other)}). `
                : "";
            setDiagnostic(
              scoring +
                (result.reasons.length
                  ? result.reasons.join(" ")
                  : "This candidate passes the current search filters. Check the applied-versus-current settings, completed-search status and later ranked result pages in the debug export."),
            );
          }}
        >
          Why wasn’t this trade found?
        </button>
        <button
          className="button primary"
          disabled={bounds.errors.length > 0}
          onClick={search}
        >
          {running ? "Restart search" : "Search"}
        </button>
        {/* Keep the one-click recovery available even when an invalid filter disables Search. */}
        <FilterHelp
          label="Clear filters"
          help="Clears optional search restrictions, target, ranking and near misses; restores automatic index matching and removes previous results. Keeps your selected players, protected tradable pool and outgoing/incoming package sizes."
        >
          <button type="button" className="subtle" onClick={clearFilters}>
            Clear filters
          </button>
        </FilterHelp>
        {(running || (!stale && job?.recovery?.busy)) && (
          <button className="subtle" onClick={cancel}>
            Cancel
          </button>
        )}
      </div>
      {diagnostic && (
        <p className="notice" role="status">
          {diagnostic}
        </p>
      )}
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
                ? ` ${job.progress.stats.scored.toLocaleString()} of ${job.progress.stats.matched.toLocaleString()} (${job.progress.stats.matched ? Math.floor((100 * job.progress.stats.scored) / job.progress.stats.matched) : 100}%)`
                : ` ${job.progress.stats.checked}/${job.progress.stats.teams} ${multiplePackages ? "team/package checks" : "teams"}; ${job.progress.stats.matched} matches`)}
            {/* Show elapsed time and a changing estimate so a large, finite search does not look frozen. */}
            {job.progress?.elapsedMs !== undefined && (
              <small>
                Elapsed: {searchDuration(job.progress.elapsedMs)}.
                {job.progress.remainingMs !== undefined &&
                  ` Estimated remaining: ${searchDuration(job.progress.remainingMs)} (may change).`}
              </small>
            )}
            <small>
              Every match is evaluated before results appear. Large searches can
              take several minutes; Cancel to narrow the index range or package
              sizes.
            </small>
          </span>
        </div>
      )}
      {stale && (
        <p className="notice warning" role="status">
          Search inputs changed. Displayed figures belong to the previous
          search. You can still save or load these trades; loading recalculates
          current results.
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
          (job.status === "stale" &&
            (job.rows.length > 0 || !!job.suggestions?.length))) && (
          <>
            <p role="status">
              {job.total} index matches. Ranked by{" "}
              {discovery.ranking === "balanced"
                ? "benefit to both teams"
                : discovery.ranking === "other"
                  ? "their model expected roster-potential gain per week"
                  : "your model expected lineup gain per week"}
              ; an index match is not a fairness or acceptance guarantee.
            </p>
            {/* A zero final result must not imply enumeration failed or that the pool had no index matches. */}
            {!stale && !job.total && !!job.stats?.weeklyExcluded && (
              <p className="notice warning" role="status">
                {job.stats.scored} index-matched trades were evaluated;{" "}
                {job.stats.weeklyExcluded} failed your weekly-gain limits.{" "}
                {query.weekly?.own?.minimum != null &&
                  `Your minimum: ${query.weekly.own.minimum} points/week. `}
                {query.weekly?.other?.minimum != null &&
                  `Their minimum: ${query.weekly.other.minimum} points/week. `}
                Enable Near misses to inspect evaluated alternatives with unmet
                limits.
              </p>
            )}
            {/* Counts come from the same complete evaluator; applying a proposal is always an explicit user action. */}
            {!stale && !job.total && job.recovery && (
              <div className="notice" aria-label="Search recovery options">
                {job.recovery.busy ? (
                  <p role="status">
                    Checking recovery options…{" "}
                    {job.recovery.total
                      ? `${job.recovery.checked} of ${job.recovery.total} evaluated`
                      : "Finding candidate packages"}
                    . Your filters are unchanged.
                  </p>
                ) : (
                  <>
                    <p>
                      {job.recovery.error ??
                        (job.recovery.options?.length
                          ? "Try an evaluated adjustment:"
                          : "No matches with these limited adjustments. Review your advanced criteria or offered players.")}
                    </p>
                    {job.recovery.options?.map((option) => (
                      <button
                        key={option.id}
                        className="button"
                        onClick={() => {
                          restoreQuery(option.query);
                          setAdvanced(true);
                          setPendingSearch(option.query);
                        }}
                      >
                        {option.changes.join(" + ")} → {option.count} matches
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
            <div className="table-wrap">
              <table className="trade-search-results">
                <thead>
                  <tr>
                    <th>Incoming / team</th>
                    <th className="model">Index / difference</th>
                    <th className="model">
                      Your gain / week
                      <small>
                        {lineupBasisLabel(
                          job.rows[0]?.lineupBasis ?? lineupBasis,
                        )}
                      </small>
                    </th>
                    <th className="model">
                      Their gain / week
                      <small>
                        {lineupBasisLabel(
                          job.rows[0]?.lineupBasis ?? lineupBasis,
                        )}
                      </small>
                    </th>
                    {job.rows.some((row) => row.surface) && (
                      <>
                        <th className="fact">Their season-average gain</th>
                        <th className="projection">
                          Their ESPN Week{" "}
                          {job.rows.find((row) => row.surface)?.surface?.week}{" "}
                          gain
                        </th>
                      </>
                    )}
                    <th>Value exchange / tests</th>
                    <th>Details / load</th>
                  </tr>
                </thead>
                <GroupedTradeRows
                  rows={job.rows}
                  m={resultModel.current ?? m}
                  render={(row) => (
                    <tr key={row.key} data-trade-result>
                      <td>
                        {names(row.get)}
                        {row.give && <small>Offer: {names(row.give)}</small>}
                        {/* Display existing primary labels and positions so incoming-filter matches can be inspected. */}
                        {query.incoming && (
                          <small>
                            {row.get
                              .map((id) => {
                                const p = m.byId.get(id)!;
                                return `${p.name}: ${p.pos}, ${p.gem}`;
                              })
                              .join("; ")}
                          </small>
                        )}
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
                        {row.usefulness && (
                          <small className="model">
                            {row.usefulness.length}/
                            {(row.give ?? query.give).length} players useful
                          </small>
                        )}
                      </td>
                      <td className="model">{scoring(row.own)}</td>
                      <td className="model">{scoring(row.other)}</td>
                      {job.rows.some((candidate) => candidate.surface) && (
                        <>
                          <td className="fact">
                            {row.surface?.average.gain == null
                              ? "Unavailable"
                              : scoring(row.surface.average.gain)}
                          </td>
                          <td className="projection">
                            {row.surface?.projection.gain == null
                              ? "Unavailable"
                              : scoring(row.surface.projection.gain)}
                          </td>
                        </>
                      )}
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
                        {row.manager && (
                          <p className="model">
                            {row.manager.range
                              ? `Estimated acceptance ${row.manager.range[0]}–${row.manager.range[1]}%`
                              : `Manager assessment: ${row.manager.status}`}
                          </p>
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
                          {/* Keep the scoring bases explicit without changing the independent positional-fit or price tests. */}
                          <p>
                            <small>
                              {lineupBasisLabel(row.lineupBasis)} for both
                              teams, including required drops.
                              <span className="model">
                                {" "}
                                Your Before {fmt(row.ownBefore)} → After{" "}
                                {fmt(row.ownAfter)}; Their Before{" "}
                                {fmt(row.otherBefore)} → After{" "}
                                {fmt(row.otherAfter)} points/week.
                              </span>
                            </small>
                          </p>
                          {row.manager && (
                            <ManagerEvidence
                              value={row.manager}
                              m={resultModel.current ?? m}
                              draft={{
                                teamA:
                                  appliedSearch.current?.query.teamA ??
                                  query.teamA,
                                teamB: row.teamB,
                                give:
                                  row.give ??
                                  appliedSearch.current?.query.give ??
                                  query.give,
                                get: row.get,
                              }}
                              basis={row.lineupBasis}
                              lineupsRaw={lineupsRaw}
                              allowLog={!stale}
                            />
                          )}
                          {row.surface && (
                            <SurfaceAppealView value={row.surface} m={m} />
                          )}
                          {/* Always explain recipient roles, even when optional upgrade filters are disabled. */}
                          <OpponentIncentiveView
                            m={m}
                            value={job.lineups?.[row.key]?.details?.incentive}
                            inspect={() => inspect(row)}
                            stale={stale}
                          />
                          {/* Show the exact qualifying comparison instead of implying a guaranteed net improvement or acceptance. */}
                          {row.upgrades?.map((upgrade) => (
                            <p key={`${upgrade.offered}-${upgrade.group}`}>
                              {upgrade.group === "best"
                                ? "Best-at-position upgrade"
                                : upgrade.group === "starter"
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
                          {/* Show unique baseline roles and the separate reserve competition check for the complete package. */}
                          {row.usefulness && (
                            <details className="usefulness-details">
                              <summary>Usefulness comparisons</summary>
                              {row.usefulness?.map((fit) => (
                                <p key={fit.offered}>
                                  Useful{" "}
                                  {fit.group === "starter"
                                    ? "starter"
                                    : "backup"}
                                  : {names([fit.offered])} (
                                  <span className="model">
                                    {fmt(fit.offeredPPG)}
                                  </span>
                                  ) vs{" "}
                                  {fit.compared
                                    ? names([fit.compared])
                                    : "role already vacant before trade"}{" "}
                                  (
                                  <span className="model">
                                    {fmt(fit.comparedPPG)}
                                  </span>
                                  ) ·{" "}
                                  <span className="model">
                                    {signed(fit.gain)} Expected PPG
                                  </span>
                                  . {fit.role}; comparison with roster before
                                  trade, including departing/dropped players.
                                  {/* Show the captured minimum beside the gain so the qualification is directly reviewable. */}{" "}
                                  Required improvement: +
                                  <span className="model">
                                    {fmt(fit.minimum)}
                                  </span>{" "}
                                  Expected PPG per player.
                                  {fit.competitionPPG !== null && (
                                    <>
                                      {" "}
                                      Strongest other resulting reserve:{" "}
                                      <span className="model">
                                        {fmt(fit.competitionPPG)}
                                      </span>{" "}
                                      Expected PPG; advantage{" "}
                                      <span className="model">
                                        {signed(fit.competitionGain)}
                                      </span>
                                      .
                                    </>
                                  )}
                                </p>
                              ))}
                            </details>
                          )}
                          {/* An unmatched offer must not borrow another assignment's opponent or imply an extra upgrade. */}
                          {row.upgrades &&
                            !stale &&
                            (row.give ?? draft.give).some(
                              (id) =>
                                !row.upgrades!.some(
                                  (upgrade) => upgrade.offered === id,
                                ),
                            ) && (
                              <p>
                                No distinct qualifying upgrade for:{" "}
                                {names(
                                  (row.give ?? draft.give).filter(
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
                            (
                              [
                                "own",
                                "other",
                                "ownMarked",
                                "otherMarked",
                              ] as const
                            ).map((side) => {
                              const detail =
                                job.lineups![row.key].details![side];
                              // Both measurements retain their own named weekly changes; the secondary views are explanatory only.
                              const title = {
                                own:
                                  lineupBasis === "best-available"
                                    ? "Your roster potential"
                                    : "Your marked-starter impact",
                                other:
                                  lineupBasis === "best-available"
                                    ? "Their scoring lineup"
                                    : "Their marked-starter impact",
                                ownMarked:
                                  lineupBasis === "best-available"
                                    ? "Your marked-starter impact"
                                    : "Your roster potential",
                                otherMarked:
                                  lineupBasis === "best-available"
                                    ? "Their marked-starter impact"
                                    : "Their best available lineup",
                              }[side];
                              const weeklyTitle = {
                                own: "Your weekly scoring replacements",
                                other: "Their weekly scoring replacements",
                                ownMarked:
                                  lineupBasis === "best-available"
                                    ? "Your marked-starter weekly replacements"
                                    : "Your best-lineup weekly replacements",
                                otherMarked:
                                  lineupBasis === "best-available"
                                    ? "Their marked-starter weekly replacements"
                                    : "Their best-lineup weekly replacements",
                              }[side];
                              return (
                                <div key={side}>
                                  <p>
                                    <strong>{title}</strong> · {detail.source}
                                  </p>
                                  <p className="model">
                                    Expected gain:{" "}
                                    {scoring(detail.expectedPerWeek)}{" "}
                                    points/week; {scoring(detail.expectedTotal)}{" "}
                                    total through Week {m.final}.
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
                                    <summary>{weeklyTitle}</summary>
                                    <p>
                                      <small>
                                        Same-slot before → after. Slot moves
                                        (including FLEX) can produce multiple
                                        rows; the weekly total includes all
                                        changes and{" "}
                                        {m.ignoreByeWeeks
                                          ? "IR exclusions; byes and temporary injury absences are ignored in this simulation"
                                          : "byes"}
                                        .
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
                        <button className="subtle" onClick={() => load(row)}>
                          Load trade
                        </button>
                        {save && (
                          <button
                            className="button primary"
                            aria-label="Save trade"
                            onClick={() => saveRow(row)}
                          >
                            <Bookmark size={16} aria-hidden="true" />{" "}
                            {savedRow === row.key ? "Saved" : "Save trade"}
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                />
              </table>
            </div>
            {/* Alternatives remain separate from exact matches and disclose every unmet limit before loading. */}
            {!!job.suggestions?.length && (
              <details className="search-adjustments">
                <summary>
                  Near misses and possible adjustments (top{" "}
                  {job.suggestions.length})
                </summary>
                {job.suggestions.map((row) => (
                  <div key={row.key} className="panel">
                    <p>
                      Offer: {names(row.give ?? query.give)} · Receive:{" "}
                      {names(row.get)} ·{" "}
                      {str(
                        m.dataset.tables.ModelTeams.find(
                          (team) => str(team.TeamID) === row.teamB,
                        )?.TeamName,
                      )}
                    </p>
                    <p>
                      Your gain:{" "}
                      <span className="model">{scoring(row.own)}</span>{" "}
                      points/week · Their gain:{" "}
                      <span className="model">{scoring(row.other)}</span>{" "}
                      points/week · Incoming index:{" "}
                      <span className="model">{fmt(row.incoming)}</span>.
                    </p>
                    {row.surface && (
                      <SurfaceAppealView value={row.surface} m={m} />
                    )}
                    {row.nearMiss?.reasons.map((reason) => (
                      <p key={reason} className="model">
                        {reason}
                      </p>
                    ))}
                    <p>
                      Value: {row.grade}. Surplus: {row.surplus}. Points:{" "}
                      {row.points}.{" "}
                      {row.warnings.length
                        ? "CONDITIONAL: " + row.warnings.join("; ")
                        : "Legal modeled rosters."}
                    </p>
                    <button
                      type="button"
                      className="subtle"
                      onClick={() => load(row)}
                    >
                      Inspect this alternative
                    </button>
                  </div>
                ))}
              </details>
            )}
            {job.total === 0 && (
              <p>
                {query.weekly ||
                query.deficit ||
                query.upgrade ||
                query.usefulness ||
                query.incoming
                  ? "No packages match this index range, incoming count and active filters."
                  : "No trades meet the current search criteria."}
              </p>
            )}
            <details className="search-exclusions">
              <summary>Why trades were excluded</summary>
              {/* Report post-evaluation filtering separately from index/positional eligibility. */}
              {job.stats?.managerExcluded !== undefined && (
                <p>
                  Manager-expectation exclusions: {job.stats.managerExcluded}.
                  Missing evidence and safeguard failures remain distinct in
                  evaluated near misses.
                </p>
              )}
              {job.stats?.surfaceExcluded !== undefined && (
                <p>
                  Trades excluded by surface appeal, model-gain, legal-roster or
                  optional value-test requirements: {job.stats.surfaceExcluded}.
                  Missing selected surface data is excluded rather than treated
                  as zero.
                </p>
              )}
              {job.stats?.protectedExcluded !== undefined && (
                <p>
                  Packages excluded to protect your roster from automatic drops:{" "}
                  {job.stats.protectedExcluded}.
                </p>
              )}
              {job.stats?.incomingExcluded !== undefined && (
                <p>
                  Packages excluded by incoming player filters:{" "}
                  {job.stats.incomingExcluded}.
                </p>
              )}
              {job.stats?.weeklyExcluded !== undefined && (
                <p>
                  Trades excluded by weekly-gain limits:{" "}
                  {job.stats.weeklyExcluded}. All {job.stats.scored}{" "}
                  index/positional matches were evaluated before filtering;
                  unavailable bounded weekly gains are excluded.
                </p>
              )}
              {/* Report package usefulness separately from legacy team-level fit and weekly scoring filters. */}
              {job.stats?.usefulnessExcluded !== undefined && (
                <p>
                  Trades excluded because not every offered player is useful:{" "}
                  {job.stats.usefulnessExcluded}. Includes dropped/IR offers and
                  unavailable comparisons. All {job.stats.scored}{" "}
                  index/positional matches were evaluated before filtering.
                </p>
              )}
              {/* Count excluded teams separately from evaluated-package weekly-gain exclusions. */}
              {job.stats?.deficitExcluded !== undefined && (
                <p>
                  {multiplePackages ? "Team/package checks" : "Teams"} excluded
                  by positional-deficit filter: {job.stats.deficitExcluded}.
                  Includes unavailable grades.
                </p>
              )}
              {/* Report filtering independently of missing-index and package-size exclusions. */}
              {job.stats?.upgradeExcluded !== undefined && (
                <p>
                  {multiplePackages ? "Team/package checks" : "Teams"} excluded
                  by positional-upgrade filter: {job.stats.upgradeExcluded}.
                  Includes teams without usable comparison data.
                </p>
              )}
              <p>
                {multiplePackages
                  ? "Missing-index exclusions across package searches"
                  : "Missing-index players excluded"}
                : {job.stats?.excluded ?? 0}.
                {multiplePackages ? "Team/package checks" : "Teams"} with too
                few eligible players: {job.stats?.thinTeams ?? 0}. Counts
                describe successive search stages and should not be added
                together.
              </p>
            </details>
            <div className="table-footer">
              <span>
                {job.rows.length} of {job.total} matches
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
    </SearchSection>
  );
  // Chain initial values migrate once; its own state and persisted preferences no longer follow standard-search edits.
  return (
    <>
      {searchPanel}
      <TradeChains
        m={m}
        team={draft.teamA}
        pool={discovery.flexible ? discovery.pool : draft.give}
        basis={lineupBasis}
        lineupsRaw={lineupsRaw}
        save={save}
        selectedTeams={
          initialSettings.standard?.query?.discovery?.teams ?? selectedTeams
        }
        initial={initialSettings.chain}
        remember={(value) =>
          setChainSettings((previous) =>
            JSON.stringify(previous) === JSON.stringify(value)
              ? previous
              : value,
          )
        }
        open={openFinder === "chain"}
        toggle={() =>
          setOpenFinder((old) => (old === "chain" ? null : "chain"))
        }
        debug={(value) => {
          chainDebug.current = value;
        }}
      />
    </>
  );
}
