import { nextRefreshDefaults } from "../next-refresh";
import type { Model, Player } from "../valuation";
import { teamColors } from "./nfl-colors";

export interface VersusSide {
  id: string;
  name: string;
  pos: string;
  nfl: string;
  colors: { background: string; ink: string };
}

export interface VersusRow {
  label: string;
  a: string | null;
  b: string | null;
  // Bar lengths on a 0 to 1 scale, relative to the larger of the two; null when that side's value is missing.
  aShare: number | null;
  bShare: number | null;
  better: "a" | "b" | "even" | null;
}

export interface Versus {
  a: VersusSide;
  b: VersusSide;
  rows: VersusRow[];
}

const side = (p: Player): VersusSide => ({
  id: p.id,
  name: p.name,
  pos: p.pos,
  nfl: p.nfl,
  colors: teamColors(p.nfl),
});

// Compare two players on the numbers the player card already shows; higher is better on every row.
export function versus(m: Model, aId: string, bId: string): Versus | null {
  const a = m.byId.get(aId),
    b = m.byId.get(bId);
  if (!a || !b) return null;
  const ra = nextRefreshDefaults(m, a),
    rb = nextRefreshDefaults(m, b);
  const defs: [string, number | null, number | null, number][] = [
    ["Expected PPG", a.blendedExpected, b.blendedExpected, 1],
    ["Floor, next game", ra.lower, rb.lower, 1],
    ["Ceiling, next game", ra.higher, rb.higher, 1],
    ["Recent PPG", a.recent, b.recent, 1],
    ["Value PPG", a.value, b.value, 1],
    ["ESPN season PPG", a.projected, b.projected, 1],
    ["Surplus index", a.index, b.index, 0],
  ];
  const rows = defs.map(([label, x, y, digits]) => {
    const top = Math.max(x ?? 0, y ?? 0);
    // A negative value has no bar; its number is still shown.
    const share = (v: number | null) =>
      v === null ? null : top <= 0 ? 0 : Math.max(0, v) / top;
    return {
      label,
      a: x === null ? null : x.toFixed(digits),
      b: y === null ? null : y.toFixed(digits),
      aShare: share(x),
      bShare: share(y),
      better:
        x === null || y === null ? null : x === y ? "even" : x > y ? "a" : "b",
    } satisfies VersusRow;
  });
  return { a: side(a), b: side(b), rows };
}

// Keep the last two chosen players; adding a third replaces the oldest, and the same player is never added twice.
export function addToVersus(raw: string | undefined, id: string): string[] {
  const ids = (raw ?? "").split(",").filter(Boolean);
  if (ids.includes(id)) return ids.slice(-2);
  return [...ids, id].slice(-2);
}
