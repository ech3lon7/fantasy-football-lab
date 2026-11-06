import { positions, type Draft } from "./contracts";
import { teamsAssessment } from "./lineups";
import { positionGradeScale } from "./trade-search";
import type { TradeResult } from "./trades";
import type { Model } from "./valuation";

// Grade limits are optional preferences and never change the existing scoring, valuation, or grading formulas.
export interface ChainGradeLimit {
  side: "own" | "other" | "both";
  maximumDrop: number;
}

export type GradeImpactSide = "own" | "other";

export interface PositionalGradeImpactRule {
  id: string;
  side: GradeImpactSide;
  position: string;
  steps: number;
}

export interface ChainPositionChange {
  position: string;
  before: string;
  after: string;
  drop: number | null;
  stepDelta: number | null; // Signed: positive = upgrade, negative = downgrade
}

export interface ChainPositionImpact {
  own: ChainPositionChange[];
  other: ChainPositionChange[];
}

// Calculate the signed grade step delta between two grades on the standard position grade scale.
// Positive = upgrade, negative = downgrade, null = grade unavailable ("n.a.").
export function gradeStepDelta(before: string, after: string): number | null {
  const first = positionGradeScale.findIndex((g) => g === before);
  const last = positionGradeScale.findIndex((g) => g === after);
  return first < 0 || last < 0 ? null : last - first;
}

// Reassess both legal rosters at this exact step, including required drops and IR, with the existing league-relative Teams grades.
export function chainPositionImpact(
  m: Model,
  draft: Draft,
  result: TradeResult,
  targetPositions?: Iterable<string>,
): ChainPositionImpact {
  if (!result.valid || !result.legality) return { own: [], other: [] };
  const own = new Set(result.legalA),
    other = new Set(result.legalB),
    ir = new Set([...result.irA, ...result.irB]);
  const players = m.players.map((p) => {
    const owner = own.has(p.id)
      ? draft.teamA
      : other.has(p.id)
        ? draft.teamB
        : [draft.teamA, draft.teamB].includes(p.owner)
          ? "0"
          : p.owner;
    return {
      ...p,
      owner,
      slot: ir.has(p.id) ? 21 : owner !== p.owner ? 20 : p.slot,
    };
  });
  const before = teamsAssessment(m),
    after = teamsAssessment({
      ...m,
      players,
      byId: new Map(players.map((p) => [p.id, p])),
    });
  const affected = new Set([
    ...[...draft.give, ...draft.get, ...result.dropsA, ...result.dropsB].map(
      (id) => m.byId.get(id)!.pos,
    ),
    ...(targetPositions ?? []),
  ]);
  const changes = (team: string) =>
    [...positions, "FLEX"]
      .filter(
        (position) =>
          affected.has(position as (typeof positions)[number]) ||
          (position === "FLEX" &&
            ["RB", "WR", "TE"].some((p) =>
              affected.has(p as (typeof positions)[number]),
            )),
      )
      .filter((position) => {
        // A roster format without this starter position has no applicable grade to protect.
        const field =
          position === "FLEX"
            ? "FlexSlots"
            : position === "D/ST"
              ? "DSTSlots"
              : `${position}Slots`;
        return Number(m.dataset.tables.ModelContext[0][field]) > 0;
      })
      .map((position) => {
        const a =
            before.get(team)?.find((g) => g.position === position)?.grade ??
            "n.a.",
          b =
            after.get(team)?.find((g) => g.position === position)?.grade ??
            "n.a.";
        const first = positionGradeScale.findIndex((g) => g === a),
          last = positionGradeScale.findIndex((g) => g === b);
        return {
          position,
          before: a,
          after: b,
          drop: first < 0 || last < 0 ? null : Math.max(0, first - last),
          stepDelta: first < 0 || last < 0 ? null : last - first,
        };
      });
  return { own: changes(draft.teamA), other: changes(draft.teamB) };
}

// A total EPPG gain cannot rescue a failed explicit grade limit; unavailable grades do not silently count as unchanged.
export function chainGradeFailures(
  impact: ChainPositionImpact,
  limit?: ChainGradeLimit,
): string[] {
  if (!limit) return [];
  return (["own", "other"] as const).flatMap((side) =>
    limit.side !== "both" && limit.side !== side
      ? []
      : impact[side]
          .filter((row) => row.drop === null || row.drop > limit.maximumDrop)
          .map(
            (row) =>
              `${side === "own" ? "Your" : "Their"} ${row.position}: ${row.before} → ${row.after}; ${row.drop === null ? "grade unavailable" : `drops ${row.drop} grade steps (maximum ${limit.maximumDrop})`}.`,
          ),
  );
}

// Evaluates positional grade impact rules against pre- and post-trade grade changes for own and opponent teams.
export function evaluateGradeImpacts(
  impact: ChainPositionImpact,
  rules?: PositionalGradeImpactRule[],
): { passes: boolean; failures: string[] } {
  // If no rules are specified, all trades pass with zero failures.
  if (!rules || rules.length === 0) {
    return { passes: true, failures: [] };
  }

  const failures: string[] = [];

  for (const rule of rules) {
    const sideLabel = rule.side === "own" ? "Your" : "Their";
    const sideImpacts = impact[rule.side];
    const row = sideImpacts?.find((r) => r.position === rule.position);

    // If position is not tracked or grade cannot be computed (e.g. 'n.a.'), rule cannot be satisfied.
    if (!row || row.stepDelta === null || row.stepDelta === undefined) {
      failures.push(
        `${sideLabel} ${rule.position}: ${row ? `${row.before} → ${row.after}; ` : ""}grade unavailable`,
      );
      continue;
    }

    if (rule.side === "own") {
      // For own team:
      // steps > 0 (upgrade target): requires stepDelta >= steps
      // steps < 0 (drop budget): requires stepDelta >= steps (e.g. drop <= 2 steps, stepDelta >= -2)
      // steps === 0 (no drop): requires stepDelta >= 0
      if (row.stepDelta < rule.steps) {
        failures.push(
          `Your ${rule.position}: ${row.before} → ${row.after}; change of ${row.stepDelta > 0 ? `+${row.stepDelta}` : row.stepDelta} steps does not meet requirement of ${rule.steps > 0 ? `+${rule.steps}` : rule.steps} steps.`,
        );
      }
    } else {
      // For other team:
      // steps > 0 (incentive upgrade): requires stepDelta >= steps
      // steps < 0 (depletion target): requires stepDelta <= steps (e.g. drops by at least 2 steps, stepDelta <= -2)
      // steps === 0 (no drop): requires stepDelta >= 0
      if (rule.steps < 0) {
        if (row.stepDelta > rule.steps) {
          failures.push(
            `Their ${rule.position}: ${row.before} → ${row.after}; change of ${row.stepDelta > 0 ? `+${row.stepDelta}` : row.stepDelta} steps does not meet depletion requirement of ${rule.steps} steps.`,
          );
        }
      } else {
        if (row.stepDelta < rule.steps) {
          failures.push(
            `Their ${rule.position}: ${row.before} → ${row.after}; change of ${row.stepDelta > 0 ? `+${row.stepDelta}` : row.stepDelta} steps does not meet requirement of ${rule.steps > 0 ? `+${rule.steps}` : rule.steps} steps.`,
          );
        }
      }
    }
  }

  return {
    passes: failures.length === 0,
    failures,
  };
}
