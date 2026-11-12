import { useMemo, useState, type ReactNode } from "react";
import { addDropPairs, pairMoves } from "../../domain/view/add-drop";
import type { ScenarioMove } from "../../domain/roster-scenarios";
import { depthChart, type DepthTile } from "../../domain/view/roster";
import type { PositionGrade } from "../../domain/lineups";
import type { Model, Player } from "../../domain/valuation";
import { starterLineupsKey } from "../../domain/starter-lineups";
import { PlayerName } from "../../ui/PlayerName";
import { PlayerPhoto } from "../../ui/PlayerPhoto";
import { Chip } from "../../ui/primitives";
import { StarterLineupEditor } from "../StarterLineupEditor";
import { SimulationNote } from "./SimulationIssuePopover";

// A grade letter on the shared six-step scale; the letter is always shown, never colour alone.
export function GradeBadge({
  grade,
  tone,
}: {
  grade: string;
  tone: number | null;
}) {
  return (
    <span
      className="gd-grade"
      data-tone={tone ?? "na"}
      title={tone === null ? "Grade unavailable" : `Grade ${grade}`}
    >
      {grade === "n.a." ? "N/A" : grade}
    </span>
  );
}

// The recent-games strip: one bar per played game on the group's scale, with gaps for unrecorded scores and byes marked.
function Strip({ tile, max }: { tile: DepthTile; max: number }) {
  if (tile.strip.length === 0)
    return <span className="gd-strip-na">No games yet</span>;
  return (
    <span
      className="gd-strip"
      role="img"
      aria-label={`Recent scores: ${tile.strip
        .map((s) =>
          s.isBye
            ? "bye"
            : s.points === null
              ? "unavailable"
              : s.points.toFixed(1),
        )
        .join(", ")}`}
    >
      {tile.strip.map((s) => (
        <i
          key={s.week}
          title={`Week ${s.week}: ${s.isBye ? "Bye" : s.points === null ? "unavailable" : s.points.toFixed(1)}`}
          style={{
            height: s.isBye
              ? 6
              : s.points === null
                ? 2
                : `${Math.max(4, (Math.max(0, s.points) / max) * 100)}%`,
            opacity:
              s.isBye || s.points === null
                ? undefined
                : Math.max(0.35, Math.min(1, 0.35 + 0.65 * (s.points / max))),
          }}
          data-gap={s.points === null && !s.isBye ? "" : undefined}
          data-bye={s.isBye ? "" : undefined}
        />
      ))}
    </span>
  );
}

// One roster tile: starters have a yellow edge and solid outline, bench players a faint outline.
export function PlayerTile({
  tile,
  player,
  max,
  onCut,
}: {
  tile: DepthTile;
  player: Player;
  max: number;
  onCut?: (id: string) => void;
}) {
  return (
    <article className="gd-tile" data-role={tile.role} data-player-row="">
      <div className="gd-tile-ident">
        <PlayerPhoto player={player} size={32} />
        <PlayerName
          p={player}
          className="player-link gd-tile-name"
          ariaLabel={`${tile.name} ${tile.pos} · ${tile.nfl}`}
        >
          <b>{tile.name}</b>
          <small>
            {tile.role === "Starter" ? `Starter · ${tile.slot}` : tile.role}
          </small>
        </PlayerName>
      </div>
      <div className="gd-tile-side">
        <span className="gd-tile-eppg">
          <small>EPPG</small>
          {tile.eppg ?? "—"}
        </span>
        {onCut && (
          <button
            type="button"
            className="gd-tile-cut"
            aria-label={`Cut ${tile.name}`}
            title={`Cut ${tile.name} from simulation`}
            onClick={(e) => {
              e.stopPropagation();
              onCut(tile.id);
            }}
          >
            Cut
          </button>
        )}
      </div>
      <Strip tile={tile} max={max} />
      {(tile.labels.length > 0 ||
        (tile.injury && tile.injury !== "Active")) && (
        <span className="gd-tile-badges">
          {tile.labels.slice(0, 3).map((l) => (
            <Chip key={l}>{l}</Chip>
          ))}
          {tile.injury && tile.injury !== "Active" && (
            <Chip tone="warning">{tile.injury}</Chip>
          )}
        </span>
      )}
    </article>
  );
}

// The Roster screen: the simulator, the depth chart for the active roster, and the marked-starters editor.
export function Roster({
  m,
  team,
  grades,
  filters,
  onFilters,
  simulator,
  tryPair,
  onApplyDrop,
  onSwitchToLive,
}: {
  // Applies a cut and an add to a hypothetical roster; returns whether it worked.
  tryPair: (moves: ScenarioMove[]) => boolean;
  m: Model;
  team: string;
  grades: PositionGrade[];
  filters: Record<string, string>;
  onFilters: (patch: Record<string, string>) => void;
  simulator: ReactNode;
  onApplyDrop?: (team: string, playerId: string) => void;
  onSwitchToLive?: () => void;
}) {
  const chart = depthChart(m, team, grades),
    pairs = useMemo(() => addDropPairs(m, team), [m, team]),
    [depthOnly, setDepthOnly] = useState(true),
    [tried, setTried] = useState("");
  const shownPairs = pairs.filter((p) => depthOnly || p.starts === "starts");
  const handleCut = (id: string) => {
    if (tryPair([{ kind: "move", player: id, from: team, to: "0" }])) {
      const p = m.byId.get(id);
      setTried(`Cut ${p?.name ?? id} in simulation.`);
    }
  };
  return (
    <div className="gd-roster">
      {simulator}
      <section aria-label="Add and drop pairs" className="gd-pairs">
        <h2>Add and drop pairs</h2>
        <p className="gd-muted">
          For each available player, the drop that helps your lineup most, using
          your existing drop rules. Gains are Expected PPG per week with a
          spread.
        </p>
        <label className="gd-check">
          <input
            type="checkbox"
            checked={depthOnly}
            onChange={(e) => setDepthOnly(e.target.checked)}
          />
          Show depth-only pickups
        </label>
        {shownPairs.length === 0 ? (
          <p className="gd-muted">No pickup would change your lineup.</p>
        ) : (
          <ul className="gd-pair-list">
            {shownPairs.map((p) => (
              <li key={`${p.addId}-${p.dropId}`} className="gd-pair">
                <span>
                  Add <b>{p.addName}</b> ({p.addPos}), drop <b>{p.dropName}</b>{" "}
                  ({p.dropPos})
                </span>
                <span className="gd-pair-gain">
                  {p.gain.gain === null
                    ? "—"
                    : `${p.gain.gain > 0 ? "+" : ""}${p.gain.gain.toFixed(1)}${p.gain.spread === null ? "" : ` ± ${p.gain.spread.toFixed(1)}`}`}
                </span>
                <Chip tone={p.starts === "starts" ? "positive" : "neutral"}>
                  {p.starts === "starts"
                    ? `Starts at ${p.startsAt}`
                    : "Depth only"}
                </Chip>
                <button
                  type="button"
                  className="gd-pill"
                  onClick={() => {
                    if (tryPair(pairMoves(team, p)))
                      setTried(
                        `Tried ${p.addName} for ${p.dropName} in a simulation.`,
                      );
                  }}
                >
                  Try in a simulation
                </button>
              </li>
            ))}
          </ul>
        )}
        {tried && (
          <p role="status" className="gd-muted">
            {tried}
          </p>
        )}
      </section>
      <section aria-label="Depth chart" className="gd-depth">
        <h2>Depth chart</h2>
        <SimulationNote
          simulation={m.simulation}
          team={team}
          onApplyDrop={onApplyDrop}
          onSwitchToLive={onSwitchToLive}
        />
        {m.simulation &&
          !m.simulation.structuredIssues?.some((i) => i.team === team) && (
            <p className="gd-muted">
              Showing the hypothetical roster “{m.simulation.scenario.name}”.
              Grades and lineups use it everywhere in the app.
            </p>
          )}
        {chart.map((group) => (
          <section key={group.position} className="gd-depth-group">
            <h3>
              {group.position}
              <GradeBadge grade={group.grade} tone={group.tone} />
            </h3>
            {group.tiles.length === 0 ? (
              <p className="gd-muted">No players</p>
            ) : (
              <div className="gd-tiles">
                {group.tiles.map((tile) => (
                  <PlayerTile
                    key={tile.id}
                    tile={tile}
                    player={m.byId.get(tile.id)!}
                    max={group.scaleMax}
                    onCut={m.simulation ? handleCut : undefined}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
        {chart.length === 0 && <p>No players on this roster.</p>}
      </section>
      {/* Starter choices keep their own saved setting; the editor is hidden while a simulation is active, as before. */}
      {!m.simulation && (
        <StarterLineupEditor
          key={`${team}/${m.dataset.hash}/${filters[starterLineupsKey] ?? ""}`}
          m={m}
          team={team}
          filters={filters}
          change={onFilters}
        />
      )}
    </div>
  );
}
