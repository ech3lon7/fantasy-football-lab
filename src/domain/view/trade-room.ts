import type { Draft } from "../contracts";
import { chainPositionImpact } from "../chain-position-impact";
import { nextRefreshDefaults } from "../next-refresh";
import { readLineupBasis, tradeImpact } from "../trade-impact";
import type { TradeResult } from "../trades";
import type { Model, Player } from "../valuation";

type Impact = NonNullable<ReturnType<typeof tradeImpact>>["own"];

export type MoveTag =
  | "New"
  | "Up from bench"
  | "Leaves"
  | "To bench"
  | "Unfilled"
  | { shiftedFrom: string };

export interface LineupSlot {
  slot: string;
  id: string | null;
  name: string;
  // Expected PPG for the player; null when unavailable, never zero.
  eppg: string | null;
  // Shown only when something changed for this slot; an unchanged slot has no tag.
  tag: MoveTag | null;
}

export interface LineupMoves {
  week: number;
  before: LineupSlot[];
  after: LineupSlot[];
  // Plain sentences naming who is replaced and who shifts; empty when nothing moves.
  notes: string[];
}

const f1 = (x: number | null | undefined) =>
  x === null || x === undefined || !Number.isFinite(x) ? null : x.toFixed(1);

// Per slot before and after a trade for one team and week, using the same lineups the gain is computed from.
export function lineupMoves(
  m: Model,
  side: Impact,
  week: number,
  outgoing: string[],
  incoming: string[],
): LineupMoves | null {
  const w = side.weekly.find((x) => x.week === week);
  if (!w) return null;
  const slots = w.slots as string[],
    before = w.beforeIds as (string | null)[],
    after = w.ids as (string | null)[];
  const name = (id: string | null) => (id ? (m.byId.get(id)?.name ?? id) : "");
  const eppg = (id: string | null) =>
    id ? f1(m.byId.get(id)?.blendedExpected) : null;
  const beforeSlot = new Map<string, string>();
  before.forEach((id, i) => id && beforeSlot.set(id, slots[i]));
  const afterSet = new Set(after.filter((x): x is string => !!x)),
    beforeSet = new Set(before.filter((x): x is string => !!x));
  const afterRows = after.map((id, i): LineupSlot => {
    let tag: MoveTag | null = null;
    if (!id) tag = "Unfilled";
    else if (incoming.includes(id) && !beforeSet.has(id)) tag = "New";
    else if (!beforeSet.has(id)) tag = "Up from bench";
    else if (beforeSlot.get(id) !== slots[i])
      tag = { shiftedFrom: beforeSlot.get(id)! };
    return { slot: slots[i], id, name: name(id), eppg: eppg(id), tag };
  });
  const beforeRows = before.map((id, i): LineupSlot => {
    let tag: MoveTag | null = null;
    if (id && !afterSet.has(id))
      tag = outgoing.includes(id) ? "Leaves" : "To bench";
    return {
      slot: slots[i],
      id,
      name: name(id),
      eppg: eppg(id),
      tag: id ? tag : null,
    };
  });
  const notes: string[] = [];
  afterRows.forEach((row, i) => {
    if (!row.tag || row.tag === "Unfilled") return;
    if (typeof row.tag === "object")
      notes.push(
        `${row.name} shifts from ${row.tag.shiftedFrom} to ${row.slot}.`,
      );
    else {
      const replaced = before[i];
      notes.push(
        replaced && replaced !== row.id && !afterSet.has(replaced)
          ? `${row.name} ${row.tag === "New" ? "replaces" : "moves up for"} ${name(replaced)} at ${row.slot}.`
          : `${row.name} ${row.tag === "New" ? "joins" : "moves up from the bench"} at ${row.slot}.`,
      );
    }
  });
  return { week, before: beforeRows, after: afterRows, notes };
}

export interface GradeChip {
  position: string;
  before: string;
  after: string;
  // Signed steps on the position grade scale; positive is an upgrade.
  steps: number;
  text: string;
  tone: "positive" | "negative";
}

// Grade-step chips for the positions this trade actually moves; unaffected or ungraded positions return nothing.
export function gradeStepChips(
  m: Model,
  draft: Draft,
  result: TradeResult,
): { own: GradeChip[]; other: GradeChip[] } {
  const impact = chainPositionImpact(m, draft, result);
  const chips = (rows: typeof impact.own) =>
    rows
      .filter((r) => r.stepDelta !== null && r.stepDelta !== 0)
      .map((r): GradeChip => ({
        position: r.position,
        before: r.before,
        after: r.after,
        steps: r.stepDelta!,
        text: `${r.position} ${r.before}→${r.after} ${r.stepDelta! > 0 ? "+" : ""}${r.stepDelta}`,
        tone: r.stepDelta! > 0 ? "positive" : "negative",
      }));
  return { own: chips(impact.own), other: chips(impact.other) };
}

export interface GainSpread {
  // Per-week Expected PPG gain; null when the lineup gain cannot be scored.
  gain: number | null;
  // Square root of the summed squares of the next-refresh spreads of players whose lineup spot changes.
  spread: number | null;
  floor: number | null;
  ceiling: number | null;
  players: string[];
  // Two changed players on one NFL team are not independent, so the range is slightly understated.
  sharesNflTeam: boolean;
  reason: string;
}

// The lineup gain with a range, combining each changed player's spread as an independent value.
export function lineupGainSpread(
  m: Model,
  side: Impact,
  gain: number | null,
): GainSpread {
  const changed = new Set<string>();
  for (const w of side.weekly) {
    const slots = w.slots as string[],
      before = w.beforeIds as (string | null)[],
      after = w.ids as (string | null)[];
    const where = new Map<string, string>();
    before.forEach((id, i) => id && where.set(id, slots[i]));
    const placed = new Map<string, string>();
    after.forEach((id, i) => id && placed.set(id, slots[i]));
    for (const [id, slot] of placed)
      if (where.get(id) !== slot) changed.add(id);
    for (const id of where.keys()) if (!placed.has(id)) changed.add(id);
  }
  const players = [...changed]
    .map((id) => m.byId.get(id))
    .filter((p): p is Player => !!p);
  const spreads = players.map((p) => nextRefreshDefaults(m, p).spread);
  const missing = players.filter((_, i) => spreads[i] === null);
  const sharesNflTeam =
    new Set(players.map((p) => p.nfl)).size < players.length;
  const base = {
    gain,
    players: players.map((p) => p.name),
    sharesNflTeam,
  };
  if (gain === null)
    return {
      ...base,
      spread: null,
      floor: null,
      ceiling: null,
      reason: "The lineup gain cannot be scored.",
    };
  if (players.length === 0)
    return { ...base, spread: null, floor: null, ceiling: null, reason: "" };
  if (missing.length)
    return {
      ...base,
      spread: null,
      floor: null,
      ceiling: null,
      reason: `Spread unavailable for ${missing.map((p) => p.name).join(", ")}.`,
    };
  // Every changed player has a spread here: the missing case returned above.
  const spread = Math.sqrt(
    spreads.reduce<number>((total, s) => total + (s ?? 0) ** 2, 0),
  );
  return {
    ...base,
    spread,
    floor: gain - spread,
    ceiling: gain + spread,
    reason: "",
  };
}

export type VerdictTone = "good" | "bad" | "warn" | "neutral";
export interface Verdict {
  id: "surplus" | "lineup" | "legality" | "uncertainty";
  label: string;
  summary: string;
  tone: VerdictTone;
  detail: string[];
}

// The four separate verdicts. None of them feeds another, and there is no combined score.
export function verdicts(
  m: Model,
  result: TradeResult,
  basis?: string,
): Verdict[] | null {
  if (!result.valid) return null;
  const impact = tradeImpact(result, readLineupBasis(basis))!;
  const spread = lineupGainSpread(m, impact.own, impact.own.expectedPerWeek);
  const surplusTone: VerdictTone =
    result.surplusTest === "UNAVAILABLE"
      ? "neutral"
      : result.surplusTest === "PASS"
        ? "good"
        : "bad";
  const gain = spread.gain;
  return [
    {
      id: "surplus",
      label: "Surplus exchange",
      summary: result.grade,
      tone: surplusTone,
      detail: [
        `Incoming surplus ${result.incoming.toFixed(1)} versus outgoing ${result.outgoing.toFixed(1)}.`,
        `Package test: ${result.surplusTest}${result.surplusTest === "FAIL" ? `, short by ${result.surplusShortfall.toFixed(1)}` : ""}.`,
      ],
    },
    {
      id: "lineup",
      label: "Lineup impact (EPPG)",
      summary:
        gain === null
          ? "Unavailable"
          : `${gain > 0 ? "+" : ""}${gain.toFixed(1)}${spread.spread === null ? "" : ` ± ${spread.spread.toFixed(1)}`}`,
      tone:
        gain === null
          ? "neutral"
          : gain > 0
            ? "good"
            : gain < 0
              ? "bad"
              : "neutral",
      detail: [
        "Lineup gain ± spread, per remaining week.",
        ...(spread.floor !== null && spread.ceiling !== null
          ? [
              `Floor ${spread.floor.toFixed(1)}, expected ${gain!.toFixed(1)}, ceiling ${spread.ceiling.toFixed(1)}.`,
            ]
          : spread.reason
            ? [spread.reason]
            : []),
        ...(spread.sharesNflTeam
          ? [
              "Two players whose lineup spot changes share an NFL team, so this range is slightly understated.",
            ]
          : []),
      ],
    },
    {
      id: "legality",
      label: "Legality",
      summary: result.legality ? "Legal" : "Needs changes",
      tone: result.legality ? "good" : "bad",
      detail: [
        result.dropsA.length + result.dropsB.length > 0
          ? `Required drops: ${[...result.dropsA, ...result.dropsB].map((id) => m.byId.get(id)?.name ?? id).join(", ")}.`
          : "No drops are required.",
      ],
    },
    {
      id: "uncertainty",
      label: "Uncertainty",
      summary: result.uncertainty.length ? "Review" : "Low",
      tone: result.uncertainty.length ? "warn" : "good",
      detail: result.uncertainty.length
        ? result.uncertainty
        : ["No injury, data or baseline concerns were found."],
    },
  ];
}

export interface TapeRow {
  label: string;
  send: string | null;
  receive: string | null;
}

// Side-by-side totals for the players being sent and received; a total is null when any player's value is missing.
export function taleOfTape(m: Model, draft: Draft): TapeRow[] {
  const side = (ids: string[], read: (p: Player) => number | null) => {
    const players = ids
      .map((id) => m.byId.get(id))
      .filter((p): p is Player => !!p);
    const values = players.map(read);
    return players.length === 0 || values.some((v) => v === null)
      ? null
      : (values as number[]).reduce((a, b) => a + b, 0).toFixed(1);
  };
  const row = (label: string, read: (p: Player) => number | null): TapeRow => ({
    label,
    send: side(draft.give, read),
    receive: side(draft.get, read),
  });
  return [
    row("Expected PPG (sum)", (p) => p.blendedExpected),
    row("Value PPG (sum)", (p) => p.value),
    row("Surplus (positive VORP)", (p) => p.positive),
  ];
}
