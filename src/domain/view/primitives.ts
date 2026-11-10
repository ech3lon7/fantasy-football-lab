// Read-only helpers behind the shared interface components, so components never do arithmetic on model values.

export interface Range {
  floor: number | null;
  expected: number | null;
  ceiling: number | null;
}

// Place floor, expected and ceiling on a shared scale as percentages; any missing value or an empty scale yields null, never zero.
export function barPositions(
  range: Range,
  scale: { min: number; max: number },
): {
  floor: number;
  expected: number;
  ceiling: number;
  width: number;
} | null {
  const { floor, expected, ceiling } = range;
  if (floor === null || expected === null || ceiling === null) return null;
  const width = scale.max - scale.min;
  if (!Number.isFinite(width) || width <= 0) return null;
  const at = (v: number) =>
    Math.min(100, Math.max(0, ((v - scale.min) / width) * 100));
  const [lo, hi] = [at(floor), at(ceiling)];
  return { floor: lo, expected: at(expected), ceiling: hi, width: hi - lo };
}

// A limit counts as edited only when it differs from its default; a missing value is never "edited".
export const isEdited = (
  value: number | null | undefined,
  fallback: number,
): boolean => value !== null && value !== undefined && value !== fallback;

// Remember which folding groups the person left open, in the existing string-valued filter record.
export const foldedGroupsKey = "foldedGroups";

// Parse the saved map and ignore anything malformed so a bad value never breaks a screen.
export function readOpenGroups(raw?: string): Record<string, boolean> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
      ),
    );
  } catch {
    return {};
  }
}

// Return the new saved string with one group opened or closed, leaving other groups as they were.
export function setGroupOpen(
  raw: string | undefined,
  id: string,
  open: boolean,
): string {
  return JSON.stringify({ ...readOpenGroups(raw), [id]: open });
}
