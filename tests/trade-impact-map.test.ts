import { describe, expect, it } from "vitest";
import { defaults } from "../src/domain/contracts";
import { forHypotheticalScoring } from "../src/domain/lineups";
import { evaluate } from "../src/domain/valuation";
import { buildTradeImpactMap } from "../src/domain/trade-impact-map";
import { starterFixture } from "./fixtures";

// Isolate a single QB slot so the expected upgrades and replacement losses are hand-checkable.
async function sample() {
  const m = forHypotheticalScoring(evaluate(await starterFixture(), defaults));
  Object.assign(m.dataset.tables.ModelContext[0], { QBSlots: 1, RBSlots: 0, WRSlots: 0, TESlots: 0, FlexSlots: 0, KSlots: 0, DSTSlots: 0 });
  m.weeks = [m.current];
  for (const p of m.players) { p.expected = 5; p.value = 5; }
  for (const [id, points] of [["100", 20], ["101", 30], ["200", 25]] as const) {
    const p = m.byId.get(id)!; p.expected = points; p.value = points;
  }
  return m;
}

describe("trade lineup impact map", () => {
  it("measures starter loss, bench loss and incoming improvement in points per week", async () => {
    const m = await sample();
    const map = buildTradeImpactMap(m, "1", "best-available");
    expect(map.leave.get("1")?.get("101")).toBe(10);
    expect(map.leave.get("1")?.get("100")).toBe(0);
    expect(map.add.get("2")?.get("101")).toBe(5);
    expect(map.add.get("1")?.get("200")).toBe(0);
  });
  it("does not turn missing player EPPG into zero", async () => {
    const m = await sample(); m.byId.get("200")!.expected = null;
    const map = buildTradeImpactMap(m, "1", "best-available");
    expect(map.add.get("1")?.get("200")).toBeNull();
    expect(map.leave.get("2")?.get("200")).toBeNull();
  });
});
