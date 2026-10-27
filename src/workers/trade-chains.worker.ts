import { evaluate } from "../domain/valuation";
import {
  applyRosterScenario,
  type RosterScenario,
} from "../domain/roster-scenarios";
import {
  searchTradeChains,
  type ChainQuery,
  type ChainStats,
} from "../domain/trade-chains";
import type { Dataset, Settings } from "../domain/contracts";

// A dedicated disposable worker isolates bounded chain exploration from ordinary search and makes Cancel immediate.
export interface ChainRequest {
  id: string;
  context: string;
  dataset: Dataset;
  settings: Settings;
  evidence: string;
  roleWeight: string;
  lineupsRaw?: string;
  scenario?: RosterScenario;
  query: ChainQuery;
}
self.onmessage = (event: MessageEvent<ChainRequest>) => {
  const request = event.data;
  const send = (message: object) =>
    self.postMessage({ id: request.id, context: request.context, ...message });
  try {
    const model = applyRosterScenario(
      evaluate(request.dataset, request.settings, {
        evidence: request.evidence,
        roleWeight: request.roleWeight,
      }),
      request.scenario,
      request.lineupsRaw,
    );
    let last = 0;
    const started = performance.now();
    const progress = (stats: ChainStats) => {
      const now = performance.now();
      if (now - last >= 150 || stats.phase === "Complete") {
        send({ type: "progress", stats, elapsed: now - started });
        last = now;
      }
    };
    const result = searchTradeChains(
      model,
      request.query,
      request.lineupsRaw,
      progress,
    );
    send({ type: "complete", result, elapsed: performance.now() - started });
  } catch (error) {
    send({
      type: "error",
      message: error instanceof Error ? error.message : "Chain search failed.",
    });
  }
};
