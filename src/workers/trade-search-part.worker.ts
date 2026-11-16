import { evaluate } from "../domain/valuation";
import { applyRosterScenario } from "../domain/roster-scenarios";
import { runUsefulTradeSearch } from "../domain/useful-trade-adapter";
import { readLineupBasis } from "../domain/trade-impact";
import type { PartMessage, PartRequest } from "./trade-search-pool";

// A helper for the broad trade search: rebuilds the same model and searches only its share of the opponents.
// Its rows are exactly what the single-threaded search would have produced for those opponents.
self.onmessage = async (event: MessageEvent<PartRequest>) => {
  const request = event.data;
  const send = (message: PartMessage) => self.postMessage(message);
  try {
    const model = applyRosterScenario(
      evaluate(request.dataset, request.settings, { evidence: request.evidence, roleWeight: request.roleWeight }),
      request.scenario,
      request.lineupsRaw,
    );
    const result = await runUsefulTradeSearch(
      model,
      request.teamA,
      request.protectedIds,
      readLineupBasis(request.basis),
      request.lineupsRaw,
      (singles) => send({ type: "singles", rows: singles.map((row) => ({ ...row.searchRow, seedKey: row.seedKey })) }),
      request.beam,
      request.opponents,
      (event) => send({ type: "team", ...event }),
    );
    send({
      type: "done",
      rows: result.rows.map(({ trade, variants }) => ({ ...trade.searchRow, seedKey: trade.seedKey, variants: variants.map((v) => ({ ...v.searchRow, seedKey: v.seedKey })) })),
      coverage: result.coverage,
    });
  } catch (error) {
    send({ type: "error", message: error instanceof Error ? error.message : "The search helper failed." });
  }
};
