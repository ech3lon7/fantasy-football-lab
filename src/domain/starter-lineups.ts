import { z } from "zod";
import { cmpId, n, num, str, sum } from "./contracts";
import type { Model } from "./valuation";
import { available, irAssignments, lineup, roster } from "./lineups";

// Analysis-only starter selections use existing private settings sync, without a database or workbook schema change.
export const starterLineupsKey = "startingLineups";
const savedSchema = z
  .object({
    version: z.literal(1),
    teams: z.record(
      z.string().max(40),
      z
        .object({
          season: z.number().int(),
          teamName: z.string().max(200),
          week: z.number().int().min(1).max(18),
          savedUTC: z.string().datetime(),
          starters: z.array(z.string().max(40)).max(100),
          roster: z.array(z.string().max(40)).max(100),
        })
        .strict(),
    ),
  })
  .strict();
type Saved = z.infer<typeof savedSchema>;
// Reject malformed saved selections rather than silently counting unknown players as bench or zero points.
const parseSaved = (raw?: string): Saved => {
  if (!raw) return { version: 1, teams: {} };
  if (raw.length > 32000)
    throw Error(
      "Saved starter selections are too large. Reset to the imported lineup.",
    );
  return savedSchema.parse(JSON.parse(raw));
};

// Expose league slot counts once for both validation and the editor's explanations.
export function starterSlotCounts(m: Model) {
  const c = m.dataset.tables.ModelContext[0];
  return {
    QB: num(c.QBSlots),
    RB: num(c.RBSlots),
    WR: num(c.WRSlots),
    TE: num(c.TESlots),
    FLEX: num(c.FlexSlots),
    K: num(c.KSlots),
    "D/ST": num(c.DSTSlots),
  };
}

// Partial lineups are allowed; duplicate/foreign/IR players and impossible position/FLEX assignments are not.
export function validateStarterIds(m: Model, team: string, ids: string[]) {
  const errors: string[] = [],
    slots = starterSlotCounts(m);
  if (new Set(ids).size !== ids.length)
    errors.push("A player cannot start twice.");
  if (ids.some((id) => m.byId.get(id)?.owner !== team))
    errors.push(
      "Starter selections include a player no longer on this team. Review and save the lineup.",
    );
  if (ids.some((id) => m.byId.get(id)?.slot === 21))
    errors.push(
      "IR players cannot be marked Starter. Update their roster status in ESPN and reimport first.",
    );
  const count = (pos: string) =>
    ids.filter((id) => m.byId.get(id)?.pos === pos).length;
  for (const pos of ["QB", "K", "D/ST"] as const)
    if (count(pos) > slots[pos])
      errors.push(`${pos}: at most ${slots[pos]} starters.`);
  if (
    ["RB", "WR", "TE"].reduce(
      (total, pos) =>
        total + Math.max(0, count(pos) - slots[pos as "RB" | "WR" | "TE"]),
      0,
    ) > slots.FLEX
  )
    errors.push(
      "RB/WR/TE starters exceed the position and FLEX slots. Bench a player before promoting another.",
    );
  return errors;
}

// Seed from actual imported ESPN starters, never bench (20), IR (21), or an absent slot.
export function readStarterLineup(m: Model, team: string, raw?: string) {
  const imported = m.dataset.tables.ModelRosters.filter(
    (r) =>
      str(r.TeamID) === team &&
      n(r.LineupSlotID) !== null &&
      ((num(r.LineupSlotID) >= 0 && num(r.LineupSlotID) < 20) ||
        num(r.LineupSlotID) === 23),
  ).map((r) => str(r.PlayerID));
  let ids = imported,
    source = "Imported ESPN lineup",
    savedUTC: string | null = null;
  const errors: string[] = [],
    warnings: string[] = [];
  try {
    const saved = parseSaved(raw).teams[team];
    if (!saved) {
      const assigned = new Map(
        m.dataset.tables.ModelRosters.filter((r) => str(r.TeamID) === team).map(
          (r) => [str(r.PlayerID), r.LineupSlotID],
        ),
      );
      if (roster(m, team).some((id) => n(assigned.get(id)) === null))
        errors.push(
          "Imported starter/bench slots are missing. Mark and save your lineup before relying on direct scoring.",
        );
    }
    if (saved) {
      source = "Saved app lineup";
      savedUTC = saved.savedUTC;
      ids = saved.starters;
      const name = str(
        m.dataset.tables.ModelTeams.find((t) => str(t.TeamID) === team)
          ?.TeamName,
      );
      if (
        saved.season !== num(m.dataset.tables.ModelContext[0].Season) ||
        saved.teamName !== name
      )
        errors.push(
          "This saved lineup belongs to another season or team. Reset to the imported lineup.",
        );
      if (saved.week !== m.current)
        warnings.push(
          `Saved in Week ${saved.week}; review your starters for Week ${m.current}.`,
        );
      if (
        JSON.stringify([...saved.roster].sort(cmpId)) !==
        JSON.stringify(roster(m, team).sort(cmpId))
      )
        warnings.push(
          "Roster changed since this lineup was saved. Review and save your starter selections.",
        );
    }
  } catch {
    errors.push(
      "Saved starter selections are invalid. Reset to the imported lineup.",
    );
  }
  errors.push(...validateStarterIds(m, team, ids));
  if (!ids.length)
    warnings.push(
      "No active starters selected; empty slots score zero. Mark and save your starters to evaluate your planned lineup.",
    );
  return {
    ids: ids.filter((id) => m.byId.get(id)?.owner === team),
    source,
    savedUTC,
    errors,
    warnings,
  };
}

// Save one team's valid plan while preserving every other team's selections and the recorded source dataset.
export function saveStarterLineup(
  m: Model,
  team: string,
  ids: string[],
  raw?: string,
) {
  const errors = validateStarterIds(m, team, ids);
  if (errors.length) throw Error(errors.join(" "));
  const saved = parseSaved(raw);
  saved.teams[team] = {
    season: num(m.dataset.tables.ModelContext[0].Season),
    teamName: str(
      m.dataset.tables.ModelTeams.find((t) => str(t.TeamID) === team)?.TeamName,
    ),
    week: m.current,
    savedUTC: new Date().toISOString(),
    starters: [...ids].sort(cmpId),
    roster: roster(m, team).sort(cmpId),
  };
  const result = JSON.stringify(saved);
  if (result.length > 32000)
    throw Error("Saved starter selections exceed sync space.");
  return result;
}

// Reset only this team; an entirely malformed store can only be recovered by discarding that invalid setting.
export function resetStarterLineup(team: string, raw?: string) {
  let saved: Saved;
  try {
    saved = parseSaved(raw);
  } catch {
    return "";
  }
  delete saved.teams[team];
  return Object.keys(saved.teams).length ? JSON.stringify(saved) : "";
}

// Marked starters anchor direct scoring; reserves do not become hypothetical future starters merely for bye coverage.
export function directStarterImpact(
  m: Model,
  team: string,
  after: string[],
  incoming: string[],
  raw?: string,
) {
  const selection = readStarterLineup(m, team, raw),
    afterSet = new Set(after);
  const survivors = selection.ids.filter((id) => afterSet.has(id));
  const marked = new Set(selection.ids),
    replacements: string[] = [];
  const template = lineup(m, selection.ids, m.current, false, true, "expected");
  const occupied = new Set(survivors),
    ir = new Set(irAssignments(m, after));
  // Promote a named reserve only when a marked starter actually leaves, not to invent future bench scoring losses.
  for (let i = 0; i < template.ids.length; i++) {
    const id = template.ids[i];
    if (!id || afterSet.has(id)) continue;
    const slot = template.slots[i];
    const candidate = after
      .map((x) => m.byId.get(x)!)
      .filter(
        (p) =>
          !occupied.has(p.id) &&
          !ir.has(p.id) &&
          p.value !== null &&
          p.expected !== null &&
          available(m, p, m.current) &&
          (slot === "FLEX"
            ? ["RB", "WR", "TE"].includes(p.pos)
            : p.pos === slot),
      )
      .sort((a, b) => b.expected! - a.expected! || cmpId(a.id, b.id))[0];
    if (candidate) {
      occupied.add(candidate.id);
      if (!incoming.includes(candidate.id)) replacements.push(candidate.id);
    }
  }
  const baseAfter = [...new Set([...survivors, ...replacements])];
  const allIncoming = incoming.filter((id) => afterSet.has(id));
  const currentKept = lineup(m, baseAfter, m.current, false, false, "expected");
  const currentProposed = lineup(
    m,
    [...new Set([...baseAfter, ...allIncoming])],
    m.current,
    false,
    false,
    "expected",
  );
  const departedSlots = template.slots.filter(
    (_, i) => !!template.ids[i] && !afterSet.has(template.ids[i]!),
  );
  const promotedIncoming = allIncoming.filter((id) => {
    const p = m.byId.get(id)!;
    return (
      (currentProposed.expected > currentKept.expected &&
        currentProposed.ids.includes(id)) ||
      departedSlots.some((slot) =>
        slot === "FLEX" ? ["RB", "WR", "TE"].includes(p.pos) : p.pos === slot,
      )
    );
  });
  const candidates = [...new Set([...baseAfter, ...promotedIncoming])];
  const errors = [...selection.errors];
  if (
    [...selection.ids, ...candidates].some(
      (id) => m.byId.get(id)?.expected == null || m.byId.get(id)?.value == null,
    )
  )
    errors.push(
      "A starter or incoming replacement has unavailable model data; direct scoring is unavailable.",
    );
  // Compare scoring for the same selected players; optional incoming upgrades cannot force a worse lineup than keeping them benched.
  const weekly = m.weeks.map((week) => {
    const before = lineup(m, selection.ids, week, false, false, "expected"),
      kept = lineup(m, baseAfter, week, false, false, "expected"),
      proposed = lineup(m, candidates, week, false, false, "expected");
    const post = proposed.expected >= kept.expected ? proposed : kept;
    return {
      week,
      beforeExpected: errors.length ? null : before.expected,
      afterExpected: errors.length ? null : post.expected,
      expectedGain: errors.length ? null : post.expected - before.expected,
      valueGain: errors.length ? null : post.value - before.value,
      unfilled: post.unfilled,
      beforeIds: before.ids,
      ids: post.ids,
      slots: post.slots,
    };
  });
  const total = (key: "expectedGain" | "valueGain") =>
    errors.length ? null : sum(weekly.map((w) => w[key]!));
  const expected = total("expectedGain"),
    value = total("valueGain");
  return {
    source: selection.source,
    savedUTC: selection.savedUTC,
    errors,
    warnings: selection.warnings,
    marked: selection.ids,
    benchOutgoing: roster(m, team).filter(
      (id) => !afterSet.has(id) && !marked.has(id),
    ),
    replacements,
    promotedIncoming,
    weekly,
    expected,
    value,
    expectedPerWeek:
      expected === null || !m.weeks.length ? null : expected / m.weeks.length,
    valuePerWeek:
      value === null || !m.weeks.length ? null : value / m.weeks.length,
  };
}
