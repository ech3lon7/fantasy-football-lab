import { browseTradeResults } from "../domain/trade-result-groups";
import { managerFailures } from "../domain/manager-expectations";
import { surfaceFailures } from "../domain/surface-appeal";
import { deficitProtectionFailures } from "../domain/trade-safeguards";
import { gradeImpactFailures } from "../domain/chain-position-impact";
import { findTradeRecoveries } from "../domain/trade-guidance";
import { evaluate, type Model } from "../domain/valuation";
import { withLineupMemo } from "../domain/lineups";
import { applyRosterScenario } from "../domain/roster-scenarios";
import {
  runCompleteTradeSearch,
  type CompleteTrade,
  type CompleteCoverage,
} from "../domain/complete-trade-search";
import { partition, poolSize, runPooled } from "./trade-search-pool";
import { resultRowView, type ResultRowView } from "../domain/view/search-rows";
import { defaultTradeFilters, type TradeFilters } from "../domain/trade-filters";
import { tradeFilterView } from "../domain/trade-filter-view";
import { evaluateTrade } from "../domain/trades";
import {
  scoreTradeMatch,
  matchesWeekly,
  searchLineupDetails,
  type TradeSearchQuery,
  type SearchRequest,
  type SearchResponse,
  type SearchRow,
  type SearchStats,
  type SearchFilterSort,
} from "../domain/trade-search";
import {
  compareDiscoveryRows,
  discoveryFailures,
  findDiscoveryMatches,
  opponentIncentive,
  retainSuggestion,
} from "../domain/trade-discovery";

// Keep one completed search in this dedicated worker; cancellation terminates the whole worker.
let retained:
  | {
      id: string;
      context: string;
      rows: CompleteTrade[];
      suggestions?: SearchRow[];
      stats: SearchStats;
      model: Model;
      query: TradeSearchQuery;
      lineupsRaw?: string;
      filteredRows?: CompleteTrade[];
      filters?: TradeFilters;
      sort?: SearchFilterSort;
      protectedIds?: string[];
      showHidden?: boolean;
      limit?: number;
      hydratedCache: Map<string, SearchRow>;
      // Legacy fallback fields
      legacyRows?: SearchRow[];
      useful?: boolean;
    }
  | undefined;

const send = (message: SearchResponse) => self.postMessage(message);

// Worker callbacks can update the current search while its asynchronous work yields.

function hydrateTrade(
  m: Model,
  query: TradeSearchQuery,
  lineupsRaw: string | undefined,
  trade: CompleteTrade,
  cache: Map<string, SearchRow>,
): SearchRow {
  const existing = cache.get(trade.key);
  if (existing) return existing;

  const queryWithBestAvailable: TradeSearchQuery = {
    ...query,
    give: trade.give,
    count: trade.get.length,
    below: 0,
    above: 0,
    lineupBasis: "best-available",
  };
  const incoming = trade.get.reduce(
    (s, id) => s + (m.byId.get(id)?.index ?? 0),
    0,
  );
  const outgoing = trade.give.reduce(
    (s, id) => s + (m.byId.get(id)?.index ?? 0),
    0,
  );
  const draft = {
    teamA: query.teamA,
    teamB: trade.teamB,
    give: trade.give,
    get: trade.get,
  };
  const evaluated = evaluateTrade(m, draft, false, lineupsRaw);
  const searchRow = scoreTradeMatch(
    m,
    queryWithBestAvailable,
    {
      key: trade.key,
      teamB: trade.teamB,
      give: trade.give,
      get: trade.get,
      incoming,
      outgoing,
      difference: incoming - outgoing,
    },
    lineupsRaw,
    evaluated,
  );
  searchRow.coreSwap = trade.seedKey;
  searchRow.seedKey = trade.seedKey;
  searchRow.filterEvidence = trade.filterEvidence;
  searchRow.positionImpact = trade.filterEvidence.positionImpact;
  cache.set(trade.key, searchRow);
  return searchRow;
}

function hydrateRelatedTrade(
  m: Model,
  trade: CompleteTrade,
  cache: Map<string, SearchRow>,
): SearchRow {
  const existing = cache.get(trade.key);
  if (existing) return existing;

  const incoming = trade.get.reduce(
    (s, id) => s + (m.byId.get(id)?.index ?? 0),
    0,
  );
  const outgoing = trade.give.reduce(
    (s, id) => s + (m.byId.get(id)?.index ?? 0),
    0,
  );
  const W = m.weeks.length || 1;
  const searchRow: SearchRow = {
    key: trade.key,
    teamB: trade.teamB,
    give: trade.give,
    get: trade.get,
    incoming,
    outgoing,
    difference: incoming - outgoing,
    seedKey: trade.seedKey,
    coreSwap: trade.seedKey,
    filterEvidence: trade.filterEvidence,
    positionImpact: trade.filterEvidence.positionImpact,
    lineupBasis: "best-available",
    own: trade.own,
    other: trade.other,
    ownTotal: trade.own * W,
    otherTotal: trade.other * W,
    grade: "Good deal",
    surplus: "PASS",
    points: "PASS",
    legal: true,
    warnings: [],
    dropsA: [],
    dropsB: [],
    irA: [],
    irB: [],
  };
  cache.set(trade.key, searchRow);
  return searchRow;
}

// The display view of every row shown so far is scored here, once, and sent once: scoring a trade for display is heavy, and doing it
// while the screen renders would hold up every animation. Rows the screen has not been sent a view for score themselves there.
let viewState = {
  id: "",
  views: new Map<string, ResultRowView>(),
  sent: new Set<string>(),
};

function newViews(
  state: NonNullable<typeof retained>,
  rows: SearchRow[],
  hidden: { row: SearchRow; reasons: string[] }[] = [],
) {
  if (viewState.id !== state.id)
    viewState = { id: state.id, views: new Map(), sent: new Set() };
  const out: Record<string, ResultRowView> = {};
  const context = {
    teamA: state.query.teamA,
    give: state.query.give ?? [],
    basis: "best-available" as const,
    lineupsRaw: state.lineupsRaw,
  };
  const allRows = [
    ...rows,
    ...hidden.map((h) => h.row),
  ];
  for (const row of allRows) {
    if (viewState.sent.has(row.key)) continue;
    let view = viewState.views.get(row.key);
    if (!view) {
      try {
        view = resultRowView(state.model, row, context);
      } catch {
        continue;
      }
      viewState.views.set(row.key, view);
    }
    out[row.key] = view;
    viewState.sent.add(row.key);
  }
  return out;
}

// Produce the same sorted, filtered page for live batches and completed searches.
function filteredPayload(state: NonNullable<typeof retained>) {
  return withLineupMemo(() => {
    const byKey = new Map(state.rows.map((row) => [row.key, row]));
    const evidence = state.rows.map((row) => row.filterEvidence);
    const result = tradeFilterView(
      evidence,
      state.filters ?? defaultTradeFilters(),
      state.sort ?? "acceptance",
      !!state.showHidden,
      state.protectedIds ?? [],
    );

    // Group packages by the search engine's stable one-for-one seed, keeping the best sorted result first.
    const grouped = new Map<
      string,
      CompleteTrade & { related: CompleteTrade[] }
    >();
    for (const item of result.visible) {
      const row = byKey.get(item.key);
      if (!row) continue;
      const groupKey = row.seedKey ?? row.key;
      const existingGroup = grouped.get(groupKey);
      if (existingGroup) existingGroup.related.push(row);
      else grouped.set(groupKey, { ...row, related: [] });
    }

    const groupedRows = [...grouped.values()];
    state.filteredRows = groupedRows;

    const pageLimit = state.limit ?? 50;
    const page = groupedRows.slice(0, pageLimit);
    const hydratedPage: SearchRow[] = page.map((group) => {
      const main = hydrateTrade(
        state.model,
        state.query,
        state.lineupsRaw,
        group,
        state.hydratedCache,
      );
      const related = group.related.map((r) =>
        hydrateRelatedTrade(
          state.model,
          r,
          state.hydratedCache,
        ),
      );
      return { ...main, variants: [], related };
    });

    const hiddenTotal = result.hidden.length;
    const hidden = state.showHidden
      ? result.hidden
          .slice(0, pageLimit)
          .map(({ row, reasons }) => {
            const original = byKey.get(row.key);
            return original
              ? {
                  row: hydrateTrade(
                    state.model,
                    state.query,
                    state.lineupsRaw,
                    original,
                    state.hydratedCache,
                  ),
                  reasons,
                }
              : null;
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
      : [];

    const browse = browseTradeResults(state.model, groupedRows, undefined, []);

    return {
      ...browse,
      rows: hydratedPage,
      views: newViews(state, hydratedPage, hidden),
      groupsTotal: groupedRows.length,
      total: result.total,
      visibleTotal: result.visible.length,
      counts: result.only,
      blocks: result.counts,
      hidden,
      hiddenTotal,
      stats: state.stats,
      filters: state.filters,
      sort: state.sort,
    };
  });
}

self.onmessage = async (event: MessageEvent<SearchRequest>) => {
  const request = event.data;
  const { id, context } = request;
  try {
    // Filter and sort the captured evidence only; stale worker messages are ignored.
    if (request.type === "filter" || request.type === "sort") {
      if (!retained || retained.id !== id || retained.context !== context)
        return;
      if (request.type === "filter") {
        retained.filters = request.filters;
        retained.showHidden = request.showHidden;
        retained.limit = Math.max(1, request.limit ?? 50);
        if (request.protectedIds) retained.protectedIds = request.protectedIds;
      }
      retained.sort = request.sort;
      send({ id, context, type: "filtered", ...filteredPayload(retained) });
      return;
    }

    // Detail requests reuse the captured model/query and affect neither the completed ranking nor draft.
    if (request.type === "details") {
      if (!retained || retained.id !== id || retained.context !== context)
        return;
      try {
        let row = retained.hydratedCache?.get(request.key);
        if (!row) {
          const comp = retained.rows?.find(
            (candidate) => candidate.key === request.key,
          );
          if (comp) {
            row = hydrateTrade(
              retained.model,
              retained.query,
              retained.lineupsRaw,
              comp,
              retained.hydratedCache,
            );
          } else if (retained.legacyRows) {
            row = retained.legacyRows.find(
              (candidate) => candidate.key === request.key,
            );
          }
        }
        if (!row)
          throw Error("This trade is no longer in the completed search.");
        send({
          id,
          context,
          type: "details",
          key: request.key,
          details: {
            ...searchLineupDetails(
              retained.model,
              { ...retained.query, lineupBasis: "best-available" },
              row,
              retained.lineupsRaw,
              !retained.useful,
            ),
            incentive: opponentIncentive(
              retained.model,
              { ...retained.query, lineupBasis: "best-available" },
              row,
              retained.lineupsRaw,
            ),
          },
        });
      } catch (error) {
        send({
          id,
          context,
          type: "details",
          key: request.key,
          error:
            error instanceof Error
              ? error.message
              : "Lineup details unavailable.",
        });
      }
      return;
    }

    // Browse only the captured completed set; names, package pages and outgoing alternatives never rerun scoring.
    if (request.type === "browse") {
      if (!retained || retained.id !== id || retained.context !== context)
        return;
      const state = retained;
      const rows = state.filteredRows ?? state.rows;
      const browse = browseTradeResults(
        state.model,
        rows,
        request.options,
        state.query.give,
      );
      const hydratedVisible = browse.rows.map((r) =>
        "ownTotal" in r
          ? (r as SearchRow)
          : hydrateTrade(
              state.model,
              state.query,
              state.lineupsRaw,
              r,
              state.hydratedCache,
            ),
      );
      send({
        id,
        context,
        type: "browse",
        token: request.token,
        view: browse.view,
        rows: hydratedVisible,
        total: rows.length,
        stats: state.stats,
      });
      return;
    }

    retained = undefined;
    const model = applyRosterScenario(
      evaluate(request.dataset, request.settings, {
        evidence: request.evidence,
        roleWeight: request.roleWeight,
      }),
      request.scenario,
      request.lineupsRaw,
    );

    // Complete trade search (broad Find trades)
    if (request.useful) {
      const own = request.query.teamA;
      const manager = request.useful.manager ?? { version: 1, profiles: {} };
      const initialFilters = request.useful.filters ?? defaultTradeFilters();
      const initialSort = request.useful.sort ?? "acceptance";
      const initialProtectedIds = request.useful.protectedIds ?? [];

      const stats: SearchStats = {
        teams: 0,
        checked: 0,
        excluded: 0,
        thinTeams: 0,
        matched: 0,
        scored: 0,
      };

      retained = {
        id,
        context,
        rows: [],
        suggestions: [],
        stats,
        model,
        query: request.query,
        lineupsRaw: request.lineupsRaw,
        useful: true,
        filters: initialFilters,
        sort: initialSort,
        protectedIds: initialProtectedIds,
        showHidden: request.useful.showHidden,
        limit: request.useful.limit ?? 50,
        hydratedCache: new Map(),
      };

      const opponents = model.dataset.tables.ModelTeams.map((team) =>
        String(team.TeamID),
      ).filter((team) => team && team !== "0" && team !== own);
      const completedTeams = new Set<string>();

      const reportTeam = (event: {
        team: string;
        singles: number;
        extensions: number;
        done: boolean;
      }) => {
        if (event.done) completedTeams.add(event.team);
        send({ id, context, type: "team", ...event });
      };

      const onOpponentDone = (
        team: string,
        possible: number,
        scored: number,
        kept: number,
        rows: CompleteTrade[],
      ) => {
        reportTeam({ team, singles: possible, extensions: kept, done: true });
        retained!.rows.push(...rows);
        stats.teams = completedTeams.size;
        stats.checked += possible;
        stats.scored += scored;
        stats.matched += kept;
        send({ id, context, type: "partial", ...filteredPayload(retained!) });
      };

      const size = poolSize(
        opponents.length,
        self.navigator?.hardwareConcurrency,
        typeof Worker !== "undefined",
      );
      let found:
        | { rows: CompleteTrade[]; coverage: CompleteCoverage }
        | undefined;
      let retryQueue: Promise<unknown> = Promise.resolve();

      if (size > 1) {
        try {
          found = await runPooled(
            {
              dataset: request.dataset,
              settings: request.settings,
              evidence: request.evidence,
              roleWeight: request.roleWeight,
              scenario: request.scenario,
              lineupsRaw: request.lineupsRaw,
              teamA: own,
              manager,
            },
            partition(opponents, size),
            () =>
              new Worker(
                new URL("./trade-search-part.worker.ts", import.meta.url),
                { type: "module" },
              ),
            (event) => {
              onOpponentDone(
                event.team,
                event.possible,
                event.scored,
                event.kept,
                event.rows,
              );
            },
            (slice) => {
              for (const team of slice) completedTeams.delete(team);
              const task = retryQueue.then(async () => {
                const partRows: CompleteTrade[] = [];
                const cov = await runCompleteTradeSearch(
                  model,
                  own,
                  request.lineupsRaw,
                  manager,
                  slice,
                  (event) => {
                    if (event.done) {
                      partRows.push(...event.rows);
                      onOpponentDone(
                        event.team,
                        event.possible,
                        event.scored,
                        event.kept,
                        event.rows,
                      );
                    }
                  },
                );
                return { rows: partRows, coverage: cov };
              });
              retryQueue = task.catch(() => undefined);
              return task;
            },
          );
        } catch {
          found = undefined;
        }
      }

      if (!found) {
        const partRows: CompleteTrade[] = [];
        const cov = await runCompleteTradeSearch(
          model,
          own,
          request.lineupsRaw,
          manager,
          opponents,
          (event) => {
            if (event.done) {
              partRows.push(...event.rows);
              onOpponentDone(
                event.team,
                event.possible,
                event.scored,
                event.kept,
                event.rows,
              );
            }
          },
        );
        found = { rows: partRows, coverage: cov };
      }

      const missingTeams = opponents.filter(
        (team) => !completedTeams.has(team),
      );
      if (missingTeams.length) found.coverage.missingTeams = missingTeams;

      stats.teams = found.coverage.opponents;
      stats.checked = found.coverage.possible;
      stats.scored = found.coverage.scored;
      stats.matched = found.coverage.kept;

      send({
        id,
        context,
        type: "complete",
        ...filteredPayload(retained!),
        coverage: found.coverage,
      });
      return;
    }

    // Legacy discovery path (for non-useful searches like Trade analyzer or Chain planner discovery)
    const started = performance.now();
    let lastProgress = 0,
      evaluationStarted = started;
    const progress = (
      phase:
        | "Finding matching packages"
        | "Evaluating trades"
        | "Sorting results",
      stats: SearchStats,
      force = false,
    ) => {
      const now = performance.now();
      if (force || now - lastProgress >= 150) {
        const remainingMs =
          phase === "Evaluating trades" && stats.scored > 0
            ? ((now - evaluationStarted) / stats.scored) *
              Math.max(0, stats.matched - stats.scored)
            : undefined;
        send({
          id,
          context,
          type: "progress",
          progress: { phase, stats, elapsedMs: now - started, remainingMs },
        });
        lastProgress = now;
      }
    };
    progress(
      "Finding matching packages",
      {
        teams: 0,
        checked: 0,
        excluded: 0,
        thinTeams: 0,
        matched: 0,
        scored: 0,
      },
      true,
    );
    const { matches, stats } = findDiscoveryMatches(
      model,
      request.query,
      (s) => progress("Finding matching packages", s),
      request.lineupsRaw,
    );
    evaluationStarted = performance.now();
    progress("Evaluating trades", stats, true);
    const evaluated = new Map<string, SearchRow>();
    const rows: SearchRow[] = [];
    const suggestions: SearchRow[] = [];
    if (request.query.weekly) stats.weeklyExcluded = 0;
    if (request.query.surface) stats.surfaceExcluded = 0;
    if (request.query.manager) stats.managerExcluded = 0;
    if (request.query.usefulness) stats.usefulnessExcluded = 0;
    if (request.query.deficitProtection?.enabled)
      stats.deficitProtectionExcluded = 0;
    if (request.query.gradeImpacts?.length)
      stats.gradeImpactExcluded = 0;

    for (const match of matches) {
      const row = scoreTradeMatch(
        model,
        request.query,
        match,
        request.lineupsRaw,
      );
      evaluated.set(match.key, row);
      const failures = discoveryFailures(row, request.query);
      if (!failures.length && !row.nearMiss) rows.push(row);
      else {
        if (
          deficitProtectionFailures(
            row.deficitProtection,
            request.query.deficitProtection,
          ).length
        )
          stats.deficitProtectionExcluded =
            (stats.deficitProtectionExcluded ?? 0) + 1;
        if (managerFailures(row.manager, request.query.manager).length)
          stats.managerExcluded = (stats.managerExcluded ?? 0) + 1;
        if (surfaceFailures(row, request.query.surface).length)
          stats.surfaceExcluded = (stats.surfaceExcluded ?? 0) + 1;
        if (
          request.query.usefulness &&
          row.usefulness?.length !== (row.give ?? request.query.give).length
        )
          stats.usefulnessExcluded = (stats.usefulnessExcluded ?? 0) + 1;
        if (
          request.query.goal === "position" &&
          !(row.positionGain != null && row.positionGain > 0)
        )
          stats.positionExcluded = (stats.positionExcluded ?? 0) + 1;
        if (request.query.weekly && !matchesWeekly(row, request.query.weekly))
          stats.weeklyExcluded = (stats.weeklyExcluded ?? 0) + 1;
        if (
          gradeImpactFailures(row.positionImpact, request.query.gradeImpacts)
            .length
        )
          stats.gradeImpactExcluded = (stats.gradeImpactExcluded ?? 0) + 1;
        if (request.query.discovery?.nearMisses)
          retainSuggestion(
            suggestions,
            row,
            [...failures, ...(row.nearMiss?.reasons ?? [])],
            request.query.discovery.ranking,
          );
      }
      stats.scored++;
      progress("Evaluating trades", stats);
    }
    progress("Sorting results", stats, true);
    rows.sort((a, b) =>
      compareDiscoveryRows(a, b, request.query.discovery?.ranking),
    );
    retained = {
      id,
      context,
      rows: [],
      legacyRows: rows,
      suggestions,
      stats,
      model,
      query: request.query,
      lineupsRaw: request.lineupsRaw,
      hydratedCache: new Map(),
    };
    send({
      id,
      context,
      type: "complete",
      ...browseTradeResults(model, rows, undefined, request.query.give),
      total: rows.length,
      stats,
      suggestions,
    });
    if (!rows.length) {
      send({ id, context, type: "recovery", checked: 0, total: 0 });
      let lastRecovery = 0;
      try {
        const options = findTradeRecoveries(
          model,
          request.query,
          request.lineupsRaw,
          evaluated,
          (checked, total) => {
            const now = performance.now();
            if (now - lastRecovery >= 150) {
              send({ id, context, type: "recovery", checked, total });
              lastRecovery = now;
            }
          },
        );
        send({ id, context, type: "recovery", options });
      } catch {
        send({
          id,
          context,
          type: "recovery",
          error:
            "Recovery previews could not be completed. Your original search is unchanged.",
        });
      }
    }
  } catch (error) {
    retained = undefined;
    send({
      id,
      context,
      type: "error",
      message: error instanceof Error ? error.message : "Trade search failed.",
    });
  }
};
