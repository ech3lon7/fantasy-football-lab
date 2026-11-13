import {
  defaultSearchLimits,
  editedLimits,
  limitLabels,
  type LimitName,
  type SearchLimits,
} from "../search-limits";

// How one limit reads in the interface, for example "6.0 EPPG", "20%" or "Off".
export function limitText(name: LimitName, limits: SearchLimits): string {
  switch (name) {
    case "minimumFinalGain":
    case "maximumTemporaryLoss":
      return `${limits[name].toFixed(1)} EPPG`;
    case "maximumRecipientValueLoss":
      return `${Math.round(limits[name] * 100)}%`;
    case "indexWindow":
      return limits.indexWindow === null ? "Off" : `±${limits.indexWindow}`;
  }
}

// The one-line summary of the shared limits: "Defaults", or only the limits that were changed.
export function limitsSummary(limits: SearchLimits): string {
  const edited = editedLimits(limits);
  return edited.length
    ? edited.map((n) => `${limitLabels[n]} ${limitText(n, limits)}`).join(" · ")
    : "Defaults";
}

export { defaultSearchLimits };
