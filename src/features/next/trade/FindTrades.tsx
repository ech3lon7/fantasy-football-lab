import { useEffect, useRef, useState } from "react";
import type { Model } from "../../../domain/valuation";
import { str, type Draft } from "../../../domain/contracts";
import type { SearchLimits } from "../../../domain/search-limits";
import type { LineupBasis } from "../../../domain/trade-impact";
import type { TradeSearchQuery } from "../../../domain/trade-search";
import type { SavedTradeSummary } from "../../../domain/saved-trades";
import { defaultTradeFilters, showAllTradeFilters } from "../../../domain/trade-filters";
import { GradeGoals } from "./GradeGoals";
import { WheelBoard } from "./board/WheelBoard";
import { findWheelData } from "./wheel/wheel-data";
import { BroadResults } from "./BroadResults";
import { useTradeSearch } from "./useTradeSearch";
import { PlayCallScene } from "./wheel/PlayCallScene";
import { defaultFilterShortcut, filterShortcut } from "./filter-shortcut";

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
  shortcut,
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
  shortcut?: string;
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
  const teams = model.dataset.tables.ModelTeams.filter((team) => str(team.TeamID) !== "0");
  const f = s.broad.filters;
  const root = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState(false);
  const [notice, setNotice] = useState("");
  // Focus the inline wheel only from the active finder and outside editable controls or modal dialogs.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!root.current || root.current.offsetParent === null ||
          target?.closest('input, select, textarea, [contenteditable="true"]') ||
          Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some((dialog) => dialog.getClientRects().length > 0) ||
          filterShortcut(event) !== (shortcut || defaultFilterShortcut)) return;
      const board = root.current.querySelector<HTMLElement>(".gd-zb");
      if (!board) return;
      event.preventDefault();
      board.scrollIntoView({ block: "center" });
      board.querySelector<HTMLElement>('.gd-wheel-seg[tabindex="0"]')?.focus();
      // The board answers with a short chalk tap and sweeps the focused segment's hatch (M23).
      board.dispatchEvent(new CustomEvent("zb-shortcut"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);
  // Search and migration feedback stay within the wheel area.
  useEffect(() => { if (s.running) setScene(true); }, [s.running]);
  useEffect(() => {
    if (!s.migrationNote) return;
    setNotice(s.migrationNote);
    const timer = window.setTimeout(() => setNotice(""), 7000);
    return () => window.clearTimeout(timer);
  }, [s.migrationNote]);
  const update = (patch: Partial<typeof f>) => s.updateBroad({ filters: { ...f, ...patch } });
  const selected = s.broad.protectedIds;
  return (
    <div ref={root} className="gd-find gd-broad-search">
      <div className="gd-find-wheel">
        <WheelBoard
          data={findWheelData({
            m: model, teamA: draft.teamA, filters: f, update,
            clear: () => s.updateBroad({ filters: defaultTradeFilters(f) }),
            showAll: () => s.updateBroad({ filters: showAllTradeFilters(f) }),
            protectedIds: selected,
            setProtectedIds: (protectedIds) => s.updateBroad({ protectedIds }),
            counts: { total: s.job?.total ?? 0, visible: s.job?.visibleTotal ?? 0,
              hides: s.job?.filterCounts ?? {}, blocks: s.job?.filterBlocks ?? {} },
          })}
          searched={!!s.job}
          goalsEditor={<GradeGoals chalk m={model} draft={draft} rules={f.gradeGoals} onChange={(gradeGoals) => update({ gradeGoals })} />}
          rail={{
            teams: teams.map((team) => ({ id: str(team.TeamID), name: str(team.TeamName) })),
            teamId: draft.teamA,
            onTeam: (id) => change({ ...draft, teamA: id, teamB: "", give: [], get: [] }),
            running: s.running,
            canSearch: !!draft.teamA,
            onSearch: () => s.search(selected),
            onCancel: s.cancel,
            progress: s.running ? { done: Object.values(s.job?.teams ?? {}).filter((t) => t.done).length, total: Math.max(0, teams.length - 1) } : null,
            error: s.job?.status === "error" ? (s.job.error ?? "Trade search failed.") : "",
          }}
          onShowAll={() => s.updateBroad({ filters: showAllTradeFilters(f) })}
          onReset={() => s.updateBroad({ filters: defaultTradeFilters(f) })}
          notice={notice && <div className="gd-wheel-toast" role="status">{notice}</div>}
          scene={scene && <PlayCallScene m={model} ownTeam={draft.teamA} teams={s.job?.teams} running={s.running} failed={s.job?.status === "error"} cancelled={s.job?.status === "cancelled"} onGone={() => setScene(false)} />}
        />
      </div>
      <BroadResults m={model} s={s} canSave={!!save} onAnalyze={onAnalyze} />
    </div>
  );
}
