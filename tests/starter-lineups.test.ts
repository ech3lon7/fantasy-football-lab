import { expect, it } from "vitest";
import { starterFixture } from "./fixtures";
import { evaluate } from "../src/domain/valuation";
import { evaluateTrade } from "../src/domain/trades";
import { roster, lineup } from "../src/domain/lineups";
import {
  directStarterImpact,
  readStarterLineup,
  resetStarterLineup,
  saveStarterLineup,
  validateStarterIds,
} from "../src/domain/starter-lineups";

// Imported assignments, including legitimate slot zero, must seed user choices instead of the model's preferred QB.
it("seeds actual imported starters and preserves the legacy optimizer", async () => {
  const d = await starterFixture(),
    m = evaluate(d, d.settings);
  expect(readStarterLineup(m, "1").ids.sort()).toEqual(["1", "100"]);
  expect(lineup(m, roster(m, "1"), m.current).ids).toContain("101");
});

// Saved app choices remain private state, never mutations of ESPN slots or player valuations.
it("saves and resets per-team plans without changing data or other teams", async () => {
  const d = await starterFixture(),
    m = evaluate(d, d.settings),
    original = structuredClone(d);
  const a = saveStarterLineup(m, "1", ["1", "101"]);
  const both = saveStarterLineup(m, "2", ["2", "200"], a);
  expect(readStarterLineup(m, "1", both)).toMatchObject({
    ids: ["1", "101"],
    source: "Saved app lineup",
    errors: [],
  });
  expect(readStarterLineup(m, "1", resetStarterLineup("1", both)).source).toBe(
    "Imported ESPN lineup",
  );
  expect(readStarterLineup(m, "2", resetStarterLineup("1", both)).source).toBe(
    "Saved app lineup",
  );
  expect(d).toEqual(original);
});

// Only legal position/FLEX combinations may be saved, and partial lineups remain visibly unfilled.
it("validates ownership, duplicates, IR and position limits", async () => {
  const d = await starterFixture(),
    m = evaluate(d, d.settings);
  expect(validateStarterIds(m, "1", ["100", "101"]).join()).toContain("QB");
  expect(validateStarterIds(m, "1", ["1", "1"]).join()).toContain("twice");
  expect(validateStarterIds(m, "1", ["2"]).join()).toContain("no longer");
  expect(validateStarterIds(m, "1", [])).toEqual([]);
  m.byId.get("101")!.slot = 21;
  expect(() => saveStarterLineup(m, "1", ["101"])).toThrow("IR");
  // Two RBs fit RB + FLEX, while a third exceeds both slots.
  for (const id of ["103", "104"]) m.byId.get(id)!.owner = "1";
  expect(validateStarterIds(m, "1", ["1", "103"])).toEqual([]);
  expect(validateStarterIds(m, "1", ["1", "103", "104"])).not.toHaveLength(0);
});

// The user's key case: a valuable benched QB has zero direct loss, yet the exchange remains a bad deal.
it("shows zero direct scoring loss for a bench trade while grading lost value and coverage independently", async () => {
  const d = await starterFixture(),
    m = evaluate(d, d.settings);
  const trade = evaluateTrade(
    m,
    { teamA: "1", teamB: "2", give: ["101"], get: ["200"] },
    false,
  );
  if (!trade.valid) throw Error(trade.errors.join());
  expect(trade.directA.expectedPerWeek).toBe(0);
  expect(trade.directA.weekly.every((w) => w.expectedGain === 0)).toBe(true);
  expect(trade.directA.benchOutgoing).toContain("101");
  expect(trade.grade).toBe("Horrible deal");
  expect(trade.a.expected).toBeLessThan(0);
  expect(trade.outgoing).toBeGreaterThan(trade.incoming);
  expect(trade.directA.promotedIncoming).not.toContain("200");
});

// A starter trade should count the explicitly shown reserve replacement, rather than subtracting the full outgoing score.
it("uses a named replacement only when an active starter actually leaves", async () => {
  const d = await starterFixture(),
    m = evaluate(d, d.settings);
  const impact = directStarterImpact(m, "1", ["1", "101", "200"], ["200"]);
  expect(impact.replacements).toEqual(["101"]);
  expect(impact.weekly[0].beforeIds).toContain("100");
  expect(impact.weekly[0].ids).toContain("101");
  expect(impact.weekly[0].expectedGain).toBe(10);
});

// An incoming upgrade can improve starters while an outgoing reserve contributes no direct loss.
it("counts incoming scoring upgrades and recomputes after changing marked starters", async () => {
  const d = await starterFixture(),
    m = evaluate(d, d.settings);
  const after = ["1", "100", "2"];
  const impact = directStarterImpact(m, "1", after, ["2"]);
  expect(impact.expectedPerWeek).toBe(15);
  expect(impact.promotedIncoming).toEqual(["2"]);
  const saved = saveStarterLineup(m, "1", ["1", "101"]);
  const changed = directStarterImpact(
    m,
    "1",
    ["1", "100", "200"],
    ["200"],
    saved,
  );
  expect(changed.weekly[0].expectedGain).toBe(-10);
});

// Byes and unavailable starters do not invent bench points; missing model inputs stay unavailable rather than zero.
it("preserves bye, injury, negative-score and missing-data distinctions", async () => {
  const d = await starterFixture(),
    m = evaluate(d, d.settings),
    ids = roster(m, "1");
  const impact = directStarterImpact(m, "1", ids, []);
  expect(impact.weekly.find((w) => w.week === 8)!.beforeIds).not.toContain(
    "100",
  );
  expect(impact.weekly.find((w) => w.week === 8)!.beforeIds).not.toContain(
    "101",
  );
  m.byId.get("100")!.out = true;
  expect(
    directStarterImpact(m, "1", ids, []).weekly[0].beforeIds,
  ).not.toContain("100");
  m.byId.get("100")!.out = false;
  m.byId.get("100")!.expected = -2;
  m.byId.get("100")!.value = -2;
  expect(directStarterImpact(m, "1", ids, []).weekly[0].beforeIds).toContain(
    "100",
  );
  m.byId.get("100")!.expected = null;
  expect(directStarterImpact(m, "1", ids, []).expected).toBeNull();
});

// Roster/season changes and malformed settings must be reviewable without silently replacing the user's saved plan.
it("revalidates saved plans after refresh and rejects corrupted settings", async () => {
  const d = await starterFixture(),
    m = evaluate(d, d.settings),
    saved = saveStarterLineup(m, "1", ["1", "101"]);
  m.current++;
  expect(readStarterLineup(m, "1", saved).warnings.join()).toContain("review");
  m.byId.get("101")!.owner = "2";
  const changed = readStarterLineup(m, "1", saved);
  expect(changed.errors.join()).toContain("no longer");
  expect(changed.warnings.join()).toContain("Roster changed");
  expect(
    directStarterImpact(m, "1", ["1", "100"], [], saved).expected,
  ).toBeNull();
  expect(readStarterLineup(m, "1", "broken").errors.join()).toContain(
    "invalid",
  );
  expect(resetStarterLineup("1", "broken")).toBe("");
});

// Starter overrides affect only the new direct result, not the established valuation/grade/package calculations.
it("leaves legacy trade results and valuation formulas unchanged", async () => {
  const d = await starterFixture(),
    m = evaluate(d, d.settings),
    draft = { teamA: "1", teamB: "2", give: ["101"], get: ["200"] };
  const before = evaluateTrade(m, draft, false),
    after = evaluateTrade(
      m,
      draft,
      false,
      saveStarterLineup(m, "1", ["1", "101"]),
    );
  if (!before.valid || !after.valid)
    throw Error("Expected valid fixture trade");
  expect({
    ...after,
    directA: before.directA,
    directB: before.directB,
  }).toEqual(before);
  expect(after.directA.expected).not.toBe(before.directA.expected);
});

// Missing imported slot data must not masquerade as a zero-impact bench designation.
it("requires review for missing imported slots and accepts an explicit valid app plan", async () => {
  const d = await starterFixture();
  d.tables.ModelRosters = d.tables.ModelRosters.filter(
    (r) => r.PlayerID !== 101,
  );
  const m = evaluate(d, d.settings);
  expect(readStarterLineup(m, "1").errors.join()).toContain(
    "slots are missing",
  );
  expect(directStarterImpact(m, "1", roster(m, "1"), []).expected).toBeNull();
  const saved = saveStarterLineup(m, "1", ["1", "100"]);
  expect(readStarterLineup(m, "1", saved).errors).toEqual([]);
});
