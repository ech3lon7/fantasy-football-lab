import { cmpId } from "./contracts";
import { irAssignments, roster } from "./lineups";
import { calculateMppg, type MppgResult } from "./mppg";
import { starterSlotCounts } from "./starter-lineups";
import type { Model, Player } from "./valuation";
import { combineSpreads } from "./view/odds";

// The fixed template order every lineup uses: QB, RB, WR, TE, FLEX, K, D/ST.
export const slotOrder = ["QB", "RB", "WR", "TE", "FLEX", "K", "D/ST"] as const;
export type SlotKind = (typeof slotOrder)[number];

export interface FormationSlot {
  slot: SlotKind;
  // Position within the fixed template order.
  index: number;
  playerId: string | null;
}

// Move a roster player into the chosen slot, swapping starters only when both positions fit.
export function moveFormationPlayer(m: Model, team: string, slots: FormationSlot[], id: string, targetIndex: number): FormationSlot[] {
  const player = m.byId.get(id);
  const target = slots.find((slot) => slot.index === targetIndex);
  const source = slots.find((slot) => slot.playerId === id);
  const accepts = (slot: SlotKind, pos: string) => slot === "FLEX" ? ["RB", "WR", "TE"].includes(pos) : slot === pos;
  if (!player || player.owner !== team || irAssignments(m, roster(m, team)).includes(id)) throw Error("Select a player on this roster who is not on IR.");
  if (!target || !accepts(target.slot, player.pos)) throw Error(`${player.name} is not eligible for that slot.`);
  if (source && source.index !== target.index && target.playerId) {
    const displaced = m.byId.get(target.playerId);
    if (!displaced || !accepts(source.slot, displaced.pos)) throw Error("These starters cannot swap because their positions do not fit both slots.");
  }
  return slots.map((slot) => slot.index === target.index ? { ...slot, playerId: id } : source && slot.index === source.index ? { ...slot, playerId: target.playerId } : slot);
}

export interface OptimizeInput {
  // The lineup on screen: ESPN, saved app lineup or a simulation's.
  current: FormationSlot[];
  pins: string[];
}

export interface LineupChange {
  slotIndex: number;
  slot: SlotKind;
  inId: string;
  outId: string | null;
  inName: string;
  outName: string | null;
  gain: number;
  pinned: boolean;
}

export interface OptimizeResult {
  slots: FormationSlot[];
  changes: LineupChange[];
  currentTotal: number;
  optimizedTotal: number;
  gain: number;
  currentSpread: number;
  optimizedSpread: number;
  // Null when no pin is set or the pins cost nothing.
  pinCost: number | null;
  // Pinned players that cannot all start legally; non-empty disables Optimize.
  conflicts: string[];
  unpinnable: { id: string; reason: string }[];
}

const round = (value: number) => Math.round(value * 10) / 10;

// The slot template for this league, in the same order the scoring engine uses.
export function formationTemplate(m: Model): SlotKind[] {
  const counts = starterSlotCounts(m);
  return slotOrder.flatMap((slot) =>
    Array.from({ length: Math.max(0, counts[slot]) }, () => slot),
  );
}

// Slot card labels: RB1/RB2 and WR1/WR2, everything else by name.
export function slotLabels(slots: SlotKind[]): string[] {
  const seen: Partial<Record<SlotKind, number>> = {};
  return slots.map((slot) => {
    const index = (seen[slot] ?? 0) + 1;
    seen[slot] = index;
    return slot === "RB" || slot === "WR" ? `${slot}${index}` : slot;
  });
}

// Why a player cannot be pinned, or null when he can. An imported IR slot, a bye and an injury are explicit reasons.
export function pinBlocker(m: Model, team: string, id: string): string | null {
  const player = m.byId.get(id);
  if (!player || player.owner !== team) return "Not on this team";
  if (player.slot === 21) return "IR";
  const mppg = calculateMppg(m, player);
  if (mppg.value === null) return mppg.reason || "No MPPG this week";
  return irAssignments(m, roster(m, team)).includes(id) ? "IR" : null;
}

interface Candidate {
  player: Player;
  mppg: MppgResult;
}

// Highest-MPPG legal lineup, honouring pins. Greedy is optimal because FLEX accepts any RB, WR or TE.
export function optimizeLineup(
  m: Model,
  team: string,
  input: OptimizeInput,
): OptimizeResult {
  const ids = roster(m, team),
    ir = new Set([
      ...irAssignments(m, ids),
      ...ids.filter((id) => m.byId.get(id)?.slot === 21),
    ]);
  // One MPPG read per player, reused for values, totals and pin reasons.
  const mppgById = new Map<string, MppgResult>();
  for (const id of ids) {
    const player = m.byId.get(id);
    if (player) mppgById.set(id, calculateMppg(m, player));
  }
  const valueOf = (id: string | null) =>
    id ? (mppgById.get(id)?.value ?? null) : null;
  const spreadOf = (id: string | null) =>
    id ? (mppgById.get(id)?.spread ?? null) : null;
  const noPins: OptimizeResult = {
    slots: input.current,
    changes: [],
    currentTotal: 0,
    optimizedTotal: 0,
    gain: 0,
    currentSpread: 0,
    optimizedSpread: 0,
    pinCost: null,
    conflicts: [],
    unpinnable: [],
  };
  const template = formationTemplate(m);
  if (!template.length) return { ...noPins, slots: [] };

  const eligible: Candidate[] = [];
  for (const id of ids) {
    const player = m.byId.get(id),
      mppg = mppgById.get(id);
    if (player && mppg && mppg.value !== null && !ir.has(id))
      eligible.push({ player, mppg });
  }
  const ranked = eligible.sort(
    (a, b) => b.mppg.value! - a.mppg.value! || cmpId(a.player.id, b.player.id),
  );
  const byId = new Map(ranked.map((c) => [c.player.id, c]));

  const unpinnable: { id: string; reason: string }[] = [];
  const pinned: Candidate[] = [];
  for (const id of [...new Set(input.pins)]) {
    const reason = pinBlocker(m, team, id),
      candidate = byId.get(id);
    if (reason === null && candidate) pinned.push(candidate);
    else if (reason !== null) unpinnable.push({ id, reason });
  }
  pinned.sort(
    (a, b) => b.mppg.value! - a.mppg.value! || cmpId(a.player.id, b.player.id),
  );
  const pinnedIds = new Set(pinned.map((c) => c.player.id));

  const assignments: (string | null)[] = template.map(() => null);
  const placed = new Set<string>();
  const conflicts: string[] = [];
  // Pinned players take their position slot first, then FLEX; any overflow is a conflict.
  for (const { player } of pinned) {
    let index = template.findIndex(
      (slot, i) => slot === player.pos && assignments[i] === null,
    );
    if (index < 0 && ["RB", "WR", "TE"].includes(player.pos))
      index = template.findIndex(
        (slot, i) => slot === "FLEX" && assignments[i] === null,
      );
    if (index < 0) conflicts.push(player.id);
    else {
      assignments[index] = player.id;
      placed.add(player.id);
    }
  }

  if (!conflicts.length) {
    // Fill position slots with the best unpinned eligible players, then FLEX.
    const fill = (slot: SlotKind) => {
      for (let i = 0; i < template.length; i++) {
        if (template[i] !== slot || assignments[i] !== null) continue;
        const pick = ranked.find(
          (c) =>
            !placed.has(c.player.id) &&
            !pinnedIds.has(c.player.id) &&
            (slot === "FLEX"
              ? ["RB", "WR", "TE"].includes(c.player.pos)
              : c.player.pos === slot),
        );
        if (pick) {
          assignments[i] = pick.player.id;
          placed.add(pick.player.id);
        }
      }
    };
    for (const slot of ["QB", "RB", "WR", "TE", "K", "D/ST"] as const)
      fill(slot);
    fill("FLEX");
  }

  // Keep an existing FLEX starter there when another selected player can legally exchange into his position slot.
  if (!conflicts.length) {
    const flexIndex = template.indexOf("FLEX");
    const previousFlex = input.current.find((entry) => entry.slot === "FLEX")?.playerId;
    const previousIndex = previousFlex ? assignments.indexOf(previousFlex) : -1;
    const flexPlayer = flexIndex >= 0 ? assignments[flexIndex] : null;
    if (previousIndex >= 0 && previousIndex !== flexIndex && flexPlayer &&
        byId.get(flexPlayer)?.player.pos === template[previousIndex]) {
      assignments[flexIndex] = previousFlex!;
      assignments[previousIndex] = flexPlayer;
    }
  }

  // Slot stability: players who keep starting keep their current index within the position group.
  if (!conflicts.length) {
    for (const slot of slotOrder) {
      const indices = template
        .map((kind, i) => (kind === slot ? i : -1))
        .filter((i) => i >= 0);
      if (!indices.length) continue;
      const current = input.current
        .filter((entry) => entry.slot === slot)
        .map((entry) => entry.playerId);
      const previous = assignments.slice();
      const next: (string | null)[] = indices.map(() => null);
      current.forEach((id, i) => {
        if (id && i < next.length && indices.some((x) => previous[x] === id))
          next[i] = id;
      });
      indices
        .map((i) => previous[i])
        .filter((id): id is string => !!id && !next.includes(id))
        .forEach((id) => {
          const empty = next.indexOf(null);
          if (empty >= 0) next[empty] = id;
        });
      indices.forEach((i, j) => {
        assignments[i] = next[j];
      });
    }
  }

  const total = (slotIds: (string | null)[]) =>
    round(
      slotIds.reduce<number>((sum, id) => sum + (valueOf(id) ?? 0), 0),
    );
  const spread = (slotIds: (string | null)[]) =>
    round(
      combineSpreads(
        slotIds
          .map(spreadOf)
          .filter((s): s is number => s !== null && Number.isFinite(s)),
      ),
    );

  const currentIds = input.current.map((slot) => slot.playerId);
  const optimizedIds = [...assignments];
  const currentTotal = total(currentIds);
  const optimizedTotal = conflicts.length ? currentTotal : total(optimizedIds);
  const currentSpread = spread(currentIds);
  const optimizedSpread = conflicts.length
    ? currentSpread
    : spread(optimizedIds);

  // Follow slot changes through retained starters so each incoming player names the player actually displaced.
  const currentSet = new Set(currentIds.filter((id): id is string => !!id)),
    optimizedSet = new Set(optimizedIds.filter((id): id is string => !!id));
  const incoming = optimizedIds
    .filter((id): id is string => !!id && !currentSet.has(id))
    .sort(
      (a, b) => (valueOf(b) ?? 0) - (valueOf(a) ?? 0) || cmpId(a, b),
    );
  const outgoing = currentIds
    .filter((id): id is string => !!id && !optimizedSet.has(id))
    .sort(
      (a, b) =>
        (valueOf(a) ?? -Infinity) - (valueOf(b) ?? -Infinity) || cmpId(a, b),
    );
  const changes: LineupChange[] =
    !conflicts.length && incoming.length
      ? incoming.map((inId) => {
          const slotIndex = optimizedIds.indexOf(inId);
          const visited = new Set<number>();
          let replacedIndex = slotIndex;
          let outId: string | null = null;
          while (!visited.has(replacedIndex)) {
            visited.add(replacedIndex);
            const occupant = currentIds[replacedIndex];
            if (!occupant) break;
            if (!optimizedSet.has(occupant)) {
              outId = occupant;
              break;
            }
            replacedIndex = optimizedIds.indexOf(occupant);
            if (replacedIndex < 0) break;
          }
          // Consume each outgoing player once, preserving the established ranking as fallback.
          if (!outId) outId = outgoing[0] ?? null;
          if (outId) outgoing.splice(outgoing.indexOf(outId), 1);
          return {
            slotIndex,
            slot: template[slotIndex],
            inId,
            outId,
            inName: m.byId.get(inId)?.name ?? inId,
            outName: outId ? (m.byId.get(outId)?.name ?? outId) : null,
            gain: round((valueOf(inId) ?? 0) - (valueOf(outId) ?? 0)),
            pinned: pinnedIds.has(inId),
          };
        })
      : [];

  // Pin cost compares the pinned best against the same calculation with no pins.
  let pinCost: number | null = null;
  if (pinned.length && !conflicts.length) {
    const free = optimizeLineup(m, team, { current: input.current, pins: [] });
    const cost = round(free.optimizedTotal - optimizedTotal);
    pinCost = cost > 0 ? cost : null;
  }

  return {
    slots: conflicts.length
      ? template.map((slot, index) => ({
          slot,
          index,
          playerId: input.current[index]?.playerId ?? null,
        }))
      : template.map((slot, index) => ({
          slot,
          index,
          playerId: assignments[index],
        })),
    changes,
    currentTotal,
    optimizedTotal,
    gain: round(optimizedTotal - currentTotal),
    currentSpread,
    optimizedSpread,
    pinCost,
    conflicts,
    unpinnable,
  };
}
