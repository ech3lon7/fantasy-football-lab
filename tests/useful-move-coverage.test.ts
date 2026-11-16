import { describe, expect, it } from "vitest";
import { defaults } from "../src/domain/contracts";
import { forHypotheticalScoring, roster, withLineupMemoAsync } from "../src/domain/lineups";
import { evaluate } from "../src/domain/valuation";
import { evaluateTrade } from "../src/domain/trades";
import { scoreTradeMatch, type TradeSearchQuery } from "../src/domain/trade-search";
import { tradeImpact } from "../src/domain/trade-impact";
import { runUsefulTradeSearch } from "../src/domain/useful-trade-adapter";
import { FLOOR_MAX_LOSS_OWN, FLOOR_MAX_LOSS_OTHER } from "../src/domain/useful-move-search";
import { bigLeagueFixture } from "./big-league-fixture";

describe("useful trade engine coverage", () => {
  it("finds all 9 shapes and matches brute force top-18 trades up to 2:2", async () => {
    const fixture = await bigLeagueFixture(4);
    const m = forHypotheticalScoring(evaluate(fixture, defaults));
    const ownTeam = "1";
    const opponent = "2";
    const basis = "best-available";

    // Run engine against team 2
    const engineResult = await runUsefulTradeSearch(m, ownTeam, [], basis, undefined, undefined, undefined, [opponent]);
    const engineTrades = engineResult.rows.flatMap((r) => [r.trade, ...r.variants]);

    // Check all 9 shapes appear
    const engineShapes = new Set(engineTrades.map((t) => `${t.give.length}:${t.get.length}`));
    const allShapes = ["1:1", "1:2", "1:3", "2:1", "2:2", "2:3", "3:1", "3:2", "3:3"];
    for (const shape of allShapes) {
      expect(engineShapes.has(shape), `shape ${shape} should appear in engine results`).toBe(true);
    }

    // Brute force check up to 2:2
    const ours = roster(m, ownTeam);
    const theirs = roster(m, opponent);

    const evaluateBrute = (give: string[], get: string[]) => {
      const query: TradeSearchQuery = { teamA: ownTeam, give, count: get.length, below: 0, above: 0, lineupBasis: basis };
      const incoming = get.reduce((s, id) => s + (m.byId.get(id)?.index ?? 0), 0);
      const outgoing = give.reduce((s, id) => s + (m.byId.get(id)?.index ?? 0), 0);
      const draft = { teamA: ownTeam, teamB: opponent, give, get };
      const evaluated = evaluateTrade(m, draft, false);
      const searchRow = scoreTradeMatch(
        m,
        query,
        { key: JSON.stringify([opponent, give, get]), teamB: opponent, give, get, incoming, outgoing, difference: incoming - outgoing },
        undefined,
        evaluated,
      );
      const impact = tradeImpact(evaluated, basis);
      const changed = !!impact && [impact.own, impact.other].some((side) =>
        side.weekly.some((week) => JSON.stringify(week.beforeIds) !== JSON.stringify(week.ids))
      );
      const passes = searchRow.legal === true && changed && searchRow.own !== null && searchRow.other !== null &&
        Number.isFinite(searchRow.own) && Number.isFinite(searchRow.other) &&
        searchRow.own >= -FLOOR_MAX_LOSS_OWN && searchRow.other >= -FLOOR_MAX_LOSS_OTHER;
      return passes ? { give, get, own: searchRow.own!, other: searchRow.other! } : null;
    };

    const bruteByShape: Record<string, { give: string[]; get: string[]; own: number; other: number }[]> = {
      "1:1": [],
      "2:1": [],
      "1:2": [],
      "2:2": [],
    };

    await withLineupMemoAsync(async () => {
      // 1:1
      for (let i = 0; i < ours.length; i++) {
        for (let j = 0; j < theirs.length; j++) {
          const res = evaluateBrute([ours[i]], [theirs[j]]);
          if (res) bruteByShape["1:1"].push(res);
        }
      }

      // 2:1
      for (let i = 0; i < ours.length; i++) {
        for (let i2 = i + 1; i2 < ours.length; i2++) {
          for (let j = 0; j < theirs.length; j++) {
            const res = evaluateBrute([ours[i], ours[i2]], [theirs[j]]);
            if (res) bruteByShape["2:1"].push(res);
          }
        }
      }

      // 1:2
      for (let i = 0; i < ours.length; i++) {
        for (let j = 0; j < theirs.length; j++) {
          for (let j2 = j + 1; j2 < theirs.length; j2++) {
            const res = evaluateBrute([ours[i]], [theirs[j], theirs[j2]]);
            if (res) bruteByShape["1:2"].push(res);
          }
        }
      }

      // 2:2
      for (let i = 0; i < ours.length; i++) {
        for (let i2 = i + 1; i2 < ours.length; i2++) {
          for (let j = 0; j < theirs.length; j++) {
            for (let j2 = j + 1; j2 < theirs.length; j2++) {
              const res = evaluateBrute([ours[i], ours[i2]], [theirs[j], theirs[j2]]);
              if (res) bruteByShape["2:2"].push(res);
            }
          }
        }
      }
    });

    // Check top 18 for each shape 1:1, 2:1, 1:2, 2:2
    for (const shape of ["1:1", "2:1", "1:2", "2:2"]) {
      const brute = bruteByShape[shape];
      const engine = engineTrades.filter((t) => `${t.give.length}:${t.get.length}` === shape);

      const bruteOwnDesc = [...brute].sort((a, b) => b.own - a.own);
      const engineOwnDesc = [...engine].sort((a, b) => b.own! - a.own!);

      const bruteBothDesc = [...brute].sort((a, b) => Math.min(b.own, b.other) - Math.min(a.own, a.other));
      const engineBothDesc = [...engine].sort((a, b) => Math.min(b.own!, b.other!) - Math.min(a.own!, a.other!));

      for (let k = 0; k < 18; k++) {
        expect(engineOwnDesc[k], `engine should have k=${k} for shape ${shape} sorted by own`).toBeDefined();
        expect(bruteOwnDesc[k], `brute force should have k=${k} for shape ${shape} sorted by own`).toBeDefined();
        expect(
          Math.abs(engineOwnDesc[k].own! - bruteOwnDesc[k].own),
          `shape ${shape} rank ${k} own value should match within 0.01 (engine: ${engineOwnDesc[k].own}, brute: ${bruteOwnDesc[k].own})`,
        ).toBeLessThanOrEqual(0.01);

        expect(engineBothDesc[k], `engine should have k=${k} for shape ${shape} sorted by both`).toBeDefined();
        expect(bruteBothDesc[k], `brute force should have k=${k} for shape ${shape} sorted by both`).toBeDefined();
        const engineMin = Math.min(engineBothDesc[k].own!, engineBothDesc[k].other!);
        const bruteMin = Math.min(bruteBothDesc[k].own, bruteBothDesc[k].other);
        expect(
          Math.abs(engineMin - bruteMin),
          `shape ${shape} rank ${k} both (min) value should match within 0.01 (engine: ${engineMin}, brute: ${bruteMin})`,
        ).toBeLessThanOrEqual(0.01);
      }
    }
  }, 600000);
});
