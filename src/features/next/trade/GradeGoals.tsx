import { useMemo, type ReactNode } from "react";
import type { Model } from "../../../domain/valuation";
import type { Draft } from "../../../domain/contracts";
import {
  availableStarterPositions,
  type PositionalGradeImpactRule,
} from "../../../domain/chain-position-impact";
import { teamsAssessment } from "../../../domain/lineups";
import { gradeGoalSentence } from "../../../domain/view/trade-room";
import {
  goalKey,
  isOverall,
  newGoal,
  stepOptionsFor,
  withPosition,
  withSide,
  withStepKey,
} from "./goalRules";

// The positional grade goals editor: one row per goal with the plain-language sentence beneath it.
export function GradeGoals({
  m,
  draft,
  rules,
  onChange,
  scope,
  children,
}: {
  m: Model;
  draft: Draft;
  rules: PositionalGradeImpactRule[];
  onChange: (rules: PositionalGradeImpactRule[]) => void;
  // Names the trade whose goals these are (Chain planner); the editor then folds into its group instead of being a card.
  scope?: string;
  // The primary action sits at the foot of the card.
  children?: ReactNode;
}) {
  const available = availableStarterPositions(m);
  const grades = useMemo(
    () => teamsAssessment(m).get(draft.teamA) ?? [],
    [m, draft.teamA],
  );
  const label = (text: string) => (scope ? `${scope}: ${text}` : text);
  const set = (index: number, next: PositionalGradeImpactRule) =>
    onChange(rules.map((r, i) => (i === index ? next : r)));
  return (
    <section
      className={scope ? "gd-goals" : "gd-card gd-goals"}
      aria-label={
        scope ? `${scope} positional grade goals` : "Positional grade goals"
      }
    >
      <div className="gd-chips" style={{ justifyContent: "space-between" }}>
        {scope ? (
          <span className="gd-quiet">Goals for {scope.toLowerCase()}</span>
        ) : (
          <h3>Positional grade goals</h3>
        )}
        <button
          type="button"
          className="gd-cbtn"
          onClick={() => onChange([...rules, newGoal(rules, available)])}
        >
          + Add goal
        </button>
      </div>
      {rules.map((rule, index) => {
        const positionList =
          available.includes(rule.position) || isOverall(rule.position)
            ? available
            : [rule.position, ...available];
        const own =
          grades.find((g) => g.position === rule.position)?.grade ?? null;
        return (
          <div key={rule.id} className="gd-rule">
            <select
              className="gd-sel"
              aria-label={label("Team")}
              value={rule.side}
              onChange={(e) =>
                set(index, withSide(rule, e.target.value as "own" | "other"))
              }
            >
              <option value="own">Your team</option>
              <option value="other">The other team</option>
            </select>
            <select
              className="gd-sel"
              aria-label={label("Position")}
              value={rule.position}
              onChange={(e) => set(index, withPosition(rule, e.target.value))}
            >
              {positionList.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value="OVERALL">Overall (net steps)</option>
            </select>
            <select
              className="gd-sel"
              aria-label={label("Grade steps")}
              value={goalKey(rule)}
              onChange={(e) => set(index, withStepKey(rule, e.target.value))}
            >
              {stepOptionsFor(rule).map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="gd-cbtn"
              aria-label={label("Remove positional goal")}
              onClick={() => onChange(rules.filter((_, i) => i !== index))}
            >
              ✕
            </button>
            <p className="gd-quiet gd-goal-line">{gradeGoalSentence(rule, own)}</p>
          </div>
        );
      })}
      {rules.length === 0 && (
        <p className="gd-quiet">
          No positional grade goals configured. Every legal trade is listed.
        </p>
      )}
      <div>{children}</div>
    </section>
  );
}
