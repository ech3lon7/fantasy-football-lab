import { useMemo, useState } from "react";
import type { Draft, Position } from "../../../domain/contracts";
import { positions, str } from "../../../domain/contracts";
import type { Model } from "../../../domain/valuation";
import { teamsAssessment } from "../../../domain/lineups";
import { positionGradeScale } from "../../../domain/trade-search";
import { guidedQuery } from "../../../domain/trade-guidance";
import { primaryGemSignals } from "../../../domain/label-rules";
import { defaultDeficitProtection } from "../../../domain/trade-safeguards";
import { editedLimits, type SearchLimits } from "../../../domain/search-limits";
import { limitsSummary } from "../../../domain/view/limits";
import { ManagerControls } from "../../Negotiations";
import { Check, Field, Group, PlayerPick } from "./controls";
import { LimitsEditor } from "./LimitsEditor";
import { goalsSummary } from "./goalRules";
import type { TradeSearchState } from "./useTradeSearch";

const toggle = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

// The nine folding groups of the Find trades controls panel; every control of the earlier search is here.
export function FindControls({
  m,
  draft,
  change,
  s,
  limits,
  updateLimits,
  resetLimits,
}: {
  m: Model;
  draft: Draft;
  change: (draft: Draft) => void;
  s: TradeSearchState;
  limits: SearchLimits;
  updateLimits: (next: SearchLimits) => void;
  resetLimits: () => void;
}) {
  const teams = m.dataset.tables.ModelTeams.filter(
    (t) => str(t.TeamID) !== "0",
  );
  const teamName = (id: string) =>
    str(teams.find((t) => str(t.TeamID) === id)?.TeamName) || id;
  const mine = useMemo(
    () =>
      m.players
        .filter((p) => p.owner === draft.teamA)
        .sort((a, b) => (b.blendedExpected ?? -1) - (a.blendedExpected ?? -1)),
    [m, draft.teamA],
  );
  const opponentIds = s.opponents.map((t) => str(t.TeamID));
  const chosenTeams = s.selectedTeams ?? opponentIds;
  const [previewTeam, setPreviewTeam] = useState("");
  const preview = previewTeam || opponentIds[0] || "";
  const grades = useMemo(
    () => teamsAssessment(m).get(preview) ?? [],
    [m, preview],
  );
  const protectedCount = Math.max(0, mine.length - s.discovery.pool.length);
  const receive = s.receive;
  const upgradeCount =
    s.upgradeMode === "either" ? s.requiredStarters : s.requiredUpgrades;

  const packagesSummary = [
    s.discovery.flexible
      ? `Offer ${s.discovery.minimum}–${s.discovery.maximum} from ${s.discovery.pool.length} tradable`
      : `Offer ${draft.give.length || "none yet"}`,
    `receive ${receive.minimum === receive.maximum ? receive.maximum : `${receive.minimum}–${receive.maximum}`}`,
    s.discovery.flexible ? `${protectedCount} protected` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const needsSummary = s.deficitOnly
    ? `Deficit at ${s.selectedPosition || "a position"}, grade ${s.deficitCeiling} or lower${s.deficitProtection.enabled ? " · protect weak positions" : ""}`
    : "Any team";

  const receiveSummary = [
    s.incomingPositions.length ? s.incomingPositions.join("/") : "Any position",
    s.signals.length
      ? `${s.minimumSignals}+ ${s.signals.join("/")}`
      : "any label",
  ].join(" · ");

  const fitParts = [
    s.usefulnessOnly ? "Offered players must be useful" : "",
    s.upgradeOnly ? "Positional upgrades required" : "",
    s.ownWeekly.enabled || s.otherWeekly.enabled ? "Weekly gain limits" : "",
  ].filter(Boolean);

  const rankLabels: Record<string, string> = {
    own: "By your lineup gain",
    other: "By their lineup gain",
    balanced: "By benefit to both teams",
    acceptance: "By estimated acceptance",
  };

  return (
    <>
      <Group title="Players & packages" summary={packagesSummary} defaultOpen>
        <Field label="Standard search team">
          <select
            value={draft.teamA}
            onChange={(e) => {
              const teamA = e.target.value;
              change({
                teamA,
                teamB:
                  draft.teamB === teamA
                    ? (opponentIds.find((id) => id !== teamA) ?? "")
                    : draft.teamB,
                give: [],
                get: [],
              });
            }}
          >
            {teams.map((t) => (
              <option key={str(t.TeamID)} value={str(t.TeamID)}>
                {str(t.TeamName)}
              </option>
            ))}
          </select>
        </Field>
        <Check
          checked={s.discovery.flexible}
          onChange={(flexible) => s.setDiscovery((d) => ({ ...d, flexible }))}
        >
          Find outgoing combinations
        </Check>
        {s.discovery.flexible ? (
          <>
            <PlayerPick
              label="Your tradable pool"
              players={mine}
              selected={s.discovery.pool}
              max={12}
              onToggle={(id) =>
                s.setDiscovery((d) => ({ ...d, pool: toggle(d.pool, id) }))
              }
            />
            <p className="gd-quiet">
              {protectedCount} of your players are protected from offers and
              from automatic drops.
            </p>
            <div className="gd-row2">
              <Field label="Offer at least">
                <select
                  value={s.discovery.minimum}
                  onChange={(e) =>
                    s.setDiscovery((d) => ({ ...d, minimum: e.target.value }))
                  }
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Offer at most">
                <select
                  value={s.discovery.maximum}
                  onChange={(e) =>
                    s.setDiscovery((d) => ({ ...d, maximum: e.target.value }))
                  }
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </>
        ) : (
          <PlayerPick
            label="Players you offer"
            players={mine}
            selected={draft.give}
            max={5}
            onToggle={(id) =>
              change({ ...draft, give: toggle(draft.give, id) })
            }
          />
        )}
        <Check checked={s.packages} onChange={s.setPackages}>
          Create package
        </Check>
        {s.packages && (
          <Field label="Maximum players to receive">
            <select
              value={s.count}
              onChange={(e) => s.setCount(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Find a target player">
          <input
            type="text"
            value={s.discovery.targetSearch}
            onChange={(e) =>
              s.setDiscovery((d) => ({ ...d, targetSearch: e.target.value }))
            }
          />
        </Field>
        <Field label="Required incoming player">
          <select
            value={s.discovery.target}
            onChange={(e) =>
              s.setDiscovery((d) => ({ ...d, target: e.target.value }))
            }
          >
            <option value="">Any player</option>
            {m.players
              .filter(
                (p) =>
                  chosenTeams.includes(p.owner) &&
                  p.owner !== draft.teamA &&
                  (!s.discovery.targetSearch ||
                    p.name
                      .toLowerCase()
                      .includes(s.discovery.targetSearch.toLowerCase())),
              )
              .sort((a, b) => a.name.localeCompare(b.name))
              .slice(0, 300)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.pos}
                </option>
              ))}
          </select>
        </Field>
      </Group>

      <Group
        title="Teams to search"
        summary={
          s.selectedTeams === undefined
            ? `All ${opponentIds.length} ${opponentIds.length === 1 ? "team" : "teams"}`
            : `${chosenTeams.length} of ${opponentIds.length} teams`
        }
      >
        {s.opponents.map((t) => {
          const id = str(t.TeamID);
          return (
            <Check
              key={id}
              checked={chosenTeams.includes(id)}
              onChange={() => {
                const next = toggle(chosenTeams, id);
                s.setSelectedTeams(
                  next.length === opponentIds.length ? undefined : next,
                );
              }}
            >
              {str(t.TeamName)}
            </Check>
          );
        })}
        <div className="gd-chips">
          <button
            type="button"
            className="gd-cbtn"
            onClick={() => s.setSelectedTeams(undefined)}
          >
            Select all
          </button>
          <button
            type="button"
            className="gd-cbtn"
            onClick={() => s.setSelectedTeams([])}
          >
            Clear
          </button>
        </div>
      </Group>

      <Group title="Team needs" summary={needsSummary}>
        <Check checked={s.deficitOnly} onChange={s.setDeficitOnly}>
          Only teams with a positional deficit
        </Check>
        {s.deficitOnly && (
          <div className="gd-row2">
            <Field label="Deficit position">
              <select
                value={s.selectedPosition}
                onChange={(e) => s.setDeficitPosition(e.target.value)}
              >
                {(s.offeredPositions.length
                  ? s.offeredPositions
                  : [...positions]
                ).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Maximum position grade">
              <select
                value={s.deficitCeiling}
                onChange={(e) => s.setDeficitCeiling(e.target.value)}
              >
                {positionGradeScale.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <Check
          checked={s.deficitOnly && s.deficitProtection.enabled}
          disabled={!s.deficitOnly}
          onChange={(enabled) =>
            s.setDeficitProtection({
              ...s.deficitProtection,
              enabled,
              minimum:
                Number.isFinite(s.deficitProtection.minimum) &&
                s.deficitProtection.minimum > 0
                  ? s.deficitProtection.minimum
                  : defaultDeficitProtection.minimum,
            })
          }
        >
          Protect their weak positions
        </Check>
        {s.deficitOnly && s.deficitProtection.enabled && (
          <Field label="Minimum positional gain (points/week)">
            <input
              type="number"
              min="0.01"
              step="0.25"
              value={
                Number.isFinite(s.deficitProtection.minimum)
                  ? s.deficitProtection.minimum
                  : ""
              }
              onChange={(e) =>
                s.setDeficitProtection({
                  ...s.deficitProtection,
                  minimum: e.target.value.trim() ? Number(e.target.value) : NaN,
                })
              }
            />
          </Field>
        )}
        <Field label="Preview team">
          <select
            value={preview}
            onChange={(e) => setPreviewTeam(e.target.value)}
          >
            {opponentIds.map((id) => (
              <option key={id} value={id}>
                {teamName(id)}
              </option>
            ))}
          </select>
        </Field>
        <div
          className="gd-chips"
          aria-label={`${teamName(preview)} position grades`}
        >
          {grades.map((g) => (
            <span key={g.position} className="gd-gradepill">
              {g.position} {g.grade}
            </span>
          ))}
        </div>
      </Group>

      <Group
        title="Positional grade goals"
        summary={goalsSummary(s.gradeImpacts)}
      >
        <p className="gd-quiet">
          Goals are edited beside the results, where each one reads in plain
          language.
        </p>
        <button
          type="button"
          className="gd-cbtn"
          onClick={() =>
            document
              .querySelector(".gd-goals")
              ?.scrollIntoView({ behavior: "auto", block: "start" })
          }
        >
          Go to the goals
        </button>
      </Group>

      <Group title="What you receive" summary={receiveSummary}>
        <div role="group" aria-label="Position to receive">
          {positions.map((p: Position) => (
            <Check
              key={p}
              checked={s.incomingPositions.includes(p)}
              onChange={() =>
                s.setIncomingPositions(
                  toggle(s.incomingPositions, p) as Position[],
                )
              }
            >
              {p}
            </Check>
          ))}
        </div>
        {s.incomingPositions.length > 0 && (
          <Field label="Minimum incoming position matches">
            <input
              type="number"
              min="1"
              value={s.minimumPositions}
              onChange={(e) => s.setMinimumPositions(e.target.value)}
            />
          </Field>
        )}
        <div role="group" aria-label="Incoming players">
          {primaryGemSignals.map((sig) => (
            <Check
              key={sig}
              checked={s.signals.includes(sig)}
              onChange={() =>
                s.setSignals(toggle(s.signals, sig) as typeof s.signals)
              }
            >
              {sig}
            </Check>
          ))}
        </div>
        {s.signals.length > 0 && (
          <Field label="Minimum incoming Gem/Pre-gem/Watch matches">
            <input
              type="number"
              min="1"
              value={s.minimumSignals}
              onChange={(e) => s.setMinimumSignals(e.target.value)}
            />
          </Field>
        )}
      </Group>

      <Group
        title="Roster fit"
        summary={fitParts.length ? fitParts.join(" · ") : "No extra fit rules"}
      >
        <Check checked={s.usefulnessOnly} onChange={s.setUsefulnessOnly}>
          Every offered player must be useful to the other team
        </Check>
        {s.usefulnessOnly && (
          <Field label="Minimum usefulness improvement (Expected PPG)">
            <input
              type="number"
              step="0.25"
              value={s.minimumUsefulness}
              onChange={(e) => s.setMinimumUsefulness(e.target.value)}
            />
          </Field>
        )}
        <Check checked={s.upgradeOnly} onChange={s.setUpgradeOnly}>
          Only show positional upgrades for the other team
        </Check>
        {s.upgradeOnly && (
          <>
            <Field label="Upgrade target">
              <select
                value={s.upgradeMode}
                onChange={(e) =>
                  s.setUpgradeMode(e.target.value as typeof s.upgradeMode)
                }
              >
                <option value="starter">Starter</option>
                <option value="depth">Depth (bench)</option>
                <option value="either">Either</option>
                <option value="best">Best at position</option>
              </select>
            </Field>
            <Field label="Minimum Expected PPG upgrade">
              <input
                type="number"
                step="0.25"
                value={s.minimumUpgrade}
                onChange={(e) => s.setMinimumUpgrade(e.target.value)}
              />
            </Field>
            <Field
              label={
                s.upgradeMode === "either"
                  ? "Required starter upgrades"
                  : "Required upgrades"
              }
            >
              <input
                type="number"
                min="0"
                value={upgradeCount}
                onChange={(e) =>
                  s.upgradeMode === "either"
                    ? s.setRequiredStarters(e.target.value)
                    : s.setRequiredUpgrades(e.target.value)
                }
              />
            </Field>
            {s.upgradeMode === "either" && (
              <Field label="Required bench upgrades">
                <input
                  type="number"
                  min="0"
                  value={s.requiredBench}
                  onChange={(e) => s.setRequiredBench(e.target.value)}
                />
              </Field>
            )}
          </>
        )}
        {(["own", "other"] as const).map((side) => {
          const range = side === "own" ? s.ownWeekly : s.otherWeekly;
          const set = side === "own" ? s.setOwnWeekly : s.setOtherWeekly;
          const who = side === "own" ? "your" : "their";
          return (
            <div key={side} className="gd-fg-body">
              <Check
                checked={range.enabled}
                onChange={(enabled) => set({ ...range, enabled })}
              >
                Limit {who} weekly gain
              </Check>
              {range.enabled && (
                <div className="gd-row2">
                  <Field label={`Minimum ${who} gain per week`}>
                    <input
                      type="number"
                      step="0.25"
                      value={range.minimum}
                      onChange={(e) =>
                        set({ ...range, minimum: e.target.value })
                      }
                    />
                  </Field>
                  <Field label={`Maximum ${who} gain per week`}>
                    <input
                      type="number"
                      step="0.25"
                      value={range.maximum}
                      onChange={(e) =>
                        set({ ...range, maximum: e.target.value })
                      }
                    />
                  </Field>
                </div>
              )}
            </div>
          );
        })}
      </Group>

      <Group
        title="Search limits"
        summary={limitsSummary(limits)}
        edited={editedLimits(limits).length > 0}
      >
        <LimitsEditor
          limits={limits}
          update={updateLimits}
          reset={resetLimits}
        />
      </Group>

      <Group
        title="Manager profiles & acceptance"
        summary={s.manager ? "Surface Trading on" : "League baseline"}
      >
        <ManagerControls value={s.manager} change={s.setManager} />
      </Group>

      <Group title="Ranking" summary={rankLabels[s.discovery.ranking]}>
        <Field label="Rank trades by">
          <select
            value={s.discovery.ranking}
            onChange={(e) =>
              s.setDiscovery((d) => ({
                ...d,
                ranking: e.target.value as typeof d.ranking,
              }))
            }
          >
            {Object.entries(rankLabels).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Search goal">
          <select
            value={s.goal === "surface" ? "custom" : s.goal}
            onChange={(e) =>
              s.restoreQuery(
                guidedQuery(
                  s.query,
                  e.target.value as NonNullable<typeof s.goal>,
                  s.goalPosition,
                ),
              )
            }
          >
            <option value="explore">Trade away these players</option>
            <option value="improve">Improve my weekly scoring</option>
            <option value="position">Find a position upgrade</option>
            <option value="custom">Custom search</option>
          </select>
        </Field>
        {s.goal === "position" && (
          <Field label="Position to receive">
            <select
              value={s.goalPosition}
              onChange={(e) =>
                s.restoreQuery(
                  guidedQuery(s.query, "position", e.target.value as Position),
                )
              }
            >
              {positions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Check
          checked={s.discovery.nearMisses}
          onChange={(nearMisses) =>
            s.setDiscovery((d) => ({ ...d, nearMisses }))
          }
        >
          Show near misses and adjustments
        </Check>
      </Group>
    </>
  );
}
