import { expect, it } from "vitest";
import { mean, sd, sum } from "../src/domain/contracts";
import { evaluate } from "../src/domain/valuation";
import {
  nextRefreshContext,
  nextRefreshDefaults,
  nextRefreshEppg,
} from "../src/domain/next-refresh";
import { fixture } from "./fixtures";
import historicalSpread from "../src/domain/historical-scoring-spread.json";

// EPPG takes precedence over any weekly projection, including zero; the spread remains the historical sample SD.
it("autofills EPPG plus/minus sample SD and falls back only to a usable weekly projection", async () => {
  const d = await fixture([12, 18, 24]);
  const m = evaluate(d, d.settings),
    p = { ...m.byId.get("1")!, blendedExpected: 20, weekly: 18 };
  const before = JSON.stringify(m);
  expect(nextRefreshDefaults(m, p)).toMatchObject({
    base: 20,
    lower: 14,
    higher: 26,
    spread: 6,
    useWeekly: false,
  });
  expect(nextRefreshDefaults(m, { ...p, weekly: 0 })).toMatchObject({
    base: 20,
    lower: 14,
    higher: 26,
    useWeekly: false,
  });
  for (const changed of [
    { ...p, weekly: null },
    { ...p, bye: m.current },
    { ...p, out: true },
  ]) {
    const result = nextRefreshDefaults(m, changed);
    expect(result.base).toBe(p.blendedExpected);
    expect(result.lower).toBe(p.blendedExpected! - 6);
    expect(result.higher).toBe(p.blendedExpected! + 6);
    expect(result.useWeekly).toBe(false);
  }
  const noGame = structuredClone(m);
  noGame.dataset.tables.ModelSchedule.find(
    (r) => r.Week === m.current,
  )!.HasGame = 0;
  expect(nextRefreshDefaults(noGame, p).useWeekly).toBe(false);
  // Unavailable EPPG permits the fallback, but a bye, absence or missing game/projection never supplies a fake zero.
  const unavailable = { ...p, blendedExpected: null };
  expect(nextRefreshDefaults(m, unavailable)).toMatchObject({
    base: 18,
    lower: 12,
    higher: 24,
    useWeekly: true,
  });
  expect(nextRefreshDefaults(m, { ...unavailable, weekly: 0 })).toMatchObject({
    base: 0,
    lower: -6,
    higher: 6,
    useWeekly: true,
  });
  expect(nextRefreshDefaults(m, { ...p, blendedExpected: 0 })).toMatchObject({
    base: 0,
    lower: -6,
    higher: 6,
    useWeekly: false,
  });
  for (const changed of [
    { ...unavailable, weekly: null },
    { ...unavailable, bye: m.current },
    { ...unavailable, out: true },
  ])
    expect(nextRefreshDefaults(m, changed).base).toBeNull();
  expect(nextRefreshDefaults(noGame, unavailable).base).toBeNull();
  expect(
    nextRefreshDefaults(m, { ...p, historyComplete: false }),
  ).toMatchObject({ base: null, lower: null, higher: null, spread: null });
  expect(JSON.stringify(m)).toBe(before);
});

// Missing and constant variability differ: fewer than two games leaves bounds blank, while SD zero produces three equal editable scores.
it("keeps low/high unavailable for short histories and uses zero SD without fabricating a spread", async () => {
  for (const scores of [[], [18]]) {
    const d = await fixture(scores),
      m = evaluate(d, d.settings);
    expect(
      nextRefreshDefaults(m, {
        ...m.byId.get("1")!,
        blendedExpected: 18,
        weekly: 22,
      }),
    ).toMatchObject({ base: 18, lower: null, higher: null, spread: null });
  }
  const d = await fixture([18, 18, 18]),
    m = evaluate(d, d.settings);
  expect(
    nextRefreshDefaults(m, {
      ...m.byId.get("1")!,
      blendedExpected: 18,
      weekly: 22,
    }),
  ).toMatchObject({ base: 18, lower: 18, higher: 18, spread: 0 });
});

// Independent variance arithmetic verifies small-sample widening, unchanged factual SD and absence of model mutations.
it("blends positional historical variance while preserving the player's own SD and EPPG", async () => {
  const d = await fixture([20, 24]);
  d.tables.ModelContext[0].ScoringItemsJSON = JSON.stringify(
    historicalSpread.scoring,
  );
  const m = evaluate(d, d.settings);
  const p = { ...m.byId.get("1")!, pos: "RB" as const, blendedExpected: 20 };
  const before = JSON.stringify(m);
  const result = nextRefreshDefaults(m, p);
  const expectedSpread = Math.sqrt(
    (8 + 4 * historicalSpread.positions.RB.sd ** 2) / 5,
  );
  expect(result.personalSD).toBeCloseTo(Math.sqrt(8), 10);
  expect(result.personalWeight).toBe(0.2);
  expect(result.spread).toBeCloseTo(expectedSpread, 10);
  expect(result.spread).toBeGreaterThan(result.personalSD!);
  expect(result.base).toBe(20);
  expect(result.lower).toBeCloseTo(20 - expectedSpread, 10);
  expect(result.higher).toBeCloseTo(20 + expectedSpread, 10);
  expect(result.reference).toEqual(historicalSpread.positions.RB);
  expect(JSON.stringify(m)).toBe(before);
});

// Empty, single-game and constant histories may use the historical reference without fabricating personal SD; its influence fades with appearances.
it("uses historical variance for short histories and gives personal variance increasing weight", async () => {
  for (const count of [0, 1, 2, 4, 8, 12]) {
    const d = await fixture(Array(count).fill(18));
    d.tables.ModelContext[0].ScoringItemsJSON = JSON.stringify(
      historicalSpread.scoring,
    );
    const m = evaluate(d, d.settings);
    const p = { ...m.byId.get("1")!, blendedExpected: 0 };
    const result = nextRefreshDefaults(m, p);
    const df = Math.max(0, count - 1);
    expect(result.personalSD).toBe(count < 2 ? null : 0);
    expect(result.personalWeight).toBe(df / (df + 4));
    expect(result.spread).toBeCloseTo(
      historicalSpread.positions.RB.sd * Math.sqrt(4 / (df + 4)),
      10,
    );
    expect(result.lower).toBeLessThan(0);
    expect(result.higher).toBeGreaterThan(0);
    expect(
      nextRefreshDefaults(m, { ...p, historyComplete: false }),
    ).toMatchObject({
      personalSD: null,
      reference: null,
      spread: null,
      lower: null,
      higher: null,
    });
  }
});

// Select references by position, not player quality; blending can narrow a volatile player's spread as well as widen a small-sample one.
it("uses separate historical references for every position and retains valid negative scores", async () => {
  const d = await fixture([0, -10, 30]);
  d.tables.ModelContext[0].ScoringItemsJSON = JSON.stringify(
    historicalSpread.scoring,
  );
  const m = evaluate(d, d.settings);
  for (const pos of Object.keys(historicalSpread.positions) as Array<
    keyof typeof historicalSpread.positions
  >) {
    const result = nextRefreshDefaults(m, { ...m.byId.get("1")!, pos });
    expect(result.reference).toEqual(historicalSpread.positions[pos]);
    expect(result.personalSD).toBeCloseTo(sd([0, -10, 30])!, 10);
    expect(result.spread).toBeLessThan(result.personalSD!);
    expect(result.spread).toBeGreaterThan(historicalSpread.positions[pos].sd);
  }
});

// Different rules, positional overrides, duplicates or malformed configs fall back to personal SD, never an incompatible pooled reference.
it("checks complete scoring compatibility without depending on JSON ordering or unrelated metadata", async () => {
  const d = await fixture([12, 18, 24]);
  const scoring = structuredClone(historicalSpread.scoring);
  d.tables.ModelContext[0].ScoringItemsJSON = JSON.stringify(
    [...scoring].reverse().map((r) => ({ ...r, leagueTotal: 999 })),
  );
  const m = evaluate(d, d.settings),
    p = m.byId.get("1")!;
  expect(nextRefreshDefaults(m, p).reference).not.toBeNull();
  const changedPoints = structuredClone(scoring);
  changedPoints.find((r) => r.statId === 53)!.points = 0.5;
  const changedOverride = structuredClone(scoring);
  changedOverride.find((r) => r.statId === 89)!.pointsOverrides = { "16": 6 };
  for (const config of [
    JSON.stringify(changedPoints),
    JSON.stringify(changedOverride),
    JSON.stringify([...scoring, scoring[0]]),
    "{",
    "null",
    "[]",
  ]) {
    d.tables.ModelContext[0].ScoringItemsJSON = config;
    expect(nextRefreshDefaults(m, p)).toMatchObject({
      reference: null,
      personalSD: 6,
      personalWeight: 1,
      spread: 6,
    });
  }
});

// Compare each scenario with a separately refreshed production model, including short histories, actual-only and zero/negative scores.
it.each([
  { scores: [], points: 0, projection: 15 },
  { scores: [10], points: -5, projection: 15 },
  { scores: [10, 20], points: 0, projection: 0 },
  { scores: [10, 20], points: 30, projection: null },
  { scores: [10, 20, 30], points: 40, projection: null },
  { scores: [0, -2, 12, 10, 30], points: 37.5, projection: 15 },
])(
  "matches the next imported calculation for $scores / $points / projection $projection",
  async ({ scores, points, projection }) => {
    const d = await fixture(scores);
    const raw = d.tables.ModelPlayers.find((p) => p.PlayerID === 1)!;
    if (projection === null) raw.ProjectionRecords = 0;
    else raw.ESPN_Projected_PPG = projection;
    const m = evaluate(d, { ...d.settings, RecentWeight: 0.4, PriorGames: 6 });
    const p = m.byId.get("1")!;
    const before = JSON.stringify(m);
    const result = nextRefreshEppg(m, p, points)!;
    const next = structuredClone(d),
      nextRaw = next.tables.ModelPlayers.find((r) => r.PlayerID === 1)!;
    const updated = [...scores, points];
    Object.assign(nextRaw, {
      GamesPlayed: updated.length,
      Season_Games: updated.length,
      ActualPoints: sum(updated),
      Actual_PPG: mean(updated),
      Last3_PPG: mean(updated.slice(-3)),
      ScoreSD: sd(updated),
    });
    next.tables.ModelHistory.push({
      PlayerID: 1,
      Season: 2026,
      Week: m.current,
      Points: points,
      Games: 1,
      HistoryStatus: "Valid",
    });
    next.tables.ModelContext[0].CurrentWeek = m.current + 1;
    const refreshed = evaluate(next, m.settings).byId.get("1")!;
    expect(result.games).toBe(refreshed.games);
    expect(result.actual).toBeCloseTo(refreshed.actual!);
    expect(result.recent).toBeCloseTo(refreshed.recent!);
    expect(result.weight).toBeCloseTo(refreshed.weight);
    if (refreshed.expected === null) expect(result.expected).toBeNull();
    else expect(result.expected).toBeCloseTo(refreshed.expected, 10);
    expect(JSON.stringify(m)).toBe(before);
  },
);

// Reject incomplete or conflicting evidence rather than silently synthesizing a healthy-looking refresh.
it("blocks missing history, duplicate periods, inconsistent aggregates, conflicting projections and finished seasons", async () => {
  const d = await fixture();
  const m = evaluate(d, d.settings),
    p = m.byId.get("1")!;
  expect(nextRefreshEppg(m, p, Infinity)).toBeNull();
  expect(nextRefreshEppg(m, p, NaN)).toBeNull();
  expect(nextRefreshContext(m, { ...p, games: 6 }).issue).toContain("history");
  expect(nextRefreshContext(m, { ...p, recent: 99 }).issue).toContain(
    "averages",
  );
  expect(
    nextRefreshContext(m, { ...p, raw: { ...p.raw, ProjectionRecords: 2 } })
      .issue,
  ).toContain("Conflicting");
  expect(nextRefreshContext(m, { ...p, remaining: 0 }).issue).toContain(
    "No remaining",
  );
  expect(nextRefreshContext({ ...m, current: 18 }, p).issue).toContain(
    "No remaining",
  );
  m.dataset.tables.ModelHistory.find((r) => r.PlayerID === 1)!.Week = 2;
  expect(nextRefreshEppg(m, p, 10)).toBeNull();
});

// A bye/nonparticipation row never enters the played-game denominator, and optional role blending cannot affect this calculator.
it("ignores nonparticipation and optional role influence while allowing a first actual-only fourth game", async () => {
  const d = await fixture([0, -2, 12, 10, 30]);
  d.tables.ModelHistory.push({
    PlayerID: 1,
    Season: 2026,
    Week: 0,
    Points: 99,
    Games: 0,
    HistoryStatus: "Valid",
  });
  const m = evaluate(d, d.settings),
    p = m.byId.get("1")!;
  const result = nextRefreshEppg(m, p, 0)!;
  expect(result.actual).toBeCloseTo(50 / 6);
  expect(result.recent).toBeCloseTo(40 / 3);
  expect(
    nextRefreshEppg(
      { ...m, roleScenarioWeight: 1 },
      { ...p, expected: 99, roleForecast: 99 },
      0,
    ),
  ).toEqual(result);
  expect(result.change).toBeCloseTo(result.expected! - p.blendedExpected!);
});
