import { useEffect, useRef, useState } from "react";
import { ArrowRight, Shield, UserRound, X } from "lucide-react";
import type { Model, Player } from "../domain/valuation";
import { available, forHypotheticalScoring } from "../domain/lineups";
import { scenarioLineupBoard } from "../domain/roster-scenarios";
import {
  readStarterLineup,
  type StarterAssignments,
} from "../domain/starter-lineups";
import { fmt } from "../ui/components";
import { PlayerName } from "../ui/PlayerName";

// Use public ESPN player portraits, with the app's icon set when unavailable; portraits never determine player identity or scoring.
function Portrait({ player }: { player: Player }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="sim-portrait" aria-hidden="true">
      {Number(player.id) > 0 && !failed ? (
        <img
          alt=""
          loading="lazy"
          src={`https://a.espncdn.com/i/headshots/nfl/players/full/${player.id}.png`}
          onError={() => setFailed(true)}
        />
      ) : player.pos === "D/ST" ? (
        <Shield size={32} />
      ) : (
        <UserRound size={32} />
      )}
    </div>
  );
}

// Card actions edit only the hypothetical recipe; names continue to open the existing player-detail popover.
function PlayerCard({
  m,
  id,
  week,
  changed,
  added,
  leaving,
  action,
  inspect = true,
}: {
  m: Model;
  id: string;
  week: number;
  changed?: boolean;
  added?: boolean;
  leaving?: boolean;
  action?: { label: string; run: () => void };
  inspect?: boolean;
}) {
  const p = m.byId.get(id)!;
  return (
    <article
      className={`sim-player-card${changed ? " sim-card-changed" : ""}`}
      aria-label={`${p.name}${added ? ", added" : leaving ? ", leaving" : ""}`}
    >
      <div className="sim-player-top">
        <Portrait key={p.id} player={p} />
        <div>
          <small>
            {p.pos} · {p.nfl || "NFL team unavailable"}
          </small>
          {inspect ? <PlayerName p={p} /> : <strong>{p.name}</strong>}
          {(added || leaving) && (
            <small className="sim-change-label">
              {added ? "Added to roster" : "Leaves roster"}
            </small>
          )}
        </div>
      </div>
      <div className="sim-player-stats">
        <span>
          Actual PPG<strong className="fact">{fmt(p.actual)}</strong>
        </span>
        <span>
          Expected PPG<strong className="model">{fmt(p.expected)}</strong>
        </span>
        <span>
          Surplus index<strong className="model">{fmt(p.index)}</strong>
        </span>
      </div>
      <div className="sim-player-status">
        <span className="fact">{p.injury}</span>
        {p.bye === week ? (
          <span>
            Bye · Week {week}
            {m.ignoreByeWeeks ? " · ignored in simulation" : ""}
          </span>
        ) : !available(m, p, week) ? (
          <span>Unavailable · Week {week}</span>
        ) : null}
      </div>
      {action && (
        <button
          className="subtle sim-card-action"
          aria-label={action.label}
          onClick={action.run}
        >
          Cut player
        </button>
      )}
    </article>
  );
}

// Side-by-side cards share a week and scoring basis; mobile tabs show the same two boards without shrinking the cards.
export function ScenarioLineupBoards({
  real,
  model,
  team,
  realPlans,
  assign,
  starters,
  cut,
}: {
  real: Model;
  model: Model;
  team: string;
  realPlans?: string;
  assign: (
    id: string,
    target: number | undefined,
    assignments: StarterAssignments,
  ) => boolean;
  starters: (assignments: StarterAssignments) => boolean;
  cut: (id: string) => void;
}) {
  // Reopening a manual plan shows its exact saved slots; optimization remains an explicit separate view.
  const [mode, setMode] = useState<"optimized" | "marked">(() =>
      readStarterLineup(model, team, model.simulation?.lineupsRaw ?? realPlans)
        .assignments
        ? "marked"
        : "optimized",
    ),
    [selectedWeek, setWeek] = useState(model.current),
    [tab, setTab] = useState("after");
  const week = model.weeks.includes(selectedWeek)
    ? selectedWeek
    : model.current;
  // The live-roster comparison uses the same hypothetical scoring policy as the edited roster.
  const baseline = model.ignoreTemporaryAbsences
    ? forHypotheticalScoring(real)
    : real;
  const before = scenarioLineupBoard(baseline, team, week, mode, realPlans),
    after = scenarioLineupBoard(
      model,
      team,
      week,
      mode,
      model.simulation?.lineupsRaw ?? realPlans,
    );
  const [target, setTarget] = useState<{
      slot: string;
      index?: number;
    } | null>(null),
    [search, setSearch] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const original = new Set(
      real.players.filter((p) => p.owner === team).map((p) => p.id),
    ),
    projected = new Set(
      model.players.filter((p) => p.owner === team).map((p) => p.id),
    );
  // Native modal focus/escape behavior keeps the league picker usable with keyboard and touch.
  useEffect(() => {
    if (target) dialog.current?.showModal();
    else dialog.current?.close();
  }, [target]);
  function pick(slot: string, index?: number) {
    setSearch("");
    setTarget({ slot, index });
  }
  function choose(id: string) {
    if (
      assign(
        id,
        target!.index,
        after.roles.map((role) => role.id),
      )
    ) {
      if (target!.slot !== "BENCH") setMode("marked");
      setTarget(null);
    }
  }
  const eligible = target
    ? model.players
        .filter(
          (p) =>
            (target.slot === "BENCH" ||
              ((p.slot !== 21 || p.owner !== team) &&
                (target.slot === "FLEX"
                  ? ["RB", "WR", "TE"].includes(p.pos)
                  : p.pos === target.slot))) &&
            p.name.toLowerCase().includes(search.toLowerCase()),
        )
        .sort(
          (a, b) =>
            (b.expected ?? -Infinity) - (a.expected ?? -Infinity) ||
            a.name.localeCompare(b.name),
        )
    : [];
  return (
    <div className="sim-lineup-comparison">
      <div className="toolbar">
        <label className="control">
          <span>Lineup view</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="optimized">Best available lineup</option>
            <option value="marked">Marked starters</option>
          </select>
        </label>
        <label className="control">
          <span>Board week</span>
          <select
            value={week}
            onChange={(e) => setWeek(Number(e.target.value))}
          >
            {model.weeks.map((w) => (
              <option key={w} value={w}>
                Week {w}
                {w === model.current ? " · current" : ""}
              </option>
            ))}
          </select>
        </label>
        <button className="button" onClick={() => pick("BENCH")}>
          Add / move a league player
        </button>
      </div>
      <p className="sim-board-note">
        Boards show Week {week}. The summary above averages all remaining weeks.
        {model.ignoreByeWeeks &&
          " Hypothetical scoring ignores byes and temporary injury absences; IR players remain excluded."}
        Best available matches the trade analyzer’s Best available setting;
        Marked starters shows your saved choices.
      </p>
      <div
        className="sim-board-tabs"
        role="tablist"
        aria-label="Roster comparison"
      >
        <button
          role="tab"
          aria-selected={tab === "before"}
          aria-controls="sim-board-before"
          onClick={() => setTab("before")}
        >
          Live roster
        </button>
        <button
          role="tab"
          aria-selected={tab === "after"}
          aria-controls="sim-board-after"
          onClick={() => setTab("after")}
        >
          Hypothetical roster
        </button>
      </div>
      <div className="sim-boards">
        {(
          [
            { key: "before", title: "Live roster", m: baseline, board: before },
            {
              key: "after",
              title: "Hypothetical roster",
              m: model,
              board: after,
            },
          ] as const
        ).map(({ key, title, m, board }) => (
          <section
            key={key}
            id={`sim-board-${key}`}
            className={`sim-board${tab === key ? " sim-board-active" : ""}`}
            aria-label={title}
          >
            <header>
              <div>
                <small>{key === "before" ? "BEFORE" : "AFTER"}</small>
                <h3>{title}</h3>
              </div>
              <div className="sim-score">
                <small>Week {week} expected</small>
                <strong className="model">{fmt(board.expected)}</strong>
              </div>
            </header>
            <div className="sim-slot-grid">
              {board.roles.map((role, i) => (
                <div
                  className={`sim-slot${role.slot === "QB" ? " sim-slot-qb" : ""}`}
                  key={role.key}
                >
                  <div className="sim-slot-title">
                    <b>
                      {role.slot} {role.ordinal}
                    </b>
                    {key === "after" && role.id !== before.roles[i]?.id && (
                      <span>Changed</span>
                    )}
                  </div>
                  {role.id ? (
                    <PlayerCard
                      m={m}
                      id={role.id}
                      week={week}
                      changed={
                        key === "after" && role.id !== before.roles[i]?.id
                      }
                      added={key === "after" && !original.has(role.id)}
                      leaving={key === "before" && !projected.has(role.id)}
                    />
                  ) : (
                    <div className="sim-empty-slot">No available starter</div>
                  )}
                  {key === "after" && (
                    <div className="sim-slot-actions">
                      <button
                        className="button"
                        aria-label={`Replace ${role.slot} ${role.ordinal}`}
                        onClick={() => pick(role.slot, i)}
                      >
                        {role.id ? "Replace" : "Fill slot"}
                      </button>
                      {role.id && (
                        <button
                          className="subtle"
                          aria-label={`Bench ${m.byId.get(role.id)!.name}`}
                          onClick={() => {
                            if (
                              // Clearing one card preserves every other assigned slot, including deliberate vacancies.
                              starters(
                                after.roles.map((value, index) =>
                                  index === i ? null : value.id,
                                ),
                              )
                            )
                              setMode("marked");
                          }}
                        >
                          Bench
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <details className="sim-reserves">
              <summary>Bench &amp; IR ({board.reserves.length})</summary>
              <div className="sim-reserve-grid">
                {board.reserves.map((id) => (
                  <div key={id}>
                    <PlayerCard
                      m={m}
                      id={id}
                      week={week}
                      added={key === "after" && !original.has(id)}
                      leaving={key === "before" && !projected.has(id)}
                      action={
                        key === "after"
                          ? {
                              label: `Cut ${m.byId.get(id)!.name}`,
                              run: () => cut(id),
                            }
                          : undefined
                      }
                    />
                    {m.byId.get(id)!.slot === 21 && <small>Imported IR</small>}
                  </div>
                ))}
              </div>
            </details>
            {board.issues.map((issue) => (
              <p className="notice warning" key={issue}>
                {issue}
              </p>
            ))}
          </section>
        ))}
      </div>
      <p className="sim-board-note">
        <ArrowRight size={14} aria-hidden="true" /> Replace a slot to choose any
        league player. The displaced player stays on the bench. Added players
        leave their previous fantasy team in this simulation.
      </p>
      <dialog
        ref={dialog}
        className="sim-player-picker"
        aria-labelledby="sim-picker-title"
        onCancel={() => setTarget(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setTarget(null);
        }}
      >
        <div className="toolbar">
          <h3 id="sim-picker-title">
            {target?.slot === "BENCH"
              ? "Add a league player"
              : `Choose ${target?.slot ?? ""} starter`}
          </h3>
          <button
            className="subtle"
            aria-label="Close player picker"
            onClick={() => setTarget(null)}
          >
            <X size={20} />
          </button>
        </div>
        <label className="control">
          <span>Search league players</span>
          <input
            autoFocus
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type a player name"
          />
        </label>
        <p>Selecting a player changes only your hypothetical roster.</p>
        <div className="sim-picker-list">
          {eligible.slice(0, 60).map((p) => (
            <div key={p.id}>
              <PlayerCard m={model} id={p.id} week={week} inspect={false} />
              <small>
                {p.owner === "0"
                  ? "Available"
                  : String(
                      model.dataset.tables.ModelTeams.find(
                        (t) => String(t.TeamID) === p.owner,
                      )?.TeamName,
                    )}
              </small>
              <button
                className="button primary"
                aria-label={`Choose ${p.name}`}
                onClick={() => choose(p.id)}
              >
                Choose player
              </button>
            </div>
          ))}
        </div>
        {eligible.length > 60 && (
          <p>
            Showing the top 60 matches. Type more of the name to narrow the
            list.
          </p>
        )}
        {!eligible.length && <p>No matching players.</p>}
      </dialog>
    </div>
  );
}
