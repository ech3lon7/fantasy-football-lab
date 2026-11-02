import { FilterHelp } from "../ui/FilterHelp";
import {
  defaultDeficitProtection,
  type DeficitProtection,
} from "../domain/trade-safeguards";

// Reuse presentation only: each finder and chain leg owns its own independent protection settings.
export function DeficitProtectionControls({
  scope,
  value,
  change,
  targeting,
  ceiling,
}: {
  scope: string;
  value?: DeficitProtection;
  change: (value: DeficitProtection) => void;
  targeting: boolean;
  ceiling: string;
}) {
  const rule = value ?? { ...defaultDeficitProtection, enabled: false };
  const label = `${scope}: Protect their weak positions`;
  return (
    <div className="trade-search-controls trade-deficit-protection">
      <FilterHelp
        label={label}
        help="If a team gives up its best player at a weak position, its best-available positional starting lineup must improve by your minimum after the entire trade and required drops. Includes FLEX contributions, excludes waiver pickups, and does not depend on who they marked as starters. Example: their best RB scores 18; receiving 19 alone fails a +2 minimum. Other search filters still apply."
      >
        <label className="check">
          <input
            type="checkbox"
            aria-label={label}
            // Protection complements enabled deficit targeting and inherits its one visible grade threshold.
            checked={targeting && rule.enabled}
            disabled={!targeting}
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
      {targeting && rule.enabled && (
        <>
          <FilterHelp
            label={`${scope}: Minimum positional gain`}
            help={`Protects positions graded ${ceiling} or lower, using the deficit threshold above. Required net improvement is the whole positional starter total including FLEX across the remaining season, not a bench comparison or team-wide gain. +2 is an adjustable preference, not a historically validated cutoff.`}
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
