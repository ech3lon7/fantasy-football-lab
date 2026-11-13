import { useState, useEffect } from "react";
import { num, type AppState } from "../domain/contracts";
import type { Model } from "../domain/valuation";
import {
  activeRosterScenario,
  appendScenarioMove,
  isReservedSimulationName,
  readRosterScenarios,
  writeRosterScenarios,
  rosterScenariosKey,
  scenarioTeamImpact,
  rosterSaveSlots,
  rosterScenarioDirty,
  loadRosterSnapshot,
  scenarioRosterBase,
  snapshotMatchesScenario,
  type RosterSaveSlot,
  type RosterScenario,
  type ScenarioMove,
} from "../domain/roster-scenarios";
import { lineup, roster } from "../domain/lineups";
import {
  readStarterLineup,
  starterLineupsKey,
  type StarterAssignments,
} from "../domain/starter-lineups";
import { TeamsOptions } from "../ui/layout";
import { Metric, fmt, signed } from "../ui/components";
import { PlayerPhoto } from "../ui/PlayerPhoto";
import { StarterLineupEditor } from "./StarterLineupEditor";
import { ScenarioLineupBoards } from "./ScenarioLineupBoards";

// This editor persists move recipes only; the ordinary My Team roster remains a separate live analysis view.
export function RosterSimulator({
  real,
  model,
  viewTeam,
  onViewTeam,
  state,
  savedRaw,
  change,
  saveSlot,
  clearSlot,
  deleteScenario,
}: {
  real: Model;
  model: Model;
  viewTeam: string;
  onViewTeam: (team: string) => void;
  state: AppState;
  savedRaw?: string;
  change: (raw: string) => boolean;
  saveSlot: (slot: RosterSaveSlot) => boolean;
  clearSlot?: (slot: RosterSaveSlot) => boolean;
  deleteScenario: (id: string) => boolean;
}) {
  const read = readRosterScenarios(state.filters[rosterScenariosKey]),
    collection = read.collection;
  const current = activeRosterScenario(state.filters[rosterScenariosKey]);
  // Local UI state for user inputs, active search, feedback messages, selected roster save slot, switch prompt, and toast notifications
  const [name, setName] = useState(""),
    [player, setPlayer] = useState(""),
    [search, setSearch] = useState(""),
    [message, setMessage] = useState(""),
    [selectedSlot, setSelectedSlot] = useState<RosterSaveSlot>(
      collection.activeSlot ?? 1,
    ),
    [pendingSwitchSlot, setPendingSwitchSlot] = useState<RosterSaveSlot | null>(
      null,
    ),
    [toastMessage, setToastMessage] = useState("");

  // Keep selected slot in sync with external activeSlot updates
  useEffect(() => {
    if (collection.activeSlot && collection.activeSlot !== selectedSlot) {
      setSelectedSlot(collection.activeSlot);
    }
  }, [collection.activeSlot]);

  // Auto-dismiss transient toast notifications after 2.5 seconds
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(""), 2500);
    return () => clearTimeout(timer);
  }, [toastMessage]);
  // Names are working edits too; switching or loading a snapshot restores that recipe's own name.
  useEffect(() => {
    setName(current?.name ?? "");
  }, [current?.id, current?.name]);
  const team = real.dataset.tables.ModelTeams.some(
    (t) => String(t.TeamID) === viewTeam,
  )
    ? viewTeam
    : state.preferredTeam;
  // All writes enforce the existing total cloud-state budget and report failures without discarding a saved scenario.
  function persist(next: typeof collection) {
    try {
      if (!change(writeRosterScenarios(state, next))) return false;
      setMessage("");
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save simulation.");
      return false;
    }
  }
  // Updates the current scenario in the working draft
  function update(next: RosterScenario) {
    return persist({
      ...collection,
      activeSlot: selectedSlot,
      scenarios: collection.scenarios.map((s) =>
        s.id === next.id
          ? {
              ...next,
              baseLineups:
                next.baseLineups ?? state.filters[starterLineupsKey] ?? "",
              baseRoster: next.baseRoster ?? scenarioRosterBase(real),
            }
          : s,
      ),
    });
  }

  // Switches to the specified slot, auto-loading any existing snapshot or resetting to clean live roster
  function switchToSlot(targetSlot: RosterSaveSlot) {
    setSelectedSlot(targetSlot);
    const updatedCollection = { ...collection, activeSlot: targetSlot };
    const hasSnapshot = collection.snapshots?.some(
      (s) => s.scenario.id === current?.id && s.slot === targetSlot,
    );
    if (hasSnapshot && current) {
      try {
        const loadedRaw = loadRosterSnapshot(
          state,
          state.filters[rosterScenariosKey] ?? "",
          current.id,
          targetSlot,
        );
        const parsed = readRosterScenarios(loadedRaw);
        change(
          writeRosterScenarios(state, {
            ...parsed.collection,
            activeSlot: targetSlot,
          }),
        );
      } catch (err) {
        setMessage(
          err instanceof Error ? err.message : "Could not load snapshot.",
        );
      }
    } else {
      persist(updatedCollection);
    }
  }

  // Handles clicking a slot pill: checks for unsaved edits before auto-loading another saved slot
  function handleSelectSlot(targetSlot: RosterSaveSlot) {
    if (targetSlot === selectedSlot) return;
    const targetSnapshot = collection.snapshots?.find(
      (saved) => saved.scenario.id === current?.id && saved.slot === targetSlot,
    );
    const selectedSnapshot = collection.snapshots?.find(
      (saved) =>
        saved.scenario.id === current?.id && saved.slot === selectedSlot,
    );
    const hasUnsavedChanges =
      selectedSnapshot && current
        ? !snapshotMatchesScenario(selectedSnapshot.scenario, current)
        : Boolean(current && current.moves.length > 0);

    // If switching to another saved slot that would overwrite unsaved changes via auto-load, prompt user
    if (targetSnapshot && hasUnsavedChanges) {
      setPendingSwitchSlot(targetSlot);
      return;
    }
    switchToSlot(targetSlot);
  }

  // Clears all roster moves and resets the slot back to the live baseline roster
  function handleClearSlot() {
    if (clearSlot) {
      if (clearSlot(selectedSlot)) {
        setToastMessage(`Slot ${selectedSlot} cleared to live roster.`);
        setMessage("");
      }
    }
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

  const simAdds: string[] = [];
  const simDrops: string[] = [];
  if (current) {
    for (let i = 0; i < current.cursor; i++) {
      const action = current.moves[i];
      if (action.kind === "move") {
        const pName = model.byId.get(action.player)?.name ?? action.player;
        if (action.to === team || action.to === state.preferredTeam) simAdds.push(pName);
        else if (action.from === team || action.from === state.preferredTeam) simDrops.push(pName);
      } else if (action.kind === "trade") {
        const isTeamA = action.teamA === team || action.teamA === state.preferredTeam;
        const isTeamB = action.teamB === team || action.teamB === state.preferredTeam;
        if (isTeamA) {
          action.get.forEach((id) => simAdds.push(model.byId.get(id)?.name ?? id));
          action.give.forEach((id) => simDrops.push(model.byId.get(id)?.name ?? id));
        } else if (isTeamB) {
          action.give.forEach((id) => simAdds.push(model.byId.get(id)?.name ?? id));
          action.get.forEach((id) => simDrops.push(model.byId.get(id)?.name ?? id));
        }
      }
    }
  }

  return (
    <section className="gd-sim" aria-label="Hypothetical roster simulator">
      <h2>Hypothetical roster simulator</h2>
      <p className="gd-muted">
        Analysis only. Add anyone in the league, plan cuts/transfers and compare
        expected scoring; live rosters and player indices stay separate.
      </p>
      {read.issue && (
        <p className="notice danger gd-notice">
          {read.issue}
          <button className="subtle" onClick={() => change("")}>
            Clear unreadable simulations
          </button>
        </p>
      )}
      {message && (
        <p role="alert" className="notice danger gd-notice">
          {message}
        </p>
      )}

      {/* Compact simulator card matching D_GamedayPlus.dc.html */}
      <div
        className="card gd-sim-card"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          padding: "16px",
          borderRadius: "16px",
          background: "var(--gd-surface)",
          border: "2px solid var(--gd-line)",
          marginBottom: "16px",
        }}
      >
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <span className="kick" style={{ margin: 0, color: "var(--gd-muted)", fontSize: "13px", fontWeight: 700, textTransform: "uppercase" }}>
            Simulation
          </span>
          <div className="pills gd-pills" role="group" aria-label="Roster in use" style={{ display: "inline-flex", gap: "6px" }}>
            <button
              type="button"
              className="pill gd-pill"
              aria-pressed={!collection.active}
              style={{
                background: !collection.active ? "var(--gd-selected)" : "transparent",
                color: !collection.active ? "var(--gd-selected-ink)" : "inherit",
              }}
              onClick={() => {
                setName("");
                persist({ ...collection, active: "" });
              }}
            >
              Live roster
            </button>
            {collection.scenarios.map((s) => {
              const isActive = collection.active === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  className="pill gd-pill"
                  aria-pressed={isActive}
                  style={{
                    background: isActive ? "var(--gd-selected)" : "transparent",
                    color: isActive ? "var(--gd-selected-ink)" : "inherit",
                  }}
                  onClick={() => {
                    setName(s.name);
                    persist({ ...collection, active: s.id });
                  }}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
          {/* Naming and validation remain available before creating a simulation. */}
          <div className="toolbar gd-sim-toolbar">
            <label className="control">
              <span>Simulation name</span>
              <input
                aria-label="Simulation name"
                value={name}
                onChange={(e) => {
                  const val = e.target.value;
                  setName(val);
                  if (isReservedSimulationName(val)) {
                    setMessage(
                      "‘Live’ and ‘Live roster’ are reserved for the real roster. Choose another name for your simulation.",
                    );
                    return;
                  }
                  setMessage("");
                  if (current && val.trim())
                    update({ ...current, name: val });
                }}
                maxLength={120}
                placeholder={current?.name ?? "Name your next moves"}
              />
            </label>
          </div>
          <button
            type="button"
            aria-label="New simulation"
            className="pill gd-pill"
            disabled={!!read.issue}
            onClick={() => {
              // Reject reserved names at creation as well as while editing.
              if (isReservedSimulationName(name)) {
                setMessage("‘Live’ and ‘Live roster’ are reserved for the real roster. Choose another name for your simulation.");
                return;
              }
              const scenario: RosterScenario = {
                id: crypto.randomUUID(),
                name: name.trim() || `Simulation ${collection.scenarios.length + 1}`,
                team: state.preferredTeam,
                season: num(real.dataset.tables.ModelContext[0].Season),
                sourceHash: real.dataset.hash,
                baseLineups: state.filters[starterLineupsKey] ?? "",
                baseRoster: scenarioRosterBase(real),
                moves: [],
                cursor: 0,
              };
              persist({
                ...collection,
                active: scenario.id,
                scenarios: [...collection.scenarios, scenario],
              });
              setName("");
              setMessage("");
              onViewTeam(state.preferredTeam);
            }}
          >
            + New
          </button>
          <button
            type="button"
            className="pill gd-pill"
            disabled={!current}
            onClick={() => {
              if (current && saveSlot(selectedSlot)) {
                setToastMessage(`Saved to Slot ${selectedSlot}.`);
              }
            }}
          >
            Save slot
          </button>
          {current && (
            <button
              type="button"
              className="pill gd-pill"
              onClick={() => deleteScenario(current.id)}
            >
              Delete
            </button>
          )}
        </div>

        {current && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13.5px", flexWrap: "wrap" }}>
              <span className="quiet" style={{ color: "var(--gd-muted)", minWidth: "48px" }}>
                Added
              </span>
              {simAdds.length === 0 ? (
                <span className="quiet" style={{ color: "var(--gd-muted)" }}>None</span>
              ) : (
                simAdds.map((pName, i) => (
                  <span
                    key={i}
                    className="lab-pos"
                    style={{
                      background: "rgba(17,128,91,0.2)",
                      color: "var(--gd-positive-ink)",
                      padding: "2px 8px",
                      borderRadius: "6px",
                      fontWeight: 700,
                      fontSize: "12px",
                    }}
                  >
                    <b>+</b> {pName}
                  </span>
                ))
              )}
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13.5px", flexWrap: "wrap" }}>
              <span className="quiet" style={{ color: "var(--gd-muted)", minWidth: "48px" }}>
                Cut or sent away
              </span>
              {simDrops.length === 0 ? (
                <span className="quiet" style={{ color: "var(--gd-muted)" }}>None</span>
              ) : (
                simDrops.map((pName, i) => (
                  <span
                    key={i}
                    className="lab-warn"
                    style={{
                      background: "rgba(217,83,79,0.2)",
                      color: "var(--gd-negative-ink)",
                      padding: "2px 8px",
                      borderRadius: "6px",
                      fontWeight: 700,
                      fontSize: "12px",
                    }}
                  >
                    <b>✕</b> {pName}
                  </span>
                ))
              )}
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginTop: "4px" }}>
              <span className="quiet" style={{ color: "var(--gd-muted)" }}>
                Add a league player
              </span>
              <input
                className="inp"
                style={{
                  padding: "6px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--gd-line)",
                  background: "var(--gd-surface-2)",
                  color: "var(--gd-ink)",
                }}
                placeholder="Type a name to add…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search.trim().length > 1 && (
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {real.players
                    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()) && p.owner !== team)
                    .slice(0, 5)
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="pill gd-pill"
                        style={{ fontSize: "12px" }}
                        onClick={() => {
                          move({ kind: "move", player: p.id, from: p.owner ?? "0", to: team });
                          setSearch("");
                        }}
                      >
                        + {p.name} ({p.pos})
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {current && (
        <details className="gd-disclosure gd-sim-details" style={{ marginTop: "12px", marginBottom: "16px" }}>
          <summary style={{ fontWeight: 700, cursor: "pointer", fontSize: "14px" }}>
            More simulation tools
          </summary>
          <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "14px" }}>
            {/* Three explicit save slots preserve independent recipe checkpoints; ordinary roster edits never overwrite them. */}
            <section aria-label="Roster save slots">
            <div className="roster-slots-header">
              <h3>Roster save slots</h3>
              {/* Transient toast feedback for auto-saves and slot actions */}
              {toastMessage && (
                <div
                  className="slot-toast-notification"
                  role="status"
                  aria-live="polite"
                >
                  {toastMessage}
                </div>
              )}
            </div>
            {/* Dirty switch confirmation prompt */}
            {pendingSwitchSlot !== null && (
              <div
                className="roster-slot-switch-dialog"
                role="alertdialog"
                aria-labelledby="switch-dialog-title"
              >
                <div className="switch-dialog-content">
                  <p id="switch-dialog-title">
                    You have unsaved changes in Slot {selectedSlot}. Save before
                    switching to Slot {pendingSwitchSlot}?
                  </p>
                  <div className="toolbar">
                    <button
                      className="button primary"
                      onClick={() => {
                        if (saveSlot(selectedSlot)) {
                          setToastMessage(`Saved to Slot ${selectedSlot}.`);
                        }
                        switchToSlot(pendingSwitchSlot);
                        setPendingSwitchSlot(null);
                      }}
                    >
                      Save & Switch
                    </button>
                    <button
                      className="button"
                      onClick={() => {
                        switchToSlot(pendingSwitchSlot);
                        setPendingSwitchSlot(null);
                      }}
                    >
                      Discard & Switch
                    </button>
                    <button
                      className="subtle"
                      onClick={() => setPendingSwitchSlot(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
            <p
              role="status"
              className={
                rosterScenarioDirty(
                  savedRaw,
                  state.filters[rosterScenariosKey],
                  current.id,
                )
                  ? "warning-text"
                  : "muted"
              }
            >
              {rosterScenarioDirty(
                savedRaw,
                state.filters[rosterScenariosKey],
                current.id,
              )
                ? "Unsaved changes — click Save to slot to keep this roster."
                : "Current roster is saved."}
            </p>
            <p className="muted">
              Snapshots restore ownership and exact starter slots. Player
              forecasts use the current imported data.
            </p>
            {/* Compact segmented roster save slots: renders a space-saving pill selector and an active action bar */}
            {(() => {
              // Retrieve snapshot data for the currently selected slot to determine active details and load button availability
              const selectedSnapshot = collection.snapshots?.find(
                (saved) =>
                  saved.scenario.id === current.id &&
                  saved.slot === selectedSlot,
              );

              return (
                <div className="roster-slots-container">
                  {/* Segmented horizontal pill strip displaying all 10 slots with saved (●) versus empty (○) indicators */}
                  <div
                    className="roster-slot-pills"
                    role="tablist"
                    aria-label="Select save slot"
                  >
                    {rosterSaveSlots.map((slot) => {
                      const isSaved = Boolean(
                        collection.snapshots?.some(
                          (saved) =>
                            saved.scenario.id === current.id &&
                            saved.slot === slot,
                        ),
                      );
                      const isSelected = selectedSlot === slot;
                      return (
                        <button
                          key={slot}
                          type="button"
                          role="tab"
                          aria-selected={isSelected}
                          aria-label={`Slot ${slot}${isSaved ? " (saved)" : " (empty)"}`}
                          className={`slot-pill ${isSelected ? "active" : ""} ${isSaved ? "has-data" : "empty"}`}
                          onClick={() => handleSelectSlot(slot)}
                        >
                          <span className="slot-pill-label">Slot {slot}</span>
                          <span
                            className={`slot-dot ${isSaved ? "saved" : "empty"}`}
                            aria-hidden="true"
                          >
                            {isSaved ? "●" : "○"}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Unified inspector and action strip showing selected slot info and primary Save/Load triggers */}
                  <div className="roster-slot-action-bar">
                    <div className="slot-info">
                      <div className="slot-header-row">
                        <strong>Slot {selectedSlot}</strong>
                        {selectedSnapshot && (
                          <span className="slot-tag">Saved</span>
                        )}
                      </div>
                      <p
                        className={`slot-desc ${selectedSnapshot ? "" : "empty"}`}
                      >
                        {selectedSnapshot
                          ? selectedSnapshot.scenario.name
                          : "Empty slot"}
                      </p>
                      {selectedSnapshot && (
                        <small className="muted">
                          Saved{" "}
                          {new Date(selectedSnapshot.savedUTC).toLocaleString()}
                        </small>
                      )}
                    </div>

                    <div className="toolbar">
                      <button
                        className="button primary"
                        onClick={() => {
                          if (!name.trim()) {
                            setMessage(
                              "Enter a simulation name before saving.",
                            );
                            return;
                          }
                          if (isReservedSimulationName(name)) {
                            setMessage(
                              "‘Live’ and ‘Live roster’ are reserved for the real roster. Choose another name for your simulation.",
                            );
                            return;
                          }
                          if (saveSlot(selectedSlot)) {
                            setMessage("");
                            setToastMessage(`Saved to Slot ${selectedSlot}.`);
                          }
                        }}
                      >
                        Save to slot {selectedSlot}
                      </button>
                      <button
                        className="button"
                        disabled={!selectedSnapshot}
                        onClick={() => {
                          try {
                            change(
                              loadRosterSnapshot(
                                state,
                                state.filters[rosterScenariosKey] ?? "",
                                current.id,
                                selectedSlot,
                              ),
                            );
                            setToastMessage(`Loaded Slot ${selectedSlot}.`);
                          } catch (error) {
                            setMessage(
                              error instanceof Error
                                ? error.message
                                : "Could not load roster snapshot.",
                            );
                          }
                        }}
                      >
                        Load slot {selectedSlot}
                      </button>
                      {/* Clear slot: wipes all moves and reverts the scenario back to the live baseline roster */}
                      <button
                        className="button"
                        disabled={
                          !selectedSnapshot && current.moves.length === 0
                        }
                        onClick={handleClearSlot}
                      >
                        Clear slot {selectedSlot}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </section>
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
                onChange={(e) => onViewTeam(e.target.value)}
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
            {selected && (
              <div className="sim-selected-player-preview">
                <PlayerPhoto player={selected} size={32} />
                <div className="sim-preview-info">
                  <strong>{selected.name}</strong>
                  <small className="gd-muted">
                    {selected.pos} · {selected.nfl || "FA"} · Owner:{" "}
                    {selected.owner === "0"
                      ? "Available"
                      : String(
                          real.dataset.tables.ModelTeams.find(
                            (t) => String(t.TeamID) === selected.owner,
                          )?.TeamName,
                        )}
                  </small>
                </div>
                <div className="sim-preview-stats">
                  <span>
                    EPPG <b>{fmt(selected.expected)}</b>
                  </span>
                </div>
              </div>
            )}
          </details>
          <details className="sim-advanced">
            <summary>Move history ({current.moves.length})</summary>
            {current.moves.length === 0 ? (
              <p className="gd-muted">
                No moves recorded yet in this simulation.
              </p>
            ) : (
              <ol className="gd-move-history">
                {current.moves.map((action, i) => {
                  const isApplied = i < current.cursor;
                  const canUndoThis = i === current.cursor - 1;
                  return (
                    <li
                      key={i}
                      className={`gd-move-item ${isApplied ? "applied" : "undone"}`}
                    >
                      <span className="gd-move-status">
                        {isApplied ? "Applied" : "Undone"}:
                      </span>{" "}
                      <span className="gd-move-desc">
                        {action.kind === "move"
                          ? `${model.byId.get(action.player)?.name ?? action.player} → ${action.to === "0" ? "Available / cut" : String(real.dataset.tables.ModelTeams.find((t) => String(t.TeamID) === action.to)?.TeamName)}`
                          : action.kind === "trade"
                            ? `Trade: ${action.give.map((id) => model.byId.get(id)?.name ?? id).join(" + ")} → ${String(real.dataset.tables.ModelTeams.find((t) => String(t.TeamID) === action.teamB)?.TeamName)}; ${action.get.map((id) => model.byId.get(id)?.name ?? id).join(" + ")} → ${String(real.dataset.tables.ModelTeams.find((t) => String(t.TeamID) === action.teamA)?.TeamName)}`
                            : `Starter plan for ${String(real.dataset.tables.ModelTeams.find((t) => String(t.TeamID) === action.team)?.TeamName)}`}
                      </span>
                      {canUndoThis && (
                        <button
                          type="button"
                          className="subtle gd-move-undo"
                          onClick={() =>
                            update({ ...current, cursor: current.cursor - 1 })
                          }
                          aria-label={`Undo move ${i + 1}`}
                        >
                          Undo
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
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
          </div>
        </details>
      )}
    </section>
  );
}
