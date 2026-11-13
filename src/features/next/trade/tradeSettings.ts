// The Find trades finder and the Chain planner remember their controls in one account-scoped string, `tradeSearchSettings`:
// { version: 1, standard: {...}, chain: {...} }. Each screen writes only its own part and keeps the other as stored.
export interface StoredTradeSettings {
  version?: number;
  // The saved parts are written by the hooks and read back by them; each hook owns the shape of its own part.
  standard?: { query?: unknown; controls?: unknown };
  chain?: unknown;
}

// Read the stored record; anything unreadable or from another version counts as no saved settings.
export function readTradeSettings(raw?: string): StoredTradeSettings {
  try {
    const value = JSON.parse(raw ?? "{}");
    return value && value.version === 1 ? value : {};
  } catch {
    return {};
  }
}

// Replace one part of the stored record with a new JSON value, keeping the other part exactly as it was.
export function mergeTradeSettings(
  raw: string | undefined,
  part: "standard" | "chain",
  valueJson: string | undefined,
): string {
  const current = readTradeSettings(raw);
  const next: StoredTradeSettings = {
    version: 1,
    standard:
      part === "standard" && valueJson
        ? JSON.parse(valueJson)
        : current.standard,
    chain:
      part === "chain" && valueJson ? JSON.parse(valueJson) : current.chain,
  };
  return JSON.stringify(next);
}
