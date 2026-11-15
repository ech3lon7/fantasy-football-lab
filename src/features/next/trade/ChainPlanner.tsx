import type { Draft } from "../../../domain/contracts";
import { str } from "../../../domain/contracts";
import type { Model } from "../../../domain/valuation";
import type { LineupBasis } from "../../../domain/trade-impact";
import type { SavedTradeSummary } from "../../../domain/saved-trades";
import type { TradeSearchQuery } from "../../../domain/trade-search";
import { editedLimits, type SearchLimits } from "../../../domain/search-limits";
import { ChainLegs, ChainWhole } from "./ChainControls";
import { ChainResults } from "./ChainResults";
import { LimitsEditor } from "./LimitsEditor";
import { useChainSearch, type ChainSearchState } from "./useChainSearch";
import { clampTheirGain } from "../../../domain/trade-filters";

// The exclusion counts and attempts of the last chain search, closed until asked for.
function ChainDiagnostics({ s }: { s: ChainSearchState }) {
  const stats = s.job?.result?.stats;
  const rows: [string, number | undefined][] = [
    ["Dependency exclusions", stats?.rejectedDependency],
    ["Index-window exclusions", stats?.rejectedIndex],
    ["Price-test failures", stats?.rejectedValue],
    ["Surplus/deficit exclusions", stats?.rejectedFit ?? 0],
    ["Roster/protection failures", stats?.rejectedRoster],
    ["Scoring/mode/gain failures", stats?.rejectedGain],
    ["Positional grade-limit exclusions", stats?.rejectedGrades ?? 0],
    ["Recipient fairness/benefit failures", stats?.rejectedRecipient],
  ];
  return (
    <details className="gd-diag">
      <summary>Diagnostics</summary>
      <div className="gd-fg-body" style={{ marginTop: 10 }}>
        <button type="button" className="gd-cbtn" onClick={s.downloadDebug}>
          Download chain debug
        </button>
        <section aria-label="Why chains were excluded">
          <h4 className="gd-kick">Why chains were excluded</h4>
          {stats ? (
            <>
              <p className="gd-quiet">
                Search coverage: {stats.limited ? "incomplete" : "complete"}.
                Eligible first trades: {stats.firstEligible}; explored:{" "}
                {stats.firstExplored}. Method: {stats.searchVersion}.
              </p>
              <ul className="gd-quiet">
                {rows
                  .filter(([, n]) => n !== undefined)
                  .map(([label, n]) => (
                    <li key={label}>
                      {label}: {n}
                    </li>
                  ))}
              </ul>
            </>
          ) : (
            <p className="gd-quiet">Run a search to see what it excluded.</p>
          )}
        </section>
        <section aria-label="Search attempts">
          <h4 className="gd-kick">Search attempts</h4>
          {s.job?.result?.attempts?.length ? (
            s.job.result.attempts.map((a, i) => (
              <p key={i} className="gd-quiet">
                Attempt {i + 1}: {a.found} qualifying plans, {a.stats.evaluated}{" "}
                evaluations.{" "}
                {a.changes.length ? a.changes.join("; ") : "Original limits."}
              </p>
            ))
          ) : (
            <p className="gd-quiet">No attempts yet.</p>
          )}
        </section>
      </div>
    </details>
  );
}

// The Chain planner: header, preset cards, the shared limits, per-trade settings, the whole chain, then results.
export function ChainPlanner({
  model,
  draft,
  lineupsRaw,
  basis,
  limits,
  updateLimits,
  resetLimits,
  settingsRaw,
  legacySettingsRaw,
  saveSettings,
  save,
  onAnalyze,
}: {
  model: Model;
  draft: Draft;
  lineupsRaw?: string;
  basis: LineupBasis;
  limits: SearchLimits;
  updateLimits: (next: SearchLimits) => void;
  resetLimits: () => void;
  settingsRaw?: string;
  legacySettingsRaw?: string;
  saveSettings?: (raw: string) => void;
  save?: (
    draft: Draft,
    summary: SavedTradeSummary,
    query: TradeSearchQuery,
    context?: Model,
  ) => boolean | void;
  onAnalyze: (draft: Draft) => void;
}) {
  const s = useChainSearch({
    m: model,
    draft,
    lineupsRaw,
    basis,
    limits,
    settingsRaw,
    legacySettingsRaw,
    saveSettings,
    save,
  });
  const edited = editedLimits(limits).length > 0;
  const targets = s.discovery.requiredTargets ?? [];
  const finalTargets = model.players
    .filter((p) => p.owner !== s.team && p.owner !== "0")
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="gd-chain">
      <section className="gd-card" aria-label="Two-trade chain planner">
        <div className="gd-chips" style={{ justifyContent: "space-between" }}>
          <h3>Two-trade chain planner</h3>
          <label className="gd-field"><span>Their EPPG gain minimum</span>
            <input type="number" min={-2} max={1} step={0.5} value={s.recipientGain}
              onChange={(event) => s.setRecipientGain(String(clampTheirGain(Number(event.target.value))))} />
          </label>
          <label className="gd-field">
            <span>Chain search depth</span>
            <select
              className="gd-sel"
              value={s.depth}
              onChange={(e) => s.setDepth(e.target.value as typeof s.depth)}
            >
              <option value="standard">Broad — up to 16,000 evaluations</option>
              <option value="deeper">Deeper — up to 60,000 evaluations</option>
            </select>
          </label>
          <label className="gd-field">
            <span>Required final target</span>
            <select
              className="gd-sel"
              value={targets[0] ?? ""}
              onChange={(e) =>
                s.setDiscovery({
                  ...s.discovery,
                  requiredTargets: e.target.value
                    ? [e.target.value]
                    : undefined,
                })
              }
            >
              <option value="">Any target</option>
              {finalTargets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} - {p.pos}
                </option>
              ))}
            </select>
          </label>
          {s.running ? (
            <button type="button" className="gd-primary" onClick={s.cancel}>
              Cancel chain search
            </button>
          ) : (
            <button
              type="button"
              className="gd-primary"
              disabled={s.errors.length > 0}
              onClick={() => s.search()}
            >
              Run chain trade search
            </button>
          )}
          <button type="button" className="gd-cbtn" onClick={s.clearFilters}>
            Clear chain filters
          </button>
        </div>
        {s.errors.map((message) => (
          <p key={message} className="gd-quiet" role="alert">
            {message}
          </p>
        ))}
        <p className="gd-quiet">
          Each trade keeps its own controls: packages, teams, fit rules and
          positional grade goals. Lineup impact uses{" "}
          {s.basis === "marked-starters"
            ? "marked starters"
            : "the best available lineup"}{" "}
          for{" "}
          {str(
            model.dataset.tables.ModelTeams.find(
              (t) => str(t.TeamID) === s.team,
            )?.TeamName,
          ) || "your team"}
          .
        </p>
      </section>

      {s.migrationNote && <p className="gd-quiet">Saved search: ignored {s.migrationNote}.</p>}

      <section className="gd-card" aria-label="Chain search limits">
        <details className="gd-limits">
          <summary>
            Search limits{" "}
            {edited && (
              <>
                <span
                  className="gd-edot"
                  title="At least one limit differs from its default"
                />
                <span className="gd-quiet">edited</span>
              </>
            )}
          </summary>
          <div className="gd-fg-body" style={{ marginTop: 10 }}>
            <LimitsEditor
              limits={limits}
              update={updateLimits}
              reset={resetLimits}
            />
          </div>
        </details>
      </section>

      <ChainLegs m={model} s={s} />
      <ChainWhole m={model} s={s} />
      <ChainDiagnostics s={s} />
      <ChainResults m={model} s={s} canSave={!!save} onAnalyze={onAnalyze} />
    </div>
  );
}

