import { useMemo, useState, type ReactNode } from "react";
import { addDropPairs, pairMoves } from "../../domain/view/add-drop";
import type { ScenarioMove } from "../../domain/roster-scenarios";
import { depthChart, type DepthTile } from "../../domain/view/roster";
import type { PositionGrade } from "../../domain/lineups";
import type { Model, Player } from "../../domain/valuation";
import { starterLineupsKey } from "../../domain/starter-lineups";
import { PlayerName } from "../../ui/PlayerName";
import { Chip } from "../../ui/primitives";
import { StarterLineupEditor } from "../StarterLineupEditor";

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

// The recent-games strip: one bar per played game on the group's scale, with gaps for unrecorded scores.
function Strip({ tile, max }: { tile: DepthTile; max: number }) {
  if (tile.strip.length === 0)
    return <span className="gd-strip-na">No games yet</span>;
  return (
    <span
      className="gd-strip"
      role="img"
      aria-label={`Recent scores: ${tile.strip
        .map((s) => (s.points === null ? "unavailable" : s.points.toFixed(1)))
        .join(", ")}`}
    >
      {tile.strip.map((s) => (
        <i
          key={s.week}
          title={`Week ${s.week}: ${s.points === null ? "unavailable" : s.points.toFixed(1)}`}
          style={{
            height:
              s.points === null
                ? 2
                : `${Math.max(4, (Math.max(0, s.points) / max) * 100)}%`,
          }}
          data-gap={s.points === null ? "" : undefined}
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
}: {
  tile: DepthTile;
  player: Player;
  max: number;
}) {
  return (
    <article className="gd-tile" data-role={tile.role} data-player-row="">
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
      <span className="gd-tile-eppg">
        <small>EPPG</small>
        {tile.eppg ?? "—"}
      </span>
      <Strip tile={tile} max={max} />
      {tile.injury && tile.injury !== "Active" && (
        <Chip tone="warning">{tile.injury}</Chip>
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
}: {
  // Applies a cut and an add to a hypothetical roster; returns whether it worked.
  tryPair: (moves: ScenarioMove[]) => boolean;
  m: Model;
  team: string;
  grades: PositionGrade[];
  filters: Record<string, string>;
  onFilters: (patch: Record<string, string>) => void;
  simulator: ReactNode;
}) {
  const chart = depthChart(m, team, grades),
    pairs = useMemo(() => addDropPairs(m, team), [m, team]),
    [depthOnly, setDepthOnly] = useState(true),
    [tried, setTried] = useState("");
  const shownPairs = pairs.filter((p) => depthOnly || p.starts === "starts");
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
        {m.simulation && (
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
            <div className="gd-tiles">
              {group.tiles.map((tile) => (
                <PlayerTile
                  key={tile.id}
                  tile={tile}
                  player={m.byId.get(tile.id)!}
                  max={group.scaleMax}
                />
              ))}
            </div>
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
