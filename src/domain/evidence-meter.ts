import type { EvidenceComparison } from "./evidence-comparison";

// Red/green describe favorable player evidence, independently of whether a positive or negative badge qualifies.
export function adverseEvidence(
  tag: string,
  check: string,
  comparison: EvidenceComparison,
) {
  if (tag === "Reduced workload" && check === "Sustained workload decline")
    return ![
      "Verified played-game sample",
      "Positive earlier workload",
    ].includes(comparison.note ?? "");
  return (
    ["SELL HIGH", "TD caution"].includes(tag) &&
    ["Positional volume test", "Player touchdown rate"].includes(check)
  );
}

// Keep scales tied to the same numeric cutoff, not each player's result. These are display bounds, not historical extrema or probabilities.
export function evidenceMeter(
  comparison: EvidenceComparison,
  tag: string,
  check: string,
  remainingWeeks?: number,
) {
  // Binary requirements use labeled endpoints; unknown/waived checks never acquire a fabricated value.
  if (comparison.condition) {
    if (comparison.condition === "UNKNOWN" || comparison.condition === "WAIVED")
      return null;
    const qualifies = comparison.condition === "PASS";
    return {
      low: 0,
      high: 1,
      bounded: qualifies ? 1 : 0,
      value: qualifies ? 1 : 0,
      playerPosition: qualifies ? 100 : 0,
      thresholdPosition: 100,
      favorableIncreases: true,
      qualifies,
      leftLabel: "Not met",
      rightLabel: "Met",
      outside: "",
    };
  }
  const numeric = comparison.numeric;
  if (
    !numeric ||
    numeric.threshold === null ||
    numeric.value === null ||
    !Number.isFinite(numeric.threshold) ||
    !Number.isFinite(numeric.value)
  )
    return null;
  const { threshold, value, unit, operator } = numeric;
  const minimum = operator === "≥" || operator === ">";
  const strict = operator === ">" || operator === "<";
  const favorableIncreases =
    minimum !== adverseEvidence(tag, check, comparison);
  const span = Math.max(Math.abs(threshold), unit === "%" ? 0.01 : 1);
  const low =
    unit === "games" ? Math.max(0, threshold - span) : threshold - span;
  // Availability has a real shared upper bound: the selected snapshot's remaining fantasy horizon.
  const high =
    check === "Availability" &&
    unit === "games" &&
    remainingWeeks !== undefined &&
    Number.isFinite(remainingWeeks) &&
    remainingWeeks > threshold
      ? remainingWeeks
      : threshold + span;
  if (!Number.isFinite(high - low) || high <= low) return null;
  const bounded = Math.max(low, Math.min(high, value));
  const position = (n: number) =>
    ((favorableIncreases ? n - low : high - n) / (high - low)) * 100;
  const format = (n: number) =>
    unit === "%"
      ? `${(n * 100).toFixed(2)}%`
      : `${n.toFixed(unit === "games" ? 0 : 2)} ${unit}`;
  return {
    low,
    high,
    bounded,
    value,
    playerPosition: position(bounded),
    thresholdPosition: position(threshold),
    favorableIncreases,
    qualifies: minimum
      ? strict
        ? value > threshold
        : value >= threshold
      : strict
        ? value < threshold
        : value <= threshold,
    leftLabel: format(favorableIncreases ? low : high),
    rightLabel: format(favorableIncreases ? high : low),
    outside:
      value < low
        ? "Below display range"
        : value > high
          ? "Above display range"
          : "",
  };
}
