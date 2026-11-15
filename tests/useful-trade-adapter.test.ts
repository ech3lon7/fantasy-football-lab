import { expect, it } from "vitest";
import { defaults } from "../src/domain/contracts";
import { forHypotheticalScoring, roster } from "../src/domain/lineups";
import { evaluate } from "../src/domain/valuation";
import { runUsefulTradeSearch } from "../src/domain/useful-trade-adapter";
import { starterFixture } from "./fixtures";

// The real model adapter must check all rostered opponents through the existing trade evaluator.
it("evaluates every one-for-one against the real roster and preserves the scorer output", async () => {
  const m = forHypotheticalScoring(evaluate(await starterFixture(), defaults));
  m.weeks = [m.current];
  const one = roster(m, "1"), two = roster(m, "2");
  const result = await runUsefulTradeSearch(m, "1", [], "best-available");
  expect(result.coverage.singles).toBe(one.length * two.length);
  for (const row of result.rows) {
    expect(row.trade.legal).toBe(true);
    expect(row.trade.searchRow.own).toBe(row.trade.own);
    expect(row.trade.searchRow.other).toBe(row.trade.other);
  }
});

