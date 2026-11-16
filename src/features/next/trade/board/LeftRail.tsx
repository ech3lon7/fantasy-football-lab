import { useId, useLayoutEffect, useRef, useState } from "react";
import { motion, useBoardMotion } from "./board-motion";
import { RollText } from "./RollText";

export interface RailTeam {
  id: string;
  name: string;
}

export interface RailProps {
  teams: RailTeam[];
  teamId: string;
  onTeam: (id: string) => void;
  running: boolean;
  canSearch: boolean;
  onSearch: () => void;
  onCancel: () => void;
  // Teams finished and teams in all while a search runs.
  progress: { done: number; total: number } | null;
  // Why the last search failed, shown under SEARCH with a shake and a chalk underline.
  error: string;
  activeCount: number;
  onShowAll: () => void;
  onReset: () => void;
  // Which part of the rail to render: all of it (desktop), or the top or bottom row of the phone layout.
  part?: "all" | "top" | "bottom";
}

// The left rail, in chalk, outside the wheel: the team chooser, SEARCH (CANCEL while a search runs, with progress), the filters-on
// count, show all and reset to defaults. None of it is inside the wheel or its hub.
export function LeftRail(props: RailProps) {
  const { part = "all" } = props;
  if (part === "top") return <div data-rail="top" className="gd-rail-row"><TopItems {...props} /></div>;
  if (part === "bottom") return <div data-rail="bottom" className="gd-rail-row"><BottomItems {...props} /></div>;
  return (
    <>
      <div data-rail="top" className="gd-rail-block"><TopItems {...props} /></div>
      <div data-rail="bottom" className="gd-rail-block"><BottomItems {...props} /></div>
    </>
  );
}

function TopItems({ teams, teamId, onTeam, running, canSearch, onSearch, onCancel, progress, error }: RailProps) {
  const [open, setOpen] = useState(false);
  const bm = useBoardMotion();
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);
  const searchWrap = useRef<HTMLDivElement>(null);
  const errorLine = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const wasRunning = useRef(running);
  const team = teams.find((t) => t.id === teamId);

  // M15: the list drops down with each team written in, 30 ms apart.
  useLayoutEffect(() => {
    if (!open) return;
    bm.stagger("team-write", list.current?.querySelectorAll("li") ?? [], { ...motion.teamWrite }, 30, 14);
  }, [open]);
  // M16: the circle around SEARCH is redrawn and the label morphs (SEARCH to CANCEL, and back, M19).
  useLayoutEffect(() => {
    if (wasRunning.current === running) return;
    wasRunning.current = running;
    bm.play("search-label", label.current, motion.labelMorph, { silent: true });
  }, [running]);
  // M26: a search that failed shakes its message and draws a chalk line under it.
  useLayoutEffect(() => {
    if (!error) return;
    bm.play("error-shake", errorLine.current, motion.shake);
    bm.play("error-line", errorLine.current?.querySelector(".gd-error-line path"), motion.errorLine, { silent: true });
  }, [error]);

  const pick = (id: string) => {
    const li = list.current?.querySelector(`[data-team="${id}"]`);
    const circle = li?.querySelector(".gd-team-circle path");
    const done = () => {
      onTeam(id);
      setOpen(false);
    };
    const circled = bm.play("team-circle", circle, motion.teamCircle);
    if (!circled) return done();
    // The pick is circled for a moment, then the list is erased and the hub and count redraw (the team changes).
    circled.finished.then(() => {
      const erased = bm.play("team-erase", list.current, motion.teamErase, { silent: true });
      if (erased) erased.finished.then(done, done);
      else done();
    }, done);
  };
  const press = () => {
    bm.play("search-circle", searchWrap.current?.querySelector(".gd-search-circle path"), motion.searchCircle);
    bm.play("search-squash", searchWrap.current?.querySelector("button"), motion.searchSquash, { silent: true });
    if (running) onCancel();
    else onSearch();
  };

  return (
    <>
      <div className="gd-team" data-motion="M1">
        <button
          type="button"
          className="gd-team-button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
        >
          for {team?.name ?? "—"} <span aria-hidden="true">▾</span>
        </button>
        {open && (
          <ul ref={list} id={listId} role="listbox" aria-label="Teams" className="gd-team-list" data-motion="M15">
            {teams.map((t) => (
              <li key={t.id} data-team={t.id} data-motion="M15">
                <button type="button" role="option" aria-selected={t.id === teamId} onClick={() => pick(t.id)}>
                  {t.name}
                  <svg className="gd-team-circle" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M6 15 C6 3 94 3 94 15 C94 27 6 27 6 15" pathLength={1} />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="gd-search-wrap" ref={searchWrap} data-motion="M1">
        <svg className="gd-search-circle" viewBox="0 0 220 76" preserveAspectRatio="none" aria-hidden="true" data-motion="M16">
          <path d="M16 38 C14 8 206 4 206 38 C206 70 20 72 14 40" pathLength={1} />
        </svg>
        <button type="button" className="gd-search-button" disabled={!running && !canSearch} onClick={press} data-motion="M16">
          <span ref={label} data-motion="M16">{running ? "Cancel" : "Search"}</span>
        </button>
      </div>
      {running && progress && (
        <div className="gd-search-progress" role="status" data-motion="M17">
          searching…{" "}
          <RollText motionId="M17" text={String(progress.done)} /> / <RollText motionId="M17" text={String(progress.total)} /> teams
        </div>
      )}
      {error && (
        <div ref={errorLine} className="gd-search-error" aria-live="polite" data-motion="M26">
          {error}
          <svg className="gd-error-line" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
            <path d="M2 3 C25 0 40 6 60 3 S90 2 98 3" pathLength={1} />
          </svg>
        </div>
      )}
    </>
  );
}

function BottomItems({ activeCount, onShowAll, onReset }: RailProps) {
  return (
    <>
      <div className="gd-rail-count" data-motion="M1">
        <RollText text={`${activeCount} filters on`} />
      </div>
      <button type="button" className="gd-rail-link" data-motion="M1" onClick={onShowAll}>Show all</button>
      <button type="button" className="gd-rail-link" data-motion="M1" onClick={onReset}>Reset to defaults</button>
    </>
  );
}
