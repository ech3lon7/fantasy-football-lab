import { useState } from "react";
import type { Model } from "../domain/valuation";
import { settingsSchema, tableNames, type Settings } from "../domain/contracts";
import type { GemTrackingState } from "../domain/gem-tracking";
import { historicalLabelAudit } from "../domain/historical-label-reference";
import { effectiveLabelRules } from "../domain/label-rules";
import { DataTable, fmt } from "../ui/components";
import { PlayerName } from "../ui/PlayerName";
import { GemTracking } from "./GemTracking";

interface SettingField {
  key: keyof Settings;
  label: string;
  desc: string;
  step?: string;
  unit?: string;
}

const SETTING_GROUPS: {
  title: string;
  description: string;
  fields: SettingField[];
}[] = [
  {
    title: "Forecast",
    description: "Baseline scoring projection and touchdown expectation rates.",
    fields: [
      {
        key: "PriorGames",
        label: "Prior games for forecast confidence",
        desc: "Games of history before season projections reach full weight.",
        step: "1",
        unit: "games",
      },
      {
        key: "RecentWeight",
        label: "Recent PPG weight",
        desc: "Weight applied to recent games versus season baseline.",
        step: "0.01",
        unit: "share",
      },
      {
        key: "CarriesPerTD",
        label: "Carries per rushing TD",
        desc: "League baseline carry count expected per rushing touchdown.",
        step: "0.1",
        unit: "carries",
      },
      {
        key: "TargetsPerTD",
        label: "Targets per receiving TD",
        desc: "League baseline target count expected per receiving touchdown.",
        step: "0.1",
        unit: "targets",
      },
    ],
  },
  {
    title: "Consistency",
    description: "Adjustments for weekly variance and scoring reliability.",
    fields: [
      {
        key: "ConsistencyCoefficient",
        label: "Consistency loss weight",
        desc: "Penalty coefficient applied for weekly scoring volatility.",
        step: "0.01",
        unit: "weight",
      },
      {
        key: "ConsistencyCap",
        label: "Consistency penalty cap",
        desc: "Maximum consistency loss penalty applied to value.",
        step: "0.01",
        unit: "cap",
      },
      {
        key: "MinConsistencyGames",
        label: "Minimum games for consistency",
        desc: "Minimum completed games before consistency penalties apply.",
        step: "1",
        unit: "games",
      },
    ],
  },
  {
    title: "Gem rules",
    description: "Criteria for prospective breakout targets and waiver gems.",
    fields: [
      {
        key: "MinOpportunity",
        label: "Minimum opportunities baseline",
        desc: "Minimum season opportunities required for classification.",
        step: "1",
        unit: "opps",
      },
      {
        key: "GemMinGames",
        label: "Minimum games played",
        desc: "Games needed to evaluate candidate breakout trajectories.",
        step: "1",
        unit: "games",
      },
      {
        key: "GemMinGap",
        label: "Opportunity point gap",
        desc: "Minimum expected versus actual point gap to trigger gem alert.",
        step: "0.1",
        unit: "pts",
      },
      {
        key: "GemMinGapPct",
        label: "Opportunity point gap %",
        desc: "Minimum percentage gap between expected and actual scoring.",
        step: "0.01",
        unit: "%",
      },
      {
        key: "GemMinPriorGames",
        label: "Minimum prior games",
        desc: "Historical games required before gem signals evaluate.",
        step: "1",
        unit: "games",
      },
      {
        key: "GemTrendFloor",
        label: "Trend point floor",
        desc: "Absolute PPG improvement needed across recent performances.",
        step: "0.1",
        unit: "pts",
      },
      {
        key: "GemTrendPctFloor",
        label: "Trend percentage floor",
        desc: "Relative percentage growth required across recent performances.",
        step: "0.01",
        unit: "%",
      },
      {
        key: "GemWRTargets",
        label: "WR minimum targets",
        desc: "Recent target volume required for WR breakout eligibility.",
        step: "1",
        unit: "targets",
      },
      {
        key: "GemWRShare",
        label: "WR target share",
        desc: "Team target share percentage required for WR gem classification.",
        step: "0.01",
        unit: "share",
      },
      {
        key: "GemTETargets",
        label: "TE minimum targets",
        desc: "Recent target volume required for TE breakout eligibility.",
        step: "1",
        unit: "targets",
      },
      {
        key: "GemTEShare",
        label: "TE target share",
        desc: "Team target share percentage required for TE gem classification.",
        step: "0.01",
        unit: "share",
      },
      {
        key: "GemRBOpportunities",
        label: "RB minimum opportunities",
        desc: "Combined carries and targets required for RB breakout watch.",
        step: "1",
        unit: "opps",
      },
      {
        key: "GemRBRushShare",
        label: "RB rushing share",
        desc: "Percentage of team rushing attempts handled by the player.",
        step: "0.01",
        unit: "share",
      },
      {
        key: "GemRBTargetShare",
        label: "RB target share",
        desc: "Percentage of team pass targets directed to the running back.",
        step: "0.01",
        unit: "share",
      },
    ],
  },
  {
    title: "Grades",
    description: "Positional balance thresholds and league power grading.",
    fields: [
      {
        key: "GradeDMinus",
        label: "Grade D- threshold",
        desc: "Relative rating boundary for D- rank.",
        step: "0.01",
        unit: "rating",
      },
      {
        key: "GradeD",
        label: "Grade D threshold",
        desc: "Relative rating boundary for D rank.",
        step: "0.01",
        unit: "rating",
      },
      {
        key: "GradeDPlus",
        label: "Grade D+ threshold",
        desc: "Relative rating boundary for D+ rank.",
        step: "0.01",
        unit: "rating",
      },
      {
        key: "GradeCMinus",
        label: "Grade C- threshold",
        desc: "Relative rating boundary for C- rank.",
        step: "0.01",
        unit: "rating",
      },
      {
        key: "GradeC",
        label: "Grade C threshold",
        desc: "Relative rating boundary for C rank.",
        step: "0.01",
        unit: "rating",
      },
      {
        key: "GradeCPlus",
        label: "Grade C+ threshold",
        desc: "Relative rating boundary for C+ rank.",
        step: "0.01",
        unit: "rating",
      },
      {
        key: "GradeBMinus",
        label: "Grade B- threshold",
        desc: "Relative rating boundary for B- rank.",
        step: "0.01",
        unit: "rating",
      },
      {
        key: "GradeB",
        label: "Grade B threshold",
        desc: "Relative rating boundary for B rank.",
        step: "0.01",
        unit: "rating",
      },
      {
        key: "GradeBPlus",
        label: "Grade B+ threshold",
        desc: "Relative rating boundary for B+ rank.",
        step: "0.01",
        unit: "rating",
      },
      {
        key: "GradeAMinus",
        label: "Grade A- threshold",
        desc: "Relative rating boundary for A- rank.",
        step: "0.01",
        unit: "rating",
      },
      {
        key: "GradeA",
        label: "Grade A threshold",
        desc: "Relative rating boundary for A rank.",
        step: "0.01",
        unit: "rating",
      },
      {
        key: "GradeAPlus",
        label: "Grade A+ threshold",
        desc: "Relative rating boundary for A+ rank.",
        step: "0.01",
        unit: "rating",
      },
    ],
  },
  {
    title: "Trades",
    description: "Surplus index value calculations and package loss tolerance.",
    fields: [
      {
        key: "Premium",
        label: "Package premium exponent",
        desc: "Scaling premium applied to multi-player consolidation trades.",
        step: "0.01",
        unit: "mult",
      },
      {
        key: "FairBandPct",
        label: "Fair trade tolerance %",
        desc: "Allowable value percentage difference considered a fair trade.",
        step: "0.01",
        unit: "%",
      },
      {
        key: "ExcellentPct",
        label: "Excellent gain threshold %",
        desc: "Percentage surplus advantage designating an Excellent trade.",
        step: "0.01",
        unit: "%",
      },
      {
        key: "StealPct",
        label: "Steal gain threshold %",
        desc: "Percentage surplus advantage designating a Steal deal.",
        step: "0.01",
        unit: "%",
      },
      {
        key: "BadLossPct",
        label: "Bad trade loss threshold %",
        desc: "Percentage deficit threshold designating a Bad trade.",
        step: "0.01",
        unit: "%",
      },
      {
        key: "HorribleLossPct",
        label: "Horrible trade loss threshold %",
        desc: "Percentage deficit threshold designating a Horrible trade.",
        step: "0.01",
        unit: "%",
      },
      {
        key: "ReserveCutoff",
        label: "Reserve eligibility cutoff",
        desc: "Proportionate cutoff for scoring reserve player contributions.",
        step: "0.01",
        unit: "share",
      },
    ],
  },
];

export function ModelView({
  m,
  change,
  tracking = null,
  part,
}: {
  // The Gameday Plus Lab shows the settings and the audits on separate pages; omitted shows everything, as before.
  part?: "settings" | "audits";
  m: Model;
  change: (s: Settings) => void;
  tracking?: Promise<GemTrackingState> | null;
}) {
  const [message, setMessage] = useState("");
  // Build compact method context from aggregate-only evidence and the same effective settings used by classification.
  const labelAudit = historicalLabelAudit(m);
  const labelRules = effectiveLabelRules(m.settings);

  return (
    <>
      {(!part || part === "settings") && (
        <div className="gd-model-settings">
          <h2 className="gd-h2">Model settings</h2>
          {message && (
            <p className="notice danger" role="alert">
              {message}
            </p>
          )}
          {SETTING_GROUPS.map((group) => (
            <section key={group.title} className="gd-card gd-settings-group">
              <div className="gd-settings-group-header">
                <h3 className="gd-settings-group-title">{group.title}</h3>
                <p className="gd-muted">{group.description}</p>
              </div>
              <div className="gd-settings-group-grid">
                {group.fields.map((field) => (
                  <label key={field.key} className="gd-edit-control">
                    <div className="gd-edit-control-head">
                      <span className="gd-edit-label">{field.label}</span>
                      {field.unit && (
                        <small className="gd-edit-unit">{field.unit}</small>
                      )}
                    </div>
                    <input
                      type="number"
                      step={field.step ?? "any"}
                      className="gd-edit-input"
                      value={m.settings[field.key]}
                      onChange={(e) => {
                        const candidate = {
                          ...m.settings,
                          [field.key]: e.target.valueAsNumber,
                        };
                        const result = settingsSchema.safeParse(candidate);
                        if (result.success) {
                          change(result.data);
                          setMessage("");
                        } else {
                          setMessage(
                            `${field.label}: ${result.error.issues.map((x) => x.message).join("; ")}`,
                          );
                        }
                      }}
                    />
                    <span className="gd-edit-desc">{field.desc}</span>
                  </label>
                ))}
              </div>
            </section>
          ))}
          <p className="gd-muted">
            Expected PPG is the scoring forecast. Value PPG adjusts it for
            consistency. Surplus index measures value above available
            replacements.
          </p>
        </div>
      )}
      {/* Automatic dated comparisons remain separate from current settings, historical summaries and live labels. */}
      {!part && <GemTracking tracking={tracking} />}
      {(!part || part === "audits") && (
        <>
          {/* Keep research and rule inventories collapsed while preserving the existing settings and baseline workflow. */}
          <section className="gd-card gd-audit-card">
            <div className="gd-audit-card-head">
              <h2 className="gd-h2">Player-label evidence</h2>
              <p className="gd-muted">{labelAudit.version}</p>
            </div>
            <p>{labelAudit.status}</p>
            <details>
              <summary>Historical label research</summary>
              <p>{labelAudit.outcome}</p>
              <p>{labelAudit.volume}</p>
              <DataTable
                rows={labelAudit.rows}
                id={(r) => r.id}
                columns={[
                  { key: "tag", label: "Label", value: (r) => r.tag },
                  { key: "unit", label: "Unit", value: (r) => r.unit },
                  {
                    key: "sample",
                    label: "Successes / labels",
                    kind: "fact",
                    value: (r) => r.sample,
                  },
                  {
                    key: "rate",
                    label: "Historical rate",
                    kind: "fact",
                    value: (r) => r.rate,
                  },
                  {
                    key: "base",
                    label: "Matched base rate",
                    kind: "fact",
                    value: (r) => r.base,
                  },
                  {
                    key: "lift",
                    label: "Lift over base",
                    kind: "fact",
                    value: (r) => r.lift,
                  },
                  {
                    key: "volume",
                    label: "Label volume",
                    kind: "fact",
                    value: (r) => r.volume,
                  },
                  {
                    key: "followup",
                    label: "Missing outcomes",
                    value: (r) => r.followup,
                  },
                  {
                    key: "seasons",
                    label: "Successes / labels by season",
                    value: (r) => r.seasons,
                  },
                ]}
              />
              <p>
                <small>{labelAudit.baseline}</small>
              </p>
              <p>{labelAudit.scoring}</p>
              <p>
                <small>{labelAudit.limitations}</small>
              </p>
              {/* Fingerprints are unbroken identifiers; wrap this new audit line so it cannot widen the mobile page. */}
              <p style={{ overflowWrap: "anywhere" }}>
                <small>
                  Evidence binding: {labelAudit.binding.researchSHA256};
                  aggregate: {labelAudit.binding.aggregateSHA256}.
                </small>
              </p>
            </details>
            <details>
              <summary>Active label rules and parameters</summary>
              <p>{labelAudit.policy}</p>
              <DataTable
                rows={labelRules}
                id={(r) => r.id}
                columns={[
                  { key: "id", label: "Rule", value: (r) => r.id },
                  {
                    key: "positions",
                    label: "Positions",
                    value: (r) => r.positions,
                  },
                  {
                    key: "window",
                    label: "Windows / routes",
                    value: (r) => r.window,
                  },
                  {
                    key: "parameters",
                    label: "Effective parameters",
                    kind: "model",
                    value: (r) =>
                      r.parameters
                        .map(
                          (p) =>
                            `${p.id}: ${p.operator} ${p.value} ${p.unit} (${p.binding})`,
                        )
                        .join("; "),
                  },
                  {
                    key: "evidence",
                    label: "Evidence status",
                    value: (r) => r.evidence,
                  },
                ]}
              />
            </details>
          </section>
          <section className="gd-card gd-audit-card">
            <div className="gd-audit-card-head">
              <h2 className="gd-h2">Replacement baseline audit</h2>
              <p className="gd-muted">
                Mean of the top three eligible available players. Hypothetical
                trades do not change these pools.
              </p>
            </div>
            <DataTable
              rows={m.pools}
              id={(p) => p.position}
              columns={[
                {
                  key: "pos",
                  label: "Position",
                  kind: "fact",
                  value: (p) => p.position,
                },
                {
                  key: "count",
                  label: "Eligible count",
                  kind: "model",
                  value: (p) => p.eligible,
                },
                {
                  key: "used",
                  label: "Pool used",
                  kind: "model",
                  value: (p) => p.candidates.length,
                },
                {
                  key: "avg",
                  label: "Mean Value PPG",
                  kind: "model",
                  value: (p) => p.value,
                },
                {
                  key: "names",
                  label: "Selected candidates",
                  value: (p) =>
                    p.candidates
                      .map((x) => `${x.name}: ${fmt(x.value)}`)
                      .join("; "),
                  // Replacement candidates expose the same stats as rostered players.
                  render: (p) =>
                    p.candidates.map((x, i) => (
                      <span key={x.id}>
                        {i > 0 && "; "}
                        <PlayerName p={x} />: {fmt(x.value)}
                      </span>
                    )),
                },
                { key: "status", label: "Status", value: (p) => p.status },
              ]}
            />
          </section>
          <section className="gd-card gd-audit-card">
            <div className="gd-audit-card-head">
              <h2 className="gd-h2">Source data audit</h2>
              <p className="gd-muted">
                Only supported model tables are imported. Connections, credentials
                and workbook instructions are excluded.
              </p>
            </div>
            {m.dataset.issues.map((x, i) => (
              <p key={i} className="warning-text">
                {x}
              </p>
            ))}
            {tableNames.map((name) => (
              <details key={name}>
                <summary>
                  {name} · {m.dataset.tables[name].length} records
                </summary>
                <DataTable
                  rows={m.dataset.tables[name]}
                  id={(r) => JSON.stringify(r)}
                  columns={Object.keys(m.dataset.tables[name][0] ?? {})
                    .filter((key) => key !== "PlayerID")
                    .map((key) => ({
                      key,
                      label: key,
                      value: (r: Record<string, unknown>) => r[key],
                    }))}
                />
              </details>
            ))}
          </section>
        </>
      )}
    </>
  );
}
