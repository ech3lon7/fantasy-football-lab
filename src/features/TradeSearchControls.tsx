import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, GripVertical } from "lucide-react";
import type { Position } from "../domain/contracts";
import { str } from "../domain/contracts";
import { irAssignments, teamsAssessment } from "../domain/lineups";
import { scenarioLineupBoard } from "../domain/roster-scenarios";
import type { Model } from "../domain/valuation";
import { fmt } from "../ui/components";
import { PlayerName } from "../ui/PlayerName";
import { FilterHelp } from "../ui/FilterHelp";
import { TradePortrait } from "./TradeWorkspace";

// Native disclosures preserve mounted controls and keyboard access while grouping each finder's independent settings.
export function TradeFilterGroup({
  title,
  summary,
  children,
  open = false,
}: {
  title: string;
  summary?: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details
      className="trade-filter-category"
      data-category={title}
      open={open}
    >
      <summary>
        <strong>{title}</strong>
        <small>{summary}</small>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="trade-filter-category-body">{children}</div>
    </details>
  );
}

// Drag payloads are scoped to the owning finder/team; external text and another finder's players cannot change selections.
const playerDrag = "application/x-fantasy-trade-player";
const positionDrag = "application/x-fantasy-trade-position";
export function TradePoolBoard({
  m,
  team,
  pool,
  offering,
  scope,
  move,
  bulk,
  active = true,
}: {
  m: Model;
  team: string;
  pool: string[];
  offering?: string[];
  scope: string;
  move: (id: string, destination: "protected" | "pool" | "offering") => void;
  bulk?: ReactNode;
  active?: boolean;
}) {
  const [over, setOver] = useState("");
  const owned = m.players
    .filter((p) => p.owner === team)
    .sort((a, b) => a.name.localeCompare(b.name));
  const lanes = offering
    ? (["protected", "pool", "offering"] as const)
    : (["protected", "pool"] as const);
  return (
    <section
      className="trade-pool-board"
      aria-label={`${scope} visual player pool`}
    >
      <div className="trade-pool-heading">
        <strong>
          {scope === "Chain" ? "Chain player pool" : "Your player pool"} ·{" "}
          {active ? "Flexible search" : "Fixed offer"}
        </strong>
        {bulk}
      </div>
      {/* Inactive pools never imply protection from the fixed search's existing required-drop rules. */}
      <FilterHelp
        label="Player pool moves"
        help="Drag a card or use Move to. Moving to Tradable pool enables flexible search, which explores subsets of the whole pool and protects other players from offers and drops. Offering edits the manual draft; it is not a required subset in flexible searches. In fixed-offer mode, unoffered players can still appear as proposed required drops."
      >
        <small className="muted">
          Drag or use Move to ·{" "}
          {active
            ? `Pool: ${pool.length}/12`
            : `Offering: ${offering?.length ?? 0}/5`}
        </small>
      </FilterHelp>
      <div className="trade-pool-lanes">
        {lanes.map((lane) => {
          const players = owned.filter((p) =>
            lane === "offering"
              ? offering?.includes(p.id)
              : lane === "pool"
                ? pool.includes(p.id) && !offering?.includes(p.id)
                : !pool.includes(p.id) && !offering?.includes(p.id),
          );
          return (
            <div
              key={lane}
              className={`trade-pool-lane${over === lane ? " is-drop-target" : ""}`}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(playerDrag)) {
                  event.preventDefault();
                  setOver(lane);
                }
              }}
              onDragLeave={() => setOver("")}
              onDrop={(event) => {
                event.preventDefault();
                setOver("");
                try {
                  const value = JSON.parse(
                    event.dataTransfer.getData(playerDrag),
                  );
                  if (
                    value.scope === scope &&
                    value.team === team &&
                    owned.some((p) => p.id === value.id)
                  )
                    move(value.id, lane);
                } catch {
                  /* Ignore unrelated or malformed drag payloads. */
                }
              }}
              aria-label={`${scope} ${lane === "pool" ? "tradable pool" : lane === "protected" && !active ? "not offered" : lane} drop zone`}
            >
              <h4>
                {lane === "pool"
                  ? "Tradable pool"
                  : lane === "offering"
                    ? "Offering"
                    : active
                      ? "Protected"
                      : "Not offered"}{" "}
                <small>({players.length})</small>
              </h4>
              <div className="trade-pool-players">
                {players.map((player) => (
                  <article
                    key={player.id}
                    className="trade-pool-player"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(
                        playerDrag,
                        JSON.stringify({ scope, team, id: player.id }),
                      );
                    }}
                    onDragEnd={() => setOver("")}
                  >
                    <GripVertical size={12} aria-hidden="true" />
                    <TradePortrait player={player} />
                    <div>
                      <PlayerName p={player} />
                      <small>
                        {player.pos} · {player.nfl}
                      </small>
                      <strong className="model">
                        {fmt(player.expected)} EPPG
                      </strong>
                      <select
                        aria-label={`Move ${player.name} in ${scope.toLowerCase()} pool`}
                        value={lane}
                        onChange={(event) =>
                          move(player.id, event.target.value as typeof lane)
                        }
                      >
                        <option value="protected">
                          {active ? "Protected" : "Not offered"}
                        </option>
                        <option value="pool">Tradable pool</option>
                        {offering && <option value="offering">Offering</option>}
                      </select>
                    </div>
                  </article>
                ))}
              </div>
              {!players.length && (
                <small className="muted">Drop a player here</small>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Position chips support the same selection by click, keyboard or drag; only offered/allowed positions can be dropped.
export function TradePositionChips({
  scope,
  positions,
  selected,
  change,
  checkboxLabel,
}: {
  scope: string;
  positions: readonly Position[];
  selected: readonly string[];
  change: (position: Position) => void;
  checkboxLabel?: string;
}) {
  return (
    <div
      className="trade-position-chips"
      role="group"
      aria-label={`${scope} position choices`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(positionDrag))
          event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        try {
          const value = JSON.parse(event.dataTransfer.getData(positionDrag));
          if (
            value.scope === scope &&
            positions.includes(value.position) &&
            !selected.includes(value.position)
          )
            change(value.position);
        } catch {
          /* Ignore unrecognized position drags. */
        }
      }}
    >
      {/* Preserve individual marker-free help for each position while adding native drag support. */}
      {positions.map((position) => (
        <FilterHelp
          key={position}
          label={
            checkboxLabel
              ? `${checkboxLabel} ${position}`
              : `${scope}: ${position}`
          }
          help={
            checkboxLabel
              ? "Receive players at any selected position. The minimum counts players, not distinct positions. If Gem/Pre-gem/Watch is enabled, the same players must satisfy both categories. No position selections means no position restriction."
              : "Click a position to select it, or drag its chip into this row. Each search and chain leg keeps its own position choices."
          }
        >
          {checkboxLabel ? (
            <label
              key={position}
              className="trade-position-choice"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(
                  positionDrag,
                  JSON.stringify({ scope, position }),
                );
              }}
            >
              <input
                type="checkbox"
                aria-label={`${checkboxLabel} ${position}`}
                checked={selected.includes(position)}
                onChange={() => change(position)}
              />
              {position}
            </label>
          ) : (
            <button
              key={position}
              type="button"
              draggable
              aria-pressed={selected.includes(position)}
              onClick={() => change(position)}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(
                  positionDrag,
                  JSON.stringify({ scope, position }),
                );
              }}
            >
              {position}
            </button>
          )}
        </FilterHelp>
      ))}
    </div>
  );
}

// Preview existing domain grades and legal lineups only; it never changes team scopes, trade selections or computes a new forecast.
export function TeamNeedsPreview({
  m,
  teams,
  scope,
  position,
  changePosition,
  initialTeam,
}: {
  m: Model;
  teams: string[];
  scope: string;
  position?: string;
  changePosition?: (position: Position) => void;
  initialTeam?: string;
}) {
  const [chosen, setChosen] = useState("");
  const [previewPosition, setPreviewPosition] = useState("");
  const shownPosition = previewPosition || position;
  const team = teams.includes(chosen)
    ? chosen
    : teams.includes(initialTeam ?? "")
      ? initialTeam!
      : teams[0];
  const grades = useMemo(() => teamsAssessment(m), [m]);
  const board = useMemo(
    () => (team ? scenarioLineupBoard(m, team, m.current, "optimized") : null),
    [m, team],
  );
  const rows = grades.get(team) ?? [];
  const visible =
    board?.roles
      .filter(
        (role) =>
          role.id &&
          (!shownPosition || m.byId.get(role.id)?.pos === shownPosition),
      )
      .slice(0, 4) ?? [];
  const starters = new Set(board?.roles.map((role) => role.id));
  // An IR player is not a usable reserve; keep the preview consistent with the lineup evaluator's IR exclusions.
  const excludedIR = new Set(
    irAssignments(
      m,
      m.players
        .filter((player) => player.owner === team)
        .map((player) => player.id),
    ),
  );
  const reserves = m.players
    .filter(
      (player) =>
        player.owner === team &&
        !starters.has(player.id) &&
        !excludedIR.has(player.id) &&
        (!shownPosition || player.pos === shownPosition),
    )
    .sort((a, b) => (b.expected ?? -Infinity) - (a.expected ?? -Infinity))
    .slice(0, 2);
  return (
    <div className="trade-needs-preview">
      <label className="control">
        <span>Preview team</span>
        <select
          aria-label={`${scope} preview team`}
          value={team ?? ""}
          onChange={(event) => setChosen(event.target.value)}
        >
          {teams.map((id) => (
            <option key={id} value={id}>
              {str(
                m.dataset.tables.ModelTeams.find((t) => str(t.TeamID) === id)
                  ?.TeamName,
              )}
            </option>
          ))}
        </select>
      </label>
      {!teams.length ? (
        <small>No teams selected.</small>
      ) : (
        <>
          <div className="trade-grade-tiles">
            {rows
              .filter((row) => ["QB", "RB", "WR", "TE"].includes(row.position))
              .map((row) => (
                <FilterHelp
                  key={row.position}
                  label={`${row.position} grade`}
                  help={`${row.advice} Grades compare this league's teams; previewing a grade does not enable a filter.`}
                >
                  <button
                    type="button"
                    className={`trade-grade-tile${/^[FDC]/.test(row.grade) ? " is-weak" : ""}${row.position === shownPosition ? " is-selected" : ""}`}
                    aria-pressed={row.position === shownPosition}
                    onClick={() => {
                      setPreviewPosition(row.position);
                      changePosition?.(row.position as Position);
                    }}
                  >
                    <small>{row.position}</small>
                    <strong>{row.grade}</strong>
                  </button>
                </FilterHelp>
              ))}
          </div>
          <div
            className="trade-needs-lineup"
            aria-label={`${scope} current roster preview`}
          >
            {visible.map((role) => {
              const player = m.byId.get(role.id!)!;
              return (
                <article key={role.key}>
                  <small>{role.slot} · starter</small>
                  <TradePortrait player={player} />
                  <PlayerName p={player} />
                  <strong className="model">{fmt(player.expected)} EPPG</strong>
                </article>
              );
            })}
            {reserves.map((player) => (
              <article key={player.id}>
                <small>{player.pos} · reserve</small>
                <TradePortrait player={player} />
                <PlayerName p={player} />
                <strong className="model">{fmt(player.expected)} EPPG</strong>
              </article>
            ))}
          </div>
          <small className="muted">
            Current roster preview · best available · Week {m.current}. Trade
            impact appears in results.
          </small>
        </>
      )}
    </div>
  );
}
