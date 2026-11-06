import type { JSX } from "react";
import type {
  PositionalGradeImpactRule,
  GradeImpactSide,
} from "../domain/chain-position-impact";

// Default position list if not explicitly provided
const DEFAULT_POSITIONS: string[] = ["QB", "RB", "WR", "TE", "FLEX", "K", "D/ST"];

// Step dropdown options for the user's team (upgrades and drop limits)
const OWN_STEP_OPTIONS: { value: number; label: string }[] = [
  { value: 5, label: "Upgrade ≥ 5 steps" },
  { value: 4, label: "Upgrade ≥ 4 steps" },
  { value: 3, label: "Upgrade ≥ 3 steps" },
  { value: 2, label: "Upgrade ≥ 2 steps" },
  { value: 1, label: "Upgrade ≥ 1 step" },
  { value: 0, label: "No drop (≥ 0)" },
  { value: -1, label: "Drop at most 1 step" },
  { value: -2, label: "Drop at most 2 steps" },
  { value: -3, label: "Drop at most 3 steps" },
  { value: -4, label: "Drop at most 4 steps" },
  { value: -5, label: "Drop at most 5 steps" },
];

// Step dropdown options for opponent team (upgrades and depletion targets)
const OTHER_STEP_OPTIONS: { value: number; label: string }[] = [
  { value: 5, label: "Upgrade ≥ 5 steps" },
  { value: 4, label: "Upgrade ≥ 4 steps" },
  { value: 3, label: "Upgrade ≥ 3 steps" },
  { value: 2, label: "Upgrade ≥ 2 steps" },
  { value: 1, label: "Upgrade ≥ 1 step" },
  { value: 0, label: "No drop for them (≥ 0)" },
  { value: -1, label: "Downgrade by ≥ 1 step" },
  { value: -2, label: "Downgrade by ≥ 2 steps" },
  { value: -3, label: "Downgrade by ≥ 3 steps" },
  { value: -4, label: "Downgrade by ≥ 4 steps" },
  { value: -5, label: "Downgrade by ≥ 5 steps" },
];

/**
 * Renders positional grade impact goal controls for trade searches and multi-step chains.
 * Allows users to configure target grade step deltas (upgrades, drop protection, or opponent depletion)
 * for specific roster positions.
 */
export function PositionalGradeImpactControls({
  rules,
  onChange,
  positions,
  ariaLabelPrefix = "Positional grade goal",
}: {
  rules: PositionalGradeImpactRule[];
  onChange: (rules: PositionalGradeImpactRule[]) => void;
  positions?: string[];
  ariaLabelPrefix?: string;
}): JSX.Element {
  const availablePositions =
    positions && positions.length > 0 ? positions : DEFAULT_POSITIONS;
  const activeRules = rules ?? [];

  // Generate a unique ID for new rules using crypto.randomUUID when available
  const generateRuleId = (): string =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `rule-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  // Append a new default positional goal rule
  const handleAddRule = () => {
    const newRule: PositionalGradeImpactRule = {
      id: generateRuleId(),
      side: "own",
      position: availablePositions[0] || "WR",
      steps: 2,
    };
    onChange([...activeRules, newRule]);
  };

  // Update a single property on the rule at the specified index
  const handleUpdateRule = (
    index: number,
    patch: Partial<PositionalGradeImpactRule>,
  ) => {
    onChange(
      activeRules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    );
  };

  // Remove the rule at the specified index
  const handleRemoveRule = (index: number) => {
    onChange(activeRules.filter((_, i) => i !== index));
  };

  return (
    <div className="grade-impact-container">
      <div className="grade-impact-header">
        <span>Positional Grade Goals</span>
      </div>

      {activeRules.length === 0 ? (
        <p className="grade-impact-empty">No positional grade goals configured.</p>
      ) : (
        <div className="grade-impact-list">
          {activeRules.map((rule, index) => {
            const stepOptions =
              rule.side === "other" ? OTHER_STEP_OPTIONS : OWN_STEP_OPTIONS;

            return (
              <div key={rule.id} className="grade-impact-row">
                {/* Team selector: Your team vs Their team */}
                <select
                  className="grade-impact-select"
                  aria-label={`${ariaLabelPrefix} ${index + 1} team`}
                  value={rule.side}
                  onChange={(e) =>
                    handleUpdateRule(index, {
                      side: e.target.value as GradeImpactSide,
                    })
                  }
                >
                  <option value="own">Your team</option>
                  <option value="other">Their team</option>
                </select>

                {/* Position selector */}
                <select
                  className="grade-impact-select"
                  aria-label={`${ariaLabelPrefix} ${index + 1} position`}
                  value={rule.position}
                  onChange={(e) =>
                    handleUpdateRule(index, { position: e.target.value })
                  }
                >
                  {availablePositions.map((pos) => (
                    <option key={pos} value={pos}>
                      {pos}
                    </option>
                  ))}
                </select>

                {/* Grade step target selector */}
                <select
                  className="grade-impact-select"
                  aria-label={`${ariaLabelPrefix} ${index + 1} target`}
                  value={rule.steps}
                  onChange={(e) =>
                    handleUpdateRule(index, {
                      steps: Number(e.target.value),
                    })
                  }
                >
                  {stepOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                {/* Remove goal button */}
                <button
                  type="button"
                  className="grade-impact-remove"
                  aria-label={`${ariaLabelPrefix} ${index + 1} remove`}
                  title="Remove positional goal"
                  onClick={() => handleRemoveRule(index)}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Button to add a new positional goal rule */}
      <button
        type="button"
        className="grade-impact-add-btn button"
        onClick={handleAddRule}
      >
        + Add Positional Goal
      </button>
    </div>
  );
}
