import { starterLineupsKey } from "../domain/starter-lineups";
import { evaluate, type Model } from "../domain/valuation";
import { teamsAssessment } from "../domain/lineups";
import { evaluateTrade } from "../domain/trades";
import { evidenceKey, roleScenarioKey } from "../domain/opportunity";
let model: Model | undefined,
  key = "";
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
    if (type === "trade")
      self.postMessage({
        id,
        result: evaluateTrade(
          model!,
          draft,
          true,
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
