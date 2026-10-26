import { z } from "zod";
import { num, str, type AppState, type Dataset, type Draft } from "./contracts";
import type { Model } from "./valuation";
import {
  lineup,
  roster,
  rosterExcess,
  forHypotheticalScoring,
  available,
} from "./lineups";
import {
  directStarterImpact,
  readStarterLineup,
  saveStarterLineup,
  starterTemplate,
  starterAssignmentsSchema,
} from "./starter-lineups";

// Store compact move recipes in existing private settings; never retain another workbook or mutate the live snapshot.
export const rosterScenariosKey = "rosterScenarios";
export const scenarioMoveSchema = z.discriminatedUnion("kind", [
  // A complete exchange is one undoable step, so replay can never apply only half of a forced trade.
  z
    .object({
      kind: z.literal("trade"),
      teamA: z.string(),
      teamB: z.string(),
      give: z.array(z.string()).min(1).max(5),
      get: z.array(z.string()).min(1).max(5),
    })
    .strict(),
  z
    .object({
      kind: z.literal("move"),
      player: z.string(),
      from: z.string(),
      to: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("lineup"),
      team: z.string(),
      ids: z.array(z.string()).max(100),
      // Optional exact slot IDs keep existing saved recipes compatible without reranking new card edits.
      assignments: starterAssignmentsSchema.optional(),
    })
    .strict(),
]);
export const rosterScenarioSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(120),
    season: z.number().int(),
    team: z.string(),
    sourceHash: z.string().max(100),
    moves: z.array(scenarioMoveSchema).max(100),
    cursor: z.number().int().min(0).max(100),
  })
  .strict()
  .refine((s) => s.cursor <= s.moves.length);
const collectionSchema = z
  .object({
    version: z.literal(1),
    active: z.string(),
    scenarios: z.array(rosterScenarioSchema).max(10),
  })
  .strict()
  .refine(
    (c) =>
      new Set(c.scenarios.map((s) => s.id)).size === c.scenarios.length &&
      (!c.active || c.scenarios.some((s) => s.id === c.active)),
  );
export type RosterScenario = z.infer<typeof rosterScenarioSchema>;
export type ScenarioMove = z.infer<typeof scenarioMoveSchema>;
export type ScenarioCollection = z.infer<typeof collectionSchema>;

// Invalid saved recipes remain recoverable rather than silently replacing existing private state.
export function readRosterScenarios(raw?: string): {
  collection: ScenarioCollection;
  issue: string;
} {
  try {
    return {
      collection: raw
        ? collectionSchema.parse(JSON.parse(raw))
        : { version: 1, active: "", scenarios: [] },
      issue: "",
    };
  } catch {
    return {
      collection: { version: 1, active: "", scenarios: [] },
      issue:
        "Saved roster simulations could not be read. Their stored data is preserved; explicitly clear simulations to recover.",
    };
  }
}
export function writeRosterScenarios(
  state: AppState,
  collection: ScenarioCollection,
) {
  // Keep capacity errors actionable while preserving all existing saved scenarios.
  if (collection.scenarios.length > 10)
    throw Error(
      "Ten roster simulations are already saved. Delete an unused simulation before adding or restoring another.",
    );
  const raw = JSON.stringify(collectionSchema.parse(collection));
  if (
    new TextEncoder().encode(
      JSON.stringify(
        { ...state, filters: { ...state.filters, [rosterScenariosKey]: raw } },
        null,
        2,
      ),
    ).length > 64000
  )
    throw Error(
      "Workspace sync storage is full. Remove an unused simulation or saved trade before continuing.",
    );
  return raw;
}
export function activeRosterScenario(raw?: string) {
  const read = readRosterScenarios(raw);
  return read.collection.scenarios.find((s) => s.id === read.collection.active);
}
// Undo/redo moves a cursor; making a new move discards only the abandoned redo branch.
export function appendScenarioMove(
  s: RosterScenario,
  move: ScenarioMove,
): RosterScenario {
  if (s.cursor >= 100)
    throw Error(
      "This simulation has reached its 100-move limit. Create another simulation to continue.",
    );
  return rosterScenarioSchema.parse({
    ...s,
    moves: [...s.moves.slice(0, s.cursor), move],
    cursor: s.cursor + 1,
  });
}

// Force bypasses price and lineup verdicts, but still requires two real fantasy teams and distinct currently owned players.
export function scenarioTradeErrors(m: Model, draft: Draft) {
  const teams = new Set(m.dataset.tables.ModelTeams.map((t) => str(t.TeamID)));
  const selected = [...draft.give, ...draft.get];
  const errors: string[] = [];
  if (
    !teams.has(draft.teamA) ||
    !teams.has(draft.teamB) ||
    draft.teamA === draft.teamB
  )
    errors.push("Choose two different fantasy teams.");
  if (
    ![draft.give, draft.get].every((ids) => ids.length >= 1 && ids.length <= 5)
  )
    errors.push("Choose one to five players on each side.");
  if (new Set(selected).size !== selected.length)
    errors.push("A player cannot appear twice in the trade.");
  if (
    draft.give.some((id) => m.byId.get(id)?.owner !== draft.teamA) ||
    draft.get.some((id) => m.byId.get(id)?.owner !== draft.teamB)
  )
    errors.push(
      "Trade selections must match current simulated ownership. No players were moved.",
    );
  return errors;
}

// Store an explicitly completed trade without evaluating acceptance or making automatic drops/waiver additions.
export function appendScenarioTrade(
  m: Model,
  scenario: RosterScenario,
  draft: Draft,
) {
  const errors = scenarioTradeErrors(m, draft);
  if (scenario.season !== num(m.dataset.tables.ModelContext[0].Season))
    errors.push(
      "Create a simulation for the current season before forcing a trade.",
    );
  if (errors.length) throw Error(errors.join(" "));
  return appendScenarioMove(scenario, {
    kind: "trade",
    teamA: draft.teamA,
    teamB: draft.teamB,
    give: [...draft.give],
    get: [...draft.get],
  });
}
export const sourceDataset = (m: Model): Dataset =>
  m.simulation?.sourceDataset ?? m.dataset;

// Compare live and simulated lineups with their own ownership/IR state, using the same per-week Expected PPG optimizer.
export function scenarioTeamImpact(
  real: Model,
  projected: Model,
  team: string,
) {
  const before = roster(real, team),
    after = roster(projected, team);
  // Ignore byes and temporary absences on both sides, so an unchanged scenario cannot create a scoring gain.
  const baseline = projected.ignoreTemporaryAbsences
    ? forHypotheticalScoring(real)
    : real;
  // Excluded IR players cannot invalidate potential totals; usable candidates with missing forecasts still block scoring.
  const incomplete = (model: Model, ids: string[]) =>
    ids.some((id) => {
      const p = model.byId.get(id);
      return (
        !p ||
        ((p.expected === null || p.value === null) &&
          model.weeks.some((week) => available(model, p, week)))
      );
    });
  const missing = incomplete(baseline, before) || incomplete(projected, after);
  const weekly = real.weeks.map((week) => ({
    week,
    before: lineup(baseline, before, week, false, false, "expected").expected,
    after: lineup(projected, after, week, false, false, "expected").expected,
  }));
  if (missing || !weekly.length)
    return { before: null, after: null, gain: null };
  const live = weekly.reduce((total, w) => total + w.before, 0) / weekly.length;
  const simulated =
    weekly.reduce((total, w) => total + w.after, 0) / weekly.length;
  return { before: live, after: simulated, gain: simulated - live };
}

// Both visual boards use the existing scoring engines; marked cards retain assigned roles even on a bye.
export function scenarioLineupBoard(
  m: Model,
  team: string,
  week: number,
  mode: "optimized" | "marked",
  raw?: string,
) {
  const owned = roster(m, team);
  const selected =
    mode === "marked" ? directStarterImpact(m, team, owned, [], raw) : null;
  const marked = selected?.weekly.find((w) => w.week === week);
  const best = lineup(m, owned, week, false, false, "expected");
  // Display saved assignments independently of weekly availability: a bye cannot silently bench a chosen starter.
  // Scoring still uses the availability-aware marked result below; edits retain other unavailable starters too.
  const assigned = selected
    ? starterTemplate(
        m,
        selected.marked,
        readStarterLineup(m, team, raw).assignments,
      )
    : best;
  const ids = assigned.ids;
  const slots = assigned.slots;
  const used = new Set(ids.filter(Boolean));
  const counts = new Map<string, number>();
  const roles = slots.map((slot, i) => {
    const ordinal = (counts.get(slot) ?? 0) + 1;
    counts.set(slot, ordinal);
    return { key: `${slot}-${ordinal}`, slot, ordinal, id: ids[i] ?? null };
  });
  const issues = selected
    ? [...selected.errors, ...selected.warnings]
    : owned.some(
          // An excluded IR card has no scoring contribution; missing data for an eligible player remains unavailable.
          (id) =>
            available(m, m.byId.get(id)!, week) &&
            (m.byId.get(id)?.expected == null || m.byId.get(id)?.value == null),
        )
      ? ["Incomplete roster scoring data; optimized score is unavailable."]
      : [];
  return {
    roles,
    ids: ids.filter((id): id is string => !!id),
    reserves: owned
      .filter((id) => !used.has(id))
      .sort(
        (a, b) =>
          m.byId.get(a)!.pos.localeCompare(m.byId.get(b)!.pos) ||
          (m.byId.get(b)!.expected ?? -Infinity) -
            (m.byId.get(a)!.expected ?? -Infinity) ||
          a.localeCompare(b),
      ),
    expected: selected
      ? (marked?.beforeExpected ?? null)
      : issues.length
        ? null
        : best.expected,
    issues,
    markedIds: readStarterLineup(m, team, raw).ids,
  };
}

// This small non-security stamp identifies projected UI caches; full recipe text also participates in analysis identity.
function stamp(text: string) {
  let hash = 2166136261;
  for (const c of text) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}

// Apply ownership and starter changes after valuation: actuals, forecasts, indices and live replacement pools stay fixed.
export function applyRosterScenario(
  real: Model,
  input?: RosterScenario,
  lineupsRaw?: string,
): Model {
  if (!input) return real;
  const scenario = rosterScenarioSchema.parse(input),
    issues: string[] = [];
  const m: Model = {
    // Set both availability policies before replaying moves; all workers and saved scenarios share the same assumptions.
    ...forHypotheticalScoring(real),
    players: real.players.map((p) => ({ ...p, raw: { ...p.raw } })),
    dataset: { ...real.dataset, tables: { ...real.dataset.tables } },
  };
  m.byId = new Map(m.players.map((p) => [p.id, p]));
  const teams = new Set(
    real.dataset.tables.ModelTeams.map((t) => str(t.TeamID)),
  );
  let plans = lineupsRaw ?? "";
  if (scenario.season !== num(real.dataset.tables.ModelContext[0].Season))
    issues.push(
      "This simulation belongs to a different season. Its moves were not applied.",
    );
  else
    for (const [i, move] of scenario.moves
      .slice(0, scenario.cursor)
      .entries()) {
      if (move.kind === "move") {
        const p = m.byId.get(move.player);
        if (!p || (move.to !== "0" && !teams.has(move.to))) {
          issues.push(`Move ${i + 1}: player or destination no longer exists.`);
          continue;
        }
        if (p.owner === move.to) continue;
        if (p.owner !== move.from) {
          issues.push(
            `Move ${i + 1}: ${p.name} changed ownership in the latest import. Move skipped; review it.`,
          );
          continue;
        }
        // Intermediate plans can be illegal, but cutting a protected player must remain an explicit warning.
        if (move.to === "0" && !p.droppable)
          issues.push(
            `Move ${i + 1}: ${p.name} is undroppable; this cut is hypothetical and cannot be executed as shown.`,
          );
        p.owner = move.to;
        p.slot = 20;
        p.raw.OnTeamID = move.to;
      } else if (move.kind === "trade") {
        // A fully reflected refreshed trade is idempotent; conflicting/partial ownership skips the whole exchange.
        const completed = !scenarioTradeErrors(m, {
          ...move,
          teamA: move.teamB,
          teamB: move.teamA,
        }).length;
        const invalid = scenarioTradeErrors(m, move);
        if (!completed && invalid.length) {
          issues.push(`Trade ${i + 1}: ${invalid.join(" ")}`);
          continue;
        }
        // Capture existing roles before exchanging ownership; only departures are cleared, preserving every unrelated manual slot.
        const previous = [move.teamA, move.teamB].map((team) => {
          const saved = readStarterLineup(m, team, plans);
          return {
            team,
            template: starterTemplate(m, saved.ids, saved.assignments),
          };
        });
        if (!completed) {
          for (const [ids, destination] of [
            [move.give, move.teamB],
            [move.get, move.teamA],
          ] as const)
            for (const id of ids) {
              const player = m.byId.get(id)!;
              player.owner = destination;
              player.raw.OnTeamID = destination;
              player.slot = 20;
            }
        }
        // New arrivals stay on the bench. Illegal intermediate roster sizes are reported below, never silently repaired.
        for (const { team, template } of previous) {
          const assignments = template.ids.map((id) =>
            id && m.byId.get(id)?.owner === team ? id : null,
          );
          try {
            plans = saveStarterLineup(
              m,
              team,
              assignments.filter((id): id is string => id !== null),
              plans,
              assignments,
            );
          } catch (error) {
            issues.push(
              `Trade ${i + 1}: ${error instanceof Error ? error.message : "Review starter assignments."}`,
            );
          }
        }
      } else {
        try {
          plans = saveStarterLineup(
            m,
            move.team,
            move.ids,
            plans,
            move.assignments,
          );
        } catch (error) {
          issues.push(
            `Lineup ${i + 1}: ${error instanceof Error ? error.message : "Invalid starters"}`,
          );
        }
      }
    }
  // Rebuild only projected ownership/roster rows; the real tables and recorded evidence remain untouched.
  m.dataset.tables.ModelPlayers = m.players.map((p) => p.raw);
  m.dataset.tables.ModelRosters = m.players
    .filter((p) => p.owner !== "0")
    .map((p) => ({
      TeamID: p.owner,
      PlayerID: p.id,
      LineupSlotID: p.slot ?? null,
    }));
  for (const team of teams) {
    const ids = roster(m, team),
      excess = rosterExcess(m, ids);
    if (excess > 0)
      issues.push(
        `${str(real.dataset.tables.ModelTeams.find((t) => str(t.TeamID) === team)?.TeamName)} has an unresolved roster/position limit (${excess}).`,
      );
  }
  const signature = JSON.stringify(scenario);
  // Stay within the existing hash-field limit even for an unusually long imported source identifier.
  m.dataset.hash =
    real.dataset.hash.slice(0, 84) +
    ":s:" +
    stamp(real.dataset.hash + signature);
  m.analysisVersion += ":hypothetical-potential-2:simulation:" + signature;
  m.simulation = {
    scenario,
    sourceDataset: real.dataset,
    issues,
    lineupsRaw: plans,
    rebased: scenario.sourceHash !== real.dataset.hash,
  };
  return m;
}

// One explicit My team selection drives your roster and outgoing side; browsing opponents never calls this helper.
export function selectMyTeam(
  state: AppState,
  dataset: Dataset,
  team: string,
): AppState {
  if (!dataset.tables.ModelTeams.some((t) => str(t.TeamID) === team))
    return state;
  const teamB =
    state.draft.teamB !== team
      ? state.draft.teamB
      : str(
          dataset.tables.ModelTeams.find((t) => str(t.TeamID) !== team)?.TeamID,
        );
  return {
    ...state,
    preferredTeam: team,
    draft: {
      ...state.draft,
      teamA: team,
      teamB,
      give: state.draft.teamA === team ? state.draft.give : [],
      get: state.draft.teamB === teamB ? state.draft.get : [],
    },
  };
}
