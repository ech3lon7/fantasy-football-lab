import type { Draft } from "../../../domain/contracts";
import { positions, str } from "../../../domain/contracts";
import { positionGradeScale } from "../../../domain/trade-search";
import {
  clampTheirGain,
  defaultTradeFilters,
  type TradeFilters,
} from "../../../domain/trade-filters";
import type { Model } from "../../../domain/valuation";
import { GradeGoals } from "./GradeGoals";
import { Check, Field, PlayerPick } from "./controls";
import type { TradeSearchState } from "./useTradeSearch";

const toggle = (items: string[], id: string) =>
  items.includes(id) ? items.filter((x) => x !== id) : [...items, id];
const toNumber = (text: string) => (text.trim() === "" ? null : Number(text));

// Filters edit the retained search results only; nothing here starts a search. Each filter says how many trades it hides.
export function BroadFilters({
  m,
  draft,
  s,
}: {
  m: Model;
  draft: Draft;
  s: TradeSearchState;
}) {
  const f = s.broad.filters;
  const counts = s.job?.filterCounts ?? {};
  const update = (patch: Partial<TradeFilters>) =>
    s.updateBroad({ filters: { ...f, ...patch } });
  // The count sits beside a control, never inside its accessible name.
  const hides = (key: string) => (
    <small className="gd-hides" data-filter={key}>
      hides {counts[key] ?? 0}
    </small>
  );
  const mine = m.players.filter((p) => p.owner === draft.teamA);
  const theirs = m.players.filter(
    (p) => p.owner !== "0" && p.owner !== draft.teamA,
  );
  const opponents = m.dataset.tables.ModelTeams.filter(
    (t) => str(t.TeamID) !== "0" && str(t.TeamID) !== draft.teamA,
  );
  const range = (key: "yourGain" | "ownWeek" | "otherWeek", label: string) => (
    <fieldset className="gd-filter">
      <legend>
        {label} {hides(key)}
      </legend>
      <div className="gd-row2">
        <Field label={`${label} minimum`}>
          <input
            type="number"
            step="0.5"
            value={f[key].minimum ?? ""}
            onChange={(e) =>
              update({
                [key]: { ...f[key], minimum: toNumber(e.target.value) },
              })
            }
          />
        </Field>
        <Field label={`${label} maximum`}>
          <input
            type="number"
            step="0.5"
            value={f[key].maximum ?? ""}
            onChange={(e) =>
              update({
                [key]: { ...f[key], maximum: toNumber(e.target.value) },
              })
            }
          />
        </Field>
      </div>
    </fieldset>
  );
  return (
    <div className="gd-fac" aria-label="Trade filters">
      <h3>Filters</h3>
      <details open>
        <summary>Gains</summary>
        {range("yourGain", "Your EPPG gain")}
        <fieldset className="gd-filter">
          <legend>Their EPPG gain {hides("theirGain")}</legend>
          <Field label="Their EPPG gain minimum">
            <input
              type="number"
              min={-2}
              max={1}
              step={0.5}
              value={f.theirGain}
              onChange={(e) =>
                update({ theirGain: clampTheirGain(Number(e.target.value)) })
              }
            />
          </Field>
          <Field label="Their EPPG gain slider">
            <input
              type="range"
              min={-2}
              max={1}
              step={0.5}
              value={f.theirGain}
              onChange={(e) =>
                update({ theirGain: clampTheirGain(Number(e.target.value)) })
              }
            />
          </Field>
        </fieldset>
        {range("ownWeek", "Your this-week MPPG gain")}
        {range("otherWeek", "Their this-week MPPG gain")}
      </details>
      <details>
        <summary>Roles</summary>
        <div className="gd-filter">
          <Check
            checked={f.receiveStarts}
            onChange={(receiveStarts) => update({ receiveStarts })}
          >
            Everyone I receive starts for me every remaining week
          </Check>
          {hides("receiveStarts")}
        </div>
        <div className="gd-filter">
          <Check
            checked={f.giveStarts}
            onChange={(giveStarts) => update({ giveStarts })}
          >
            Everyone I send starts for them every remaining week
          </Check>
          {hides("giveStarts")}
        </div>
      </details>
      <details>
        <summary>Grades {hides("gradeGoals")}</summary>
        <GradeGoals
          m={m}
          draft={draft}
          rules={f.gradeGoals}
          onChange={(gradeGoals) => update({ gradeGoals })}
        />
      </details>
      <details>
        <summary>Players</summary>
        <PlayerPick
          label="I get must include"
          players={theirs}
          selected={f.mustGet}
          max={theirs.length}
          onToggle={(id) => update({ mustGet: toggle(f.mustGet, id) })}
        />
        {hides("mustGet")}
        <PlayerPick
          label="I give must include"
          players={mine}
          selected={f.mustGive}
          max={mine.length}
          onToggle={(id) => update({ mustGive: toggle(f.mustGive, id) })}
        />
        {hides("mustGive")}
        <PlayerPick
          label="Exclude players"
          players={[...mine, ...theirs]}
          selected={f.exclude}
          max={mine.length + theirs.length}
          onToggle={(id) => update({ exclude: toggle(f.exclude, id) })}
        />
        {hides("exclude")}
      </details>
      <details>
        <summary>Positions</summary>
        {positions.map((pos) => (
          <div key={pos} className="gd-filter">
            <Check
              checked={f.getPositions.includes(pos)}
              onChange={() =>
                update({
                  getPositions: toggle(
                    f.getPositions as string[],
                    pos,
                  ) as typeof f.getPositions,
                })
              }
            >
              Get {pos}
            </Check>
            <Check
              checked={f.givePositions.includes(pos)}
              onChange={() =>
                update({ givePositions: toggle(f.givePositions, pos) })
              }
            >
              Give {pos}
            </Check>
          </div>
        ))}
        <p className="gd-quiet">
          Get {hides("getPositions")} · Give {hides("givePositions")}
        </p>
      </details>
      <details>
        <summary>Labels {hides("labels")}</summary>
        {(["Gem", "Pre-gem", "Watch"] as const).map((label) => (
          <Check
            key={label}
            checked={f.labels.includes(label)}
            onChange={() =>
              update({
                labels: toggle(f.labels as string[], label) as typeof f.labels,
              })
            }
          >
            Incoming {label}
          </Check>
        ))}
      </details>
      <details>
        <summary>Teams {hides("teams")}</summary>
        {opponents.map((team) => {
          const id = str(team.TeamID);
          const all = opponents.map((t) => str(t.TeamID));
          return (
            <Check
              key={id}
              checked={f.teams === null || f.teams.includes(id)}
              onChange={(checked) => {
                const selected = f.teams ?? all;
                const next = checked
                  ? [...selected, id]
                  : selected.filter((v) => v !== id);
                update({ teams: next.length === all.length ? null : next });
              }}
            >
              {str(team.TeamName)}
            </Check>
          );
        })}
        <Check
          checked={!!f.teamGrade}
          onChange={(on) =>
            update({ teamGrade: on ? { position: "QB", ceiling: "C+" } : null })
          }
        >
          Only teams graded at or below
        </Check>
        {hides("teamGrade")}
        {f.teamGrade && (
          <div className="gd-row2">
            <Field label="Position">
              <select
                value={f.teamGrade.position}
                onChange={(e) =>
                  update({
                    teamGrade: { ...f.teamGrade!, position: e.target.value },
                  })
                }
              >
                {positions.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
            <Field label="Grade ceiling">
              <select
                value={f.teamGrade.ceiling}
                onChange={(e) =>
                  update({
                    teamGrade: { ...f.teamGrade!, ceiling: e.target.value },
                  })
                }
              >
                {positionGradeScale.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </details>
      <details>
        <summary>Size</summary>
        {(["giveSize", "getSize"] as const).map((key) => (
          <fieldset key={key} className="gd-filter">
            <legend>
              {key === "giveSize" ? "Players I give" : "Players I get"}{" "}
              {hides(key)}
            </legend>
            <div className="gd-row2">
              {(["minimum", "maximum"] as const).map((bound) => (
                <Field
                  key={bound}
                  label={`${key === "giveSize" ? "Give" : "Get"} ${bound}`}
                >
                  <select
                    value={f[key][bound] ?? (bound === "minimum" ? 1 : 3)}
                    onChange={(e) =>
                      update({
                        [key]: { ...f[key], [bound]: Number(e.target.value) },
                      })
                    }
                  >
                    {[1, 2, 3].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          </fieldset>
        ))}
      </details>
      <button
        type="button"
        className="gd-cbtn"
        onClick={() => s.updateBroad({ filters: defaultTradeFilters() })}
      >
        Clear filters
      </button>
    </div>
  );
}
