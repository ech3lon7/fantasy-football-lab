import { starterLineupsKey } from "../domain/starter-lineups";
import { evaluate, type Model } from "../domain/valuation";
import { teamsAssessment } from "../domain/lineups";
import { evaluateTrade } from "../domain/trades";
import { evidenceKey, roleScenarioKey } from "../domain/opportunity";
import { applyRosterScenario } from "../domain/roster-scenarios";
import type { RosterScenario } from "../domain/roster-scenarios";
import type { Draft } from "../domain/contracts";
let model: Model | undefined,
  key = "";
// Project each saved recipe independently, retaining conflicts as uncertainty rather than changing the live cache.
function projectedTrade(
  base: Model,
  draft: Draft,
  scenario?: RosterScenario,
  raw?: string,
) {
  const projected = applyRosterScenario(base, scenario, raw);
  const result = evaluateTrade(
    projected,
    draft,
    true,
    projected.simulation?.lineupsRaw ?? raw,
  );
  if (result.valid)
    result.uncertainty.push(...(projected.simulation?.issues ?? []));
  return result;
}
self.onmessage = (e: MessageEvent) => {
  const { id, dataset, settings, draft, type, filters } = e.data;
  try {
    // Supplemental references participate in cache identity but do not alter the imported workbook contract.
    const evidence = filters?.[evidenceKey];
    const roleWeight = filters?.[roleScenarioKey];
    const next =
      dataset.hash +
      JSON.stringify(settings) +
      (evidence ?? "") +
      (roleWeight ?? "0");
    // Automatic screening depends on player data and model settings, never manual Gem approval or review expiry.
    if (next !== key) {
      model = evaluate(dataset, settings, { evidence, roleWeight });
      key = next;
    }
    // Starter selections are request-specific analysis state; pass them through without changing cached player valuations.
    if (type === "saved-trades") {
      // Batch saved drafts through one dataset transfer and cached model, preserving the existing evaluator.
      for (const trade of e.data.trades) {
        try {
          self.postMessage({
            id,
            savedId: trade.id,
            result: projectedTrade(
              model!,
              trade.draft,
              trade.scenario,
              filters?.[starterLineupsKey],
            ),
          });
        } catch (error) {
          self.postMessage({
            id,
            savedId: trade.id,
            error:
              error instanceof Error
                ? error.message
                : "Saved trade calculation failed",
          });
        }
      }
    } else if (type === "trade")
      self.postMessage({
        id,
        result: projectedTrade(
          model!,
          draft,
          e.data.scenario,
          filters?.[starterLineupsKey],
        ),
      });
    else
      self.postMessage({
        id,
        result: { model, grades: [...teamsAssessment(model!).entries()] },
      });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : "Calculation failed",
    });
  }
};
