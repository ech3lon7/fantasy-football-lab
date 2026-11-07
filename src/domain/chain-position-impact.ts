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
export type GradeImpactType = "upgrade" | "drop_limit" | "deplete";

export interface PositionalGradeImpactRule {
  id: string;
  side: GradeImpactSide;
  position: string;
  steps: number;
  type?: GradeImpactType;
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

/**
 * Computes available starter positions with active slots in this league format from ModelContext[0].
 */
export function availableStarterPositions(m: Model): string[] {
  const ctx = m?.dataset?.tables?.ModelContext?.[0];
  if (!ctx) return ["QB", "RB", "WR", "TE", "FLEX", "K", "D/ST"];
  const list: string[] = [];
  if (Number(ctx.QBSlots) > 0) list.push("QB");
  if (Number(ctx.RBSlots) > 0) list.push("RB");
  if (Number(ctx.WRSlots) > 0) list.push("WR");
  if (Number(ctx.TESlots) > 0) list.push("TE");
  if (Number(ctx.FlexSlots) > 0) list.push("FLEX");
  if (Number(ctx.KSlots) > 0) list.push("K");
  if (Number(ctx.DSTSlots) > 0) list.push("D/ST");
  return list.length > 0 ? list : ["QB", "RB", "WR", "TE", "FLEX", "K", "D/ST"];
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
    const sideImpacts = impact[rule.side] ?? [];

    // Determine effective type if not explicitly set (preserves backward compatibility)
    const effectiveType: GradeImpactType =
      rule.type ??
      (rule.side === "own"
        ? rule.steps > 0
          ? "upgrade"
          : "drop_limit"
        : rule.steps > 0
          ? "upgrade"
          : rule.steps === 0
            ? "drop_limit"
            : "deplete");

    // Support overall net step requirements across all positions
    if (rule.position.toUpperCase() === "OVERALL") {
      const netDelta = netGradeStepDelta(sideImpacts);
      const sign = netDelta > 0 ? `+${netDelta}` : `${netDelta}`;

      if (effectiveType === "upgrade") {
        const requiredSteps = Math.abs(rule.steps);
        if (netDelta < requiredSteps) {
          failures.push(
            `${sideLabel} overall grade change of ${sign} steps does not meet requirement of +${requiredSteps} steps.`,
          );
        }
      } else if (effectiveType === "drop_limit") {
        const maxDrop = Math.abs(rule.steps);
        if (netDelta < -maxDrop) {
          failures.push(
            `${sideLabel} overall grade change of ${sign} steps exceeds loss limit of ${maxDrop} step${maxDrop === 1 ? "" : "s"}.`,
          );
        }
      } else if (effectiveType === "deplete") {
        const requiredDepletion = -Math.abs(rule.steps);
        if (netDelta > requiredDepletion) {
          failures.push(
            `${sideLabel} overall grade change of ${sign} steps does not meet depletion requirement of ${requiredDepletion} steps.`,
          );
        }
      }
      continue;
    }

    const row = sideImpacts.find((r) => r.position === rule.position);

    // If position is not tracked or grade cannot be computed (e.g. 'n.a.'), rule cannot be satisfied.
    if (!row || row.stepDelta === null || row.stepDelta === undefined) {
      failures.push(
        `${sideLabel} ${rule.position}: ${row ? `${row.before} → ${row.after}; ` : ""}grade unavailable`,
      );
      continue;
    }

    const delta = row.stepDelta;
    const sign = delta > 0 ? `+${delta}` : `${delta}`;

    if (effectiveType === "upgrade") {
      const requiredSteps = Math.abs(rule.steps);
      if (delta < requiredSteps) {
        failures.push(
          `${sideLabel} ${rule.position}: ${row.before} → ${row.after}; change of ${sign} steps does not meet requirement of +${requiredSteps} steps.`,
        );
      }
    } else if (effectiveType === "drop_limit") {
      const maxDrop = Math.abs(rule.steps);
      if (delta < -maxDrop) {
        failures.push(
          `${sideLabel} ${rule.position}: ${row.before} → ${row.after}; change of ${sign} steps exceeds loss limit of ${maxDrop} step${maxDrop === 1 ? "" : "s"}.`,
        );
      }
    } else if (effectiveType === "deplete") {
      const requiredDepletion = -Math.abs(rule.steps);
      if (delta > requiredDepletion) {
        failures.push(
          `${sideLabel} ${rule.position}: ${row.before} → ${row.after}; change of ${sign} steps does not meet depletion requirement of ${requiredDepletion} steps.`,
        );
      }
    }
  }

  return {
    passes: failures.length === 0,
    failures,
  };
}

// Convert grade impact evaluation results into formatted failure strings for diagnostic reporting.
export function gradeImpactFailures(
  impact?: ChainPositionImpact,
  rules?: PositionalGradeImpactRule[],
): string[] {
  if (!rules || rules.length === 0 || !impact) return [];
  return evaluateGradeImpacts(impact, rules).failures;
}

/**
 * Calculates the total net step delta across a list of position changes.
 * Positive = overall upgrade, negative = overall downgrade.
 */
export function netGradeStepDelta(
  changes: ChainPositionChange[] | null | undefined,
): number {
  if (!changes || changes.length === 0) return 0;
  return changes.reduce((total, c) => total + (c.stepDelta ?? 0), 0);
}
