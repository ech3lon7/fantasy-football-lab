import { z } from "zod";
import { cmpId, mean, num, str, type Row } from "./contracts";
import {
  defaultGemRules,
  gemVersion,
  labelRuleVersion,
  labelPolicy,
} from "./label-rules";
import { playedHistory } from "./opportunity";
import type { Model } from "./valuation";

// Freeze the research alternatives before observing any future outcomes; none changes live labels or values.
const trials = [
  { id: "current", name: "Current Gem", bit: 1 },
  { id: "confidence", name: "Confidence trial", bit: 2 },
  { id: "rare", name: "Rarity trial", bit: 4 },
  { id: "coverage", name: "Coverage trial", bit: 8 },
  { id: "noFloor", name: "Without game-workload floor", bit: 16 },
] as const;
type Position = "RB" | "WR" | "TE";
// Each tuple is workload mean/floor/support followed by scoring mean/floor/support, in both overlapping windows.
const frozenTrials = {
  confidence: {
    RB: [18, 16, 3, 16, 16, 2],
    WR: [6, 5, 2, 14, 14, 3],
    TE: [4, 4, 2, 12, 12, 2],
  },
  rare: {
    RB: [22, 12, 3, 14, 14, 2],
    WR: [7, 5, 2, 18, 14, 3],
    TE: [7, 7, 2, 11, 12, 2],
  },
  coverage: {
    RB: [16, 14, 3, 16, 16, 2],
    WR: [6, 5, 2, 16, 16, 2],
    TE: [4, 4, 2, 12, 10, 2],
  },
} as const;

// Validate the private journal independently of the synced workspace; unsupported/corrupt records are never overwritten.
const finite = z.number().finite();
const caseSchema = z
  .object({
    id: z.string(),
    pos: z.enum(["RB", "WR", "TE"]),
    mask: z.number().int().min(0).max(31),
  })
  .strict();
const outcomeSchema = z
  .object({
    sourceUTC: z.string(),
    sourceHash: z.string(),
    recordedAt: z.string(),
    results: z
      .array(
        z
          .object({
            id: z.string(),
            games: z.number().int().nonnegative(),
            ppg: finite.nullable(),
            success: z.boolean(),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();
const checkpointSchema = z
  .object({
    week: z.number().int().min(1).max(17),
    sourceUTC: z.string(),
    sourceHash: z.string(),
    capturedAt: z.string(),
    cases: z.array(caseSchema).max(10000),
    // Preserve minimal ranking-pool coverage so a later partial import cannot turn missing players/history into failures.
    pool: z
      .array(
        z
          .object({ id: z.string(), games: z.number().int().nonnegative() })
          .strict(),
      )
      .max(10000),
    outcomes: z
      .object({
        three: outcomeSchema.optional(),
        five: outcomeSchema.optional(),
      })
      .strict(),
  })
  .strict();
const cohortSchema = z
  .object({
    key: z.string(),
    league: z.string(),
    season: z.number().int(),
    final: z.number().int(),
    rules: z.string(),
    slots: z
      .object({ QB: finite, RB: finite, WR: finite, TE: finite, FLEX: finite })
      .strict(),
    checkpoints: z.array(checkpointSchema).max(17),
  })
  .strict();
export const gemJournalSchema = z
  .object({ version: z.literal(1), cohorts: z.array(cohortSchema).max(100) })
  .strict();
export type GemJournal = z.infer<typeof gemJournalSchema>;
type Cohort = GemJournal["cohorts"][number];
type Checkpoint = Cohort["checkpoints"][number];
export interface GemTrackingState {
  journal: GemJournal;
  status: string;
}
export const emptyGemJournal = (): GemJournal => ({ version: 1, cohorts: [] });

// Canonical format/league identity prevents differing scoring, rosters, rule versions or seasons being pooled together.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function identity(m: Model) {
  const c = m.dataset.tables.ModelContext[0];
  let scoring: unknown = c.ScoringItemsJSON ?? null;
  try {
    if (typeof scoring === "string") scoring = JSON.parse(scoring);
  } catch {
    /* Preserve unparsed source scoring in its own cohort. */
  }
  if (Array.isArray(scoring))
    scoring = [...scoring].sort((a, b) =>
      canonical(a).localeCompare(canonical(b)),
    );
  const format = Object.fromEntries(
    [
      "TeamCount",
      "QBSlots",
      "RBSlots",
      "WRSlots",
      "TESlots",
      "FlexSlots",
      "FinalWeek",
      "ReceptionPoints",
      "PassingTDPoints",
      "ScoringType",
    ].map((k) => [k, c[k] ?? null]),
  );
  const league = canonical({
    id: c.LeagueID ?? null,
    teams: m.dataset.tables.ModelTeams.map((t) => [
      str(t.TeamID),
      str(t.TeamName),
    ]).sort((a, b) => cmpId(a[0], b[0])),
    format,
    scoring,
  });
  const rules = canonical({
    tracker: "prospective-gem-1",
    labelRuleVersion,
    gemVersion,
    current: defaultGemRules,
    policy: labelPolicy,
    methods: trials,
    trials: frozenTrials,
    horizons: [3, 5],
    minimumGames: [2, 3],
  });
  const season = num(c.Season);
  return {
    key: canonical([league, season, rules]),
    league,
    season,
    rules,
    final: m.final,
    slots: {
      QB: num(c.QBSlots) * num(c.TeamCount),
      RB: num(c.RBSlots) * num(c.TeamCount),
      WR: num(c.WRSlots) * num(c.TeamCount),
      TE: num(c.TESlots) * num(c.TeamCount),
      FLEX: num(c.FlexSlots) * num(c.TeamCount),
    },
  };
}

// Shadow gates use only verified as-of played games; zero and negative scores remain actual observations.
function shadow(
  rows: Row[],
  pos: Position,
  rule: readonly number[],
  omitFloor = false,
) {
  return [rows.slice(-3), rows.slice(-4, -1)].every((window) => {
    const work = window.map(
      (r) => num(r.Targets) + (pos === "RB" ? num(r.RushAttempts) : 0),
    );
    const points = window.map((r) => num(r.Points));
    return (
      window.length === 3 &&
      mean(work)! >= rule[0] &&
      (omitFloor || work.filter((v) => v >= rule[1]).length >= rule[2]) &&
      mean(points)! >= rule[3] &&
      points.filter((v) => v >= rule[4]).length >= rule[5]
    );
  });
}
// Retain eligible non-labels as well as labels so future coverage is measurable within the same as-of population.
function captureCases(m: Model, histories: Map<string, Row[]>) {
  return m.players
    .flatMap((p) => {
      if (!["RB", "WR", "TE"].includes(p.pos)) return [];
      const rows = histories.get(p.id) ?? [],
        pos = p.pos as Position;
      const keys = pos === "RB" ? ["Targets", "RushAttempts"] : ["Targets"];
      const usable =
        p.historyComplete &&
        rows.length === p.games &&
        rows.length >= 4 &&
        new Set(rows.map((r) => num(r.Week))).size === rows.length &&
        rows
          .slice(-4)
          .every((r) =>
            keys.every(
              (k) =>
                Object.hasOwn(r, k) &&
                (r[k] === null ||
                  (typeof r[k] === "number" &&
                    Number.isFinite(r[k]) &&
                    num(r[k]) >= 0)),
            ),
          );
      if (!usable || p.uncertain || p.available <= 0 || p.injury !== "ACTIVE")
        return [];
      const base = defaultGemRules.positions[pos];
      let mask = p.gem === "Gem" ? 1 : 0;
      for (const name of ["confidence", "rare", "coverage"] as const)
        if (shadow(rows, pos, frozenTrials[name][pos]))
          mask |= trials.find((t) => t.id === name)!.bit;
      if (
        shadow(
          rows,
          pos,
          [base.mean, base.floor, 2, base.points, base.points, 2],
          true,
        )
      )
        mask |= 16;
      return [{ id: p.id, pos, mask }];
    })
    .sort((a, b) => cmpId(a.id, b.id));
}

// Score a full calendar-week horizon against positional starter slots plus FLEX, using actual results and deterministic ties.
function scoreOutcome(
  m: Model,
  cohort: Cohort,
  checkpoint: Checkpoint,
  horizon: number,
  histories: Map<string, Row[]>,
  now: number,
) {
  if (
    m.current <= checkpoint.week + horizon ||
    checkpoint.week + horizon > cohort.final
  )
    return null;
  const source = Date.parse(m.dataset.sourceUTC ?? "");
  if (
    !Number.isFinite(source) ||
    source <= Date.parse(checkpoint.capturedAt) ||
    source > now + 300000
  )
    return null;
  const minimum = horizon === 3 ? 2 : 3;
  const pool = m.players.filter((p) =>
    ["QB", "RB", "WR", "TE"].includes(p.pos),
  );
  // Incomplete coverage cannot establish future positional ranks; absent players are not invented as zero-point failures.
  if (
    !pool.length ||
    checkpoint.cases.some(
      (c) => !["QB", "RB", "WR", "TE"].includes(m.byId.get(c.id)?.pos ?? ""),
    ) ||
    checkpoint.pool.some(
      (p) =>
        !m.byId.has(p.id) ||
        (histories.get(p.id) ?? []).filter(
          (r) => num(r.Week) <= checkpoint.week,
        ).length < p.games,
    ) ||
    pool.some(
      (p) =>
        !p.historyComplete || (histories.get(p.id)?.length ?? 0) !== p.games,
    )
  )
    return null;
  const values = pool.map((p) => {
    const rows = (histories.get(p.id) ?? []).filter(
      (r) =>
        num(r.Week) > checkpoint.week &&
        num(r.Week) <= checkpoint.week + horizon,
    );
    return {
      id: p.id,
      pos: p.pos,
      games: rows.length,
      ppg: mean(rows.map((r) => num(r.Points))),
    };
  });
  const eligible = values
    .filter((p) => p.games >= minimum && p.ppg !== null)
    .sort((a, b) => b.ppg! - a.ppg! || cmpId(a.id, b.id));
  const starters = new Set<string>();
  for (const pos of ["QB", "RB", "WR", "TE"] as const)
    eligible
      .filter((p) => p.pos === pos)
      .slice(0, cohort.slots[pos])
      .forEach((p) => starters.add(p.id));
  eligible
    .filter((p) => p.pos !== "QB" && !starters.has(p.id))
    .slice(0, cohort.slots.FLEX)
    .forEach((p) => starters.add(p.id));
  const byId = new Map(values.map((p) => [p.id, p]));
  return {
    sourceUTC: m.dataset.sourceUTC!,
    sourceHash: m.dataset.hash,
    recordedAt: new Date(now).toISOString(),
    results: checkpoint.cases.map((c) => {
      const value = byId.get(c.id)!;
      return {
        id: c.id,
        games: value.games,
        ppg: value.ppg,
        success: starters.has(c.id),
      };
    }),
  };
}

// Append the first fresh observation per week, never backfill old labels, and freeze outcomes at the first verified mature import.
export function advanceGemJournal(
  journal: GemJournal,
  m: Model,
  now = Date.now(),
): GemTrackingState {
  const next = structuredClone(journal),
    descriptor = identity(m),
    histories = playedHistory(m.dataset);
  for (const cohort of next.cohorts.filter(
    (c) => c.league === descriptor.league && c.season === descriptor.season,
  ))
    for (const checkpoint of cohort.checkpoints)
      for (const [key, horizon] of [
        ["three", 3],
        ["five", 5],
      ] as const)
        if (!checkpoint.outcomes[key]) {
          const result = scoreOutcome(
            m,
            cohort,
            checkpoint,
            horizon,
            histories,
            now,
          );
          if (result) checkpoint.outcomes[key] = result;
        }
  const source = Date.parse(m.dataset.sourceUTC ?? ""),
    imported = Date.parse(m.dataset.importedAt),
    date = new Date(now),
    week = m.current - 1;
  const seasonNow = date.getUTCFullYear() - (date.getUTCMonth() < 2 ? 1 : 0);
  // A fresh re-import of an earlier scoring period must not rewrite what "first recorded" meant at the time.
  const latestWeek = Math.max(
    0,
    ...next.cohorts
      .filter(
        (c) => c.league === descriptor.league && c.season === descriptor.season,
      )
      .flatMap((c) => c.checkpoints.map((p) => p.week)),
  );
  let status =
    "Tracking is waiting for a fresh current-season source and at least three remaining fantasy weeks. Historical labels are never backfilled.";
  if (
    Number.isFinite(source) &&
    Number.isFinite(imported) &&
    imported <= now + 300000 &&
    imported >= source - 300000 &&
    now - source <= 86400000 &&
    source <= now + 300000 &&
    descriptor.season === seasonNow &&
    week >= latestWeek &&
    week >= 1 &&
    week <= Math.min(14, m.final - 3)
  ) {
    let cohort = next.cohorts.find((c) => c.key === descriptor.key);
    if (!cohort) {
      cohort = { ...descriptor, checkpoints: [] };
      next.cohorts.push(cohort);
    }
    if (!cohort.checkpoints.some((c) => c.week === week)) {
      cohort.checkpoints.push({
        week,
        sourceUTC: m.dataset.sourceUTC!,
        sourceHash: m.dataset.hash,
        capturedAt: date.toISOString(),
        cases: captureCases(m, histories),
        // Only IDs and observed game counts are retained, never copies of the historical weekly rows.
        pool: m.players
          .filter((p) => ["QB", "RB", "WR", "TE"].includes(p.pos))
          .map((p) => ({ id: p.id, games: histories.get(p.id)?.length ?? 0 }))
          .sort((a, b) => cmpId(a.id, b.id)),
        outcomes: {},
      });
      cohort.checkpoints.sort((a, b) => a.week - b.week);
    }
    status = `Week ${week} observation recorded. Same-week reloads and imports do not rewrite its labels. Future results wait for complete three-/five-week follow-up imports.`;
  }
  if (week < latestWeek)
    status =
      "Earlier scoring period ignored for new labels. Previously recorded observations are preserved; historical weeks are never backfilled.";
  return { journal: next, status };
}

// Report first-recorded alerts separately from repeated weekly labels; unscored horizons never enter accuracy denominators.
export function gemTrackingReport(journal: GemJournal) {
  return journal.cohorts.map((cohort, cohortIndex) => ({
    id: cohort.key,
    title: `${cohort.season} · cohort ${cohortIndex + 1}`,
    weeks: cohort.checkpoints.length,
    checkpoints: cohort.checkpoints.map((c) => ({
      week: c.week,
      capturedAt: c.capturedAt,
      sourceUTC: c.sourceUTC,
      sourceHash: c.sourceHash,
      eligible: c.cases.length,
      three: !!c.outcomes.three,
      five: c.week + 5 <= cohort.final ? !!c.outcomes.five : null,
    })),
    rows: (["RB", "WR", "TE"] as const).flatMap((pos) =>
      trials.flatMap((trial) =>
        (["three", "five"] as const).map((horizon) => {
          const first = new Set<string>();
          let labels = 0,
            scored = 0,
            hits = 0,
            firstLabels = 0,
            firstScored = 0,
            firstHits = 0,
            missed = 0,
            lostCurrent = 0,
            evaluated = 0,
            ready = 0;
          for (const checkpoint of cohort.checkpoints) {
            if (checkpoint.week + (horizon === "three" ? 3 : 5) > cohort.final)
              continue;
            const outcome = checkpoint.outcomes[horizon],
              outcomes = new Map(outcome?.results.map((r) => [r.id, r]));
            if (outcome) ready++;
            for (const c of checkpoint.cases.filter((c) => c.pos === pos)) {
              const labelled = !!(c.mask & trial.bit),
                wasFirst = labelled && !first.has(c.id),
                result = outcomes.get(c.id);
              if (labelled) {
                labels++;
                first.add(c.id);
                if (wasFirst) firstLabels++;
              }
              if (!result) continue;
              evaluated++;
              if (labelled) {
                scored++;
                if (result.success) hits++;
                if (wasFirst) {
                  firstScored++;
                  if (result.success) firstHits++;
                }
              } else if (result.success) {
                missed++;
                if (c.mask & 1) lostCurrent++;
              }
            }
          }
          const recordedWeeks = cohort.checkpoints.filter(
            (c) => c.week + (horizon === "three" ? 3 : 5) <= cohort.final,
          ).length;
          return {
            id: `${pos}:${trial.id}:${horizon}`,
            pos,
            method: trial.name,
            horizon: horizon === "three" ? "3 weeks" : "5 weeks",
            labels,
            scored,
            hits,
            firstLabels,
            firstScored,
            firstHits,
            missed,
            lostCurrent,
            evaluated,
            ready,
            recordedWeeks,
            perWeek: recordedWeeks ? labels / recordedWeeks : 0,
          };
        }),
      ),
    ),
  }));
}
