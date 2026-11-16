import { browseTradeResults } from "../domain/trade-result-groups";
import { managerFailures } from "../domain/manager-expectations";
import { surfaceFailures } from "../domain/surface-appeal";
import { deficitProtectionFailures } from "../domain/trade-safeguards";
import { gradeImpactFailures } from "../domain/chain-position-impact";
import { findTradeRecoveries } from "../domain/trade-guidance";
import { evaluate, type Model } from "../domain/valuation";
import { applyRosterScenario } from "../domain/roster-scenarios";
import { runUsefulTradeSearch } from "../domain/useful-trade-adapter";
import type { TeamProgress, UsefulCoverage } from "../domain/useful-move-search";
import { partition, poolSize, runPooled } from "./trade-search-pool";
import { readLineupBasis } from "../domain/trade-impact";
import { resultRowView, type ResultRowView } from "../domain/view/search-rows";
import { defaultTradeFilters, type TradeFilters } from "../domain/trade-filters";
import { tradeFilterView } from "../domain/trade-filter-view";
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
      rows: SearchRow[];
      suggestions: SearchRow[];
      stats: SearchStats;
      model: Model;
      query: TradeSearchQuery;
      lineupsRaw?: string;
      filteredRows?: SearchRow[];
      filters?: TradeFilters;
      sort?: SearchFilterSort;
      showHidden?: boolean;
      limit?: number;
      useful?: boolean;
    }
  | undefined;
const send = (message: SearchResponse) => self.postMessage(message);
// Worker callbacks can update the current search while its asynchronous work yields.
const currentRetained = (): typeof retained => retained;

// The display view of every row shown so far is scored here, once, and sent once: scoring a trade for display is heavy, and doing it
// while the screen renders would hold up every animation. Rows the screen has not been sent a view for score themselves there.
let viewState = { id: "", views: new Map<string, ResultRowView>(), sent: new Set<string>() };
function newViews(state: NonNullable<typeof retained>, rows: SearchRow[]) {
  if (viewState.id !== state.id) viewState = { id: state.id, views: new Map(), sent: new Set() };
  const out: Record<string, ResultRowView> = {};
  const context = { teamA: state.query.teamA, give: state.query.give ?? [], basis: readLineupBasis(state.query.lineupBasis), lineupsRaw: state.lineupsRaw };
  for (const row of rows) {
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
      const all = state.rows.flatMap((row) => [row, ...(row.variants ?? [])]);
      const byKey = new Map(all.map((row) => [row.key, row]));
      const evidence = all.flatMap((row) => row.filterEvidence ? [row.filterEvidence] : []);
      const result = tradeFilterView(evidence, state.filters ?? defaultTradeFilters(), state.sort ?? "own", !!state.showHidden);
      // Group packages by the search engine's stable one-for-one seed, keeping the best sorted result first.
      const grouped = new Map<string, SearchRow>();
      for (const item of result.visible) {
        const row = byKey.get(item.key);
        if (!row) continue;
        const group = row.seedKey ?? row.key;
        const next = { ...row, variants: [], related: [] }, existingGroup = grouped.get(group);
        if (existingGroup) existingGroup.related!.push(next);
        else grouped.set(group, next);
      }
      state.filteredRows = [...grouped.values()];
      const hidden = result.hidden.flatMap(({ row, reasons }) => {
        const original = byKey.get(row.key);
        return original ? [{ row: original, reasons }] : [];
      });
      const page = state.filteredRows.slice(0, state.limit ?? 50);
      return { ...browseTradeResults(state.model, state.filteredRows, undefined, []),
        rows: page, views: newViews(state, page), groupsTotal: state.filteredRows.length,
        total: result.total, visibleTotal: result.visible.length, counts: result.only, blocks: result.counts, hidden, stats: state.stats };
 }
self.onmessage = async (event: MessageEvent<SearchRequest>) => {
  const request = event.data;
  const { id, context } = request;
  try {
    // Filter and sort the captured evidence only; stale worker messages are ignored.
    if (request.type === "filter" || request.type === "sort") {
      if (!retained || retained.id !== id || retained.context !== context) return;
      if (request.type === "filter") {
        retained.filters = request.filters;
        retained.showHidden = request.showHidden;
        retained.limit = Math.max(1, request.limit ?? 50);
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
        // Expanded variants share the same captured model and must remain inspectable by their own keys.
        const rows = [...retained.rows, ...retained.suggestions];
        const row = [...rows, ...rows.flatMap((candidate) => candidate.variants ?? [])].find(
          (candidate) => candidate.key === request.key,
        );
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
              retained.query,
              row,
              retained.lineupsRaw,
              !retained.useful,
            ),
            incentive: opponentIncentive(
              retained.model,
              retained.query,
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
      send({
        id,
        context,
        type: "browse",
        token: request.token,
        ...browseTradeResults(
          retained.model,
          retained.filteredRows ?? retained.rows,
          request.options,
          retained.query.give,
        ),
        total: (retained.filteredRows ?? retained.rows).length,
        stats: retained.stats,
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
    const started = performance.now();
    // Keep the existing path intact until the broad-search controls are enabled.
    if (request.useful) {
      const stats: SearchStats = { teams: 0, checked: 0, excluded: 0, thinTeams: 0, matched: 0, scored: 0 };
      const own = request.query.teamA;
      const basis = readLineupBasis(request.query.lineupBasis);
      // Retain streamed one-for-ones so filters work before the larger packages finish.
      let lastPartial = -Infinity;
      const initialFilters = request.useful.filters ?? defaultTradeFilters();
      const initialSort = request.useful.sort ?? "own";
      const partial = (rows: SearchRow[], final = false) => {
        // Batches arrive often; the screen only needs a fresh list a couple of times a second.
        const now = performance.now();
        if (!final && now - lastPartial < 400) return;
        lastPartial = now;
        retained = { id, context, rows, suggestions: [], stats, model, query: request.query, lineupsRaw: request.lineupsRaw, useful: true,
          filters: retained?.filters ?? initialFilters, sort: retained?.sort ?? initialSort,
          showHidden: retained?.showHidden ?? request.useful?.showHidden, limit: retained?.limit ?? request.useful?.limit };
        send({ id, context, type: "partial", ...filteredPayload(retained) });
      };
      // Compare completed opponents with the authoritative league team list.
      const opponents = model.dataset.tables.ModelTeams.map((team) => String(team.TeamID)).filter((team) => team && team !== "0" && team !== own);
      const completedTeams = new Set<string>();
      const reportTeam = (event: TeamProgress) => { if (event.done) completedTeams.add(event.team); send({ id, context, type: "team", ...event }); };
      let retryQueue: Promise<unknown> = Promise.resolve();
      const size = poolSize(opponents.length, self.navigator?.hardwareConcurrency, typeof Worker !== "undefined");
      let found: { rows: SearchRow[]; coverage: UsefulCoverage } | undefined;
      // Opponents are searched in helper workers owned by this one; ending this worker ends them. No helpers means one thread.
      if (size > 1)
        try {
          found = await runPooled(
            { dataset: request.dataset, settings: request.settings, evidence: request.evidence, roleWeight: request.roleWeight,
              scenario: request.scenario, lineupsRaw: request.lineupsRaw, teamA: own, basis: request.query.lineupBasis,
              protectedIds: request.useful.protectedIds },
            partition(opponents, size),
            () => new Worker(new URL("./trade-search-part.worker.ts", import.meta.url), { type: "module" }),
            partial,
            reportTeam,
            (slice, publish) => {
              // Retry one failed slice at a time because lineup memoization is worker-scoped.
              for (const team of slice) completedTeams.delete(team);
              const task = retryQueue.then(async () => {
                const result = await runUsefulTradeSearch(model, own, request.useful!.protectedIds, basis, request.lineupsRaw,
                  (singles) => publish(singles.map((row) => ({ ...row.searchRow, seedKey: row.seedKey }))), undefined, slice, reportTeam);
                return { rows: result.rows.map(({ trade, variants }) => ({ ...trade.searchRow, seedKey: trade.seedKey,
                  variants: variants.map((v) => ({ ...v.searchRow, seedKey: v.seedKey })) })), coverage: result.coverage };
              });
              retryQueue = task.catch(() => undefined);
              return task;
            },
          );
        } catch {
          found = undefined;
        }
      if (!found) {
        const result = await runUsefulTradeSearch(model, own, request.useful.protectedIds, basis, request.lineupsRaw,
          (singles) => partial(singles.map((row) => ({ ...row.searchRow, seedKey: row.seedKey }))), undefined, undefined,
          reportTeam);
        found = {
          rows: result.rows.map(({ trade, variants }) => ({ ...trade.searchRow, seedKey: trade.seedKey, variants: variants.map((v) => ({ ...v.searchRow, seedKey: v.seedKey })) })),
          coverage: result.coverage,
        };
      }
      const rows = found.rows;
      // A missing completed team is reported explicitly, never counted as searched.
      const missingTeams = opponents.filter((team) => !completedTeams.has(team));
      if (missingTeams.length) found.coverage.missingTeams = missingTeams;
      Object.assign(stats, { teams: found.coverage.opponents, checked: found.coverage.singles,
        scored: found.coverage.singles + found.coverage.extensions, matched: rows.length });
      retained = { id, context, rows, suggestions: [], stats, model, query: request.query, lineupsRaw: request.lineupsRaw, useful: true,
        filters: currentRetained()?.filters ?? initialFilters, sort: currentRetained()?.sort ?? initialSort,
        showHidden: currentRetained()?.showHidden ?? request.useful?.showHidden, limit: currentRetained()?.limit ?? request.useful?.limit };
      send({ id, context, type: "complete", ...filteredPayload(retained), coverage: found.coverage });
      return;
    }
    let lastProgress = 0,
      evaluationStarted = started;
    // Throttle expensive structured-clone messages while keeping phase changes immediately visible.
    const progress = (
      phase:
        "Finding matching packages" | "Evaluating trades" | "Sorting results",
      stats: SearchStats,
      force = false,
    ) => {
      const now = performance.now();
      if (force || now - lastProgress >= 150) {
        // Estimate only the bounded evaluation phase; later, more complex packages may change this estimate.
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
    // Forward saved starters for the optional opponent-fit check; unfiltered enumeration is unchanged.
    const { matches, stats } = findDiscoveryMatches(
      model,
      request.query,
      (s) => progress("Finding matching packages", s),
      request.lineupsRaw,
    );
    evaluationStarted = performance.now();
    progress("Evaluating trades", stats, true);
    // Cache authoritative scores for exact zero-result recovery previews.
    const evaluated = new Map<string, SearchRow>();
    const rows: SearchRow[] = [];
    const suggestions: SearchRow[] = [];
    // Weekly screening uses the evaluator's averages after every complete trade evaluation.
    if (request.query.weekly) stats.weeklyExcluded = 0;
    // Report surface exclusions separately from modeled weekly-gain failures and raw index enumeration.
    if (request.query.surface) stats.surfaceExcluded = 0;
    if (request.query.manager) stats.managerExcluded = 0;
    // This filter needs each complete evaluated package, including its required drops.
    if (request.query.usefulness) stats.usefulnessExcluded = 0;
    if (request.query.deficitProtection?.enabled)
      stats.deficitProtectionExcluded = 0;
    if (request.query.gradeImpacts?.length)
      stats.gradeImpactExcluded = 0;
    // Every exact match receives the same authoritative evaluation as a manually entered trade.
    for (const match of matches) {
      const row = scoreTradeMatch(
        model,
        request.query,
        match,
        request.lineupsRaw,
      );
      evaluated.set(match.key, row);
      // Exact matches keep every enabled limit; nearby evaluated packages are a separate, explicitly explained list.
      const failures = discoveryFailures(row, request.query);
      if (!failures.length && !row.nearMiss) rows.push(row);
      else {
        // Diagnose this safeguard independently from overall weekly gain and positional-deficit targeting.
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
        // Report positional failures separately; they must not masquerade as failed total weekly-gain limits.
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
        // Drop warnings do not suppress exact matches or otherwise useful near misses.
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
    // Keep the complete ranked offers in the worker; the first response represents distinct packages for every team.
    retained = {
      id,
      context,
      rows,
      suggestions,
      stats,
      model,
      query: request.query,
      lineupsRaw: request.lineupsRaw,
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
    // Recovery runs only after an empty completed search; separate messages preserve its original filters and totals.
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
    // Fail explicitly rather than publishing an incomplete list as a completed search.
    retained = undefined;
    send({
      id,
      context,
      type: "error",
      message: error instanceof Error ? error.message : "Trade search failed.",
    });
  }
};
