import type { JSX } from "react";
import { FilterHelp } from "../ui/FilterHelp";
import type {
  PositionalGradeImpactRule,
  GradeImpactSide,
  GradeImpactType,
} from "../domain/chain-position-impact";

// Default position list including overall net roster step impact
const DEFAULT_POSITIONS: string[] = [
  "QB",
  "RB",
  "WR",
  "TE",
  "FLEX",
  "K",
  "D/ST",
  "OVERALL",
];

// Generate a unique ID for new rules using crypto.randomUUID when available
function generateRuleId(): string {
  return typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `rule-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface StepOption {
  key: string;
  type: GradeImpactType;
  steps: number;
  label: string;
}

// Step dropdown options for the user's team (upgrades and drop limits)
const OWN_STEP_OPTIONS: StepOption[] = [
  { key: "5", type: "upgrade", steps: 5, label: "Upgrade ≥ 5 steps" },
  { key: "4", type: "upgrade", steps: 4, label: "Upgrade ≥ 4 steps" },
  { key: "3", type: "upgrade", steps: 3, label: "Upgrade ≥ 3 steps" },
  { key: "2", type: "upgrade", steps: 2, label: "Upgrade ≥ 2 steps" },
  { key: "1", type: "upgrade", steps: 1, label: "Upgrade ≥ 1 step" },
  { key: "0", type: "drop_limit", steps: 0, label: "No drop (≥ 0)" },
  { key: "-1", type: "drop_limit", steps: -1, label: "Drop at most 1 step" },
  { key: "-2", type: "drop_limit", steps: -2, label: "Drop at most 2 steps" },
  { key: "-3", type: "drop_limit", steps: -3, label: "Drop at most 3 steps" },
  { key: "-4", type: "drop_limit", steps: -4, label: "Drop at most 4 steps" },
  { key: "-5", type: "drop_limit", steps: -5, label: "Drop at most 5 steps" },
];

// Step dropdown options for opponent team (upgrades, loss limits, and depletion targets)
const MATCH_NET_OPTION: StepOption = {
  key: "match_net",
  type: "match_net",
  steps: 0,
  label: "Match your overall steps",
};

const OTHER_STEP_OPTIONS: StepOption[] = [
  { key: "5", type: "upgrade", steps: 5, label: "Upgrade ≥ 5 steps" },
  { key: "4", type: "upgrade", steps: 4, label: "Upgrade ≥ 4 steps" },
  { key: "3", type: "upgrade", steps: 3, label: "Upgrade ≥ 3 steps" },
  { key: "2", type: "upgrade", steps: 2, label: "Upgrade ≥ 2 steps" },
  { key: "1", type: "upgrade", steps: 1, label: "Upgrade ≥ 1 step" },
  { key: "0", type: "drop_limit", steps: 0, label: "No drop for them (≥ 0)" },
  {
    key: "limit:-1",
    type: "drop_limit",
    steps: -1,
    label: "Drop at most 1 step",
  },
  {
    key: "limit:-2",
    type: "drop_limit",
    steps: -2,
    label: "Drop at most 2 steps",
  },
  {
    key: "limit:-3",
    type: "drop_limit",
    steps: -3,
    label: "Drop at most 3 steps",
  },
  {
    key: "limit:-4",
    type: "drop_limit",
    steps: -4,
    label: "Drop at most 4 steps",
  },
  {
    key: "limit:-5",
    type: "drop_limit",
    steps: -5,
    label: "Drop at most 5 steps",
  },
  { key: "-1", type: "deplete", steps: -1, label: "Downgrade by ≥ 1 step" },
  { key: "-2", type: "deplete", steps: -2, label: "Downgrade by ≥ 2 steps" },
  { key: "-3", type: "deplete", steps: -3, label: "Downgrade by ≥ 3 steps" },
  { key: "-4", type: "deplete", steps: -4, label: "Downgrade by ≥ 4 steps" },
  { key: "-5", type: "deplete", steps: -5, label: "Downgrade by ≥ 5 steps" },
];

function getRuleKey(rule: PositionalGradeImpactRule): string {
  if (rule.type === "match_net") {
    return "match_net";
  }
  if (rule.side === "other" && rule.type === "drop_limit" && rule.steps < 0) {
    return `limit:${rule.steps}`;
  }
  return String(rule.steps);
}

/**
 * Renders positional grade impact goal controls for trade searches and multi-step chains.
 * Allows users to configure target grade step deltas (upgrades, drop protection, loss limits, or opponent depletion)
 * for specific roster positions or overall team net step impact.
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
  const rawPositions =
    positions && positions.length > 0 ? positions : DEFAULT_POSITIONS;
  const availablePositions = rawPositions.includes("OVERALL")
    ? rawPositions
    : [...rawPositions, "OVERALL"];
  const activeRules = rules ?? [];

  // Append a new default positional goal rule targeting next available position
  const handleAddRule = () => {
    const targetedByOwn = new Set(
      activeRules.filter((r) => r.side === "own").map((r) => r.position),
    );
    const nextPosition =
      availablePositions.find((p) => !targetedByOwn.has(p)) ||
      availablePositions[0] ||
      "OVERALL";
    const newRule: PositionalGradeImpactRule = {
      id: generateRuleId(),
      side: "own",
      position: nextPosition,
      steps: 2,
      type: "upgrade",
    };
    onChange([...activeRules, newRule]);
  };

  // Update a single property on the rule at the specified index
  const handleUpdateRule = (
    index: number,
    patch: Partial<PositionalGradeImpactRule>,
  ) => {
    onChange(
      activeRules.map((rule, i) =>
        i === index ? { ...rule, ...patch } : rule,
      ),
    );
  };

  // Remove the rule at the specified index
  const handleRemoveRule = (index: number) => {
    onChange(activeRules.filter((_, i) => i !== index));
  };

  return (
    <div className="grade-impact-container">
      <div className="grade-impact-header">
        <FilterHelp
          label="Positional Grade Goals"
          help="Require specific grade improvements, set maximum drop limits on your roster, or enforce opponent positional depletion targets across candidate trades."
        >
          <span>Positional Grade Goals</span>
        </FilterHelp>
      </div>

      {activeRules.length === 0 ? (
        <p className="grade-impact-empty">
          No positional grade goals configured.
        </p>
      ) : (
        <div className="grade-impact-list">
          {activeRules.map((rule, index) => {
            const stepOptions =
              rule.side === "other"
                ? rule.position.toUpperCase() === "OVERALL"
                  ? [MATCH_NET_OPTION, ...OTHER_STEP_OPTIONS]
                  : OTHER_STEP_OPTIONS
                : OWN_STEP_OPTIONS;
            const positionOptions = availablePositions.includes(rule.position)
              ? availablePositions
              : [rule.position, ...availablePositions];

            return (
              <div key={rule.id} className="grade-impact-row">
                {/* Team selector: Your team vs Their team */}
                <select
                  className="grade-impact-select"
                  aria-label={`${ariaLabelPrefix} ${index + 1} team`}
                  value={rule.side}
                  onChange={(e) => {
                    const newSide = e.target.value as GradeImpactSide;
                    const patch: Partial<PositionalGradeImpactRule> = {
                      side: newSide,
                    };
                    if (newSide === "own" && rule.type === "match_net") {
                      patch.type = "upgrade";
                      patch.steps = 2;
                    }
                    handleUpdateRule(index, patch);
                  }}
                >
                  <option value="own">Your team</option>
                  <option value="other">Their team</option>
                </select>

                {/* Position selector with defensive fallback for custom positions */}
                <select
                  className="grade-impact-select"
                  aria-label={`${ariaLabelPrefix} ${index + 1} position`}
                  value={rule.position}
                  onChange={(e) => {
                    const newPos = e.target.value;
                    const patch: Partial<PositionalGradeImpactRule> = {
                      position: newPos,
                    };
                    if (
                      rule.type === "match_net" &&
                      newPos.toUpperCase() !== "OVERALL"
                    ) {
                      patch.type = "upgrade";
                      patch.steps = 1;
                    }
                    handleUpdateRule(index, patch);
                  }}
                >
                  {positionOptions.map((pos) => (
                    <option key={pos} value={pos}>
                      {pos === "OVERALL" ? "Overall (Net)" : pos}
                    </option>
                  ))}
                </select>

                {/* Grade step target selector */}
                <select
                  className="grade-impact-select"
                  aria-label={`${ariaLabelPrefix} ${index + 1} target`}
                  value={getRuleKey(rule)}
                  onChange={(e) => {
                    const val = e.target.value;
                    const selected =
                      stepOptions.find((o) => o.key === val) ||
                      stepOptions.find((o) => o.steps === Number(val));
                    if (selected) {
                      const patch: Partial<PositionalGradeImpactRule> = {
                        steps: selected.steps,
                      };
                      if (selected.type === "match_net") {
                        patch.type = "match_net";
                      } else if (
                        selected.type === "drop_limit" &&
                        rule.side === "other"
                      ) {
                        patch.type = "drop_limit";
                      } else if (selected.type === "deplete") {
                        patch.type = "deplete";
                      } else if (rule.type) {
                        patch.type = selected.type;
                      }
                      handleUpdateRule(index, patch);
                    }
                  }}
                >
                  {stepOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
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
