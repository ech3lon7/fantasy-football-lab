import { expect, it, vi } from "vitest";
import { fixture } from "./fixtures";
import { evaluate } from "../src/domain/valuation";
import { evaluateTrade } from "../src/domain/trades";
import { teamsAssessment } from "../src/domain/lineups";
import * as mppg from "../src/domain/mppg";

// Changing weekly MPPG must not affect season valuations, position grades or trade verdicts.
it("keeps season valuation, grades and trade results independent of MPPG", async () => {
  const d = await fixture();
  const current = evaluate(d, d.settings);
  const calculate = mppg.calculateMppg;
  const stub = vi.spyOn(mppg, "calculateMppg").mockImplementation((model, player, week, stats) => {
    const result = calculate(model, player, week, stats);
    const old = player.weekly === null ? null : Math.max(0, player.weekly + (player.blendedExpected !== null && player.projected !== null ? 0.5 * (player.blendedExpected - player.projected) : 0));
    return { ...result, value: old };
  });
  try {
    const previous = evaluate(d, d.settings);
    const valuation = (m: typeof current) => m.players.map((p) => [p.id, p.blendedExpected, p.value, p.vorp, p.index]);
    expect(valuation(current)).toEqual(valuation(previous));
    expect([...teamsAssessment(current)]).toEqual([...teamsAssessment(previous)]);
    const draft = { teamA: "1", teamB: "2", give: ["1"], get: ["2"] };
    expect(evaluateTrade(current, draft, false)).toEqual(evaluateTrade(previous, draft, false));
  } finally { stub.mockRestore(); }
});
