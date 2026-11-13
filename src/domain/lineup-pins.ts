import { z } from "zod";
import { cmpId } from "./contracts";

// View state, not dataset state: pins are per team and per imported week, and sync like other view settings.
export const lineupPinsKey = "lineupPins";

const pinsSchema = z
  .object({
    week: z.number().int().min(1).max(18),
    ids: z.array(z.string().max(40)).max(100),
  })
  .strict();
const storeSchema = z.record(z.string().max(40), pinsSchema);
export type LineupPins = z.infer<typeof storeSchema>;

// A malformed or oversized store yields no pins; it is replaced, never partially trusted.
export function readLineupPins(raw?: string): LineupPins {
  if (!raw || raw.length > 32000) return {};
  try {
    return storeSchema.parse(JSON.parse(raw));
  } catch {
    return {};
  }
}

// Pins only apply to the imported week; an older week's entry is treated as empty.
export function pinsFor(raw: string | undefined, team: string, week: number) {
  const entry = readLineupPins(raw)[team];
  return entry && entry.week === week ? entry.ids : [];
}

function write(store: LineupPins) {
  return Object.keys(store).length ? JSON.stringify(store) : "";
}

export function setPin(
  raw: string | undefined,
  team: string,
  week: number,
  id: string,
  on: boolean,
) {
  const store = readLineupPins(raw),
    ids = new Set(pinsFor(raw, team, week));
  if (on) ids.add(id);
  else ids.delete(id);
  // A stale entry is replaced by this week's pins, never merged across weeks.
  if (ids.size) store[team] = { week, ids: [...ids].sort(cmpId) };
  else delete store[team];
  return write(store);
}

export function clearPins(raw: string | undefined, team: string) {
  const store = readLineupPins(raw);
  delete store[team];
  return write(store);
}
