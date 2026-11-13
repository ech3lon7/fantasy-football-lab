import type { Model } from "../../../domain/valuation";
import type { Draft } from "../../../domain/contracts";
import type { SearchLimits } from "../../../domain/search-limits";
import type { LineupBasis } from "../../../domain/trade-impact";
import type { TradeSearchQuery } from "../../../domain/trade-search";
import type { SavedTradeSummary } from "../../../domain/saved-trades";
import { Diagnostics } from "./Diagnostics";
import { FindControls } from "./FindControls";
import { FindResults } from "./FindResults";
import { GradeGoals } from "./GradeGoals";
import { useTradeSearch } from "./useTradeSearch";

// Find trades: the controls panel on the left; the positional grade goals, the summary and the results on the right.
export function FindTrades({
  model,
  draft,
  lineupsRaw,
  change,
  save,
  limits,
  updateLimits,
  resetLimits,
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
  return (
    <div className="gd-find">
      <aside className="gd-fac" aria-label="Search controls">
        <FindControls
          m={model}
          draft={draft}
          change={change}
          s={s}
          limits={limits}
          updateLimits={updateLimits}
          resetLimits={resetLimits}
        />
        <Diagnostics m={model} draft={draft} lineupsRaw={lineupsRaw} s={s} />
      </aside>
      <div className="gd-main">
        <GradeGoals
          m={model}
          draft={draft}
          rules={s.gradeImpacts}
          onChange={s.setGradeImpacts}
        >
          {s.bounds.errors.map((message) => (
            <p key={message} className="gd-quiet" role="alert">
              {message}
            </p>
          ))}
          <div className="gd-chips">
            {s.running ? (
              <button type="button" className="gd-primary" onClick={s.cancel}>
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className="gd-primary"
                disabled={s.bounds.errors.length > 0}
                onClick={s.search}
              >
                Search trades across the league
              </button>
            )}
            <button type="button" className="gd-cbtn" onClick={s.clearFilters}>
              Clear filters
            </button>
          </div>
        </GradeGoals>
        <FindResults m={model} s={s} canSave={!!save} onAnalyze={onAnalyze} />
      </div>
    </div>
  );
}
