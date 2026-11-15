import { expect, it } from "vitest";
import { lineupFilterEvidence } from "../src/domain/trade-lineup-evidence";

// The role and MPPG filters use the same before/after players as the EPPG lineups.
it("requires every offered player to start each week and scores the existing current-week lineups", () => {
  const weekly = [
    { week: 7, beforeIds: ["a", "b"], ids: ["a", "c"] },
    { week: 8, beforeIds: ["a", "b"], ids: ["a", "c"] },
  ];
  const values = new Map([["a", 10], ["b", 12], ["c", 15]]);
  expect(lineupFilterEvidence(weekly, 7, ["c"], values)).toEqual({ startsEveryWeek: true, weekGain: 3 });
  expect(lineupFilterEvidence([...weekly, { week: 9, beforeIds: ["a"], ids: ["a"] }], 7, ["c"], values).startsEveryWeek).toBe(false);
  expect(lineupFilterEvidence(weekly, 7, ["c"], new Map([["a", 10], ["b", 12]])).weekGain).toBeNull();
  expect(lineupFilterEvidence([], 7, ["c"], values)).toEqual({ startsEveryWeek: false, weekGain: null });
});
