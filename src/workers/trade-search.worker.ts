import { evaluate, type Model } from "../domain/valuation";
import {
  compareSearchRows,
  findTradeMatches,
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

// Keep one completed search in this dedicated worker; cancellation terminates the whole worker.
let retained:
  | {
      id: string;
      context: string;
      rows: SearchRow[];
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
        const row = retained.rows.find(
          (candidate) => candidate.key === request.key,
        );
        if (!row)
          throw Error("This trade is no longer in the completed search.");
        send({
          id,
          context,
          type: "details",
          key: request.key,
          details: searchLineupDetails(
            retained.model,
            retained.query,
            row,
            retained.lineupsRaw,
          ),
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
    const model = evaluate(request.dataset, request.settings, {
      evidence: request.evidence,
      roleWeight: request.roleWeight,
    });
    let lastProgress = 0;
    // Throttle expensive structured-clone messages while keeping phase changes immediately visible.
    const progress = (
      phase:
        "Finding matching packages" | "Evaluating trades" | "Sorting results",
      stats: SearchStats,
      force = false,
    ) => {
      if (force || performance.now() - lastProgress >= 150) {
        send({ id, context, type: "progress", progress: { phase, stats } });
        lastProgress = performance.now();
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
    const { matches, stats } = findTradeMatches(
      model,
      request.query,
      (s) => progress("Finding matching packages", s),
      request.lineupsRaw,
    );
    progress("Evaluating trades", stats, true);
    const rows: SearchRow[] = [];
    // Weekly screening uses the evaluator's averages after every complete trade evaluation.
    if (request.query.weekly) stats.weeklyExcluded = 0;
    // Every exact match receives the same authoritative evaluation as a manually entered trade.
    for (const match of matches) {
      const row = scoreTradeMatch(
        model,
        request.query,
        match,
        request.lineupsRaw,
      );
      if (matchesWeekly(row, request.query.weekly)) rows.push(row);
      else stats.weeklyExcluded = (stats.weeklyExcluded ?? 0) + 1;
      stats.scored++;
      progress("Evaluating trades", stats);
    }
    progress("Sorting results", stats, true);
    rows.sort(compareSearchRows);
    retained = {
      id,
      context,
      rows,
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
    });
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
