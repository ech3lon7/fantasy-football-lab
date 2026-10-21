import { expect, it } from "vitest";
import { fixture } from "./fixtures";
import { evaluate, playerSignals } from "../src/domain/valuation";
import {
  calibrateRole,
  parseEvidence,
  readEvidence,
} from "../src/domain/opportunity";
import { available } from "../src/domain/lineups";
import { evaluateTrade } from "../src/domain/trades";
import { mean, sd } from "../src/domain/contracts";

// Supplemental metrics must reference played games and retain comparable source definitions.
it("rejects unplayed usage rows and avoids averaging mixed provider definitions", async () => {
  const d = await roleFixture(),
    timestamp = new Date().toISOString();
  const rows = [3, 4, 5].map((Week) => ({
    PlayerID: "1",
    Week,
    Source: Week === 3 ? "Provider A" : "Provider B",
    AsOfUTC: timestamp,
    UsageXFP: 12,
  }));
  const p = evaluate(d, d.settings, {
    evidence: JSON.stringify(parseEvidence(rows, d)),
  }).byId.get("1")!;
  expect(p.opportunity.usageXFP).toBeNull();
  expect(p.opportunity.supplementalStatus).toContain("Mixed provider");
  d.tables.ModelHistory = d.tables.ModelHistory.filter(
    (h) => h.PlayerID !== 1 || h.Week !== 3,
  );
  expect(() => parseEvidence(rows, d)).toThrow("verified played game");
  expect(() => parseEvidence([{ ...rows[1], PassAttempts: 2.5 }], d)).toThrow(
    "range",
  );
});
import {
  defaultGemDraft,
  screenGems,
  validateGemDraft,
} from "../src/domain/gem-screening";

// Keep played-game scores valid while deliberately making season totals include an extra current game.
async function roleFixture() {
  const d = await fixture([5, 5, 14, 14, 14]);
  for (const h of d.tables.ModelHistory)
    Object.assign(h, {
      RushAttempts: 100,
      Targets: 100,
      Receptions: 50,
      RushTD: 0,
      ReceivingTD: 0,
    });
  const history = d.tables.ModelHistory.filter((h) => h.PlayerID === 1);
  history.forEach((h, i) =>
    Object.assign(h, {
      RushAttempts: i < 2 ? 5 : 15,
      Targets: i < 2 ? 1 : 3,
      Receptions: i < 2 ? 0 : 2,
    }),
  );
  Object.assign(d.tables.ModelPlayers[0], {
    RushAttempts: 999,
    Targets: 999,
    Season_Games: 6,
    Current_Actual_Games: 1,
  });
  return d;
}

// A refresh must never inflate workload by dividing six-game volume by five-game participation.
it("aligns workload, touchdown estimates and role changes to completed games without changing scoring forecasts", async () => {
  const d = await roleFixture(),
    m = evaluate(d, d.settings),
    p = m.byId.get("1")!;
  expect(p.opportunity.carries).toBe(55);
  expect(p.opportunity.targets).toBe(11);
  expect(p.workload).toBeCloseTo(13.2);
  expect(p.xtd).toBeCloseTo(55 / 32.5 + 11 / 11);
  expect(p.opportunity.recentRate).toBe(18);
  expect(p.opportunity.priorRate).toBe(6);
  expect(p.opportunity.recentReceptions).toBe(2);
  expect(playerSignals(p)).toContain("Role-growth watch");
  expect(p.gap).toBeLessThan(0);
  const old = evaluate(d, d.settings, { workbookMode: true }).byId.get("1")!;
  expect(p.expected).toBe(old.expected);
  expect(p.value).toBe(old.value);
});

// Independent role evidence remains searchable even when a touchdown warning is also present.
it("allows role growth and touchdown caution together and supports role thresholds", async () => {
  const d = await roleFixture();
  for (const h of d.tables.ModelHistory.filter((h) => h.PlayerID === 1))
    h.RushTD = 3;
  const m = evaluate(d, d.settings),
    p = m.byId.get("1")!;
  expect(playerSignals(p)).toContain("TD caution");
  expect(p.gem).toBe("Gem");
  expect(playerSignals(p)).toContain("Role-growth watch");
  const q = validateGemDraft(
    {
      ...defaultGemDraft("1"),
      pool: "All",
      position: "RB",
      signals: ["Role-growth watch"],
      roleMin: "10",
      targetsMin: "3",
    },
    ["1", "2"],
  ).query!;
  expect(screenGems(m.players, q).matches.map((r) => r.player.id)).toContain(
    "1",
  );
  expect(
    screenGems(m.players, { ...q, roleMin: 13 }).matches.map(
      (r) => r.player.id,
    ),
  ).not.toContain("1");
});

// Missing weekly fields and mismatched season totals must not become false zero-opportunity evidence.
it("keeps missing workload unavailable while preserving real zero counting stats", async () => {
  const d = await roleFixture();
  for (const h of d.tables.ModelHistory.filter((h) => h.PlayerID === 1))
    delete h.Targets;
  expect(evaluate(d, d.settings).byId.get("1")!.workload).toBeNull();
  for (const h of d.tables.ModelHistory.filter((h) => h.PlayerID === 1))
    Object.assign(h, { RushAttempts: null, Targets: null });
  expect(evaluate(d, d.settings).byId.get("1")!.workload).toBe(0);
});

// Usage-derived xFP and FPOE require exactly the same completed games; partial windows remain unknown.
it("calculates sourced usage metrics without substituting the blended forecast", async () => {
  const d = await roleFixture();
  const rows = [3, 4, 5].map((Week) => ({
    PlayerID: "1",
    Week,
    Source: "Synthetic usage",
    AsOfUTC: new Date().toISOString(),
    UsageXFP: 12,
    TargetShare: 0.2,
    AirYardsShare: 0.3,
    RouteParticipation: 0.7,
  }));
  const input = parseEvidence(rows, d),
    p = evaluate(d, d.settings, { evidence: JSON.stringify(input) }).byId.get(
      "1",
    )!;
  expect(p.opportunity.usageXFP).toBe(12);
  expect(p.opportunity.fpoe).toBe(2);
  expect(p.opportunity.wopr).toBeCloseTo(0.51);
  expect(p.opportunity.routes).toBeCloseTo(0.7);
  const partial = parseEvidence(rows.slice(1), d);
  expect(
    evaluate(d, d.settings, { evidence: JSON.stringify(partial) }).byId.get(
      "1",
    )!.opportunity.usageXFP,
  ).toBeNull();
  expect(() => parseEvidence([...rows, rows[0]], d)).toThrow("duplicate");
  expect(() => parseEvidence([{ ...rows[0], Week: 6 }], d)).toThrow(
    "completed",
  );
  expect(() =>
    parseEvidence([{ ...rows[0], RouteParticipation: 70 }], d),
  ).toThrow("range");
});

// Current market data must be format-compatible, fresh and complete for both packages.
it("separates current provider trade values from VORP and refuses stale or mismatched market references", async () => {
  const d = await roleFixture();
  const rows = [
    { PlayerID: "1", TradeValue: 50 },
    { PlayerID: "2", TradeValue: 60 },
  ].map((r) => ({
    ...r,
    Week: 6,
    Source: "Synthetic redraft",
    AsOfUTC: new Date().toISOString(),
    MarketFormat: "redraft-1qb-ppr",
  }));
  const input = parseEvidence(rows, d),
    m = evaluate(d, d.settings, { evidence: JSON.stringify(input) });
  const draft = { teamA: "1", teamB: "2", give: ["1"], get: ["2"] };
  const r = evaluateTrade(m, draft, false);
  if (!r.valid) throw Error(r.errors.join());
  expect(r.market.outgoing).toBe(50);
  expect(r.market.incoming).toBe(60);
  expect(m.byId.get("1")!.index).toBe(
    evaluate(d, d.settings).byId.get("1")!.index,
  );
  rows[1].AsOfUTC = new Date(Date.now() - 3 * 86400000).toISOString();
  const stale = evaluateTrade(
    evaluate(d, d.settings, {
      evidence: JSON.stringify(parseEvidence(rows, d)),
    }),
    draft,
    false,
  );
  if (!stale.valid) throw Error(stale.errors.join());
  expect(stale.market.incoming).toBeNull();
  expect(stale.market.status).toContain("stale");
  expect(() =>
    parseEvidence([{ ...rows[0], MarketFormat: "dynasty" }], d),
  ).toThrow("MarketFormat");
  expect(
    readEvidence(JSON.stringify({ ...input, datasetHash: "different" }), d)
      .issue,
  ).toContain("earlier snapshot");
});

// Sourced return scenarios change both per-player available games and weekly lineup availability.
it("keeps injury return assumptions conditional and uses the selected week consistently", async () => {
  const d = await roleFixture();
  d.tables.ModelPlayers[0].InjuryStatus = "OUT";
  const input = parseEvidence(
    [
      {
        PlayerID: "1",
        Week: 6,
        Source: "User-selected scenario",
        AsOfUTC: new Date().toISOString(),
        ReturnWeek: 9,
      },
    ],
    d,
  );
  const m = evaluate(d, d.settings, { evidence: JSON.stringify(input) }),
    p = m.byId.get("1")!;
  expect(p.available).toBe(9);
  expect(available(m, p, 8)).toBe(false);
  expect(available(m, p, 9)).toBe(true);
  expect(p.uncertain).toBe(true);
  expect(p.vorp).toBeCloseTo((p.value! - p.baseline!) * 9);
});

// Future weeks cannot enter role-model training; unsupported samples never manufacture a forecast.
it("requires training evidence and ignores future history during calibration", async () => {
  const d = await roleFixture();
  const before = calibrateRole(d).map(({ forecast, ...r }) => ({
    ...r,
    forecast: [...forecast],
  }));
  d.tables.ModelHistory.push({
    ...d.tables.ModelHistory[0],
    Week: 6,
    Points: 999,
    RushAttempts: 999,
    Targets: 999,
  });
  const after = calibrateRole(d).map(({ forecast, ...r }) => ({
    ...r,
    forecast: [...forecast],
  }));
  expect(after).toEqual(before);
  expect(after.find((r) => r.position === "WR")!.coefficients).toBeNull();
});

// Recover a known lagged opportunity relationship, then verify that forecast scenarios change value exactly once.
it("fits past-role forecasts on held-out weeks and applies an explicit scenario consistently", async () => {
  const d = await fixture(Array(8).fill(10));
  const template = d.tables.ModelPlayers.find((p) => p.Position === "WR")!;
  for (let i = 0; i < 40; i++) {
    const id = 5000 + i,
      targets = Array.from(
        { length: 8 },
        (_, w) => 2 + (i % 7) + ((w * w) % 5),
      );
    const scores = targets.map((_, w) =>
      w < 2 ? 5 : 1 + 2 * mean(targets.slice(Math.max(0, w - 3), w))!,
    );
    d.tables.ModelPlayers.push({
      ...template,
      PlayerID: id,
      OnTeamID: 0,
      Player: `Calibration ${id}`,
      GamesPlayed: 8,
      Season_Games: 8,
      Current_Actual_Games: 0,
      ActualPoints: scores.reduce((a, b) => a + b, 0),
      Actual_PPG: mean(scores),
      Last3_PPG: mean(scores.slice(-3)),
      ScoreSD: sd(scores),
    });
    d.tables.ModelHistory.push(
      ...scores.map((Points, w) => ({
        PlayerID: id,
        Season: 2026,
        Week: w + 1,
        Games: 1,
        HistoryStatus: "Valid",
        Points,
        RushAttempts: 0,
        Targets: targets[w],
        Receptions: Math.floor(targets[w] / 2),
        RushTD: 0,
        ReceivingTD: 0,
      })),
    );
  }
  const base = evaluate(d, d.settings),
    scenario = evaluate(d, d.settings, { roleWeight: "1" });
  const c = base.calibration.find((c) => c.position === "WR")!;
  expect(c.tested).toBeGreaterThanOrEqual(30);
  expect(c.mae!).toBeLessThan(1e-8);
  expect(c.baselineMAE!).toBeGreaterThan(c.mae!);
  const p = scenario.byId.get("5000")!;
  expect(p.expected).toBeCloseTo(p.roleForecast!);
  expect(p.blendedExpected).toBe(base.byId.get("5000")!.expected);
  expect(p.expected).not.toBe(p.blendedExpected);
  expect(p.value).toBeCloseTo(p.expected! - p.penalty!);
  expect(
    evaluate(d, d.settings, { roleWeight: "invalid" }).evidenceIssue,
  ).toContain("between 0 and 1");
});
