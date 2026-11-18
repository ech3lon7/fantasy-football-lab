import { positions, type Draft } from "./contracts";
import {
  teamsAssessment,
  teamsAssessmentWith,
  type TeamsAssessmentCache,
} from "./lineups";
import { positionGradeScale } from "./trade-safeguards";
import type { TradeResult } from "./trades";
import type { Model } from "./valuation";

export type MinimalTradeResult = {
  valid: boolean;
  legality?: boolean;
  legalA: string[];
  legalB: string[];
  dropsA?: string[];
  dropsB?: string[];
  initialB?: string[];
  irA?: string[];
  irB?: string[];
};

// Grade limits are optional preferences and never change the existing scoring, valuation, or grading formulas.
export interface ChainGradeLimit {
  side: "own" | "other" | "both";
  maximumDrop: number;
}

export type GradeImpactSide = "own" | "other";
// One list drives both the type and saved-trade validation, so new goal types cannot silently break saving.
export const gradeImpactTypes = [
  "upgrade",
  "drop_limit",
  "deplete",
  "match_net",
] as const;
export type GradeImpactType = (typeof gradeImpactTypes)[number];

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

let _gradeIndexMap: Map<string, number> | null = null;
function getGradeIndexMap(): Map<string, number> {
  if (!_gradeIndexMap) {
    _gradeIndexMap = new Map<string, number>(positionGradeScale.map((g, i) => [g, i]));
  }
  return _gradeIndexMap;
}
// Positive = upgrade, negative = downgrade, null = grade unavailable ("n.a.").
export function gradeStepDelta(before: string, after: string): number | null {
  const map = getGradeIndexMap();
  const first = map.get(before) ?? -1;
  const last = map.get(after) ?? -1;
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
  result: MinimalTradeResult | TradeResult,
  targetPositions?: Iterable<string>,
  cachedBefore?: Map<string, { position: string; grade: string }[]>,
  teamsCache?: TeamsAssessmentCache,
): ChainPositionImpact {
  if (!result.valid || result.legality === false) return { own: [], other: [] };
  const before = cachedBefore ?? teamsAssessment(m),
    after = teamsAssessmentWith(
      m,
      new Map([
        [draft.teamA, result.legalA],
        [draft.teamB, result.legalB],
      ]),
      teamsCache,
      true,
    );
  const hasOverall = Array.from(targetPositions ?? []).some(
    (p: string) => p.toUpperCase() === "OVERALL",
  );
  const dropsA = result.dropsA ?? [];
  const dropsB = result.dropsB ?? [];
  const affected = new Set([
    ...[...draft.give, ...draft.get, ...dropsA, ...dropsB].map(
      (id) => m.byId.get(id)!.pos,
    ),
    ...(targetPositions ?? []),
    ...(hasOverall ? [...positions, "FLEX"] : []),
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
        const map = getGradeIndexMap();
        const first = map.get(a) ?? -1,
          last = map.get(b) ?? -1;
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
  otherTeamName?: string,
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

    // Migrated legacy drop limits apply to each affected position, matching the former per-position rule.
    if (rule.position.toUpperCase() === "AFFECTED" && effectiveType === "drop_limit") {
      for (const row of sideImpacts) {
        if (row.stepDelta === null || row.stepDelta < -Math.abs(rule.steps))
          failures.push(`${sideLabel} ${row.position}: ${row.before} → ${row.after}; grade drop exceeds the saved limit or is unavailable.`);
      }
      continue;
    }

    // Support overall net step requirements across all positions
    if (rule.position.toUpperCase() === "OVERALL") {
      const netDelta = netGradeStepDelta(sideImpacts);
      const sign = netDelta > 0 ? `+${netDelta}` : `${netDelta}`;

      if (effectiveType === "match_net") {
        const ownNet = netGradeStepDelta(impact.own ?? []);
        const otherNet = netGradeStepDelta(impact.other ?? []);
        if (otherNet !== ownNet) {
          const teamLabel = otherTeamName ?? "Their team";
          const otherSign = otherNet > 0 ? `+${otherNet}` : `${otherNet}`;
          const ownSign = ownNet > 0 ? `+${ownNet}` : `${ownNet}`;
          failures.push(
            `${teamLabel} overall step delta (${otherSign}) does not match your overall step delta (${ownSign}).`,
          );
        }
      } else if (effectiveType === "upgrade") {
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
  otherTeamName?: string,
): string[] {
  if (!rules || rules.length === 0 || !impact) return [];
  return evaluateGradeImpacts(impact, rules, otherTeamName).failures;
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
