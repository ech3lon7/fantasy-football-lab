import type { ResultRowView } from "../../../domain/view/search-rows";
import {
  availableStarterPositions,
  type PositionalGradeImpactRule,
} from "../../../domain/chain-position-impact";
import {
  emptyTradeBrowse,
  type TradeBrowseOptions,
  type TradeResultView,
} from "../../../domain/trade-result-groups";
import { useNegotiations } from "../../Negotiations";
import type { ManagerSettings } from "../../../domain/manager-expectations";
import { withoutLegacySurface } from "../../../domain/surface-appeal";
// Render the domain's complete primary-label choices consistently with the screener.
import { primaryGemSignals } from "../../../domain/label-rules";
import {
  readLineupBasis,
  type LineupBasis,
} from "../../../domain/trade-impact";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchSessions } from "./search-sessions-context";
import { useSearchLimits } from "../limitsContext";
import { sourceDataset } from "../../../domain/roster-scenarios";
import { poolIndexRanges } from "../../../domain/trade-tools";
import { str, type Draft, type Position } from "../../../domain/contracts";
import {
  summaryFromSearch,
  type SavedTradeSummary,
} from "../../../domain/saved-trades";
import type { Model } from "../../../domain/valuation";
import { readStarterLineup } from "../../../domain/starter-lineups";
import {
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
  type SearchFilterSort,
  type UpgradeFilter,
  type WeeklyRange,
  type TradeSearchQuery,
} from "../../../domain/trade-search";
import {
  defaultDeficitProtection,
  type DeficitProtection,
} from "../../../domain/trade-safeguards";
import { searchCue, useFeedback } from "../../../ui/feel/feedback";

import { mergeTradeSettings, readTradeSettings } from "./tradeSettings";
import { defaultTradeFilters, type TradeFilters } from "../../../domain/trade-filters";
import { migrateLegacyTradeQuery } from "../../../domain/trade-query-migration";

// Keep exploratory controls local until an evaluated package is explicitly loaded or saved.
export interface DiscoveryState {
  flexible: boolean;
  pool: string[];
  minimum: string;
  maximum: string;
  target: string;
  targetSearch: string;
  ranking: "own" | "other" | "balanced" | "acceptance";
  nearMisses: boolean;
}
export const initialDiscovery: DiscoveryState = {
  flexible: false,
  pool: [],
  minimum: "1",
  maximum: "3",
  target: "",
  targetSearch: "",
  ranking: "own",
  nearMisses: false,
};

interface SearchJob {
  id: string;
  context: string;
  status: "running" | "complete" | "cancelled" | "error" | "stale";
  progress?: SearchProgress;
  rows: SearchRow[];
  view?: TradeResultView;
  suggestions?: SearchRow[];
  total: number;
  stats?: SearchStats;
  // Preserve measured broad-search coverage while paging through the same results.
  coverage?: { singles: number; extensions: number; opponents: number; beamCutoffs: number;
    beamCutoffsByTeam: Record<string, Record<string, number>>; missingTeams?: string[] };
  // Each opponent's progress through the search, by team id, for the search scene.
  teams?: Record<string, { singles: number; extensions: number; done: boolean }>;
  // Hidden reasons and per-filter counts are tied to the same retained result set.
  filterCounts?: Record<string, number>;
  filterBlocks?: Record<string, number>;
  hiddenRows?: { row: SearchRow; reasons: string[] }[];
  visibleTotal?: number;
  groupsTotal?: number;
  error?: string;
  // The display view of each row shown so far, scored in the worker (rows without one are scored when they are drawn).
  views?: Record<string, ResultRowView>;
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
export function searchDuration(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// The controls as saved with a search; every field is optional because older saved searches carry fewer of them.
export interface StoredControls {
  below: string;
  above: string;
  indexMode: "automatic" | "strict";
  goal: NonNullable<TradeSearchQuery["goal"]>;
  goalPosition: Position;
  manager: ManagerSettings | undefined;
  advanced: boolean;
  discovery: DiscoveryState;
  selectedTeams: string[] | undefined;
  packages: boolean;
  count: number;
  signals: (typeof primaryGemSignals)[number][];
  incomingPositions: Position[];
  minimumSignals: string;
  minimumPositions: string;
  upgradeOnly: boolean;
  upgradeMode: UpgradeFilter["mode"];
  minimumUpgrade: string;
  usefulnessOnly: boolean;
  minimumUsefulness: string;
  requiredUpgrades: string;
  requiredStarters: string;
  requiredBench: string;
  ownWeekly: { enabled: boolean; minimum: string; maximum: string };
  otherWeekly: { enabled: boolean; minimum: string; maximum: string };
  deficitOnly: boolean;
  deficitPosition: string;
  deficitCeiling: string;
  gradeImpacts: PositionalGradeImpactRule[];
  deficitProtection: DeficitProtection;
}

export interface TradeSearchHookProps {
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
  settingsRaw?: string;
  saveSettings?: (raw: string) => void;
}

// State, saved settings and worker control for Find trades. It renders nothing; the screens read plain data and call plain functions.
export function useTradeSearch({
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
}: TradeSearchHookProps) {
  // Restore each finder from its own preference record; never store ephemeral results or change the other finder's query.
  // The Gameday Plus Trade room supplies one shared set of limits; without it the current controls apply.
  const limits = useSearchLimits();
  const [initialSettings] = useState(() => readTradeSettings(settingsRaw));
  // Older saved searches are translated once; unsupported options are disclosed to the user.
  // Repair old automatic migrations once; later user selections retain their saved filters.
  const [initialBroad] = useState(() => {
    const old = initialSettings.standard as { query?: TradeSearchQuery; broadTeams?: Record<string, { filters: TradeFilters; protectedIds: string[] }>; broadMigrationChecked?: boolean } | undefined;
    const teams = { ...(old?.broadTeams ?? {}) };
    let repaired = false;
    for (const entry of Object.values(teams)) {
      if (entry?.filters) {
        if (!entry.filters.mustGiveRequired) entry.filters.mustGiveRequired = [];
        if (!entry.filters.mustGetRequired) entry.filters.mustGetRequired = [];
      }
    }
    if (!old?.broadMigrationChecked) {
      for (const [team, entry] of Object.entries(teams)) {
        if (entry.filters.mustGive?.length) {
          teams[team] = { ...entry, filters: defaultTradeFilters() };
          repaired = true;
        }
      }
      if (old?.query && !old.broadTeams) {
        teams[old.query.teamA] = { filters: defaultTradeFilters(), protectedIds: [] };
        repaired = true;
      }
    }
    return { teams, repaired };
  });
  const [migrationNote, setMigrationNote] = useState(initialBroad.repaired ? "Your old Find trades settings don't apply to the new search, so filters start at the defaults." : "");
  // Save only broad-search preferences by team; worker results remain session-only.
  const [broadTeams, setBroadTeams] = useState<Record<string, { filters: TradeFilters; protectedIds: string[] }>>(
    () => {
      return initialBroad.teams;
    },
  );
  const broad = broadTeams[draft.teamA] ?? { filters: defaultTradeFilters(), protectedIds: [] };
  const [broadSort, setBroadSort] = useState<SearchFilterSort>("own");
  const [showHidden, setShowHidden] = useState(false);
  const [broadLimit, setBroadLimit] = useState(50);
  const appliedBroad = useRef(false);
  const updateBroad = (patch: Partial<{ filters: TradeFilters; protectedIds: string[] }>) =>
    setBroadTeams((previous) => {
      const current = previous[draft.teamA] ?? { filters: defaultTradeFilters(), protectedIds: [] };
      const nextProtectedIds = patch.protectedIds ?? current.protectedIds;
      let nextFilters = patch.filters ? { ...patch.filters } : { ...current.filters };

      if (patch.protectedIds) {
        const added = patch.protectedIds.filter((id) => !current.protectedIds.includes(id));
        if (added.length) {
          nextFilters = {
            ...nextFilters,
            mustGive: nextFilters.mustGive.filter((id) => !added.includes(id)),
            mustGiveRequired: nextFilters.mustGiveRequired.filter((id) => !added.includes(id)),
          };
        }
      }

      return {
        ...previous,
        [draft.teamA]: {
          filters: nextFilters,
          protectedIds: nextProtectedIds,
        },
      };
    });
  const notify = useFeedback();
  const resultPlans = useRef<string | undefined>(undefined);
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
    [count, setCount] = useState(3);
  // Package mode always includes a one-player return, including after restoring legacy minimum-size controls.
  const minimumCount = 1;
  const [deficitProtection, setDeficitProtection] = useState<DeficitProtection>(
    { ...defaultDeficitProtection },
  );
  // Positional grade impact goals specify required grade improvements or drop limits on standard search
  const [gradeImpacts, setGradeImpacts] = useState<PositionalGradeImpactRule[]>(
    [],
  );
  // Available starter positions with active slots in this league format
  const availablePositions = availableStarterPositions(m);
  // Empty selections disable each category; active categories count only the same qualifying incoming players.
  const [signals, setSignals] = useState<(typeof primaryGemSignals)[number][]>(
      [],
    ),
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
  // Subscribe to the app-owned job so messages survive a hidden screen.
  const sessions = useSearchSessions();
  const session = useSyncExternalStore(sessions.subscribe, () => sessions.get("find"));
  const job = session.job as SearchJob | null;
  const setJob = (value: SearchJob | null | ((previous: SearchJob | null) => SearchJob | null)) =>
    sessions.setJob("find", (previous) => typeof value === "function" ? value(previous as SearchJob | null) : value);
  // Result browsing is local to the completed search and is never saved as a scoring filter.
  const [resultBrowse, setResultBrowse] = useState(emptyTradeBrowse);
  const browseToken = useRef("");
  // Preserve the executed controls independently from later edits, so a debug export can identify stale results precisely.
  const appliedSearch = useRef<{
    query: TradeSearchQuery;
    context: string;
  } | null>(null);
  // Retain the result's original valuation/roster context so later control edits never relabel saved figures as current.
  const resultModel = useRef<Model | null>(null);
  const [diagnostic, setDiagnostic] = useState(""),
    [savedRow, setSavedRow] = useState("");
  // Resolve the live worker from the store rather than a component-owned ref.
  const current = () => {
    const saved = sessions.get("find");
    return saved.worker && saved.id && saved.context ? { worker: saved.worker, id: saved.id, context: saved.context } : null;
  };
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
    // Protection uses deficit targeting's single grade threshold; dormant invalid edits cannot block an unrelated search.
    deficitProtection: {
      ...deficitProtection,
      ceiling: deficitCeiling,
      enabled: deficitOnly && deficitProtection.enabled,
      minimum:
        (!deficitOnly || !deficitProtection.enabled) &&
        (!Number.isFinite(deficitProtection.minimum) ||
          deficitProtection.minimum <= 0)
          ? defaultDeficitProtection.minimum
          : deficitProtection.minimum,
    },
    lineupBasis,
    teamA: draft.teamA,
    give: draft.give,
    // The shared Search limits replace the strict-index checkbox: Off is automatic matching, a number is the strict range.
    indexMode: limits
      ? limits.indexWindow === null
        ? "automatic"
        : "strict"
      : indexMode,
    goal,
    manager: manager ? { ...manager, profiles: journal.profiles } : undefined,
    count: packages ? count : 1,
    // Disabled strict inputs cannot make an automatic search unsaveable; keep raw edits in the controls/debug report.
    below: limits
      ? (limits.indexWindow ?? 5)
      : indexMode === "automatic" &&
          (!Number.isFinite(parseOffset(below)) || parseOffset(below) < 0)
        ? 5
        : parseOffset(below),
    above: limits
      ? (limits.indexWindow ?? 5)
      : indexMode === "automatic" &&
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
    // Positional grade impact goals
    gradeImpacts: gradeImpacts.length > 0 ? gradeImpacts : undefined,
  };
  const standardControls = {
    below,
    above,
    indexMode,
    goal,
    goalPosition,
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
    // Remember dormant protection separately from the effective query, which must disable it with its parent.
    deficitProtection,
    gradeImpacts,
  };
  // The chain planner owns its own part of the saved settings; this hook writes only the standard part and keeps the rest as stored.
  const standardPart = JSON.stringify({ query, controls: standardControls, broadTeams, broadMigrationChecked: true });
  const settingsText = mergeTradeSettings(
    settingsRaw,
    "standard",
    standardPart,
  );
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
  // Changing protected players or search inputs invalidates the captured roster search, while filter edits do not.
  const context =
    tradeSearchContext(m, query, lineupsRaw) +
    JSON.stringify([
      [...broad.protectedIds].sort(),
      [...broad.filters.mustGive].sort(),
      [...(broad.filters.mustGiveRequired ?? [])].sort(),
      [...broad.filters.mustGet].sort(),
      [...(broad.filters.mustGetRequired ?? [])].sort(),
      [...broad.filters.exclude].sort(),
      broad.filters.teams ? [...broad.filters.teams].sort() : null,
    ]);
  // Editing filters dismisses the open result drawer; the captured result remains available to inspect again.
  const drawerContext = useRef(context);
  useEffect(() => {
    if (drawerContext.current === context) return;
    drawerContext.current = context;
    document
      .querySelectorAll<HTMLDetailsElement>(
        ".trade-workspace .trade-result-details[open]",
      )
      .forEach((details) => {
        details.open = false;
      });
  }, [context]);
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
    setDeficitProtection(
      q.deficitProtection ?? { ...defaultDeficitProtection },
    );
    setIndexMode(q.indexMode ?? "strict");
    setGoal(withoutLegacySurface(q).goal ?? "custom");
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
    // Restore positional grade goals
    setGradeImpacts(q.gradeImpacts ?? []);
  }
  // Existing controls migrate once; later edits remain independent across route changes and reloads.
  useEffect(() => {
    if (settingsReady.current) return;
    const previous = initialSettings.standard as
      | { query?: TradeSearchQuery; controls?: Partial<StoredControls> }
      | undefined;
    if (previous?.query) {
      const savedQuery = previous.query;
      restoreQuery(savedQuery);
      // Older saved searches carry fewer controls; each one is applied only when it was saved.
      const c = (previous.controls ?? {}) as StoredControls;
      if (Object.hasOwn(c, "below")) setBelow(c.below);
      if (Object.hasOwn(c, "above")) setAbove(c.above);
      if (Object.hasOwn(c, "indexMode")) setIndexMode(c.indexMode);
      if (Object.hasOwn(c, "goal"))
        setGoal(c.goal === "surface" ? "custom" : c.goal);
      if (Object.hasOwn(c, "goalPosition")) setGoalPosition(c.goalPosition);
      if (Object.hasOwn(c, "manager")) setManager(c.manager);
      if (Object.hasOwn(c, "advanced")) setAdvanced(c.advanced);
      if (Object.hasOwn(c, "discovery")) setDiscovery(c.discovery);
      if (Object.hasOwn(c, "selectedTeams")) setSelectedTeams(c.selectedTeams);
      if (Object.hasOwn(c, "packages")) setPackages(c.packages);
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
      if (Object.hasOwn(c, "gradeImpacts"))
        setGradeImpacts(c.gradeImpacts ?? []);
      // Parent-off searches preserve the user's child toggle/minimum for a later re-enable or reload.
      if (
        c.deficitProtection &&
        typeof c.deficitProtection.enabled === "boolean"
      )
        setDeficitProtection({
          ...defaultDeficitProtection,
          ...c.deficitProtection,
        });
      onLineupBasisChange?.(readLineupBasis(savedQuery.lineupBasis));
      if (
        savedQuery.teamA &&
        m.dataset.tables.ModelTeams.some(
          (t) => str(t.TeamID) === savedQuery.teamA,
        )
      )
        change({
          ...draft,
          teamA: savedQuery.teamA,
          give: savedQuery.give.filter(
            (id: string) => m.byId.get(id)?.owner === savedQuery.teamA,
          ),
          get: draft.teamA === savedQuery.teamA ? draft.get : [],
        });
    }
    settingsReady.current = true;
  }, []);
  // Restored queries keep unrelated criteria; retired surface restrictions are deliberately ignored.
  const appliedRestore = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!restore || appliedRestore.current === restore.id) return;
    appliedRestore.current = restore.id;
    const migrated = migrateLegacyTradeQuery(restore.query);
    setBroadTeams((previous) => ({ ...previous, [restore.query.teamA]: { filters: migrated.filters, protectedIds: [] } }));
    // Explicit restores disclose both retained criteria and discarded legacy settings.
    setMigrationNote(`Saved search: applied ${migrated.applied.length ? migrated.applied.join(", ") : "no filters"}; ignored ${migrated.ignored.length ? migrated.ignored.join(", ") : "nothing"}.`);
    onLineupBasisChange?.(readLineupBasis(restore.query.lineupBasis));
    restoreQuery(restore.query);
    setAdvanced(true);
  }, [restore?.id]);

  // Changing context invalidates captured work; showing the same screen again does nothing.
  useEffect(() => {
    sessions.invalidate("find", context);
  }, [context]);

  // Start a captured immutable request; request/context checks reject late messages after cancel or restart.
  function search(protectedIds?: string[]) {
    if (!protectedIds && bounds.errors.length) return;
    // The broad request carries no legacy goals or limits; only the selected team and protected players affect it.
    const executedQuery: TradeSearchQuery = protectedIds ? { teamA: draft.teamA, give: [], count: 1,
      below: 0, above: 0, lineupBasis } : query;
    appliedBroad.current = !!protectedIds;
    setBroadLimit(50);
    const id = crypto.randomUUID();
    // Clear feedback from the previous captured result set.
    setSavedRow("");
    setDiagnostic("");
    browseToken.current = "";
    setResultBrowse(emptyTradeBrowse());
    appliedSearch.current = { query: structuredClone(executedQuery), context };
    resultModel.current = m;
    resultPlans.current = lineupsRaw;
    try {
      const worker = new Worker(
        new URL("../../../workers/trade-search.worker.ts", import.meta.url),
        { type: "module" },
      );
      sessions.start("find", worker, id, context, { id, context, status: "running", rows: [], total: 0 } as SearchJob);
      worker.onmessage = (event: MessageEvent<SearchResponse>) => {
        const message = event.data;
        if (
          current()?.id !== message.id ||
          current()?.context !== message.context
        )
          return;
        // Typing or paging can supersede an earlier browse response without invalidating the completed calculations.
        if (message.type === "browse" && message.token !== browseToken.current)
          return;
        sessions.update("find", id, (value) => {
          const previous = value as SearchJob | null;
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
          // Each opponent reports when its one-for-ones and then all its packages are done; the search scene draws from this.
          if (message.type === "team")
            return {
              ...previous,
              teams: {
                ...previous.teams,
                [message.team]: { singles: message.singles, extensions: message.extensions, done: message.done },
              },
            };
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
          if (message.type === "filtered")
            return { ...previous, rows: message.rows, view: message.view, total: message.total,
              visibleTotal: message.visibleTotal, groupsTotal: message.groupsTotal, filterCounts: message.counts, filterBlocks: message.blocks, hiddenRows: message.hidden, stats: message.stats,
              views: message.views ? { ...previous.views, ...message.views } : previous.views };
          // Each browse response is a complete bounded view, not another raw slice to append.
          return {
            ...previous,
            // First results do not end the running session while larger packages are evaluated.
            status: message.type === "partial" ? "running" : "complete",
            rows: message.rows,
            view: message.view,
            total: message.total,
            visibleTotal: message.visibleTotal ?? previous.visibleTotal,
            groupsTotal: message.groupsTotal ?? previous.groupsTotal,
            views: message.views ? { ...previous.views, ...message.views } : previous.views,
            filterCounts: message.counts ?? previous.filterCounts,
            filterBlocks: message.blocks ?? previous.filterBlocks,
            hiddenRows: message.hidden ?? previous.hiddenRows,
            stats: message.stats,
            coverage: message.coverage ?? previous.coverage,
            suggestions: message.suggestions ?? previous.suggestions,
            paging: false,
          };
        });
        if (message.type === "browse") {
          notify(searchCue(message.total > 0));
        }
        if (message.type === "error") {
          notify("caution");
          sessions.fail("find", id);
        }
      };
      worker.onerror = () => {
        if (current()?.id !== id) return;
        notify("caution");
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
        sessions.fail("find", id);
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
        query: executedQuery,
        // Start streaming with the current filters instead of waiting for the first reply.
        ...(protectedIds
          ? {
              useful: {
                protectedIds,
                inputs: {
                  protectedIds,
                  givePool: broad.filters.mustGive,
                  giveRequired: broad.filters.mustGiveRequired ?? [],
                  getPool: broad.filters.mustGet,
                  getRequired: broad.filters.mustGetRequired ?? [],
                  exclude: broad.filters.exclude,
                  teams: broad.filters.teams,
                },
                filters: broad.filters,
                sort: broadSort,
                showHidden,
                limit: broadLimit,
              },
            }
          : {}),
      };
      sessions.post("find", id, request);
    } catch (error) {
      sessions.dispose("find");
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

  // Refilter the retained worker results after completion or preference edits without starting a new search.
  const broadFilterKey = JSON.stringify(broad.filters);
  useEffect(() => {
    if (!appliedBroad.current || !job || (job.status !== "complete" && !(job.status === "running" && job.view)) || current()?.id !== job.id) return;
    sessions.post("find", job.id, { type: "filter", id: job.id, context: job.context,
      filters: broad.filters, sort: broadSort, showHidden, limit: broadLimit } satisfies SearchRequest);
  }, [job?.id, job?.status, !!job?.view, broadFilterKey, broadSort, showHidden, broadLimit]);

  // Applying a preview restores all controls first, then starts the exact previewed query after context cleanup.
  useEffect(() => {
    // React batches restored controls with this request; optional defaults need not serialize identically.
    if (!pendingSearch) return;
    setPendingSearch(null);
    search();
  }, [pendingSearch, context]);

  // Termination is immediate even if the worker is busy in a large package enumeration/evaluation loop.
  function cancel() {
    sessions.cancel("find");
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
    setDeficitProtection({ ...defaultDeficitProtection, enabled: false });
    sessions.dispose("find");
    setJob(null);
    setPendingSearch(null);
    setGoal("custom");
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
    setGradeImpacts([]);
  }

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
      // A saved result records its actual outgoing package, even when the broad search began with no fixed offer.
      { ...captured, give: [...(row.give ?? captured.give)], count: row.get.length },
      model,
    );
    if (success !== false) setSavedRow(row.key);
  }

  // Query retained results rather than restarting the search; explicit tokens discard superseded name/page requests.
  function browseResults(options: TradeBrowseOptions) {
    if (
      !job ||
      stale ||
      job.status !== "complete" ||
      current()?.id !== job.id
    )
      return;
    browseToken.current = crypto.randomUUID();
    setResultBrowse(options);
    setJob((previous) => (previous ? { ...previous, paging: true } : previous));
  }

  // Debounce text entry; filtering names never blocks typing or allows an old response to replace newer selections.
  useEffect(() => {
    const captured = current(),
      token = browseToken.current;
    if (!captured || !token) return;
    const timer = window.setTimeout(() => {
      if (current()?.id !== captured.id || browseToken.current !== token)
        return;
      const message: SearchRequest = {
        type: "browse",
        id: captured.id,
        context: captured.context,
        token,
        options: resultBrowse,
      };
      sessions.post("find", captured.id, message);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [resultBrowse]);

  // Fetch actual weekly slot changes only when the matching result is opened.
  function inspect(row: SearchRow) {
    if (
      !job ||
      stale ||
      job.status !== "complete" ||
      current()?.id !== job.id ||
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
    sessions.post("find", job.id, request);
  }

  return {
    broad, broadSort, setBroadSort, showHidden, setShowHidden, updateBroad, migrationNote, broadLimit, setBroadLimit,
    above,
    advanced,
    appliedSearch,
    availablePositions,
    below,
    bounds,
    browseResults,
    browseToken,
    cancel,
    clearFilters,
    context,
    count,
    deficitCeiling,
    deficitOnly,
    deficitPosition,
    deficitProtection,
    diagnostic,
    discovery,
    goal,
    goalPosition,
    gradeImpacts,
    incomingPositions,
    indexMode,
    inspect,
    job,
    journal,
    lastSettings,
    limits,
    load,
    manager,
    minimumCount,
    minimumPositions,
    minimumSignals,
    minimumUpgrade,
    minimumUsefulness,
    multiplePackages,
    notify,
    offeredPositions,
    opponents,
    otherWeekly,
    ownWeekly,
    packages,
    parseOffset,
    pendingSearch,
    poolRange,
    query,
    receive,
    requiredBench,
    requiredStarters,
    requiredUpgrades,
    restoreQuery,
    resultBrowse,
    resultModel,
    resultPlans,
    running,
    saveRow,
    savedRow,
    search,
    selectedPosition,
    selectedTeams,
    setAbove,
    setAdvanced,
    setBelow,
    setCount,
    setDeficitCeiling,
    setDeficitOnly,
    setDeficitPosition,
    setDeficitProtection,
    setDiagnostic,
    setDiscovery,
    setGoal,
    setGoalPosition,
    setGradeImpacts,
    setIncomingPositions,
    setIndexMode,
    setJob,
    setManager,
    setMinimumPositions,
    setMinimumSignals,
    setMinimumUpgrade,
    setMinimumUsefulness,
    setOtherWeekly,
    setOwnWeekly,
    setPackages,
    setPendingSearch,
    setRequiredBench,
    setRequiredStarters,
    setRequiredUpgrades,
    setResultBrowse,
    setSavedRow,
    setSelectedTeams,
    setSignals,
    setUpgradeMode,
    setUpgradeOnly,
    setUsefulnessOnly,
    settingsReady,
    settingsText,
    signals,
    stale,
    standardControls,
    standardPart,
    starter,
    upgradeMode,
    upgradeOnly,
    usefulnessOnly,
    weeklyRange,
  };
}

// What the hook returns, for the components that read it.
export type TradeSearchState = ReturnType<typeof useTradeSearch>;
