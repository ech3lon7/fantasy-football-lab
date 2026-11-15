import { useEffect, useRef, useState } from "react";
import type { Model } from "../../../domain/valuation";
import { str, type Draft } from "../../../domain/contracts";
import type { SearchLimits } from "../../../domain/search-limits";
import type { LineupBasis } from "../../../domain/trade-impact";
import type { TradeSearchQuery } from "../../../domain/trade-search";
import type { SavedTradeSummary } from "../../../domain/saved-trades";
import { defaultTradeFilters } from "../../../domain/trade-filters";
import { PlayerPick } from "./controls";
import { GradeGoals } from "./GradeGoals";
import { FilterWheel } from "./wheel/FilterWheel";
import { findWheelData } from "./wheel/wheel-data";
import { activeFilterCount } from "./wheel/wheel-model";
import { BroadFilters } from "./BroadFilters";
import { BroadResults } from "./BroadResults";
import { useTradeSearch } from "./useTradeSearch";

// Search all eligible trades once; the separate panel changes only the retained results.
export function FindTrades({
  model,
  draft,
  lineupsRaw,
  change,
  save,
  basis,
  onBasisChange,
  settingsRaw,
  saveSettings,
  restore,
  onAnalyze,
}: {
  model: Model;
  draft: Draft;
  lineupsRaw?: string;
  change: (draft: Draft) => void;
  save?: (
    draft: Draft,
    summary: SavedTradeSummary,
    query: TradeSearchQuery,
    context?: Model,
  ) => boolean | void;
  limits: SearchLimits;
  updateLimits: (next: SearchLimits) => void;
  resetLimits: () => void;
  basis: LineupBasis;
  onBasisChange: (basis: LineupBasis) => void;
  settingsRaw?: string;
  saveSettings?: (raw: string) => void;
  restore?: { id: string; query: TradeSearchQuery };
  onAnalyze: () => void;
}) {
  const [open, setOpen] = useState(false);
  const s = useTradeSearch({
    m: model,
    draft,
    lineupsRaw,
    change,
    save,
    lineupBasis: basis,
    onLineupBasisChange: onBasisChange,
    restore,
    settingsRaw,
    saveSettings,
  });
  const mine = model.players.filter((p) => p.owner === draft.teamA);
  const teams = model.dataset.tables.ModelTeams.filter(
    (t) => str(t.TeamID) !== "0",
  );
  const f = s.broad.filters;
  const active = activeFilterCount(f);
  const [wheel, setWheel] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const update = (patch: Partial<typeof f>) =>
    s.updateBroad({ filters: { ...f, ...patch } });
  // F opens the wheel while this tab is showing and focus is not in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key.toLowerCase() !== "f" || e.ctrlKey || e.metaKey || e.altKey)
        return;
      if (
        el &&
        (el.isContentEditable ||
          ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName))
      )
        return;
      if (!s.job || !root.current || root.current.offsetParent === null) return;
      e.preventDefault();
      setWheel(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s.job]);
  const closeWheel = () => {
    setWheel(false);
    opener.current?.focus();
  };
  const selected = s.broad.protectedIds;
  return (
    <div ref={root} className="gd-find gd-broad-search">
      <section className="gd-card gd-broad-top" aria-label="Search all trades">
        <label>
          Team{" "}
          <select
            value={draft.teamA}
            onChange={(e) =>
              change({
                ...draft,
                teamA: e.target.value,
                teamB: "",
                give: [],
                get: [],
              })
            }
          >
            {teams.map((team) => (
              <option key={str(team.TeamID)} value={str(team.TeamID)}>
                {str(team.TeamName)}
              </option>
            ))}
          </select>
        </label>
        <div>
          <b>Never trade</b>{" "}
          {selected.map((id) => (
            <button
              key={id}
              className="gd-cbtn"
              type="button"
              onClick={() =>
                s.updateBroad({
                  protectedIds: selected.filter((x) => x !== id),
                })
              }
            >
              {model.byId.get(id)?.name ?? id} ×
            </button>
          ))}
          <details>
            <summary>+ Add</summary>
            <PlayerPick
              label="Never trade"
              players={mine}
              selected={selected}
              max={mine.length}
              onToggle={(id) =>
                s.updateBroad({
                  protectedIds: selected.includes(id)
                    ? selected.filter((x) => x !== id)
                    : [...selected, id],
                })
              }
            />
          </details>
        </div>
        {s.running ? (
          <button className="gd-primary" type="button" onClick={s.cancel}>
            Cancel
          </button>
        ) : (
          <button
            className="gd-primary"
            type="button"
            disabled={!draft.teamA}
            onClick={() => s.search(selected)}
          >
            Search all trades
          </button>
        )}
      </section>
      {s.migrationNote && (
        <p className="gd-quiet">Saved search: ignored {s.migrationNote}.</p>
      )}
      {s.job && (
        <div className="gd-broad-layout">
          <button
            ref={opener}
            className="gd-cbtn gd-wheel-open"
            type="button"
            aria-haspopup="dialog"
            onClick={() => setWheel(true)}
          >
            Filters · {active}
          </button>
          <div className="gd-broad-filter-panel" data-open={open}>
            <BroadFilters m={model} draft={draft} s={s} />
            <button
              className="gd-cbtn gd-broad-filter-toggle"
              type="button"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
          <BroadResults
            m={model}
            s={s}
            canSave={!!save}
            onAnalyze={onAnalyze}
          />
        </div>
      )}
      {!s.job && (
        <p>Press Search all trades to check every legal trade for your team</p>
      )}
      {wheel && s.job && (
        <FilterWheel
          opener={opener}
          data={findWheelData({
            m: model,
            teamA: draft.teamA,
            filters: f,
            update,
            clear: () => s.updateBroad({ filters: defaultTradeFilters() }),
            counts: {
              total: s.job.total,
              visible: s.job.visibleTotal ?? s.job.rows.length,
              hides: s.job.filterCounts ?? {},
            },
          })}
          goalsEditor={
            <GradeGoals
              m={model}
              draft={draft}
              rules={f.gradeGoals}
              onChange={(gradeGoals) => update({ gradeGoals })}
            />
          }
          onClose={closeWheel}
          onListView={() => {
            setWheel(false);
            setOpen(true);
          }}
        />
      )}
    </div>
  );
}
