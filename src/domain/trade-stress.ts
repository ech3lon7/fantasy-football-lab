import { z } from "zod";
import type { Draft } from "./contracts";
import type { Model } from "./valuation";
import { evaluateTrade } from "./trades";
import { tradeImpact } from "./trade-impact";

// A saved recipe contains explicit scoring assumptions only, never replacement forecasts or source data.
export const stressRecipeSchema = z
  .object({
    version: z.literal(1),
    adjustments: z
      .array(
        z
          .object({ player: z.string().min(1), ppg: z.number().finite() })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict()
  .refine(
    (r) =>
      new Set(r.adjustments.map((a) => a.player)).size === r.adjustments.length,
    "Adjust each player only once.",
  );
export type StressRecipe = z.infer<typeof stressRecipeSchema>;
export interface StressRow {
  own: { before: number | null; after: number | null; gain: number | null };
  other: { before: number | null; after: number | null; gain: number | null };
  dropsA: string[];
  dropsB: string[];
  legal: boolean;
  warnings: string[];
}
export interface StressResult {
  errors: string[];
  baseline?: StressRow;
  scenario?: StressRow;
  breakEven?: {
    player: string;
    ppg: number | null;
    direction: "at least" | "at most";
    note: string;
  };
  conclusion: string;
}

// Clone scoring fields only; recorded stats, real replacement pools, asking prices and the original model remain untouched.
function scoringModel(m: Model, recipe: StressRecipe): Model {
  const assumptions = new Map(recipe.adjustments.map((a) => [a.player, a.ppg]));
  const players = m.players.map((p) => {
    const expected = assumptions.get(p.id);
    if (expected === undefined) return p;
    const penalty =
      p.games >= m.settings.MinConsistencyGames && expected > 0
        ? Math.min(
            m.settings.ConsistencyCap * expected,
            m.settings.ConsistencyCoefficient * (p.scoringSD ?? 0) * p.weight,
          )
        : 0;
    return { ...p, expected, penalty, value: expected - penalty };
  });
  return { ...m, players, byId: new Map(players.map((p) => [p.id, p])) };
}

// Reuse the legal-roster and Expected-PPG optimizer before and after; waiver proposals and price tests are excluded.
function score(m: Model, draft: Draft, plans?: string): StressRow {
  const result = evaluateTrade(m, draft, false, plans);
  if (!result.valid) throw Error(result.errors.join(" "));
  const impact = tradeImpact(result, "best-available")!;
  const errors = [...impact.own.errors, ...impact.other.errors];
  if (errors.length) throw Error(errors.join(" "));
  const side = (part: typeof impact.own) => ({
    before: part.beforePerWeek,
    after: part.afterPerWeek,
    gain: part.expectedPerWeek,
  });
  const row = {
    own: side(impact.own),
    other: side(impact.other),
    dropsA: result.dropsA,
    dropsB: result.dropsB,
    legal: result.legality,
    warnings: [
      ...new Set([...result.uncertainty, ...(m.simulation?.issues ?? [])]),
    ],
  };
  if (
    Object.values(row.own)
      .concat(Object.values(row.other))
      .some((v) => v === null || !Number.isFinite(v))
  )
    throw Error(
      "Usable scoring and remaining fantasy weeks are required for both teams.",
    );
  return row;
}

// A single-player threshold is numerical sensitivity, not a calibrated prediction or an acceptance probability.
function breakEven(
  m: Model,
  draft: Draft,
  recipe: StressRecipe,
  plans?: string,
): StressResult["breakEven"] {
  if (recipe.adjustments.length !== 1) return undefined;
  const assumption = recipe.adjustments[0],
    incoming = draft.get.includes(assumption.player);
  const direction = incoming ? "at least" : "at most";
  const gain = (ppg: number) =>
    score(
      scoringModel(m, {
        version: 1,
        adjustments: [{ player: assumption.player, ppg }],
      }),
      draft,
      plans,
    ).own.gain!;
  const anchor = Math.max(
    1,
    Math.abs(m.byId.get(assumption.player)!.expected ?? 0),
    Math.abs(assumption.ppg),
  );
  let low = -anchor,
    high = 2 * anchor;
  const oriented = (ppg: number) => gain(ppg) * (incoming ? 1 : -1);
  // Expand only a bounded number of numerical brackets; a zero plateau is never reported as a unique threshold.
  for (let i = 0; i < 4 && !(oriented(low) < 0 && oriented(high) > 0); i++) {
    low *= 2;
    high *= 2;
  }
  if (!(oriented(low) < 0 && oriented(high) > 0))
    return {
      player: assumption.player,
      ppg: null,
      direction,
      note: "No unique break-even found in the tested scoring range; this player may not change your lineup.",
    };
  for (let i = 0; i < 38; i++) {
    const middle = (low + high) / 2;
    if (oriented(middle) >= 0) high = middle;
    else low = middle;
  }
  const ppg = (low + high) / 2;
  // Roster/drop discontinuities can skip zero; do not present a threshold as an exact break-even in that case.
  return {
    player: assumption.player,
    ppg: Math.abs(gain(ppg)) < 0.001 ? ppg : null,
    direction,
    note: "Other player forecasts and availability rules are held fixed; lineups and required drops are recalculated.",
  };
}

// Validate an isolated what-if request and return only scoring sensitivity, never substitute it into normal valuation/search.
export function evaluateStressTest(
  m: Model,
  draft: Draft,
  input: unknown,
  plans?: string,
): StressResult {
  try {
    const parsed = stressRecipeSchema.safeParse(input);
    if (!parsed.success)
      throw Error(
        "Select at least one player and enter a finite assumed PPG for each selected player.",
      );
    const recipe = parsed.data,
      selected = new Set([...draft.give, ...draft.get]);
    if (
      recipe.adjustments.some(
        (a) => !selected.has(a.player) || !m.byId.has(a.player),
      )
    )
      throw Error(
        "Stress-test assumptions must belong to players in this trade.",
      );
    const baseline = score(m, draft, plans),
      scenario = score(scoringModel(m, recipe), draft, plans);
    const gain = scenario.own.gain!;
    const conclusion =
      !scenario.legal || !baseline.legal
        ? "Unresolved roster limits: these scoring results are conditional."
        : Math.abs(gain) < 0.005
          ? "Your team breaks even under these assumptions."
          : gain > 0
            ? "Your team gains scoring under these assumptions."
            : baseline.own.gain! > 0
              ? "The current-model gain becomes a loss under these assumptions."
              : "Your team loses scoring under these assumptions.";
    return {
      errors: [],
      baseline,
      scenario,
      breakEven:
        baseline.legal && scenario.legal
          ? breakEven(m, draft, recipe, plans)
          : undefined,
      conclusion,
    };
  } catch (error) {
    return {
      errors: [
        error instanceof Error
          ? error.message
          : "Stress-test calculation failed.",
      ],
      conclusion: "Stress test unavailable.",
    };
  }
}
