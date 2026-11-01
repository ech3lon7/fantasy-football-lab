import { cmpId, sum, type Draft, type Position } from "./contracts";
import { irAssignments, teamsAssessment, type PositionGrade } from "./lineups";
import type { Model } from "./valuation";
import type { TradeResult } from "./trades";

// Share the existing grade order between positional targeting and recipient protection.
export const positionGradeScale = [
  "F",
  "D−",
  "D",
  "D+",
  "C−",
  "C",
  "C+",
  "B−",
  "B",
  "B+",
  "A−",
  "A",
  "A+",
] as const;
export interface DeficitProtection {
  enabled: boolean;
  ceiling: string;
  minimum: number;
}
export const defaultDeficitProtection: DeficitProtection = {
  enabled: true,
  ceiling: "C+",
  minimum: 2,
};
export interface DeficitProtectionEvidence {
  position: Position;
  grade: string;
  departing: string | null;
  before: number | null;
  after: number | null;
  gain: number | null;
  minimum: number;
  failure: string | null;
}

// Validate enabled and disabled saved controls alike; blank/invalid numeric edits cannot silently become zero.
export function deficitProtectionErrors(rule?: DeficitProtection): string[] {
  return rule &&
    (typeof rule.enabled !== "boolean" ||
      !positionGradeScale.some((grade) => grade === rule.ceiling) ||
      !Number.isFinite(rule.minimum) ||
      rule.minimum <= 0)
    ? ["Choose a valid deficit grade and a positive positional gain minimum."]
    : [];
}

// Models are immutable search snapshots; each advanced chain roster receives a fresh grade cache entry.
const gradeCache = new WeakMap<Model, Map<string, PositionGrade[]>>();
function gradesFor(m: Model) {
  let grades = gradeCache.get(m);
  if (!grades) {
    grades = teamsAssessment(m);
    gradeCache.set(m, grades);
  }
  return grades;
}

// Protect a deficit team's best positional player using the complete legal post-trade lineup, including FLEX and required drops.
export function deficitProtectionEvidence(
  m: Model,
  draft: Draft,
  result: TradeResult,
  rule?: DeficitProtection,
): DeficitProtectionEvidence[] {
  if (!rule?.enabled || !result.valid) return [];
  const grades = gradesFor(m).get(draft.teamB) ?? [];
  const threshold = positionGradeScale.findIndex(
    (grade) => grade === rule.ceiling,
  );
  const evidence: DeficitProtectionEvidence[] = [];
  const beforeIR = new Set(irAssignments(m, result.initialB));
  for (const position of new Set(draft.get.map((id) => m.byId.get(id)!.pos))) {
    const assessed = grades.find((row) => row.position === position);
    const rank = positionGradeScale.findIndex(
      (grade) => grade === assessed?.grade,
    );
    if (rank > threshold) continue;
    const players = result.initialB
      .map((id) => m.byId.get(id)!)
      .filter(
        (p) => p.pos === position && p.expected !== null && !beforeIR.has(p.id),
      )
      .sort((a, b) => b.expected! - a.expected! || cmpId(a.id, b.id));
    const best = players[0];
    const departing =
      draft.get.find(
        (id) =>
          m.byId.get(id)!.pos === position &&
          (!best || m.byId.get(id)!.expected! >= best.expected!),
      ) ?? null;
    if (!departing && rank >= 0) continue;
    const impact = result.potentialB;
    const usable =
      rank >= 0 &&
      !impact.errors.length &&
      impact.weekly.length > 0 &&
      impact.weekly.every(
        (week) => week.beforeExpected !== null && week.afterExpected !== null,
      );
    const score = (ids: (string | null)[]) =>
      sum(
        ids.map((id) =>
          id && m.byId.get(id)?.pos === position
            ? m.byId.get(id)!.expected!
            : 0,
        ),
      );
    const before = usable
      ? sum(impact.weekly.map((week) => score(week.beforeIds))) /
        impact.weekly.length
      : null;
    const after = usable
      ? sum(impact.weekly.map((week) => score(week.ids))) / impact.weekly.length
      : null;
    const gain = before !== null && after !== null ? after - before : null;
    evidence.push({
      position,
      grade: assessed?.grade ?? "Unavailable",
      departing,
      before,
      after,
      gain,
      minimum: rule.minimum,
      failure:
        gain === null
          ? `Cannot verify their ${position} improvement because lineup or position-grade data is unavailable.`
          : gain + 1e-9 < rule.minimum
            ? `Their ${position} grade is ${assessed!.grade}; giving up their best ${position} changes positional scoring by ${gain.toFixed(2)} points/week, below the required +${rule.minimum.toFixed(2)}.`
            : null,
    });
  }
  return evidence;
}

// Missing evidence is a failed check, while an empty evidence list means no deficit-position best player is being surrendered.
export function deficitProtectionFailures(
  evidence: DeficitProtectionEvidence[] | undefined,
  rule?: DeficitProtection,
) {
  if (!rule?.enabled) return [];
  return evidence === undefined
    ? ["Could not verify the recipient's deficit-position protection."]
    : evidence.flatMap((row) => (row.failure ? [row.failure] : []));
}
