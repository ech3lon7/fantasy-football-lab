import { useMemo } from "react";
import type { Draft } from "../../domain/contracts";
import { evaluateTrade } from "../../domain/trades";
import { tradeImpact, type LineupBasis } from "../../domain/trade-impact";
import { gradeStepChips, lineupGainSpread } from "../../domain/view/trade-room";
import type { Model } from "../../domain/valuation";
import { Chip } from "../../ui/primitives";

// Under a Find trades result: grade-step chips for both sides and the lineup gain with its spread.
export function RowImpact({
  m,
  draft,
  basis,
  lineupsRaw,
}: {
  m: Model;
  draft: Draft;
  basis?: LineupBasis;
  lineupsRaw?: string;
}) {
  const view = useMemo(() => {
    const result = evaluateTrade(m, draft, true, lineupsRaw);
    if (!result.valid) return null;
    const impact = tradeImpact(result, basis);
    if (!impact) return null;
    return {
      chips: gradeStepChips(m, draft, result),
      spread: lineupGainSpread(m, impact.own, impact.own.expectedPerWeek),
    };
  }, [m, draft, basis, lineupsRaw]);
  if (!view) return null;
  const { chips, spread } = view;
  return (
    <div className="gd-row-impact">
      {spread.gain !== null && (
        <small>
          Lineup gain ± spread:{" "}
          <b>
            {spread.gain > 0 ? "+" : ""}
            {spread.gain.toFixed(1)}
            {spread.spread === null ? "" : ` ± ${spread.spread.toFixed(1)}`}
          </b>
          {spread.sharesNflTeam && spread.spread !== null
            ? " (slightly understated: two changed players share an NFL team)"
            : ""}
        </small>
      )}
      {[...chips.own, ...chips.other].length > 0 && (
        <span className="gd-chips">
          {chips.own.map((c) => (
            <Chip key={`own-${c.position}`} tone={c.tone} title="Your grade">
              You {c.text}
            </Chip>
          ))}
          {chips.other.map((c) => (
            <Chip key={`other-${c.position}`} tone={c.tone} title="Their grade">
              Them {c.text}
            </Chip>
          ))}
        </span>
      )}
    </div>
  );
}
