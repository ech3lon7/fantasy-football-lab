import { chainFixture } from "./chain-fixture";
import { fromTables } from "../src/import/workbook";
import { mean, sd } from "../src/domain/contracts";

// A valuable reserve covers the outgoing RB: your modeled gain is positive while the recipient prefers the offered surface numbers.
export async function surfaceFixture() {
  const d = await chainFixture();
  for (const [id, scores, projected, weekly] of [
    [1, [30, 30, 30, 30, 30], 30, 30],
    [3, [28, 28, 28, 28, 28], 28, 28],
    [4, [8, 8, 8, 8, 8], 8, 8],
    [2, [-15, -15, 30, 30, 30], 30, 12],
  ] as const) {
    const p = d.tables.ModelPlayers.find((p) => p.PlayerID === id)!;
    Object.assign(p, {
      ActualPoints: scores.reduce((a, b) => a + b, 0),
      Actual_PPG: mean([...scores]),
      Last3_PPG: mean(scores.slice(-3)),
      ScoreSD: sd([...scores]),
      ESPN_Projected_PPG: projected,
      ESPN_Projected_Total: projected * 17,
      Current_Week_Projection: weekly,
    });
    d.tables.ModelHistory.filter((h) => h.PlayerID === id).forEach((h, i) => {
      h.Points = scores[i];
    });
  }
  return fromTables(d.tables, d.settings);
}
