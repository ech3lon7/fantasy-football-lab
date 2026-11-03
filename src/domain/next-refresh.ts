import { mean, n, num, sd, str, sum } from "./contracts";
import { playedHistory } from "./opportunity";
import type { Model, Player } from "./valuation";
import historicalSpread from "./historical-scoring-spread.json";

// Use the anonymous historical reference only for the same scoring rules; ignore unrelated league totals and key ordering.
function positionalReference(m: Model, p: Player) {
  try {
    const items = JSON.parse(
      str(m.dataset.tables.ModelContext[0].ScoringItemsJSON),
    );
    if (!Array.isArray(items)) return null;
    const scoring = items
      .map((r) => ({
        statId: r.statId,
        points: r.points,
        isReverseItem: r.isReverseItem,
        pointsOverrides: Object.fromEntries(
          Object.entries(r.pointsOverrides).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        ),
      }))
      .sort((a, b) => a.statId - b.statId);
    return JSON.stringify(scoring) === JSON.stringify(historicalSpread.scoring)
      ? historicalSpread.positions[p.pos]
      : null;
  } catch {
    return null;
  }
}

// This read-only what-if appends one played game; it never estimates that game's likelihood or changes the model.
export function nextRefreshContext(m: Model, p: Player) {
  const rows = playedHistory(m.dataset).get(p.id) ?? [];
  const scores = rows.map((r) => n(r.Points)!);
  let issue = "";
  if (
    !p.historyComplete ||
    rows.length !== p.games ||
    new Set(rows.map((r) => num(r.Week))).size !== rows.length
  )
    issue =
      "Complete, unique played-game history is required for this scenario.";
  else if (
    scores.length &&
    (p.actual === null ||
      p.recent === null ||
      Math.abs(mean(scores)! - p.actual) > 0.02 ||
      Math.abs(mean(scores.slice(-3))! - p.recent) > 0.02)
  )
    issue =
      "Recorded game scores do not agree with the imported averages. Refresh the workbook first.";
  else if (num(p.raw.ProjectionRecords) > 1)
    issue = "Conflicting ESPN season projections must be resolved first.";
  else if (
    m.current > m.final ||
    rows.some((r) => num(r.Week) >= m.final) ||
    p.remaining === 0
  )
    issue =
      "No remaining scheduled fantasy game is available in this snapshot.";
  return { scores, issue };
}

// Center editable assumptions on current EPPG, using a usable weekly projection only when EPPG is unavailable.
export function nextRefreshDefaults(m: Model, p: Player) {
  const context = nextRefreshContext(m, p);
  const scheduled = m.dataset.tables.ModelSchedule.find(
    (r) => str(r.ProTeamID) === p.nflId && num(r.Week) === m.current,
  );
  const hasEppg =
    p.blendedExpected !== null && Number.isFinite(p.blendedExpected);
  const useWeekly =
    !context.issue &&
    !hasEppg &&
    p.weekly !== null &&
    Number.isFinite(p.weekly) &&
    !p.out &&
    p.bye !== m.current &&
    num(scheduled?.HasGame) > 0;
  const base = context.issue
    ? null
    : hasEppg
      ? p.blendedExpected
      : useWeekly
        ? p.weekly
        : null;
  // Blend within-player variances with four historical variance observations; sample SD remains a separate recorded fact.
  const personalSD = context.issue ? null : sd(context.scores);
  const reference = context.issue ? null : positionalReference(m, p);
  const personalDf = Math.max(0, context.scores.length - 1);
  const personalWeight = reference
    ? personalDf / (personalDf + historicalSpread.priorDegreesOfFreedom)
    : personalSD === null
      ? 0
      : 1;
  const spread = reference
    ? Math.sqrt(
        personalWeight * (personalSD ?? 0) ** 2 +
          (1 - personalWeight) * reference.sd ** 2,
      )
    : personalSD;
  return {
    base,
    lower: base !== null && spread !== null ? base - spread : null,
    higher: base !== null && spread !== null ? base + spread : null,
    spread,
    personalSD,
    reference,
    personalWeight,
    source:
      base === null
        ? "Unavailable"
        : useWeekly
          ? `ESPN Week ${m.current} projection (EPPG unavailable)`
          : "current EPPG",
    useWeekly,
  };
}

// Reproduce the existing adaptive blend and its missing-projection fallback with the current settings and a fixed season projection.
export function nextRefreshEppg(
  m: Model,
  p: Player,
  points: number,
  context = nextRefreshContext(m, p),
) {
  if (context.issue || !Number.isFinite(points)) return null;
  const scores = [...context.scores, points],
    games = scores.length;
  const actual = sum(scores) / games,
    recent = mean(scores.slice(-3))!;
  const observed =
    (1 - m.settings.RecentWeight) * actual + m.settings.RecentWeight * recent;
  const weight = games / (games + m.settings.PriorGames);
  const expected =
    p.projected !== null
      ? weight * observed + (1 - weight) * p.projected
      : games >= 4
        ? observed
        : null;
  return {
    games,
    actual,
    recent,
    weight,
    expected,
    change:
      expected !== null && p.blendedExpected !== null
        ? expected - p.blendedExpected
        : null,
  };
}
