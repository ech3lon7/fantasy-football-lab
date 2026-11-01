import { FilterHelp } from "../ui/FilterHelp";
import {
  defaultDeficitProtection,
  positionGradeScale,
  type DeficitProtection,
} from "../domain/trade-safeguards";

// Reuse presentation only: each finder and chain leg owns its own independent protection settings.
export function DeficitProtectionControls({
  scope,
  value,
  change,
}: {
  scope: string;
  value?: DeficitProtection;
  change: (value: DeficitProtection) => void;
}) {
  const rule = value ?? { ...defaultDeficitProtection, enabled: false };
  const label = `${scope}: Protect their weak positions`;
  return (
    <div className="trade-search-controls">
      <FilterHelp
        label={label}
        help="If a team gives up its best player at a weak position, its best-available positional starting lineup must improve by your minimum after the entire trade and required drops. Includes FLEX contributions, excludes waiver pickups, and does not depend on who they marked as starters. Example: their best RB scores 18; receiving 19 alone fails a +2 minimum. Other search filters still apply."
      >
        <label className="check">
          <input
            type="checkbox"
            aria-label={label}
            checked={rule.enabled}
            onChange={(event) =>
              change({
                ...rule,
                enabled: event.target.checked,
                // Disabling an unfinished numeric edit must not block searching or saving a trade.
                minimum:
                  Number.isFinite(rule.minimum) && rule.minimum > 0
                    ? rule.minimum
                    : defaultDeficitProtection.minimum,
              })
            }
          />
          Protect their weak positions
        </label>
      </FilterHelp>
      {rule.enabled && (
        <>
          <FilterHelp
            label={`${scope}: Deficit grade cutoff`}
            help="Protect the selected grade and every lower grade, using the same league-relative grades as Teams. C+ is the starting preference, not a validated acceptance threshold."
          >
            <label className="control">
              <span>Deficit grade cutoff</span>
              <select
                aria-label={`${scope}: Deficit grade cutoff`}
                value={rule.ceiling}
                onChange={(event) =>
                  change({ ...rule, ceiling: event.target.value })
                }
              >
                {positionGradeScale.map((grade) => (
                  <option key={grade} value={grade}>
                    {grade} or lower
                  </option>
                ))}
              </select>
            </label>
          </FilterHelp>
          <FilterHelp
            label={`${scope}: Minimum positional gain`}
            help="Required net improvement in expected points per week at the protected position, across the remaining season. This is the whole positional starter total, including FLEX, not a bench comparison or a team-wide gain. +2 is an adjustable initial preference, not a historically validated cutoff."
          >
            <label className="control">
              <span>Minimum positional gain (points/week)</span>
              <input
                type="number"
                min="0.01"
                step="0.25"
                aria-label={`${scope}: Minimum positional gain`}
                value={Number.isFinite(rule.minimum) ? rule.minimum : ""}
                onChange={(event) =>
                  change({
                    ...rule,
                    minimum: event.target.value.trim()
                      ? Number(event.target.value)
                      : NaN,
                  })
                }
              />
            </label>
          </FilterHelp>
        </>
      )}
    </div>
  );
}
