import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
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
  type SearchProgress,
  type SearchRequest,
  type SearchResponse,
  type SearchRow,
  type SearchStats,
  type UpgradeFilter,
  type WeeklyRange,
  type TradeSearchQuery,
} from "../domain/trade-search";
import { Panel } from "../ui/layout";
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
  restore,
}: {
  m: Model;
  draft: Draft;
  lineupsRaw?: string;
  change: (draft: Draft) => void;
  save?: (
    draft: Draft,
    summary: SavedTradeSummary,
    query: TradeSearchQuery,
  ) => void;
  onQueryChange?: (query: TradeSearchQuery) => void;
  restore?: { id: string; query: TradeSearchQuery };
}) {
  const [below, setBelow] = useState("5"),
    [above, setAbove] = useState("5");
  // Discovery is opt-in; default controls preserve fixed outgoing packages and the existing ranking.
  const [discovery, setDiscovery] = useState(initialDiscovery);
  const [packages, setPackages] = useState(false),
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
    teamA: draft.teamA,
    give: draft.give,
    count: packages ? count : 1,
    below: parseOffset(below),
    above: parseOffset(above),
    discovery:
      packages ||
      discovery.flexible ||
      discovery.target ||
      discovery.nearMisses ||
      discovery.ranking !== "own"
        ? {
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
  // Display and progress labels follow the same incoming bounds used by discovery and saved searches.
  const receive = incomingCountRange(query);
  const multiplePackages =
    discovery.flexible ||
    discovery.nearMisses ||
    receive.minimum !== receive.maximum;
  const bounds = tradeSearchBounds(m, query);
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
  }, [draft.teamA, m.dataset.hash]);

  // Parent saves capture the current query without persisting temporary result rows on every search.
  useEffect(() => {
    onQueryChange?.(query);
  }, [JSON.stringify(query), onQueryChange]);
  // Explicit saved-trade loading restores every search control; ordinary rerenders never reset user edits.
  useEffect(() => {
    if (!restore) return;
    const q = restore.query;
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
  }, [restore?.id]);

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

  // Clear screening restrictions and stop stale work while preserving the trade draft, protected pool and package sizes.
  function clearFilters() {
    active.current?.worker.terminate();
    active.current = null;
    setJob(null);
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

  // Fixed searches retain outgoing selections; flexible results load their actual subset into the normal analyzer.
  function load(row: SearchRow) {
    if (
      stale ||
      job?.status !== "complete" ||
      bounds.errors.length ||
      row.get.some((id) => m.byId.get(id)?.owner !== row.teamB)
    )
      return;
    change({
      ...draft,
      teamB: row.teamB,
      give: [...(row.give ?? draft.give)],
      get: [...row.get],
    });
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
          help={`${label === "Your" ? "Your marked/imported starters stay anchored; bench-only departures cost zero direct starter points." : "Their full roster is optimized before and after the trade with identical Expected PPG, bye and availability rules, including existing backups and required drops."} Total model Expected scoring gain divided by ${m.weeks.length} remaining weeks (${m.current}–${m.final}). Example: +24 points over 12 weeks is +2/week. This is not actual PPG or ESPN weekly projection. Blank limits are unbounded; negative limits are allowed.`}
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
            label: `Receive package: ${count} players`,
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
  return (
    <Panel
      title="Find matching trades"
      note="Match summed value indices, then compare each trade's effect on your starting lineup."
    >
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
            Tradable pool: {names(discovery.pool)} · Offer {discovery.minimum}–
            {discovery.maximum} players.
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
          {offsetControl("Below outgoing total", below, setBelow)}
          {offsetControl("Above outgoing total", above, setAbove)}
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
              <span>Every offered player must be useful to the other team</span>
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
                    onChange={(event) => setMinimumUpgrade(event.target.value)}
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
                    onChange={(event) => setDeficitCeiling(event.target.value)}
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
      {!bounds.errors.length && !discovery.flexible && (
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
      {bounds.errors.length > 0 && (
        <p className="notice danger">{bounds.errors.join(" ")}</p>
      )}
      <p>
        <small>
          Lineup source: {starter.source} · Weeks {m.current}–{m.final} · Source
          refreshed:{" "}
          {m.dataset.sourceUTC
            ? new Date(m.dataset.sourceUTC).toLocaleString()
            : "Unavailable"}
          .
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
        {/* Keep the one-click recovery available even when an invalid filter disables Search. */}
        <FilterHelp
          label="Clear filters"
          help="Clears optional search restrictions, target, ranking and near misses; restores the default ±5 index range and removes previous results. Keeps your selected players, protected tradable pool and outgoing/incoming package sizes."
        >
          <button type="button" className="subtle" onClick={clearFilters}>
            Clear filters
          </button>
        </FilterHelp>
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
              {job.total} index matches. Ranked by{" "}
              {discovery.ranking === "balanced"
                ? "benefit to both teams"
                : discovery.ranking === "other"
                  ? "their model expected roster-potential gain per week"
                  : "your model expected lineup gain per week"}
              ; an index match is not a fairness or acceptance guarantee.
            </p>
            <div className="table-wrap">
              <table className="trade-search-results">
                <thead>
                  <tr>
                    <th>Incoming / team</th>
                    <th className="model">Index / difference</th>
                    <th className="model">
                      Your gain / week<small>Marked starters</small>
                    </th>
                    <th className="model">
                      Their gain / week<small>Roster potential</small>
                    </th>
                    <th>Value exchange / tests</th>
                    <th>Details / load</th>
                  </tr>
                </thead>
                <tbody>
                  {job.rows.map((row) => (
                    <tr key={row.key}>
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
                          {/* Keep the scoring bases explicit without changing the independent positional-fit or price tests. */}
                          <p>
                            <small>
                              Your gain uses marked starters. Their gain
                              compares optimized full rosters before and after
                              the trade, including existing backups and required
                              drops.
                            </small>
                          </p>
                          <OpponentIncentiveView
                            value={job.lineups?.[row.key]?.details?.incentive}
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
                                "ownPotential",
                                "otherMarked",
                              ] as const
                            ).map((side) => {
                              const detail =
                                job.lineups![row.key].details![side];
                              // Both measurements retain their own named weekly changes; the secondary views are explanatory only.
                              const title = {
                                own: "Your scoring lineup",
                                other: "Their scoring lineup",
                                ownPotential: "Your roster potential",
                                otherMarked: "Their marked-starter impact",
                              }[side];
                              const weeklyTitle = {
                                own: "Your weekly scoring replacements",
                                other: "Their weekly scoring replacements",
                                ownPotential:
                                  "Your roster-potential weekly replacements",
                                otherMarked:
                                  "Their marked-starter weekly replacements",
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
                        {save && (
                          <button
                            className="subtle"
                            disabled={
                              stale ||
                              job.status !== "complete" ||
                              bounds.errors.length > 0
                            }
                            onClick={() => {
                              if (
                                !stale &&
                                job.status === "complete" &&
                                !bounds.errors.length
                              )
                                save(
                                  {
                                    teamA: query.teamA,
                                    teamB: row.teamB,
                                    give: [...(row.give ?? query.give)],
                                    get: [...row.get],
                                  },
                                  summaryFromSearch(row),
                                  query,
                                );
                            }}
                          >
                            Save trade
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
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
                      disabled={
                        stale ||
                        job.status !== "complete" ||
                        !!bounds.errors.length
                      }
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
                  : "No packages match this index range and incoming count."}
              </p>
            )}
            <details className="search-exclusions">
              <summary>Why trades were excluded</summary>
              {/* Report post-evaluation filtering separately from index/positional eligibility. */}
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
    </Panel>
  );
}
