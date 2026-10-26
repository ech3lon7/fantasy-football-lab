import { useState } from "react";
import { num, type AppState } from "../domain/contracts";
import type { Model } from "../domain/valuation";
import {
  activeRosterScenario,
  appendScenarioMove,
  readRosterScenarios,
  writeRosterScenarios,
  rosterScenariosKey,
  scenarioTeamImpact,
  type RosterScenario,
  type ScenarioMove,
} from "../domain/roster-scenarios";
import { lineup, roster } from "../domain/lineups";
import {
  readStarterLineup,
  starterLineupsKey,
  type StarterAssignments,
} from "../domain/starter-lineups";
import { Panel, TeamsOptions } from "../ui/layout";
import { Metric, fmt, signed } from "../ui/components";
import { StarterLineupEditor } from "./StarterLineupEditor";
import { ScenarioLineupBoards } from "./ScenarioLineupBoards";

// This editor persists move recipes only; the ordinary My Team roster remains a separate live analysis view.
export function RosterSimulator({
  real,
  model,
  state,
  change,
}: {
  real: Model;
  model: Model;
  state: AppState;
  change: (raw: string) => void;
}) {
  const read = readRosterScenarios(state.filters[rosterScenariosKey]),
    collection = read.collection;
  const current = activeRosterScenario(state.filters[rosterScenariosKey]);
  const [name, setName] = useState(""),
    [player, setPlayer] = useState(""),
    [search, setSearch] = useState(""),
    [viewTeam, setViewTeam] = useState(""),
    [message, setMessage] = useState("");
  const team = real.dataset.tables.ModelTeams.some(
    (t) => String(t.TeamID) === viewTeam,
  )
    ? viewTeam
    : state.preferredTeam;
  // All writes enforce the existing total cloud-state budget and report failures without discarding a saved scenario.
  function persist(next: typeof collection) {
    try {
      change(writeRosterScenarios(state, next));
      setMessage("");
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save simulation.");
      return false;
    }
  }
  function update(next: RosterScenario) {
    return persist({
      ...collection,
      scenarios: collection.scenarios.map((s) => (s.id === next.id ? next : s)),
    });
  }
  function move(action: ScenarioMove) {
    if (current) {
      try {
        return update(appendScenarioMove(current, action));
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Could not apply move.");
      }
    }
    return false;
  }
  // Add-and-start is one saved recipe update with ordered undo steps; displaced starters remain on this roster.
  function assign(
    id: string,
    target: number | undefined,
    assignments: StarterAssignments,
  ) {
    if (!current) return false;
    try {
      const p = model.byId.get(id);
      if (!p) throw Error("Player is no longer available in this snapshot.");
      let next = current;
      if (p.owner !== team)
        next = appendScenarioMove(next, {
          kind: "move",
          player: id,
          from: p.owner,
          to: team,
        });
      if (target !== undefined) {
        // Pin the chosen player to the clicked slot; clear only its previous slot and bench the displaced occupant.
        const placed = assignments.map((value, i) =>
          i === target ? id : value === id ? null : value,
        );
        next = appendScenarioMove(next, {
          kind: "lineup",
          team,
          ids: placed.filter((value): value is string => value !== null),
          assignments: placed,
        });
      }
      return update(next);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not assign player.",
      );
      return false;
    }
  }
  const selected = model.byId.get(player);
  // Show the consequence of cuts/pickups themselves, independently of a subsequent trade draft.
  const impact = current ? scenarioTeamImpact(real, model, team) : null;
  return (
    <Panel
      title="Hypothetical roster simulator"
      note="Analysis only. Add anyone in the league, plan cuts/transfers and compare expected scoring; live rosters and player indices stay separate."
    >
      {read.issue && (
        <p className="notice danger">
          {read.issue}
          <button className="subtle" onClick={() => change("")}>
            Clear unreadable simulations
          </button>
        </p>
      )}
      {message && (
        <p role="alert" className="notice danger">
          {message}
        </p>
      )}
      <div className="toolbar">
        <label className="control">
          <span>Simulation</span>
          <select
            aria-label="Roster simulation"
            value={collection.active}
            onChange={(e) => {
              setName("");
              persist({ ...collection, active: e.target.value });
            }}
          >
            <option value="">Live roster</option>
            {collection.scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="control">
          <span>Simulation name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder={current?.name ?? "Name your next moves"}
          />
        </label>
        <button
          className="button primary"
          disabled={!!read.issue}
          onClick={() => {
            const scenario: RosterScenario = {
              id: crypto.randomUUID(),
              name: name.trim() || "New roster scenario",
              team: state.preferredTeam,
              season: num(real.dataset.tables.ModelContext[0].Season),
              sourceHash: real.dataset.hash,
              moves: [],
              cursor: 0,
            };
            persist({
              ...collection,
              active: scenario.id,
              scenarios: [...collection.scenarios, scenario],
            });
            setName("");
            setViewTeam(state.preferredTeam);
          }}
        >
          New simulation
        </button>
        {current && (
          <>
            <button
              className="button"
              onClick={() =>
                update({ ...current, name: name.trim() || current.name })
              }
            >
              Save name
            </button>
            <button
              className="subtle"
              onClick={() =>
                persist({
                  ...collection,
                  active: "",
                  scenarios: collection.scenarios.filter(
                    (s) => s.id !== current.id,
                  ),
                })
              }
            >
              Delete simulation
            </button>
          </>
        )}
      </div>
      {current && (
        <>
          {/* Undo and redo expose every intermediate roster without silently adding waiver players or altering earlier saved trade snapshots. */}
          <div className="toolbar">
            {/* Reuse the analyzer's existing player/package selectors rather than duplicate trade-entry controls. */}
            <a className="button" href="#/trades">
              Force a hypothetical trade
            </a>
            <button
              className="button"
              disabled={!current.cursor}
              onClick={() => update({ ...current, cursor: current.cursor - 1 })}
            >
              Undo move
            </button>
            <button
              className="button"
              disabled={current.cursor === current.moves.length}
              onClick={() => update({ ...current, cursor: current.cursor + 1 })}
            >
              Redo move
            </button>
            <span>
              {current.cursor} / {current.moves.length} moves applied
            </span>
          </div>
          <div className="toolbar">
            <label className="control">
              <span>Simulated team to edit</span>
              <select
                value={team}
                onChange={(e) => setViewTeam(e.target.value)}
              >
                <TeamsOptions d={real.dataset} />
              </select>
            </label>
          </div>
          <div className="toolbar">
            <button
              className="button"
              onClick={() =>
                move({
                  kind: "lineup",
                  team,
                  ids: lineup(
                    model,
                    roster(model, team),
                    model.current,
                    false,
                    false,
                    "expected",
                  ).ids.filter((id): id is string => !!id),
                })
              }
            >
              Optimize current lineup
            </button>
          </div>
          {impact && (
            <div className="three-col sim-impact">
              <Metric
                label="Live expected points / week"
                value={fmt(impact.before)}
              />
              <Metric
                label="Simulated expected points / week"
                value={fmt(impact.after)}
              />
              <Metric
                label="Scenario change / week"
                value={signed(impact.gain)}
              />
            </div>
          )}
          <ScenarioLineupBoards
            key={`${current.id}/${team}`}
            real={real}
            model={model}
            team={team}
            realPlans={state.filters[starterLineupsKey]}
            assign={assign}
            starters={(assignments) =>
              move({
                kind: "lineup",
                team,
                ids: assignments.filter((id): id is string => id !== null),
                assignments,
              })
            }
            cut={(id) =>
              move({ kind: "move", player: id, from: team, to: "0" })
            }
          />
          <details className="sim-advanced">
            <summary>Advanced roster moves</summary>
            <div className="trade-search-controls">
              <label className="control">
                <span>Find a league player</span>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Type a player name"
                />
              </label>
              <label className="control">
                <span>League player</span>
                <select
                  value={player}
                  onChange={(e) => setPlayer(e.target.value)}
                >
                  <option value="">Choose any league player</option>
                  {model.players
                    .filter(
                      (p) =>
                        p.id === player ||
                        p.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.pos} ·{" "}
                        {p.owner === "0"
                          ? "Available"
                          : String(
                              real.dataset.tables.ModelTeams.find(
                                (t) => String(t.TeamID) === p.owner,
                              )?.TeamName,
                            )}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <div className="toolbar">
              <button
                className="button"
                disabled={!selected || selected.owner === team}
                onClick={() =>
                  selected &&
                  move({ kind: "move", player, from: selected.owner, to: team })
                }
              >
                Move player to selected team
              </button>
              <button
                className="button"
                disabled={!selected || selected.owner === "0"}
                onClick={() =>
                  selected &&
                  move({ kind: "move", player, from: selected.owner, to: "0" })
                }
              >
                Cut player to available pool
              </button>
            </div>
          </details>
          <details>
            <summary>Move history</summary>
            <ol>
              {current.moves.map((action, i) => (
                <li key={i}>
                  {i < current.cursor ? "Applied" : "Undone"}:{" "}
                  {action.kind === "move"
                    ? `${model.byId.get(action.player)?.name ?? action.player} → ${action.to === "0" ? "Available / cut" : String(real.dataset.tables.ModelTeams.find((t) => String(t.TeamID) === action.to)?.TeamName)}`
                    : action.kind === "trade"
                      ? `Trade: ${action.give.map((id) => model.byId.get(id)?.name ?? id).join(" + ")} → ${String(real.dataset.tables.ModelTeams.find((t) => String(t.TeamID) === action.teamB)?.TeamName)}; ${action.get.map((id) => model.byId.get(id)?.name ?? id).join(" + ")} → ${String(real.dataset.tables.ModelTeams.find((t) => String(t.TeamID) === action.teamA)?.TeamName)}`
                      : `Starter plan for ${String(real.dataset.tables.ModelTeams.find((t) => String(t.TeamID) === action.team)?.TeamName)}`}
                </li>
              ))}
            </ol>
          </details>
          <p>
            Hypothetical scoring optimizes each week with byes and temporary
            injury absences ignored; IR players remain excluded. The starter
            editor below controls the separate marked-starter comparison.
          </p>
          <details className="sim-advanced">
            <summary>Detailed starter controls</summary>
            <StarterLineupEditor
              key={`${current.id}/${current.cursor}/${team}/${model.dataset.hash}`}
              m={model}
              team={team}
              filters={{
                ...state.filters,
                [starterLineupsKey]: model.simulation?.lineupsRaw ?? "",
              }}
              change={(patch) => {
                const raw = patch[starterLineupsKey];
                // Reset removes this team's saved entry; restore its projected imported starters rather than saving an empty lineup.
                const plan = raw ? JSON.parse(raw).teams[team] : undefined;
                move({
                  kind: "lineup",
                  team,
                  ids: plan?.starters ?? readStarterLineup(model, team).ids,
                  assignments: plan?.assignments,
                });
              }}
            />
          </details>
        </>
      )}
    </Panel>
  );
}
