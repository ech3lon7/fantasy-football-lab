import { useMemo } from "react";
import type { PositionGrade } from "../../domain/lineups";
import type { Model } from "../../domain/valuation";
import {
  gradeTone,
  leagueColumns,
  leagueGrid,
  positionPlayers,
} from "../../domain/view/roster";
import { usePopovers } from "../../ui/popover/PopoverStack";
import { TeamView } from "../views";
import { GradeBadge, PlayerTile } from "./Roster";

// The players behind one grade cell; each opens the player card above this popover.
function PositionList({
  m,
  team,
  teamName,
  position,
  grades,
}: {
  m: Model;
  team: string;
  teamName: string;
  position: string;
  grades: PositionGrade[];
}) {
  const { grade, tiles } = positionPlayers(m, team, grades, position);
  const max = Math.max(
    1,
    ...tiles.flatMap((t) =>
      t.strip.flatMap((s) => (s.points === null ? [] : [s.points])),
    ),
  );
  return (
    <div className="gd-popover-body">
      <h2>
        {teamName} · {position}{" "}
        <GradeBadge grade={grade} tone={gradeTone(grade)} />
      </h2>
      {position === "FLEX" && (
        <p className="gd-muted">Starters filling FLEX; any RB, WR or TE can.</p>
      )}
      <div className="gd-tiles">
        {tiles.map((tile) => (
          <PlayerTile
            key={tile.id}
            tile={tile}
            player={m.byId.get(tile.id)!}
            max={max}
          />
        ))}
      </div>
      {tiles.length === 0 && <p>No players at this position.</p>}
    </div>
  );
}

// The League screen: every team by position on the grade scale, with the full team detail below.
export function League({
  m,
  grades,
  mine,
  team,
  change,
}: {
  m: Model;
  grades: Map<string, PositionGrade[]>;
  mine: string;
  team: string;
  change: (team: string) => void;
}) {
  const popovers = usePopovers(),
    grid = useMemo(() => leagueGrid(m, grades), [m, grades]);
  return (
    <div className="gd-league">
      <section aria-label="Grade grid">
        <h2>League grades</h2>
        <p className="gd-muted">
          Modeled starter Value PPG per slot versus the league median. Select a
          grade to see the players behind it.
        </p>
        <div className="gd-grid-wrap">
          <table className="gd-grid">
            <thead>
              <tr>
                <th scope="col">Team</th>
                {leagueColumns.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row) => (
                <tr
                  key={row.teamId}
                  data-mine={row.teamId === mine || undefined}
                >
                  <th scope="row">
                    <button
                      type="button"
                      className="gd-teamname"
                      aria-pressed={row.teamId === team}
                      onClick={() => change(row.teamId)}
                    >
                      {row.name}
                    </button>
                  </th>
                  {row.cells.map((cell) => (
                    <td key={cell.position}>
                      <button
                        type="button"
                        className="gd-grade gd-grade-btn"
                        data-tone={cell.tone ?? "na"}
                        aria-label={`${row.name} ${cell.position} grade ${cell.grade === "n.a." ? "unavailable" : cell.grade}`}
                        title={cell.reason || `Grade ${cell.grade}`}
                        onClick={() =>
                          popovers.open({
                            title: `${row.name} ${cell.position}`,
                            width: 720,
                            render: () => (
                              <PositionList
                                m={m}
                                team={row.teamId}
                                teamName={row.name}
                                position={cell.position}
                                grades={grades.get(row.teamId) ?? []}
                              />
                            ),
                          })
                        }
                      >
                        {cell.grade === "n.a." ? "N/A" : cell.grade}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {/* The full roster table and position advice stay reachable by choosing a team name above. */}
      <section aria-label="Team detail" className="gd-legacy">
        <TeamView m={m} grades={grades} team={team} change={change} />
      </section>
    </div>
  );
}
