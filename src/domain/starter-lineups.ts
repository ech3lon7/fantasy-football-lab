import { z } from "zod";
import { cmpId, n, num, str, sum } from "./contracts";
import type { Model } from "./valuation";
import { available, irAssignments, lineup, roster } from "./lineups";

// Analysis-only starter selections use existing private settings sync, without a database or workbook schema change.
export const starterLineupsKey = "startingLineups";
// Version trade-scoring semantics independently of player valuations and the app's user-managed version.
export const tradeImpactVersion = "roster-potential-primary-3";
// Optional ordered slot IDs preserve manual placement; old saved lineups keep their existing automatic role assignment.
export const starterAssignmentsSchema = z.array(z.string().nullable()).max(100);
export type StarterAssignments = z.infer<typeof starterAssignmentsSchema>;
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
          assignments: starterAssignmentsSchema.optional(),
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

// Use the same fixed slot order as the scorer, retaining empty slots instead of compressing or sorting manual choices.
export function starterTemplate(
  m: Model,
  ids: string[],
  assignments?: StarterAssignments,
) {
  if (!assignments) return lineup(m, ids, m.current, false, true, "expected");
  const counts = starterSlotCounts(m);
  const slots = (
    ["QB", "RB", "WR", "TE", "FLEX", "K", "D/ST"] as const
  ).flatMap((slot) => Array.from({ length: counts[slot] }, () => slot));
  return { slots, ids: [...assignments] };
}

// Reject duplicate, foreign, ineligible or mismatched assignments before saving or using a manual template.
function validateAssignments(
  m: Model,
  ids: string[],
  assignments: StarterAssignments,
) {
  const slots = starterTemplate(m, [], assignments).slots;
  if (
    assignments.length !== slots.length ||
    JSON.stringify(assignments.filter((id) => id !== null).sort(cmpId)) !==
      JSON.stringify([...ids].sort(cmpId))
  )
    return [
      "Saved slot assignments must match the selected starters and league slots.",
    ];
  return assignments.some((id, i) => {
    if (id === null) return false;
    const pos = m.byId.get(id)?.pos;
    return slots[i] === "FLEX"
      ? !pos || !["RB", "WR", "TE"].includes(pos)
      : pos !== slots[i];
  })
    ? ["A player is assigned to an ineligible starter slot."]
    : [];
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
    assignments: StarterAssignments | undefined,
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
      // Slot choices are explicit user state, independent of points, ranking and weekly availability.
      if (saved.assignments) {
        const invalid = validateAssignments(m, ids, saved.assignments);
        errors.push(...invalid);
        if (!invalid.length) assignments = saved.assignments;
      }
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
    assignments,
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
  assignments?: StarterAssignments,
) {
  const errors = validateStarterIds(m, team, ids);
  // Only explicit card edits add assignments; legacy saves, Reset and Optimize retain their existing behavior.
  if (assignments) errors.push(...validateAssignments(m, ids, assignments));
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
    ...(assignments
      ? { assignments: starterAssignmentsSchema.parse(assignments) }
      : {}),
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

// Marked starters stay in their original roles; only departing starters permit bound reserve replacements.
export function directStarterImpact(
  m: Model,
  team: string,
  after: string[],
  incoming: string[],
  raw?: string,
): ReturnType<typeof singleStarterImpact> {
  // Chain step two inherits step one's actual marked roles separately for each week, rather than resetting to imported starters.
  const recipe = m.simulation?.scenario;
  const carried =
    recipe?.cursor === recipe?.weeklyLineupCursor
      ? recipe?.weeklyLineups
      : undefined;
  if (
    carried?.some((plan) => plan.team === team && m.weeks.includes(plan.week))
  ) {
    const context = {
      ...m,
      simulation: {
        ...m.simulation!,
        scenario: { ...m.simulation!.scenario, weeklyLineups: undefined },
      },
    };
    const parts = m.weeks.map((week) => {
      const plan = carried.find(
        (entry) => entry.team === team && entry.week === week,
      );
      const plans = plan
        ? saveStarterLineup(context, team, plan.ids, raw, plan.assignments)
        : raw;
      return directStarterImpact(
        { ...context, weeks: [week] },
        team,
        after,
        incoming,
        plans,
      );
    });
    const unique = (
      key:
        "errors" | "warnings" | "marked" | "replacements" | "promotedIncoming",
    ): string[] => [...new Set(parts.flatMap((part) => part[key]))];
    const total = (key: "expected" | "value"): number | null =>
      parts.some((part) => part[key] === null)
        ? null
        : sum(parts.map((part) => part[key]!));
    const expected = total("expected"),
      value = total("value");
    return {
      ...parts[0],
      source: parts[0].source + " · carried weekly roles",
      errors: unique("errors"),
      warnings: unique("warnings"),
      marked: unique("marked"),
      replacements: unique("replacements"),
      promotedIncoming: unique("promotedIncoming"),
      benchOutgoing: parts[0].benchOutgoing.filter((id) =>
        parts.every((part) => part.benchOutgoing.includes(id)),
      ),
      weekly: parts.flatMap((part) => part.weekly),
      expected,
      value,
      expectedPerWeek: expected === null ? null : expected / parts.length,
      valuePerWeek: value === null ? null : value / parts.length,
    };
  }
  return singleStarterImpact(m, team, after, incoming, raw);
}

// Ordinary one-trade scoring retains its existing implementation; weekly chain carry-forward calls it with one week at a time.
function singleStarterImpact(
  m: Model,
  team: string,
  after: string[],
  incoming: string[],
  raw?: string,
) {
  const selection = readStarterLineup(m, team, raw),
    afterSet = new Set(after);
  const marked = new Set(selection.ids),
    replacements = new Set<string>(),
    promotedIncoming = new Set<string>();
  const template = starterTemplate(m, selection.ids, selection.assignments);
  const allIncoming = [
      ...new Set(incoming.filter((id) => afterSet.has(id))),
    ].sort(cmpId),
    ir = new Set(irAssignments(m, after));
  const errors = [...selection.errors];
  if (
    [...selection.ids, ...allIncoming].some(
      (id) => m.byId.get(id)?.expected == null || m.byId.get(id)?.value == null,
    )
  )
    errors.push(
      "A starter or incoming replacement has unavailable model data; direct scoring is unavailable.",
    );
  // Re-evaluate availability each week, without adding existing bench coverage to a fixed marked-starter plan.
  const weekly = m.weeks.map((week) => {
    const usable = (id: string) => {
      const p = m.byId.get(id);
      return (
        !!p &&
        p.value !== null &&
        p.expected !== null &&
        available(m, p, week) &&
        (week !== m.current || !ir.has(id))
      );
    };
    const beforeIds = template.ids.map((id) =>
      id && available(m, m.byId.get(id)!, week) ? id : null,
    );
    const base = template.ids.map((id) =>
      id && afterSet.has(id) && usable(id) ? id : null,
    );
    const occupied = new Set(base);
    // A reserve is attached only to a departing starter's slot, so a FLEX replacement cannot also upgrade an unrelated TE.
    template.ids.forEach((id, i) => {
      if (!id || afterSet.has(id)) return;
      const slot = template.slots[i];
      const candidate = after
        .map((x) => m.byId.get(x)!)
        .filter(
          (p) =>
            !marked.has(p.id) &&
            !allIncoming.includes(p.id) &&
            !occupied.has(p.id) &&
            usable(p.id) &&
            p.expected! > 0 &&
            (slot === "FLEX"
              ? ["RB", "WR", "TE"].includes(p.pos)
              : p.pos === slot),
        )
        .sort((a, b) => b.expected! - a.expected! || cmpId(a.id, b.id))[0];
      if (candidate) {
        base[i] = candidate.id;
        occupied.add(candidate.id);
      }
    });
    // Match at most five incoming players to distinct anchored roles; optional unused arrivals cannot force a scoring loss.
    let states = new Map<number, { score: number; ids: (string | null)[] }>([
      [0, { score: 0, ids: [] }],
    ]);
    for (let i = 0; i < template.slots.length; i++) {
      const slot = template.slots[i],
        baseline = base[i],
        baselinePoints = baseline ? m.byId.get(baseline)!.expected! : 0;
      // A weaker arrival cannot gain eligibility solely from a surviving starter's future bye; genuine departures remain replaceable.
      const anchor = template.ids[i];
      const upgradeMinimum =
        anchor && afterSet.has(anchor)
          ? m.byId.get(anchor)!.expected!
          : baselinePoints;
      const next = new Map<number, { score: number; ids: (string | null)[] }>();
      const keep = (mask: number, score: number, ids: (string | null)[]) => {
        if (!next.has(mask) || score > next.get(mask)!.score)
          next.set(mask, { score, ids });
      };
      for (const [mask, state] of states) {
        keep(mask, state.score + baselinePoints, [...state.ids, baseline]);
        allIncoming.forEach((id, j) => {
          const p = m.byId.get(id)!;
          if (
            !(mask & (1 << j)) &&
            usable(id) &&
            p.expected! > Math.max(baselinePoints, upgradeMinimum) &&
            (slot === "FLEX"
              ? ["RB", "WR", "TE"].includes(p.pos)
              : p.pos === slot)
          )
            keep(mask | (1 << j), state.score + p.expected!, [
              ...state.ids,
              id,
            ]);
        });
      }
      states = next;
    }
    const post = [...states.values()].reduce((a, b) =>
      b.score > a.score ? b : a,
    );
    post.ids.forEach((id) => {
      if (!id) return;
      if (allIncoming.includes(id)) promotedIncoming.add(id);
      else if (!marked.has(id)) replacements.add(id);
    });
    const score = (ids: (string | null)[], key: "expected" | "value") =>
      sum(ids.map((id) => (id ? (m.byId.get(id)![key] ?? 0) : 0)));
    return {
      week,
      beforeExpected: errors.length ? null : score(beforeIds, "expected"),
      afterExpected: errors.length ? null : post.score,
      expectedGain: errors.length
        ? null
        : post.score - score(beforeIds, "expected"),
      valueGain: errors.length
        ? null
        : score(post.ids, "value") - score(beforeIds, "value"),
      unfilled: post.ids.filter((id) => !id).length,
      beforeIds,
      ids: post.ids,
      slots: template.slots,
    };
  });
  const total = (key: "expectedGain" | "valueGain") =>
    errors.length ? null : sum(weekly.map((w) => w[key]!));
  const expected = total("expectedGain"),
    value = total("valueGain");
  return {
    source:
      selection.source +
      (m.ignoreTemporaryAbsences
        ? " · byes ignored; temporary injury absences ignored; IR excluded"
        : m.ignoreByeWeeks
          ? " · byes ignored"
          : ""),
    savedUTC: selection.savedUTC,
    errors,
    warnings: selection.warnings,
    marked: selection.ids,
    benchOutgoing: roster(m, team).filter(
      (id) => !afterSet.has(id) && !marked.has(id),
    ),
    replacements: [...replacements].sort(cmpId),
    promotedIncoming: [...promotedIncoming].sort(cmpId),
    weekly,
    expected,
    value,
    expectedPerWeek:
      expected === null || !m.weeks.length ? null : expected / m.weeks.length,
    valuePerWeek:
      value === null || !m.weeks.length ? null : value / m.weeks.length,
  };
}

// Optimize both full rosters under identical Expected-PPG, schedule and IR rules; speculative waiver additions never enter this result.
export function rosterPotentialImpact(
  m: Model,
  before: string[],
  after: string[],
  incoming: string[],
) {
  const errors: string[] = [];
  const missing = [...new Set([...before, ...after])].filter((id) => {
    const p = m.byId.get(id);
    return (
      !p ||
      ((p.expected === null || p.value === null) &&
        m.weeks.some((week) => available(m, p, week)))
    );
  });
  if (missing.length)
    errors.push(
      `Roster potential unavailable: missing model data for ${missing.map((id) => m.byId.get(id)?.name ?? id).join(", ")}.`,
    );
  const replacements = new Set<string>(),
    promotedIncoming = new Set<string>();
  // Existing backups and bye coverage are present on both sides, so unchanged lineup improvements cannot become trade gains.
  const weekly = m.weeks.map((week) => {
    const pre = lineup(m, before, week, false, false, "expected"),
      post = lineup(m, after, week, false, false, "expected");
    post.ids.forEach((id) => {
      if (!id) return;
      if (incoming.includes(id)) promotedIncoming.add(id);
      else if (!pre.ids.includes(id)) replacements.add(id);
    });
    return {
      week,
      beforeExpected: errors.length ? null : pre.expected,
      afterExpected: errors.length ? null : post.expected,
      expectedGain: errors.length ? null : post.expected - pre.expected,
      valueGain: errors.length ? null : post.value - pre.value,
      unfilled: post.unfilled,
      beforeIds: pre.ids,
      ids: post.ids,
      slots: post.slots,
    };
  });
  const expected = errors.length
      ? null
      : sum(weekly.map((w) => w.expectedGain!)),
    value = errors.length ? null : sum(weekly.map((w) => w.valueGain!));
  return {
    source:
      "Optimized roster potential (Expected PPG)" +
      (m.ignoreTemporaryAbsences
        ? " · byes ignored; temporary injury absences ignored; IR excluded"
        : m.ignoreByeWeeks
          ? " · byes ignored"
          : ""),
    savedUTC: null,
    errors,
    warnings: [] as string[],
    marked: [] as string[],
    benchOutgoing: before.filter(
      (id) =>
        !after.includes(id) && !weekly.some((w) => w.beforeIds.includes(id)),
    ),
    replacements: [...replacements].sort(cmpId),
    promotedIncoming: [...promotedIncoming].sort(cmpId),
    weekly,
    expected,
    value,
    expectedPerWeek:
      expected === null || !m.weeks.length ? null : expected / m.weeks.length,
    valuePerWeek:
      value === null || !m.weeks.length ? null : value / m.weeks.length,
  };
}
