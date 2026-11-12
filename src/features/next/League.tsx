import { useMemo } from "react";
import type { PositionGrade } from "../../domain/lineups";
import type { Model, Player } from "../../domain/valuation";
import { lineup, roster } from "../../domain/lineups";
import {
  gradeTone,
  leagueColumns,
  leagueGrid,
  positionPlayers,
} from "../../domain/view/roster";
import { usePopovers } from "../../ui/popover/PopoverStack";
import { leaguePower } from "../../domain/view/power";
import { FloorCeilingBar } from "../../ui/primitives";
import {
  DataTable,
  type Column,
  playerColumnName,
  playerColumnExpected,
  playerColumnIndex,
  playerColumnTrend,
  playerColumnInjury,
  PlayerSignals,
} from "../../ui/components";
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
  const { grade, assessment, tiles } = positionPlayers(
    m,
    team,
    grades,
    position,
  );
  const max = Math.max(
    1,
    ...tiles.flatMap((t) =>
      t.strip.flatMap((s) => (s.points === null ? [] : [s.points])),
    ),
  );
  return (
    <div className="gd-popover-body gd-pos-popover">
      <div className="gd-pos-header">
        <h2>
          {teamName} · {position}{" "}
          <GradeBadge grade={grade} tone={gradeTone(grade)} />
        </h2>
        {assessment && (
          <div className="gd-pos-assessment">
            <div className="gd-pos-metrics">
              {assessment.starterValue !== null && (
                <div className="gd-metric-pill">
                  <span className="gd-metric-label">Starter Value</span>
                  <b>{assessment.starterValue.toFixed(1)} PPG</b>
                </div>
              )}
              {assessment.median !== null && (
                <div className="gd-metric-pill">
                  <span className="gd-metric-label">League Median</span>
                  <span>{assessment.median.toFixed(1)} PPG</span>
                </div>
              )}
              {assessment.versus !== null && (
                <div className="gd-metric-pill">
                  <span className="gd-metric-label">vs Median</span>
                  <b className={assessment.versus >= 0 ? "gd-good" : "gd-warn"}>
                    {assessment.versus >= 0 ? "+" : ""}
                    {Math.round(assessment.versus * 100)}%
                  </b>
                </div>
              )}
              {assessment.coverage !== null && (
                <div className="gd-metric-pill">
                  <span className="gd-metric-label">Coverage</span>
                  <span>{Math.round(assessment.coverage * 100)}%</span>
                </div>
              )}
            </div>
            {(assessment.status || assessment.advice) && (
              <p className="gd-pos-advice-text">
                {assessment.status && <strong>{assessment.status}: </strong>}
                {assessment.advice}
              </p>
            )}
          </div>
        )}
      </div>
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
      {tiles.length === 0 && (
        <p className="gd-muted">No players at this position.</p>
      )}
    </div>
  );
}

interface RosterRow {
  player: Player;
  slot: string;
  isStarter: boolean;
}

// Full roster popover built using tokenized player row components with photos and stats.
function TeamRosterPopover({
  m,
  team,
  teamName,
}: {
  m: Model;
  team: string;
  teamName: string;
}) {
  const currentLineup = useMemo(
    () => lineup(m, roster(m, team), m.current),
    [m, team],
  );
  const starterMap = useMemo(() => {
    const map = new Map<string, string>();
    for (let i = 0; i < currentLineup.ids.length; i++) {
      const id = currentLineup.ids[i];
      if (id) map.set(id, currentLineup.slots[i]);
    }
    return map;
  }, [currentLineup]);

  const rosterPlayers = useMemo(() => {
    const teamPlayerList = m.players.filter((p) => p.owner === team);
    return teamPlayerList.map((p) => {
      const slot = starterMap.get(p.id) ?? "Bench";
      return {
        player: p,
        slot,
        isStarter: slot !== "Bench",
      };
    });
  }, [m, team, starterMap]);

  const signalCol: Column<RosterRow> = {
    key: "priority",
    label: "Signal",
    kind: "model",
    value: (r) => -r.player.priority,
    render: (r) => <PlayerSignals p={r.player} />,
  };

  const columns: Column<RosterRow>[] = [
    {
      key: "slot",
      label: "Slot",
      kind: "fact",
      value: (r) => (r.isStarter ? `1-${r.slot}` : `2-Bench`),
      render: (r) => (
        <span className={`gd-slot-pill ${r.isStarter ? "starter" : "bench"}`}>
          {r.slot}
        </span>
      ),
    },
    {
      ...playerColumnName,
      value: (r) => r.player.name,
      render: (r) => playerColumnName.render!(r.player),
    },
    {
      ...playerColumnExpected,
      value: (r) => r.player.expected,
      render: (r) =>
        r.player.expected !== null ? r.player.expected.toFixed(1) : "—",
    },
    {
      ...playerColumnIndex,
      value: (r) => r.player.index,
      render: (r) => (r.player.index !== null ? r.player.index.toFixed(1) : "—"),
    },
    {
      ...playerColumnTrend,
      value: (r) => r.player.trendDelta,
      render: (r) => playerColumnTrend.render!(r.player),
    },
    signalCol,
    {
      ...playerColumnInjury,
      value: (r) => r.player.injury,
      render: (r) => playerColumnInjury.render!(r.player),
    },
    {
      key: "bye",
      label: "Bye",
      kind: "fact",
      value: (r) => r.player.bye,
      render: (r) => <span>{r.player.bye ?? "—"}</span>,
    },
  ];

  return (
    <div className="gd-popover-body gd-full-roster-popover">
      <header className="gd-team-roster-header">
        <div>
          <h2>{teamName}</h2>
          <p className="gd-muted">Full roster · Week {m.current}</p>
        </div>
        <div className="gd-team-roster-stats">
          <div className="gd-metric-pill">
            <span className="gd-metric-label">Roster</span>
            <b>{rosterPlayers.length} players</b>
          </div>
          <div className="gd-metric-pill">
            <span className="gd-metric-label">Starters EPPG</span>
            <b>{currentLineup.expected.toFixed(1)}</b>
          </div>
        </div>
      </header>
      <div className="gd-team-roster-table-wrap">
        <DataTable
          rows={rosterPlayers}
          columns={columns}
          id={(r) => r.player.id}
          playerRows
          initialSort="slot"
        />
      </div>
    </div>
  );
}

// The League screen: every team by position on the grade scale, with Power Ranges and Full Roster popovers.
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
    grid = useMemo(() => leagueGrid(m, grades), [m, grades]),
    power = useMemo(() => leaguePower(m, mine), [m, mine]);

  const powerScale = useMemo(() => {
    const floors = power.flatMap((p) => (p.floor !== null ? [p.floor] : []));
    const ceilings = power.flatMap((p) =>
      p.ceiling !== null ? [p.ceiling] : [],
    );
    if (!floors.length || !ceilings.length) return { min: 0, max: 200 };
    return {
      min: Math.floor(Math.min(...floors) / 10) * 10,
      max: Math.ceil(Math.max(...ceilings) / 10) * 10,
    };
  }, [power]);

  return (
    <div className="gd-league">
      <section aria-label="Grade grid">
        <h2>League grades</h2>
        <p className="gd-muted">
          Modeled starter Value PPG per slot versus the league median. Select a
          grade to see the players behind it, or select a team to view their full roster.
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
              {grid.map((row, line) => (
                <tr
                  key={row.teamId}
                  data-mine={row.teamId === mine || undefined}
                >
                  <th scope="row">
                    <button
                      type="button"
                      className="gd-teamname"
                      aria-label={`${row.name} full roster`}
                      aria-pressed={row.teamId === team}
                      onClick={() => {
                        change(row.teamId);
                        popovers.open({
                          title: `${row.name} · Full roster`,
                          width: 860,
                          render: () => (
                            <TeamRosterPopover
                              m={m}
                              team={row.teamId}
                              teamName={row.name}
                            />
                          ),
                        });
                      }}
                    >
                      <span>{row.name}</span>
                      {row.teamId === mine && (
                        <span className="gd-you-pill">You</span>
                      )}
                    </button>
                  </th>
                  {row.cells.map((cell) => (
                    <td key={cell.position}>
                      <button
                        type="button"
                        className="gd-grade gd-grade-btn"
                        data-tone={cell.tone ?? "na"}
                        // Let the grade grid arrive row by row instead of all at once.
                        style={{ animationDelay: `${Math.min(line, 5) * 40}ms` }}
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
      <section aria-label="Power ranges">
        <h2>Power ranges, this week</h2>
        <p className="gd-muted">
          Each team's starting lineup total in Expected PPG, with a combined
          spread. The last column is the chance your lineup outscores theirs, an
          estimate from past variability and not a prediction.
        </p>
        <div className="gd-grid-wrap">
          <table className="gd-grid gd-power">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Team</th>
                <th scope="col">Floor</th>
                <th scope="col">Expected</th>
                <th scope="col">Ceiling</th>
                <th scope="col">You outscore</th>
              </tr>
            </thead>
            <tbody>
              {power.map((r, i) => (
                <tr key={r.teamId} data-mine={r.mine || undefined}>
                  <td className="gd-power-rank">
                    {r.expected === null ? "—" : i + 1}
                  </td>
                  <th scope="row">
                    <span className="gd-power-team">
                      {r.name}
                      {r.mine && <span className="gd-you-pill">You</span>}
                    </span>
                  </th>
                  <td
                    className="gd-power-num-cell"
                    title={r.reason || undefined}
                  >
                    {r.floor === null ? "—" : r.floor.toFixed(1)}
                  </td>
                  <td className="gd-power-expected-cell">
                    <div className="gd-power-bar-wrap">
                      <FloorCeilingBar
                        range={{
                          floor: r.floor,
                          expected: r.expected,
                          ceiling: r.ceiling,
                        }}
                        scale={powerScale}
                        unavailableReason={r.reason || "Range unavailable"}
                      />
                      <span className="gd-power-num">
                        {r.expected === null ? "—" : r.expected.toFixed(1)}
                      </span>
                    </div>
                  </td>
                  <td
                    className="gd-power-num-cell"
                    title={r.reason || undefined}
                  >
                    {r.ceiling === null ? "—" : r.ceiling.toFixed(1)}
                  </td>
                  <td className="gd-power-chance-cell">
                    {r.mine
                      ? "you"
                      : r.chance === null
                        ? "—"
                        : `${Math.round(r.chance * 100)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
