import { evaluate, type Model } from "../domain/valuation";
import { teamsAssessment } from "../domain/lineups";
import { evaluateTrade } from "../domain/trades";
let model: Model | undefined,
  key = "";
self.onmessage = (e: MessageEvent) => {
  const { id, dataset, settings, draft, type } = e.data;
  try {
    const next = dataset.hash + JSON.stringify(settings);
    if (next !== key) {
      model = evaluate(dataset, settings);
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
