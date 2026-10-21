import { gemRulesKey, gemContextKey } from "../domain/gems";
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
    const gemRules = filters?.[gemRulesKey],
      roleReviews = filters?.[gemContextKey];
    const next =
      dataset.hash +
      JSON.stringify(settings) +
      (evidence ?? "") +
      (roleWeight ?? "0") +
      JSON.stringify([gemRules ?? "", roleReviews ?? ""]);
    // Expired context invalidates cached classifications even when persisted inputs have not changed.
    if (
      next !== key ||
      (model?.gemExpiresAt && model.gemExpiresAt <= Date.now())
    ) {
      model = evaluate(dataset, settings, {
        evidence,
        roleWeight,
        gemRules,
        roleReviews,
      });
      key = next;
    }
    if (type === "trade")
      self.postMessage({ id, result: evaluateTrade(model!, draft, true) });
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
