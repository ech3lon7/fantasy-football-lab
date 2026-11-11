import { positions } from "../domain/contracts";
import { useGradeGoalSentence } from "./next/limitsContext";
import type { ChainStep } from "../domain/trade-chains";
import type { ChainPositionImpact } from "../domain/chain-position-impact";
import { positionGradeScale } from "../domain/trade-search";
import type { Model } from "../domain/valuation";
import { FilterHelp } from "../ui/FilterHelp";
import { PositionalGradeImpactControls } from "./PositionalGradeImpactControls";

// Each leg owns independent player/position requirements; original outgoing cards must come from the protected trade pool.
export function ChainPlayerRequirements({
  m,
  team,
  pool,
  label,
  value,
  teams,
  firstTeams,
  change,
}: {
  m: Model;
  team: string;
  pool: string[];
  label: string;
  value: ChainStep;
  teams?: string[];
  firstTeams?: string[];
  change: (value: ChainStep) => void;
}) {
  return (
    <>
      <FilterHelp
        label={`${label}: Required incoming position`}
        help="Require at least one received player at this position. Example: receive WR coverage first, then offer Higgins in trade two. This does not replace the final EPPG or connected-chain requirements."
      >
        <label className="control">
          <span>{label}: Required incoming position</span>
          <select
            value={value.receivePosition ?? ""}
            onChange={(e) =>
              change({
                ...value,
                receivePosition: e.target.value
                  ? (e.target.value as (typeof positions)[number])
                  : undefined,
              })
            }
          >
            <option value="">Any position</option>
            {positions.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      </FilterHelp>
      <details className="trade-search-group">
        <summary>
          {label}: Required players (
          {(value.requiredGive?.length ?? 0) + (value.requiredGet?.length ?? 0)}
          )
        </summary>
        {(["requiredGive", "requiredGet"] as const).map((field) => {
          const offered = field === "requiredGive",
            selected = value[field] ?? [];
          const eligible = m.players
            .filter((p) => {
              if (
                p.expected === null ||
                p.index === null ||
                selected.includes(p.id)
              )
                return false;
              if (!offered)
                return (
                  p.owner !== "0" &&
                  p.owner !== team &&
                  (!teams || teams.includes(p.owner))
                );
              return p.owner === team
                ? pool.includes(p.id)
                : label === "Second trade" &&
                    p.owner !== "0" &&
                    (!firstTeams || firstTeams.includes(p.owner));
            })
            .sort((a, b) => a.name.localeCompare(b.name));
          return (
            <div key={field}>
              <FilterHelp
                label={`${label}: Require ${offered ? "offered" : "received"} player`}
                help={
                  offered
                    ? "Every selected player is required in this step's offer. Original players must be in your chain pool. Original players required in trade two are reserved through trade one, including required drops. A newly acquired player may also be required in trade two."
                    : "Every selected player is required in this step's incoming package. The opponent team and package-size limits still apply. Final retained targets are separate."
                }
              >
                <label className="control">
                  <span>
                    {label}: Require {offered ? "offered" : "received"} player
                  </span>
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value)
                        change({
                          ...value,
                          [field]: [...selected, e.target.value],
                        });
                    }}
                  >
                    <option value="">Choose a player</option>
                    {eligible.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.pos}
                        {offered && p.owner !== team ? " · acquire first" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </FilterHelp>
              <div className="active-filter-chips">
                {selected.map((id) => (
                  <button
                    type="button"
                    key={id}
                    aria-label={`Remove ${label} required ${offered ? "offer" : "receive"}: ${m.byId.get(id)?.name ?? "Unavailable player"}`}
                    onClick={() =>
                      change({
                        ...value,
                        [field]: selected.filter((p) => p !== id),
                      })
                    }
                  >
                    {m.byId.get(id)?.name ?? "Unavailable player"} ×
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </details>
    </>
  );
}

// Grade protection complements deficit targeting but can independently protect either side of either exchange.
export function ChainGradeLimitControls({
  label,
  value,
  change,
  positions,
}: {
  label: string;
  value: ChainStep;
  change: (value: ChainStep) => void;
  positions?: string[];
}) {
  const gradeSentence = useGradeGoalSentence();
  return (
    <div className="trade-search-controls">
      <FilterHelp
        label={`${label}: Limit positional grade drops`}
        help="Optional and independent of deficit targeting. Compare Teams grades before and after the entire exchange, including required drops and FLEX. Every affected position on the selected side must stay within the limit. B → B− is one step; B → C is three. This is a preference, not an acceptance guarantee."
      >
        <label className="check">
          <input
            type="checkbox"
            aria-label={`${label}: Limit positional grade drops`}
            checked={!!value.gradeLimit}
            onChange={(e) =>
              change({
                ...value,
                gradeLimit: e.target.checked
                  ? { side: "other", maximumDrop: 2 }
                  : undefined,
              })
            }
          />
          Limit positional grade drops
        </label>
      </FilterHelp>
      {value.gradeLimit && (
        <>
          <label className="control">
            <span>{label}: Protect grades for</span>
            <select
              value={value.gradeLimit.side}
              onChange={(e) =>
                change({
                  ...value,
                  gradeLimit: {
                    ...value.gradeLimit!,
                    side: e.target.value as "own" | "other" | "both",
                  },
                })
              }
            >
              <option value="other">The other team</option>
              <option value="own">Your team</option>
              <option value="both">Both teams</option>
            </select>
          </label>
          <label className="control">
            <span>{label}: Maximum grade steps lost</span>
            <select
              value={value.gradeLimit.maximumDrop}
              onChange={(e) =>
                change({
                  ...value,
                  gradeLimit: {
                    ...value.gradeLimit!,
                    maximumDrop: Number(e.target.value),
                  },
                })
              }
            >
              {positionGradeScale.map((_, i) => (
                <option key={i} value={i}>
                  {i === 0
                    ? "0 — no grade drops"
                    : `${i} grade step${i === 1 ? "" : "s"}`}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {/* Positional grade goals for this chain leg */}
      <PositionalGradeImpactControls
        rules={value.gradeImpacts ?? []}
        onChange={(updated) =>
          change({
            ...value,
            gradeImpacts: updated.length > 0 ? updated : undefined,
          })
        }
        positions={positions}
        sentence={gradeSentence}
        ariaLabelPrefix={`${label} grade goal`}
      />
    </div>
  );
}

// Compact grade evidence exposes positional sacrifices for both teams even with filtering off; UI never recalculates a grade.
export function ChainGradeChanges({
  step,
  value,
}: {
  step: number;
  value?: ChainPositionImpact;
}) {
  if (!value) return null;
  const rows = [
    ...new Set([...value.own, ...value.other].map((p) => p.position)),
  ];
  return (
    <FilterHelp
      label={`Step ${step} positional grade changes`}
      help="Existing Teams grades recalculated immediately before and after this step using Value PPG and current fantasy-league medians, including required drops and FLEX. Red identifies a weaker grade, green an improved grade, and gray no change or an unavailable comparison. Total EPPG may improve while one position weakens."
    >
      <div className="table-wrap">
        <table aria-label={`Step ${step} positional grade changes`}>
          <thead>
            <tr>
              <th>Position</th>
              <th>Your grade</th>
              <th>Their grade</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((position) => (
              <tr key={position}>
                <td>{position}</td>
                {(["own", "other"] as const).map((side) => {
                  const row = value[side].find((r) => r.position === position);
                  // Color both teams from the existing grade evidence; unchanged or unavailable grades stay neutral.
                  const tone =
                    !row || row.drop === null || row.before === row.after
                      ? "muted"
                      : row.drop > 0
                        ? "bad"
                        : "good";
                  return (
                    <td key={side} className={tone}>
                      {row
                        ? `${row.before} → ${row.after}${row.drop ? ` (−${row.drop} steps)` : ""}`
                        : "Not applicable"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </FilterHelp>
  );
}

// Removable chips keep hidden per-leg requirements discoverable without reopening the filter drawer.
export function ChainRequirementChips({
  m,
  label,
  value,
  change,
}: {
  m: Model;
  label: string;
  value: ChainStep;
  change: (value: ChainStep) => void;
}) {
  return (
    <>
      {value.receivePosition && (
        <button
          type="button"
          onClick={() => change({ ...value, receivePosition: undefined })}
        >
          {label}: receive {value.receivePosition} ×
        </button>
      )}
      {(["requiredGive", "requiredGet"] as const).flatMap((field) =>
        (value[field] ?? []).map((id) => (
          <button
            type="button"
            key={`${field}:${id}`}
            onClick={() =>
              change({
                ...value,
                [field]: value[field]!.filter((player) => player !== id),
              })
            }
          >
            {label}: {field === "requiredGive" ? "offer" : "receive"}{" "}
            {m.byId.get(id)?.name ?? "Unavailable player"} ×
          </button>
        )),
      )}
      {value.gradeLimit && (
        <button
          type="button"
          onClick={() => change({ ...value, gradeLimit: undefined })}
        >
          {label}:{" "}
          {value.gradeLimit.side === "own"
            ? "your"
            : value.gradeLimit.side === "other"
              ? "their"
              : "both teams’"}{" "}
          grade drop ≤ {value.gradeLimit.maximumDrop} steps ×
        </button>
      )}
      {/* Removable chip for positional grade goals in this leg */}
      {value.gradeImpacts && value.gradeImpacts.length > 0 && (
        <button
          type="button"
          aria-label={`Clear ${label} grade goals`}
          onClick={() => change({ ...value, gradeImpacts: undefined })}
        >
          {label}: {value.gradeImpacts.length} grade goal{value.gradeImpacts.length === 1 ? "" : "s"} ×
        </button>
      )}
    </>
  );
}
