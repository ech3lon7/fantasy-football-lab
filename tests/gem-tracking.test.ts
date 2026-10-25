import { expect, it } from "vitest";
import { mean, sd, type Row } from "../src/domain/contracts";
import {
  advanceGemJournal,
  emptyGemJournal,
  gemJournalSchema,
  gemTrackingReport,
} from "../src/domain/gem-tracking";
import { evaluate } from "../src/domain/valuation";
import { fixture } from "./fixtures";

const start = Date.parse("2026-10-24T18:00:00Z"),
  day = 86400000;

// Create verified synthetic weekly snapshots with complete actual scores and counting stats, without importing private data.
async function snapshot(
  week = 5,
  now = start,
  change?: (
    id: number,
    week: number,
  ) =>
    | { points?: number; played?: boolean; targets?: number; carries?: number }
    | undefined,
) {
  const d = await fixture();
  Object.assign(d.tables.ModelContext[0], {
    CurrentWeek: week + 1,
    RefreshUTC: new Date(now - 60000).toISOString(),
  });
  d.sourceUTC = new Date(now - 60000).toISOString();
  d.importedAt = new Date(now).toISOString();
  d.hash = `synthetic-week-${week}-${now}`;
  d.tables.ModelHistory = [];
  for (const p of d.tables.ModelPlayers) {
    const rows: Row[] = [];
    for (let w = 1; w <= week; w++) {
      const c = change?.(Number(p.PlayerID), w),
        points = c?.points ?? (p.PlayerID === 1 || p.PlayerID === 2 ? 20 : 10);
      if (c?.played === false) continue;
      rows.push({
        PlayerID: p.PlayerID,
        Season: 2026,
        Week: w,
        Points: points,
        Games: 1,
        HistoryStatus: "Valid",
        Targets: c?.targets ?? (p.Position === "RB" ? 0 : 8),
        RushAttempts: c?.carries ?? 20,
      });
    }
    const scores = rows.map((r) => Number(r.Points));
    Object.assign(p, {
      GamesPlayed: rows.length,
      Season_Games: rows.length,
      ActualPoints: scores.reduce((a, b) => a + b, 0),
      Actual_PPG: mean(scores),
      Last3_PPG: mean(scores.slice(-3)),
      ScoreSD: sd(scores),
    });
    d.tables.ModelHistory.push(...rows);
  }
  return evaluate(d, d.settings);
}

// Capture is read-only and once per decision week, including the unlabelled eligible denominator and exact source provenance.
it("records frozen current and shadow labels without changing any player, value, pool or setting", async () => {
  const m = await snapshot(),
    before = JSON.stringify(m);
  const first = advanceGemJournal(emptyGemJournal(), m, start);
  expect(JSON.stringify(m)).toBe(before);
  const checkpoint = first.journal.cohorts[0].checkpoints[0];
  expect(checkpoint.week).toBe(5);
  expect(checkpoint.cases.find((c) => c.id === "1")!.mask & 1).toBe(1);
  expect(checkpoint.cases.some((c) => c.mask === 0)).toBe(true);
  expect(checkpoint.cases.every((c) => c.pos !== ("QB" as string))).toBe(true);
  expect(checkpoint.sourceHash).toBe(m.dataset.hash);
  const changed = structuredClone(m);
  changed.byId.get("1")!.gem = "Watch";
  changed.dataset.hash = "same-week-correction";
  const again = advanceGemJournal(first.journal, changed, start + 60000);
  expect(again.journal).toEqual(first.journal);
  expect(gemJournalSchema.parse(first.journal)).toEqual(first.journal);
});

// Historical/stale/future sources cannot masquerade as prospective observations and no old weeks are reconstructed.
it("rejects stale, historical-season, future and missing source dates", async () => {
  for (const mode of [
    "stale",
    "old-season",
    "future",
    "missing",
    "future-import",
  ] as const) {
    const m = await snapshot();
    if (mode === "stale")
      m.dataset.sourceUTC = new Date(start - 2 * day).toISOString();
    if (mode === "old-season") m.dataset.tables.ModelContext[0].Season = 2025;
    if (mode === "future")
      m.dataset.sourceUTC = new Date(start + day).toISOString();
    if (mode === "missing") m.dataset.sourceUTC = null;
    if (mode === "future-import")
      m.dataset.importedAt = new Date(start + day).toISOString();
    expect(
      advanceGemJournal(emptyGemJournal(), m, start).journal.cohorts,
    ).toEqual([]);
  }
  const result = advanceGemJournal(emptyGemJournal(), await snapshot(9), start);
  expect(result.journal.cohorts[0].checkpoints.map((c) => c.week)).toEqual([9]);
  const older = advanceGemJournal(
    result.journal,
    await snapshot(5, start + day),
    start + day,
  );
  expect(older.journal.cohorts[0].checkpoints.map((c) => c.week)).toEqual([9]);
  expect(older.status).toContain("Earlier scoring period ignored");
});

// Three/five-calendar-week results wait for complete imported follow-up, then preserve their original observation and outcome dates.
it("scores only mature horizons, with first-recorded and repeated-week denominators kept separate", async () => {
  let result = advanceGemJournal(emptyGemJournal(), await snapshot(), start);
  result = advanceGemJournal(
    result.journal,
    await snapshot(6, start + 7 * day),
    start + 7 * day,
  );
  expect(result.journal.cohorts[0].checkpoints[0].outcomes).toEqual({});
  result = advanceGemJournal(
    result.journal,
    await snapshot(8, start + 21 * day),
    start + 21 * day,
  );
  const checkpoint = result.journal.cohorts[0].checkpoints[0];
  expect(checkpoint.outcomes.three?.results.find((r) => r.id === "1")).toEqual({
    id: "1",
    games: 3,
    ppg: 20,
    success: true,
  });
  expect(checkpoint.outcomes.five).toBeUndefined();
  const row = gemTrackingReport(result.journal)[0].rows.find(
    (r) =>
      r.pos === "RB" && r.method === "Current Gem" && r.horizon === "3 weeks",
  )!;
  expect([
    row.firstLabels,
    row.firstScored,
    row.firstHits,
    row.labels,
    row.scored,
    row.hits,
  ]).toEqual([1, 1, 1, 3, 1, 1]);
  result = advanceGemJournal(
    result.journal,
    await snapshot(10, start + 35 * day),
    start + 35 * day,
  );
  expect(result.journal.cohorts[0].checkpoints[0].outcomes.three).toEqual(
    checkpoint.outcomes.three,
  );
  expect(
    result.journal.cohorts[0].checkpoints[0].outcomes.five?.results.find(
      (r) => r.id === "1",
    )!.games,
  ).toBe(5);
});

// Participation failures are genuine failures once coverage is verified; byes are excluded while zero/negative scores count.
it("preserves zero and negative played scores, and fails insufficient follow-up rather than dropping its denominator", async () => {
  const first = advanceGemJournal(emptyGemJournal(), await snapshot(), start);
  const future = await snapshot(8, start + 21 * day, (id, w) =>
    id === 1 && w > 5
      ? { points: w === 6 ? 0 : -2, played: w !== 8 }
      : undefined,
  );
  const scored = advanceGemJournal(first.journal, future, start + 21 * day)
    .journal.cohorts[0].checkpoints[0].outcomes.three!;
  expect(scored.results.find((r) => r.id === "1")).toEqual({
    id: "1",
    games: 2,
    ppg: -1,
    success: false,
  });
  const absent = await snapshot(8, start + 21 * day, (id, w) => ({
    played: !(id === 1 && w > 6),
  }));
  expect(
    advanceGemJournal(
      first.journal,
      absent,
      start + 21 * day,
    ).journal.cohorts[0].checkpoints[0].outcomes.three!.results.find(
      (r) => r.id === "1",
    )!.success,
  ).toBe(false);
});

// Future ranks require complete league coverage, and current injury/workload uncertainty cannot become fabricated evidence.
it("keeps missing history pending and excludes absent workload, uncertain availability and incomplete as-of histories", async () => {
  const first = advanceGemJournal(emptyGemJournal(), await snapshot(), start);
  for (const mode of [
    "incomplete",
    "missing-player",
    "missing-QB",
    "lost-prefix",
  ] as const) {
    const m = await snapshot(8, start + 21 * day);
    if (mode === "incomplete") m.byId.get("100")!.historyComplete = false;
    else if (mode === "lost-prefix") {
      m.dataset.tables.ModelHistory = m.dataset.tables.ModelHistory.filter(
        (r) => r.PlayerID !== 1 || Number(r.Week) > 5,
      );
      m.byId.get("1")!.games = 3;
    } else {
      const id = mode === "missing-QB" ? "100" : "1";
      m.byId.delete(id);
      m.players = m.players.filter((p) => p.id !== id);
    }
    expect(
      advanceGemJournal(first.journal, m, start + 21 * day).journal.cohorts[0]
        .checkpoints[0].outcomes.three,
    ).toBeUndefined();
  }
  for (const mode of ["workload", "uncertain", "history"] as const) {
    const m = await snapshot();
    if (mode === "workload")
      delete m.dataset.tables.ModelHistory.find(
        (r) => r.PlayerID === 1 && r.Week === 5,
      )!.Targets;
    if (mode === "uncertain") m.byId.get("1")!.uncertain = true;
    if (mode === "history") m.byId.get("1")!.historyComplete = false;
    expect(
      advanceGemJournal(
        emptyGemJournal(),
        m,
        start,
      ).journal.cohorts[0].checkpoints[0].cases.some((c) => c.id === "1"),
    ).toBe(false);
  }
});

// Frozen alternatives are evaluated, never promoted: an unusually spiky workload can distinguish the floor trial prospectively.
it("tracks the omitted-floor alternative independently and counts productive players missed by a label", async () => {
  const m = await snapshot(5, start, (id, w) => ({
    carries: id === 1 ? [20, 0, 60, 0, 0][w - 1] : 20,
  }));
  const first = advanceGemJournal(emptyGemJournal(), m, start);
  const c = first.journal.cohorts[0].checkpoints[0].cases.find(
    (c) => c.id === "1",
  )!;
  expect(c.mask & 1).toBe(0);
  expect(c.mask & 16).toBe(16);
  const future = await snapshot(8, start + 21 * day);
  const rows = gemTrackingReport(
    advanceGemJournal(first.journal, future, start + 21 * day).journal,
  )[0].rows;
  expect(
    rows.find(
      (r) =>
        r.pos === "RB" && r.horizon === "3 weeks" && r.method === "Current Gem",
    )!.missed,
  ).toBeGreaterThan(0);
  expect(
    rows.find(
      (r) =>
        r.pos === "RB" &&
        r.horizon === "3 weeks" &&
        r.method === "Without game-workload floor",
    )!.hits,
  ).toBe(1);
});

// Positional slots, FLEX and numeric ID ties determine outcomes consistently with the captured fantasy format.
it("ranks actual follow-up PPG using positional slots then FLEX, with deterministic tied IDs", async () => {
  const first = advanceGemJournal(emptyGemJournal(), await snapshot(), start);
  first.journal.cohorts[0].slots = { QB: 0, RB: 1, WR: 0, TE: 0, FLEX: 1 };
  const future = await snapshot(8, start + 21 * day, (id, w) => ({
    points:
      w > 5
        ? id === 1 || id === 103 || id === 104
          ? 30
          : id === 2
            ? 40
            : 10
        : id === 1 || id === 2
          ? 20
          : 10,
  }));
  const results = advanceGemJournal(first.journal, future, start + 21 * day)
    .journal.cohorts[0].checkpoints[0].outcomes.three!.results;
  expect(
    results
      .filter((r) => r.success)
      .map((r) => r.id)
      .sort(),
  ).toEqual(["1", "2"]);
});

// Cohort identity survives harmless row/key ordering changes but separates changed scoring, formats, teams and seasons.
it("isolates league formats and scoring, respects Week 17, and rejects unsupported journal versions", async () => {
  const original = await snapshot(),
    first = advanceGemJournal(emptyGemJournal(), original, start);
  const shuffled = structuredClone(original);
  shuffled.dataset.tables.ModelTeams.reverse();
  expect(
    advanceGemJournal(first.journal, shuffled, start).journal.cohorts,
  ).toHaveLength(1);
  const other = structuredClone(original);
  other.dataset.tables.ModelContext[0].ReceptionPoints = 0.5;
  expect(
    advanceGemJournal(first.journal, other, start).journal.cohorts,
  ).toHaveLength(2);
  const late = advanceGemJournal(emptyGemJournal(), await snapshot(14), start);
  const lateReport = gemTrackingReport(late.journal)[0];
  expect(lateReport.checkpoints[0].five).toBeNull();
  expect(
    lateReport.rows
      .filter((r) => r.horizon === "5 weeks")
      .every((r) => r.recordedWeeks === 0 && r.perWeek === 0),
  ).toBe(true);
  expect(
    advanceGemJournal(emptyGemJournal(), await snapshot(15), start).journal
      .cohorts,
  ).toEqual([]);
  expect(
    gemJournalSchema.safeParse({ ...first.journal, version: 2 }).success,
  ).toBe(false);
});

// Prospective computations must be invariant to future history rows and unrelated projections/settings changes.
it("ignores future rows and forecast changes when freezing actual as-of trials", async () => {
  const m = await snapshot(),
    expected = advanceGemJournal(emptyGemJournal(), m, start);
  m.dataset.tables.ModelHistory.push({
    PlayerID: 1,
    Season: 2026,
    Week: 10,
    Points: 100,
    Games: 1,
    HistoryStatus: "Valid",
    Targets: 100,
    RushAttempts: 100,
  });
  m.byId.get("1")!.projected = 100;
  expect(advanceGemJournal(emptyGemJournal(), m, start)).toEqual(expected);
});
