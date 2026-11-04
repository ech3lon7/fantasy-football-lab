// Numeric evidence is presentation metadata; classification continues to use the engine's unrounded checks.
export interface EvidenceComparison {
  required: string;
  actual: string;
  margin: string;
  note?: string;
  // Eligibility checks have discrete outcomes, not invented numeric performance scores.
  condition?: "PASS" | "FAIL" | "UNKNOWN" | "WAIVED";
  // Preserve unrounded operands for read-only meters; never reverse-engineer numbers from formatted text.
  numeric?: {
    threshold: number | null;
    value: number | null;
    unit: string;
    operator: "≥" | ">" | "≤" | "<";
  };
}

// Supply a meter for every nonnumeric requirement while keeping waived and missing evidence neutral.
export function evidenceCondition(
  required: string,
  actual: string,
  met: boolean | null | "WAIVED",
  note?: string,
): EvidenceComparison {
  const condition =
    met === "WAIVED" ? met : met === null ? "UNKNOWN" : met ? "PASS" : "FAIL";
  return {
    required,
    actual,
    note,
    condition,
    margin:
      condition === "PASS"
        ? "Requirement met"
        : condition === "FAIL"
          ? "Requirement not met"
          : condition === "WAIVED"
            ? "Not required"
            : "Unavailable",
  };
}

// Measure clearance in the passing direction, keeping strict boundaries, missing values and percentage points explicit.
export function evidenceComparison(
  required: number | null | undefined,
  actual: number | null | undefined,
  unit: string,
  operator: "≥" | ">" | "≤" | "<" = "≥",
  note?: string,
): EvidenceComparison {
  const known = (v: number | null | undefined): v is number =>
    typeof v === "number" && Number.isFinite(v);
  const scale = unit === "%" ? 100 : 1;
  const format = (v: number | null | undefined) =>
    known(v)
      ? `${(v * scale).toFixed(unit === "games" ? 0 : 2)}${unit === "%" ? "" : " "}${unit}`
      : "Unavailable";
  const minimum = operator === "≥" || operator === ">";
  const delta =
    known(required) && known(actual)
      ? minimum
        ? actual - required
        : required - actual
      : null;
  let margin = "Unavailable";
  if (delta !== null) {
    const amount = Math.abs(delta * scale);
    const magnitude =
      amount > 0 && amount < 0.005
        ? "<0.01"
        : amount.toFixed(unit === "games" ? 0 : 2);
    const suffix = unit === "%" ? "percentage points" : unit;
    margin = `${delta < 0 ? "−" : "+"}${magnitude} ${suffix}`;
    if (delta === 0)
      margin +=
        operator === ">" || operator === "<"
          ? "; equal — strict limit not met"
          : "; at threshold";
    else
      margin += `; ${minimum ? (delta > 0 ? "above minimum" : "below minimum") : delta > 0 ? "below maximum" : "above maximum"}`;
  }
  return {
    required: known(required)
      ? `${operator} ${format(required)}`
      : "Unavailable",
    actual: format(actual),
    margin,
    note,
    numeric: {
      threshold: known(required) ? required : null,
      value: known(actual) ? actual : null,
      unit,
      operator,
    },
  };
}
