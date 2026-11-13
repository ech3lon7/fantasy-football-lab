import { useState } from "react";
import { positions, str } from "../../../domain/contracts";
import type { Model } from "../../../domain/valuation";
import {
  chainPresetDescriptions,
  chainPresets,
  type ChainDiscovery,
} from "../../../domain/chain-discovery";
import { availableStarterPositions } from "../../../domain/chain-position-impact";
import {
  defaultChainFit,
  type ChainFitRule,
  type ChainQuery,
} from "../../../domain/trade-chains";
import { positionGradeScale } from "../../../domain/trade-search";
import {
  defaultDeficitProtection,
  type DeficitProtection,
} from "../../../domain/trade-safeguards";
import { useFeedback } from "../../../ui/feel/feedback";
import { ManagerControls } from "../../Negotiations";
import { Check, Field, Group } from "./controls";
import { GradeGoals } from "./GradeGoals";
import type { ChainSearchState } from "./useChainSearch";

type Leg = ChainQuery["first"];

// The design's order of the cards.
const presetOrder = [
  "balanced",
  "mutual",
  "star",
  "depth",
  "coverage",
  "connected",
  "surface",
  "speculative",
  "need",
  "flip",
];
const orderedPresets = [...chainPresets].sort(
  (a, b) => presetOrder.indexOf(a.id) - presetOrder.indexOf(b.id),
);

// The ten presets as one radio group: a preset only describes the kind of chain to look for.
export function ChainPresets({ s }: { s: ChainSearchState }) {
  const notify = useFeedback();
  return (
    <div className="gd-presets" role="radiogroup" aria-label="Chain preset">
      {orderedPresets.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={s.preset === p.id}
          className="gd-pre"
          onClick={() => {
            notify("select");
            s.choosePreset(p.id);
          }}
        >
          <span className="gd-pre-name">{p.label}</span>
          <span className="gd-pre-desc">{chainPresetDescriptions[p.id]}</span>
        </button>
      ))}
      {s.preset === "custom" && (
        <button
          type="button"
          role="radio"
          aria-checked="true"
          className="gd-pre"
          data-new="true"
        >
          <span className="gd-pre-name">Custom</span>
          <span className="gd-pre-desc">
            Your own settings, changed since the last preset.
          </span>
        </button>
      )}
      {s.customPresets.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={s.preset === p.id}
          className="gd-pre"
          data-new="true"
          onClick={() => {
            notify("select");
            s.choosePreset(p.id);
          }}
        >
          <span className="gd-pre-name">{p.name}</span>
          <span className="gd-pre-desc">Your saved preset.</span>
        </button>
      ))}
    </div>
  );
}

const sizes = [1, 2, 3, 4, 5];

// One trade's settings in folding groups; every control of the earlier planner is here, with the same labels.
function LegSettings({
  m,
  s,
  label,
  value,
  change,
  override,
  setOverride,
}: {
  m: Model;
  s: ChainSearchState;
  label: "First trade" | "Second trade";
  value: Leg;
  change: (next: Leg) => void;
  override: boolean;
  setOverride: (on: boolean) => void;
}) {
  const opponents = m.dataset.tables.ModelTeams.filter(
    (t) => str(t.TeamID) !== "0" && str(t.TeamID) !== s.team,
  );
  const scope = override ? value.teams : s.selectedTeams;
  const teams =
    label === "First trade" ? s.query.first.teams : s.query.second.teams;
  const firstTeams = s.query.first.teams;
  const required =
    (value.requiredGive?.length ?? 0) + (value.requiredGet?.length ?? 0);
  const fit = (kind: "surplus" | "deficit") =>
    value.fit?.[kind] ?? defaultChainFit(kind);
  const setFit = (kind: "surplus" | "deficit", patch: Partial<ChainFitRule>) =>
    change({
      ...value,
      fit: { ...value.fit, [kind]: { ...fit(kind), ...patch } },
      ...(kind === "deficit" && patch.grade
        ? {
            deficitProtection: {
              ...(value.deficitProtection ?? defaultDeficitProtection),
              ceiling: patch.grade,
            },
          }
        : {}),
    });
  const protection: DeficitProtection = value.deficitProtection ?? {
    ...defaultDeficitProtection,
    enabled: false,
  };
  const targeting = !!fit("deficit").enabled;
  const fitCount = (["surplus", "deficit"] as const).filter(
    (k) => fit(k).enabled,
  ).length;
  const selectedAll = value.teams === undefined;

  return (
    <div className="gd-fgs">
      <Group
        title="Packages & required players"
        summary={`Offer ${value.offer.minimum}–${value.offer.maximum} · receive ${value.receive.minimum}–${value.receive.maximum}${required ? ` · ${required} required` : ""}`}
      >
        {(["offer", "receive"] as const).map((direction) => (
          <div key={direction} className="gd-row2">
            {(["minimum", "maximum"] as const).map((bound) => (
              <Field key={bound} label={`${label} ${direction} ${bound}`}>
                <select
                  className="gd-sel"
                  value={value[direction][bound]}
                  onChange={(e) =>
                    change({
                      ...value,
                      [direction]: {
                        ...value[direction],
                        [bound]: Number(e.target.value),
                      },
                    })
                  }
                >
                  {sizes.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
        ))}
        <Field label={`${label}: Required incoming position`}>
          <select
            className="gd-sel"
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
        </Field>
        {(["requiredGive", "requiredGet"] as const).map((field) => {
          const offered = field === "requiredGive";
          const selected = value[field] ?? [];
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
                  p.owner !== s.team &&
                  (!teams || teams.includes(p.owner))
                );
              return p.owner === s.team
                ? s.pool.includes(p.id)
                : label === "Second trade" &&
                    p.owner !== "0" &&
                    (!firstTeams || firstTeams.includes(p.owner));
            })
            .sort((a, b) => a.name.localeCompare(b.name));
          return (
            <div key={field}>
              <Field
                label={`${label}: Require ${offered ? "offered" : "received"} player`}
              >
                <select
                  className="gd-sel"
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
                      {offered && p.owner !== s.team ? " · acquire first" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="gd-chips">
                {selected.map((id) => (
                  <button
                    type="button"
                    key={id}
                    className="gd-cbtn"
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
      </Group>

      <Group
        title="Teams for this trade"
        summary={
          override
            ? `${value.teams?.length ?? "All"} teams (override)`
            : `Follows the planner · ${s.selectedTeams?.length ?? "all"} teams`
        }
      >
        <Check
          checked={override}
          onChange={(on) => {
            setOverride(on);
            if (on)
              change({
                ...value,
                teams: s.selectedTeams ? [...s.selectedTeams] : undefined,
              });
          }}
        >
          <span aria-label={`Override ${label.toLowerCase()} teams`}>
            Override {label.toLowerCase()} teams
          </span>
        </Check>
        {!override && (
          <p className="gd-quiet">
            Uses the teams chosen for the whole chain. Turn on the override to
            choose a different scope for this trade only.
          </p>
        )}
        {override && (
          <>
            <div className="gd-chips">
              <button
                type="button"
                className="gd-cbtn"
                onClick={() => change({ ...value, teams: undefined })}
              >
                Select all
              </button>
              <button
                type="button"
                className="gd-cbtn"
                onClick={() => change({ ...value, teams: [] })}
              >
                Clear selection
              </button>
            </div>
            {opponents.map((t) => {
              const id = str(t.TeamID);
              return (
                <label key={id} className="gd-chk">
                  <input
                    type="checkbox"
                    aria-label={`${label} team: ${str(t.TeamName)}`}
                    checked={selectedAll || !!value.teams?.includes(id)}
                    onChange={(e) => {
                      const current =
                        value.teams ?? opponents.map((o) => str(o.TeamID));
                      change({
                        ...value,
                        teams: e.target.checked
                          ? [...current, id]
                          : current.filter((x) => x !== id),
                      });
                    }}
                  />
                  <span>{str(t.TeamName)}</span>
                </label>
              );
            })}
          </>
        )}
        <span className="gd-quiet">
          {scope === undefined
            ? "All teams searched"
            : `${scope.length} teams searched`}
        </span>
      </Group>

      <Group
        title="Team needs"
        summary={
          fitCount
            ? `${fitCount} fit rule${fitCount === 1 ? "" : "s"} on`
            : "No fit rules"
        }
        edited={fitCount > 0}
      >
        {(["surplus", "deficit"] as const).map((kind) => {
          const rule = fit(kind);
          const title =
            kind === "surplus"
              ? "Receive from their surplus"
              : "Offer into their deficit";
          return (
            <div key={kind} className="gd-rule">
              <Check
                checked={rule.enabled}
                onChange={(on) => setFit(kind, { enabled: on })}
              >
                {label}: {title}
              </Check>
              {rule.enabled && (
                <>
                  <Field label={`${label} ${kind} targeting`}>
                    <select
                      className="gd-sel"
                      value={rule.mode}
                      onChange={(e) =>
                        setFit(kind, {
                          mode: e.target.value as ChainFitRule["mode"],
                        })
                      }
                    >
                      <option value="prefer">Prefer matches</option>
                      <option value="require">Require matches</option>
                    </select>
                  </Field>
                  <Field label={`${label} ${kind} grade`}>
                    <select
                      className="gd-sel"
                      value={rule.grade}
                      onChange={(e) => setFit(kind, { grade: e.target.value })}
                    >
                      {positionGradeScale.map((g) => (
                        <option key={g} value={g}>
                          {g} or {kind === "deficit" ? "lower" : "higher"}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={`${label} ${kind} positions match`}>
                    <select
                      className="gd-sel"
                      value={rule.match}
                      onChange={(e) =>
                        setFit(kind, {
                          match: e.target.value as ChainFitRule["match"],
                        })
                      }
                    >
                      <option value="any">
                        At least one relevant position
                      </option>
                      <option value="all">All relevant positions</option>
                    </select>
                  </Field>
                  <div
                    className="gd-chips"
                    role="group"
                    aria-label={`${label} ${kind} positions (none selected = automatic)`}
                  >
                    {positions.map((p) => (
                      <label key={p} className="gd-chk">
                        <input
                          type="checkbox"
                          aria-label={`${label} ${kind} position: ${p}`}
                          checked={rule.positions.includes(p)}
                          onChange={(e) =>
                            setFit(kind, {
                              positions: e.target.checked
                                ? [...rule.positions, p]
                                : rule.positions.filter((x) => x !== p),
                            })
                          }
                        />
                        <span>{p}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
        <Check
          checked={targeting && protection.enabled}
          disabled={!targeting}
          onChange={(on) =>
            change({
              ...value,
              deficitProtection: {
                ...protection,
                enabled: on,
                minimum:
                  Number.isFinite(protection.minimum) && protection.minimum > 0
                    ? protection.minimum
                    : defaultDeficitProtection.minimum,
              },
            })
          }
        >
          <span aria-label={`${label}: Protect their weak positions`}>
            Protect their weak positions
          </span>
        </Check>
        {targeting && protection.enabled && (
          <Field label={`${label}: Minimum positional gain`}>
            <input
              className="gd-sel"
              type="number"
              min="0.01"
              step="0.25"
              value={
                Number.isFinite(protection.minimum) ? protection.minimum : ""
              }
              onChange={(e) =>
                change({
                  ...value,
                  deficitProtection: {
                    ...protection,
                    minimum: e.target.value.trim()
                      ? Number(e.target.value)
                      : NaN,
                  },
                })
              }
            />
          </Field>
        )}
      </Group>

      <Group
        title="Positional grade goals"
        summary={
          value.gradeLimit || value.gradeImpacts?.length
            ? `${(value.gradeImpacts?.length ?? 0) + (value.gradeLimit ? 1 : 0)} on`
            : "None"
        }
        edited={!!value.gradeLimit || !!value.gradeImpacts?.length}
      >
        <Check
          checked={!!value.gradeLimit}
          onChange={(on) =>
            change({
              ...value,
              gradeLimit: on ? { side: "other", maximumDrop: 2 } : undefined,
            })
          }
        >
          <span aria-label={`${label}: Limit positional grade drops`}>
            Limit positional grade drops
          </span>
        </Check>
        {value.gradeLimit && (
          <>
            <Field label={`${label}: Protect grades for`}>
              <select
                className="gd-sel"
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
            </Field>
            <Field label={`${label}: Maximum grade steps lost`}>
              <select
                className="gd-sel"
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
            </Field>
          </>
        )}
        <GradeGoals
          m={m}
          draft={{ teamA: s.team, teamB: "", give: [], get: [] }}
          rules={value.gradeImpacts ?? []}
          scope={label}
          onChange={(rules) =>
            change({ ...value, gradeImpacts: rules.length ? rules : undefined })
          }
        />
        <p className="gd-quiet">
          Available starter positions:{" "}
          {availableStarterPositions(m).join(", ") || "none"}.
        </p>
      </Group>

      <Group
        title="Manager profiles & acceptance"
        summary={value.manager ? "Surface Trading on" : "League baseline"}
        edited={!!value.manager}
      >
        <ManagerControls
          label={`${label}: Enable Surface Trading`}
          value={value.manager}
          change={(manager) => change({ ...value, manager })}
        />
      </Group>
    </div>
  );
}

// The Trade 1 / Trade 2 switch, one trade's folding groups at a time.
export function ChainLegs({ m, s }: { m: Model; s: ChainSearchState }) {
  const [step, setStep] = useState<1 | 2>(1);
  return (
    <section className="gd-card" aria-label="Per-trade settings">
      <div className="gd-chips" style={{ justifyContent: "space-between" }}>
        <h3>Per-trade settings</h3>
        <div className="gd-switch" role="group" aria-label="Trade to edit">
          <button
            type="button"
            aria-pressed={step === 1}
            onClick={() => setStep(1)}
          >
            Trade 1 settings
          </button>
          <button
            type="button"
            aria-pressed={step === 2}
            onClick={() => setStep(2)}
          >
            Trade 2 settings
          </button>
        </div>
      </div>
      <p className="gd-quiet">
        Each trade keeps its own packages, teams, fit rules and grade goals.
      </p>
      {step === 1 ? (
        <LegSettings
          key="first"
          m={m}
          s={s}
          label="First trade"
          value={s.first}
          change={s.setFirst}
          override={s.firstOverride}
          setOverride={s.setFirstOverride}
        />
      ) : (
        <LegSettings
          key="second"
          m={m}
          s={s}
          label="Second trade"
          value={s.second}
          change={s.setSecond}
          override={s.secondOverride}
          setOverride={s.setSecondOverride}
        />
      )}
    </section>
  );
}

const MAX_POOL = 12;

// The whole-chain group: team and basis, tradable pool, teams to search, the dependency between the trades and how plans rank.
export function ChainWhole({ m, s }: { m: Model; s: ChainSearchState }) {
  const opponents = m.dataset.tables.ModelTeams.filter(
    (t) => str(t.TeamID) !== "0" && str(t.TeamID) !== s.team,
  );
  const mine = m.players
    .filter((p) => p.owner === s.team)
    .sort((a, b) => a.name.localeCompare(b.name));
  const d = s.discovery;
  const setD = (next: Partial<ChainDiscovery>) =>
    s.setDiscovery({ ...d, ...next });
  const teamName = (id: string) =>
    str(
      m.dataset.tables.ModelTeams.find((t) => str(t.TeamID) === id)?.TeamName,
    ) || id;
  return (
    <section className="gd-card" aria-label="Whole-chain settings">
      <h3>Whole chain</h3>
      <div className="gd-fgs">
        <Group
          title="Players & teams"
          summary={`${s.pool.length}/${MAX_POOL} tradable · ${s.selectedTeams?.length ?? "All"} teams`}
        >
          <Field label="Chain team">
            <select
              className="gd-sel"
              value={s.team}
              onChange={(e) => s.setTeam(e.target.value)}
            >
              {m.dataset.tables.ModelTeams.filter(
                (t) => str(t.TeamID) !== "0",
              ).map((t) => (
                <option key={str(t.TeamID)} value={str(t.TeamID)}>
                  {str(t.TeamName)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Chain lineup impact basis">
            <select
              className="gd-sel"
              value={s.basis}
              onChange={(e) => s.setBasis(e.target.value as typeof s.basis)}
            >
              <option value="best-available">Best available lineup</option>
              <option value="marked-starters">Marked starters</option>
            </select>
          </Field>
          <div className="gd-chips">
            <span className="gd-quiet">
              Chain tradable pool ({s.pool.length}/{MAX_POOL}). Other original
              roster players stay protected.
            </span>
            <button
              type="button"
              className="gd-cbtn"
              disabled={
                s.pool.length >= MAX_POOL ||
                mine.every((p) => s.pool.includes(p.id))
              }
              onClick={() =>
                s.setPool((old) =>
                  [
                    ...new Set([
                      ...old.filter((id) => mine.some((p) => p.id === id)),
                      ...mine.map((p) => p.id),
                    ]),
                  ].slice(0, MAX_POOL),
                )
              }
            >
              Select all{mine.length > MAX_POOL ? " (up to 12)" : ""}
            </button>
          </div>
          {mine.map((p) => (
            <label key={p.id} className="gd-chk">
              <input
                type="checkbox"
                aria-label={`Chain tradable player: ${p.name}`}
                checked={s.pool.includes(p.id)}
                disabled={!s.pool.includes(p.id) && s.pool.length >= MAX_POOL}
                onChange={(e) =>
                  s.setPool((old) =>
                    e.target.checked
                      ? [...old, p.id]
                      : old.filter((id) => id !== p.id),
                  )
                }
              />
              <span>
                {p.name} · {p.pos}
              </span>
              <span className="gd-ct">
                {p.index === null ? "—" : p.index.toFixed(1)}
              </span>
            </label>
          ))}
          <div className="gd-chips">
            <button
              type="button"
              className="gd-cbtn"
              onClick={() => s.setSelectedTeams(undefined)}
            >
              Select all chain teams
            </button>
            <button
              type="button"
              className="gd-cbtn"
              onClick={() => s.setSelectedTeams([])}
            >
              Clear chain team selection
            </button>
          </div>
          {opponents.map((t) => {
            const id = str(t.TeamID);
            return (
              <label key={id} className="gd-chk">
                <input
                  type="checkbox"
                  aria-label={`Chain search team: ${str(t.TeamName)}`}
                  checked={
                    s.selectedTeams === undefined ||
                    s.selectedTeams.includes(id)
                  }
                  onChange={(e) =>
                    s.setSelectedTeams((previous) => {
                      const current =
                        previous ?? opponents.map((o) => str(o.TeamID));
                      return e.target.checked
                        ? [...current, id]
                        : current.filter((x) => x !== id);
                    })
                  }
                />
                <span>{str(t.TeamName)}</span>
              </label>
            );
          })}
        </Group>

        <Group
          title="Dependency & ranking"
          summary={`${d.sequences === "connected" ? "Connected chains" : d.sequences === "both" ? "Both types" : "Sequential upgrades"} · ${d.ranking === "own" ? "your gain" : d.ranking === "mutual" ? "both sides" : "recipient appeal"}`}
        >
          <Field label="Sequence types">
            <select
              className="gd-sel"
              value={d.sequences}
              onChange={(e) =>
                setD({
                  sequences: e.target.value as ChainDiscovery["sequences"],
                })
              }
            >
              <option value="connected">Connected chains</option>
              <option value="sequential">
                Independent sequential upgrades
              </option>
              <option value="both">Both types</option>
            </select>
          </Field>
          <Field label="Rank plans by">
            <select
              className="gd-sel"
              value={d.ranking}
              onChange={(e) =>
                setD({ ranking: e.target.value as ChainDiscovery["ranking"] })
              }
            >
              <option value="own">Your EPPG gain</option>
              <option value="mutual">Benefit to both sides</option>
              <option value="appeal">Apparent recipient appeal</option>
            </select>
          </Field>
          <Field label="Dependency route">
            <select
              className="gd-sel"
              value={s.dependencyRoute}
              onChange={(e) =>
                s.setDependencyRoute(e.target.value as typeof s.dependencyRoute)
              }
            >
              <option value="either">Either connected route</option>
              <option value="retrade">Re-trade acquisition</option>
              <option value="retain">Keep-and-release</option>
            </select>
          </Field>
          <Field label="Minimum acquired contribution (%)">
            <input
              className="gd-sel"
              type="number"
              step="0.1"
              min={0.1}
              max={100}
              value={s.acquiredShare}
              onChange={(e) => s.setAcquiredShare(e.target.value)}
            />
          </Field>
          <Field label="Minimum interaction gain (EPPG)">
            <input
              className="gd-sel"
              type="number"
              step="0.1"
              min={0.1}
              value={s.interactionGain}
              onChange={(e) => s.setInteractionGain(e.target.value)}
            />
          </Field>
        </Group>

        <Group
          title="Targets & exclusions"
          summary={
            d.requiredTargets?.length || d.position
              ? `${d.requiredTargets?.length ?? 0} required · ${d.position ?? "any position"}`
              : "No required target"
          }
          edited={!!d.requiredTargets?.length || !!d.position}
        >
          <Field label="Target roster need">
            <select
              className="gd-sel"
              value={d.position ?? "any"}
              onChange={(e) =>
                setD({
                  position:
                    e.target.value === "any"
                      ? undefined
                      : (e.target.value as ChainDiscovery["position"]),
                })
              }
            >
              <option value="any">Any position</option>
              {positions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value="depth">Depth</option>
            </select>
          </Field>
          <Field label="Add required final target">
            <select
              className="gd-sel"
              value=""
              onChange={(e) => {
                if (e.target.value)
                  setD({
                    requiredTargets: [
                      ...new Set([
                        ...(d.requiredTargets ?? []),
                        e.target.value,
                      ]),
                    ],
                  });
              }}
            >
              <option value="">Choose a player</option>
              {m.players
                .filter((p) => p.owner !== s.team && p.owner !== "0")
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} - {p.pos}
                  </option>
                ))}
            </select>
          </Field>
          <div className="gd-chips">
            {(d.requiredTargets ?? []).map((id) => (
              <button
                key={id}
                type="button"
                className="gd-cbtn"
                aria-label={`Remove required target ${m.byId.get(id)?.name ?? "unavailable player"}`}
                onClick={() =>
                  setD({
                    requiredTargets: d.requiredTargets!.filter((x) => x !== id),
                  })
                }
              >
                {m.byId.get(id)?.name ?? "Unavailable target"} ×
              </button>
            ))}
          </div>
          {d.pinnedFirst && (
            <div className="gd-rule">
              <b>Locked first trade</b>
              <p className="gd-quiet">
                {d.pinnedFirst.give
                  .map((id) => m.byId.get(id)?.name ?? id)
                  .join(", ")}{" "}
                for{" "}
                {d.pinnedFirst.get
                  .map((id) => m.byId.get(id)?.name ?? id)
                  .join(", ")}{" "}
                · {teamName(d.pinnedFirst.teamB)}. Preview only; saved rosters
                are unchanged.
              </p>
              <button
                type="button"
                className="gd-cbtn"
                onClick={() => setD({ pinnedFirst: undefined })}
              >
                Unlock first trade
              </button>
            </div>
          )}
          <Check
            checked={!!d.broaden?.enabled}
            onChange={(on) =>
              setD({
                broaden: {
                  maximumRecipientLoss: 4,
                  maximumValueLossPct: 0.35,
                  indexExtra: 20,
                  ...d.broaden,
                  enabled: on,
                },
              })
            }
          >
            Automatically broaden empty searches
          </Check>
        </Group>
      </div>
    </section>
  );
}
