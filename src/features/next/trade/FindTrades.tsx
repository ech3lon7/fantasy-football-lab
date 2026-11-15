import { useState } from "react";
import type { Model } from "../../../domain/valuation";
import { str, type Draft } from "../../../domain/contracts";
import type { SearchLimits } from "../../../domain/search-limits";
import type { LineupBasis } from "../../../domain/trade-impact";
import type { TradeSearchQuery } from "../../../domain/trade-search";
import type { SavedTradeSummary } from "../../../domain/saved-trades";
import { PlayerPick } from "./controls";
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
  const active =
    Number(f.yourGain.minimum !== null || f.yourGain.maximum !== null) +
    1 +
    Number(f.ownWeek.minimum !== null || f.ownWeek.maximum !== null) +
    Number(f.otherWeek.minimum !== null || f.otherWeek.maximum !== null) +
    Number(f.receiveStarts) +
    Number(f.giveStarts) +
    Number(!!f.gradeGoals.length) +
    Number(!!f.mustGet.length) +
    Number(!!f.mustGive.length) +
    Number(!!f.exclude.length) +
    Number(!!f.getPositions.length) +
    Number(!!f.givePositions.length) +
    Number(!!f.labels.length) +
    Number(f.teams !== null) +
    Number(!!f.teamGrade) +
    Number(f.giveSize.minimum !== 1 || f.giveSize.maximum !== 3) +
    Number(f.getSize.minimum !== 1 || f.getSize.maximum !== 3);
  const selected = s.broad.protectedIds;
  return (
    <div className="gd-find gd-broad-search">
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
            className="gd-cbtn gd-broad-filter-toggle"
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
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
    </div>
  );
}
