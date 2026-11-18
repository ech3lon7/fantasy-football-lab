import { evaluate } from "../domain/valuation";
import { applyRosterScenario } from "../domain/roster-scenarios";
import {
  runCompleteTradeSearch,
  type CompleteTrade,
} from "../domain/complete-trade-search";
import type { PartMessage, PartRequest } from "./trade-search-pool";

// A helper for the broad trade search: rebuilds the same model and searches only its share of the opponents.
// Its rows are exactly what the single-threaded search would have produced for those opponents.
self.onmessage = async (event: MessageEvent<PartRequest>) => {
  const request = event.data;
  const send = (message: PartMessage) => self.postMessage(message);
  try {
    const model = applyRosterScenario(
      evaluate(request.dataset, request.settings, {
        evidence: request.evidence,
        roleWeight: request.roleWeight,
      }),
      request.scenario,
      request.lineupsRaw,
    );
    const collectedRows: CompleteTrade[] = [];
    const coverage = await runCompleteTradeSearch(
      model,
      request.teamA,
      request.lineupsRaw,
      request.manager,
      request.opponents,
      (teamEvent) => {
        if (teamEvent.done) {
          collectedRows.push(...teamEvent.rows);
          send({
            type: "team-rows",
            team: teamEvent.team,
            possible: teamEvent.possible,
            scored: teamEvent.scored,
            kept: teamEvent.kept,
            rows: teamEvent.rows,
          });
        }
      },
    );
    send({
      type: "done",
      rows: collectedRows,
      coverage,
    });
  } catch (error) {
    send({
      type: "error",
      message:
        error instanceof Error ? error.message : "The search helper failed.",
    });
  }
};
