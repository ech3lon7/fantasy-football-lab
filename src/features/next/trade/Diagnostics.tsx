import { useState } from "react";
import type { Model } from "../../../domain/valuation";
import type { Draft } from "../../../domain/contracts";
import {
  diagnoseTradeCandidate,
  tradeDebugReport,
} from "../../../domain/trade-tools";
import { fmt, signed } from "../../../ui/components";
import type { TradeSearchState } from "./useTradeSearch";

// The diagnostics of a search in one closed disclosure: the debug export, an explanation of one candidate, the exclusion counts
// and the recovery attempts. Nothing diagnostic sits beside the Search button.
export function Diagnostics({
  m,
  draft,
  lineupsRaw,
  s,
}: {
  m: Model;
  draft: Draft;
  lineupsRaw?: string;
  s: TradeSearchState;
}) {
  const [explanation, setExplanation] = useState("");
  const { job, stale, query } = s;
  const stats = job?.stats;

  // The export is explicit and local: analysis data and controls, never account or session credentials.
  const download = () => {
    const report = {
      ...tradeDebugReport(
        m,
        query,
        draft,
        lineupsRaw,
        s.appliedSearch.current,
        {
          status: job?.status ?? "not searched",
          stale,
          stats,
          total: job?.total,
          loadedRows: job?.rows.length,
          resultBrowse: {
            options: s.resultBrowse,
            matchingOffers: job?.view?.totalOffers,
            matchingPackages: job?.view?.totalPackages,
          },
        },
      ),
      appVersion: import.meta.env.VITE_APP_VERSION,
      controls: s.standardControls,
      loadedCandidate: job?.rows.some(
        (r) =>
          JSON.stringify([...(r.give ?? query.give)].sort()) ===
            JSON.stringify([...draft.give].sort()) &&
          JSON.stringify([...r.get].sort()) ===
            JSON.stringify([...draft.get].sort()),
      ),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "fantasy-trade-debug.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  // Explain one exact candidate on both bases while keeping every active filter.
  const why = () => {
    const result = diagnoseTradeCandidate(m, query, draft, lineupsRaw);
    const scoring =
      result.beforeAfter && result.alternative
        ? `${result.basisLabel}: your Before ${fmt(result.beforeAfter.ownBefore)} → After ${fmt(result.beforeAfter.ownAfter)} (${signed(result.ownGainPerWeek ?? null)} points/week); their Before ${fmt(result.beforeAfter.otherBefore)} → After ${fmt(result.beforeAfter.otherAfter)}. `
        : "";
    setExplanation(
      scoring +
        (result.reasons.length
          ? result.reasons.join(" ")
          : "This candidate passes the current search filters. Check the applied-versus-current settings, completed-search status and later ranked result pages in the debug export."),
    );
  };

  const counts: [string, number | undefined][] = [
    ["Packages excluded by Surface Trading", stats?.managerExcluded],
    [
      "Packages excluded to protect your roster from automatic drops",
      stats?.protectedExcluded,
    ],
    ["Packages excluded by incoming player filters", stats?.incomingExcluded],
    ["Trades excluded by weekly-gain limits", stats?.weeklyExcluded],
    [
      "Trades excluded because not every offered player is useful",
      stats?.usefulnessExcluded,
    ],
    [
      "Trades excluded for insufficient improvement at their weak position",
      stats?.deficitProtectionExcluded,
    ],
    ["Teams excluded by the positional-deficit filter", stats?.deficitExcluded],
    ["Teams excluded by the positional-upgrade filter", stats?.upgradeExcluded],
    ["Trades excluded by positional grade goals", stats?.gradeImpactExcluded],
    ["Missing-index players excluded", stats?.excluded],
    ["Teams with too few eligible players", stats?.thinTeams],
  ];

  return (
    <details className="gd-diag">
      <summary>Diagnostics</summary>
      <div className="gd-fg-body" style={{ marginTop: 10 }}>
        <button type="button" className="gd-cbtn" onClick={download}>
          Download search debug
        </button>
        <button type="button" className="gd-cbtn" onClick={why}>
          Why wasn’t this trade found?
        </button>
        {explanation && (
          <p className="gd-quiet" role="status">
            {explanation}
          </p>
        )}
        <section aria-label="Why trades were excluded">
          <h4 className="gd-kick">Why trades were excluded</h4>
          {stats ? (
            <ul className="gd-quiet">
              {counts
                .filter(([, n]) => n !== undefined)
                .map(([label, n]) => (
                  <li key={label}>
                    {label}: {n}
                  </li>
                ))}
            </ul>
          ) : (
            <p className="gd-quiet">Run a search to see what it excluded.</p>
          )}
        </section>
        <section aria-label="Search attempts">
          <h4 className="gd-kick">Search attempts</h4>
          {job?.recovery ? (
            job.recovery.busy ? (
              <p className="gd-quiet" role="status">
                Checking recovery options…{" "}
                {job.recovery.total
                  ? `${job.recovery.checked} of ${job.recovery.total} evaluated`
                  : "finding candidate packages"}
                . Your filters are unchanged.
              </p>
            ) : (
              <>
                <p className="gd-quiet">
                  {job.recovery.error ??
                    (job.recovery.options?.length
                      ? "Try an evaluated adjustment:"
                      : "No matches with these limited adjustments.")}
                </p>
                {job.recovery.options?.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="gd-cbtn"
                    onClick={() => {
                      s.restoreQuery(option.query);
                      s.setAdvanced(true);
                      s.setPendingSearch(option.query);
                    }}
                  >
                    {option.changes.join(" + ")} → {option.count} matches
                  </button>
                ))}
              </>
            )
          ) : (
            <p className="gd-quiet">No attempts yet.</p>
          )}
        </section>
      </div>
    </details>
  );
}
