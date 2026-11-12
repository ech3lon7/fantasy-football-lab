// Labels describe a player's analytical state; warnings are amber and every other label is positive green.
// The text is the only input so scouting rows, the player card, roster tiles and the ticker agree.
export type LabelTone = "positive" | "warning";

const warningLabels = new Set([
  "Reduced workload",
  "BUY LOW",
  "SELL HIGH",
  "TD caution",
]);

export function labelTone(label: string): LabelTone {
  return warningLabels.has(label) ? "warning" : "positive";
}
