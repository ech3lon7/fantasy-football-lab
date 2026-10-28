import { surfaceFailures } from "../domain/surface-appeal";
import { findTradeRecoveries } from "../domain/trade-guidance";
import { evaluate, type Model } from "../domain/valuation";
import { applyRosterScenario } from "../domain/roster-scenarios";
import {
  scoreTradeMatch,
  matchesWeekly,
  searchLineupDetails,
  type TradeSearchQuery,
  searchPageSize,
  type SearchRequest,
  type SearchResponse,
  type SearchRow,
  type SearchStats,
} from "../domain/trade-search";
import {
  compareDiscoveryRows,
  discoveryFailures,
  findDiscoveryMatches,
  opponentIncentive,
  retainSuggestion,
  violatesProtection,
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
    }
  | undefined;
const send = (message: SearchResponse) => self.postMessage(message);
self.onmessage = (event: MessageEvent<SearchRequest>) => {
  const request = event.data;
  const { id, context } = request;
  try {
    // Detail requests reuse the captured model/query and affect neither the completed ranking nor draft.
    if (request.type === "details") {
      if (!retained || retained.id !== id || retained.context !== context)
        return;
      try {
        const row = [...retained.rows, ...retained.suggestions].find(
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
    // Page only a completed matching request; page size limits rendering, never search completeness.
    if (request.type === "page") {
      if (!retained || retained.id !== id || retained.context !== context)
        return;
      if (
        !Number.isInteger(request.offset) ||
        request.offset < 0 ||
        request.offset > retained.rows.length
      )
        throw Error("Invalid result page.");
      send({
        id,
        context,
        type: "page",
        rows: retained.rows.slice(
          request.offset,
          request.offset + searchPageSize,
        ),
        offset: request.offset,
        total: retained.rows.length,
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
    // This filter needs each complete evaluated package, including its required drops.
    if (request.query.usefulness) stats.usefulnessExcluded = 0;
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
      if (!failures.length) rows.push(row);
      else {
        if (surfaceFailures(row, request.query.surface).length)
          stats.surfaceExcluded = (stats.surfaceExcluded ?? 0) + 1;
        if (violatesProtection(row, request.query))
          stats.protectedExcluded = (stats.protectedExcluded ?? 0) + 1;
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
          request.query.discovery?.nearMisses &&
          !violatesProtection(row, request.query)
        )
          retainSuggestion(
            suggestions,
            row,
            failures,
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
      rows: rows.slice(0, searchPageSize),
      offset: 0,
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
