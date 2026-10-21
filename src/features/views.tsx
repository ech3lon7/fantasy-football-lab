import { GemEvidence } from "../ui/GemEvidence";
import { StarterLineupEditor } from "./StarterLineupEditor";
// Trade discovery delegates scoring to its own worker without changing the existing analyzer.
import { TradeSearch } from "./TradeSearch";
import { starterLineupsKey } from "../domain/starter-lineups";
import { useState, useEffect } from "react";
import {
  Upload,
  ArrowUpRight,
  Users,
  ArrowLeftRight,
  Diamond,
  Activity,
  CheckCircle2,
  X,
} from "lucide-react";
import {
  num,
  str,
  cmpId,
  tableNames,
  settingsSchema,
  type Settings,
  type Draft,
  type Workspace,
} from "../domain/contracts";
import type { Model, Player } from "../domain/valuation";
import {
  evidenceKey,
  roleScenarioKey,
  marketStatus,
} from "../domain/opportunity";
// The screener consumes existing model outputs through one shared filter contract.
import {
  defaultGemDraft,
  decodeGemFilters,
  encodeGemFilters,
  gemQuerySummary,
  gemSignals,
  gemClassifications,
  gemThresholds,
  risingGemDraft,
  screenGems,
  validateGemDraft,
  type GemDraft,
  type GemResult,
} from "../domain/gem-screening";
import {
  lineup,
  horizon,
  roster,
  irAssignments,
  available,
  type PositionGrade,
} from "../domain/lineups";
import type { TradeResult } from "../domain/trades";
import type { cloudClient, CloudConfig } from "../sync/client";
import {
  Metric,
  Signal,
  Trend,
  PlayerSignals,
  DataTable,
  playerColumns,
  extendedColumns,
  fmt,
  signed,
  pct,
  type Column,
} from "../ui/components";
import { Panel, Select, TeamsOptions } from "../ui/layout";
import { PlayerName } from "../ui/PlayerName";
export function Welcome({ onImport }: { onImport: () => void }) {
  return (
    <>
      <section className="welcome">
        <div className="welcome-copy">
          <span className="eyebrow">A CLEARER VIEW OF YOUR LEAGUE</span>
          <h2>
            Turn your workbook
            <br />
            into your next move.
          </h2>
          <p>
            Your roster, trades, player trends and hidden gems in one connected
            workspace. Start with your refreshed V5.2 workbook.
          </p>
          <button className="button lime" onClick={onImport}>
            <Upload size={18} /> Import your league <ArrowUpRight size={18} />
          </button>
          <small>Parsed on your device. Your Excel file stays yours.</small>
        </div>
        <div className="field-visual" aria-hidden="true">
          <div className="field-mark top">ROSTER INTELLIGENCE</div>
          <div className="field-lines" />
          <div className="field-card">
            <Activity size={22} />
            <span>Evidence → Projection → Value</span>
            <b>Make the whole roster count.</b>
          </div>
          <div className="field-mark bottom">01 / YOUR NEXT ADVANTAGE</div>
        </div>
      </section>
      <div className="three-col">
        {[
          [
            Users,
            "See the full picture",
            "Every player, position grade and coverage gap.",
          ],
          [
            ArrowLeftRight,
            "Evaluate both sides",
            "Separate deal value from actual lineup improvement.",
          ],
          [
            Diamond,
            "Find overlooked value",
            "Scoring trends, workload and projection gaps.",
          ],
        ].map(([Icon, title, body]) => {
          const I = Icon as typeof Users;
          return (
            <div className="feature-card" key={String(title)}>
              <I size={24} />
              <h3>{String(title)}</h3>
              <p>{String(body)}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}
function GradeGrid({ rows }: { rows: PositionGrade[] }) {
  return (
    <div className="grade-grid">
      {rows.map((r) => (
        <div className="grade-card" key={r.position}>
          <span>{r.position}</span>
          <strong>{r.grade}</strong>
          <small>{r.balance}</small>
          <div className="mini-track">
            <i
              style={{
                width: `${Math.max(5, Math.min(100, 50 + (r.versus ?? -0.5) * 100))}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
export function Overview({
  m,
  grades,
  team,
  filters,
  onFilters,
}: {
  m: Model;
  grades: PositionGrade[];
  team: string;
  filters: Record<string, string>;
  onFilters: (patch: Record<string, string>) => void;
}) {
  const ids = roster(m, team),
    players = ids.map((id) => m.byId.get(id)!),
    ls = horizon(m, ids),
    starters = lineup(m, ids, m.current),
    expected = ls.length
      ? ls.reduce((a, l) => a + l.expected, 0) / ls.length
      : null,
    watch = players.filter(
      (p) =>
        p.regression === "BUY LOW" ||
        p.priority <= 4 ||
        p.opportunity.signals.length > 0,
    ),
    needs = grades.filter((g) =>
      ["Need upgrade", "Shortage"].includes(g.balance),
    );
  return (
    <>
      <div className="hero-strip">
        <div>
          <span className="eyebrow">ROSTER OUTLOOK</span>
          <h2>Build around your strengths.</h2>
          <p>
            {needs.length
              ? `${needs.map((n) => n.position).join(", ")} deserves a closer look.`
              : "Review depth and bye coverage before moving your starters."}
          </p>
          <a href="#/trades" className="text-link">
            Explore a trade <ArrowUpRight size={16} />
          </a>
        </div>
        <div className="hero-stat">
          <span>Average modeled starting score</span>
          <strong>
            {fmt(expected)}
            <small> pts / week</small>
          </strong>
          <p>Expected PPG for Value PPG-selected lineups through W{m.final}</p>
        </div>
      </div>
      <div className="metric-grid">
        <Metric
          label="Rostered players"
          value={players.length}
          kind="fact"
          note="From your imported league"
        />
        <Metric
          label="Current-week lineup"
          value={`${starters.ids.filter(Boolean).length} / ${starters.ids.length}`}
          kind="model"
          note="Eligible modeled starters"
        />
        <Metric
          label="Injury flags"
          value={players.filter((p) => p.uncertain).length}
          kind="fact"
          note="Review availability scenarios"
        />
        <Metric
          label="Remaining fantasy weeks"
          value={m.weeks.length}
          kind="fact"
          note={`Through Week ${m.final}`}
        />
      </div>
      <Panel
        title="Position health"
        note="Starter value versus your fantasy league’s median. Depth is assessed separately."
        action={
          <a href="#/teams" className="text-link">
            Full assessment <ArrowUpRight size={15} />
          </a>
        }
      >
        <GradeGrid rows={grades} />
      </Panel>
      <div className="two-col">
        <Panel
          title="Where to focus"
          note="Position needs and useful reserve value."
        >
          {grades
            .filter((g) => g.position !== "FLEX")
            .slice(0, 6)
            .map((g) => (
              <div className="advice-row" key={g.position}>
                <b>{g.position}</b>
                <div>
                  <strong>{g.balance}</strong>
                  <p>{g.advice}</p>
                  {g.status !== "Available" && (
                    <small className="warning-text">{g.status}</small>
                  )}
                </div>
              </div>
            ))}
        </Panel>
        <Panel
          title="Signals on your roster"
          note="Evidence to investigate, not an automatic transaction."
        >
          {watch.length ? (
            watch.slice(0, 6).map((p) => (
              <PlayerName p={p} className="watch-row" key={p.id}>
                <div>
                  <b>{p.name}</b>
                  <small>
                    {p.pos} · {p.nfl}
                  </small>
                </div>
                <div>
                  <PlayerSignals p={p} />
                  <Trend p={p} />
                </div>
              </PlayerName>
            ))
          ) : (
            <p>No qualifying gem or BUY LOW signals on this snapshot.</p>
          )}
          <a className="text-link" href="#/gems">
            Search available gems <ArrowUpRight size={16} />
          </a>
        </Panel>
      </div>
      {/* Starter choices have a dedicated saved setting, leaving the existing roster and team grades unchanged. */}
      <StarterLineupEditor
        key={`${team}/${m.dataset.hash}/${filters[starterLineupsKey] ?? ""}`}
        m={m}
        team={team}
        filters={filters}
        change={onFilters}
      />
    </>
  );
}
export function TeamView({
  m,
  grades,
  team,
  change,
}: {
  m: Model;
  grades: Map<string, PositionGrade[]>;
  team: string;
  change: (v: string) => void;
}) {
  const [all, setAll] = useState(false);
  return (
    <>
      <div className="toolbar">
        <Select label="Team" value={team} change={change}>
          <TeamsOptions d={m.dataset} />
        </Select>
        <label className="check">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />{" "}
          All evaluation fields
        </label>
      </div>
      <Panel
        title="Position grades and roster advice"
        note="Grades use modeled starter Value PPG per slot versus the fantasy-league median."
      >
        <GradeGrid rows={grades.get(team) ?? []} />
        <DataTable
          rows={grades.get(team) ?? []}
          id={(r) => r.position}
          columns={[
            { key: "pos", label: "Position", value: (r) => r.position },
            {
              key: "grade",
              label: "Grade",
              kind: "model",
              value: (r) => r.grade,
            },
            {
              key: "value",
              label: "Starter Value PPG",
              kind: "model",
              value: (r) => r.starterValue,
            },
            {
              key: "median",
              label: "League median",
              kind: "model",
              value: (r) => r.median,
            },
            {
              key: "vs",
              label: "Versus median",
              kind: "model",
              value: (r) => r.versus,
              render: (r) => pct(r.versus),
            },
            {
              key: "coverage",
              label: "Coverage",
              kind: "model",
              value: (r) => r.coverage,
              render: (r) => pct(r.coverage),
            },
            {
              key: "reserves",
              label: "Useful reserves",
              value: (r) => r.reserves.map((p) => p.name).join(", ") || "None",
              // Reserve names share the same quick inspection as the main roster.
              render: (r) =>
                r.reserves.length
                  ? r.reserves.map((p, i) => (
                      <span key={p.id}>
                        {i > 0 && ", "}
                        <PlayerName p={p} />
                      </span>
                    ))
                  : "None",
            },
            {
              key: "advice",
              label: "Advice / status",
              value: (r) => `${r.advice} ${r.status}`,
            },
          ]}
        />
      </Panel>
      <Panel
        title="Entire roster"
        note="Buy-low/sell-high and gem signals are separate from the surplus index."
      >
        <DataTable
          rows={m.players.filter((p) => p.owner === team)}
          columns={all ? extendedColumns : playerColumns}
          id={(p) => p.id}
          initialSort="index"
        />
      </Panel>
    </>
  );
}
export function PlayerList({
  m,
  filters,
  onFilters,
}: {
  m: Model;
  filters: Record<string, string>;
  onFilters: (p: Record<string, string>) => void;
}) {
  const query = filters.playerQuery ?? "",
    pos = filters.playerPos ?? "All",
    owner = filters.playerOwner ?? "All",
    all = filters.playerAll === "true",
    compare = (filters.compareIds ?? "").split(",");
  const setQuery = (v: string) => onFilters({ playerQuery: v }),
    setPos = (v: string) => onFilters({ playerPos: v }),
    setOwner = (v: string) => onFilters({ playerOwner: v }),
    setAll = (v: boolean) => onFilters({ playerAll: String(v) }),
    setCompare = (fn: (a: string[]) => string[]) =>
      onFilters({ compareIds: fn(compare).join(",") });
  const rows = m.players.filter(
    (p) =>
      p.name.toLowerCase().includes(query.toLowerCase()) &&
      (pos === "All" || p.pos === pos) &&
      (owner === "All" || owner === "Available"
        ? owner === "All" || p.owner === "0"
        : p.owner === owner),
  );
  return (
    <>
      <div className="toolbar">
        <label className="control grow">
          <span>Search players</span>
          <input
            placeholder="Player name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <Select label="Position" value={pos} change={setPos}>
          {["All", "QB", "RB", "WR", "TE", "K", "D/ST"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </Select>
        <Select label="Ownership" value={owner} change={setOwner}>
          <option>All</option>
          <option>Available</option>
          <TeamsOptions d={m.dataset} />
        </Select>
        <label className="check">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />{" "}
          All fields
        </label>
      </div>
      <Panel
        title="Player comparison"
        note="Select up to three players. ESPN PPG is the season forecast."
      >
        <div className="three-col">
          {[0, 1, 2].map((i) => (
            <Select
              key={i}
              label={`Player ${i + 1}`}
              value={compare[i] ?? ""}
              change={(id) =>
                setCompare((a) => {
                  const next = [...a];
                  next[i] = id;
                  return next;
                })
              }
            >
              <option value="">Choose player</option>
              {m.players
                .filter(
                  (p) =>
                    !query ||
                    p.name.toLowerCase().includes(query.toLowerCase()),
                )
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.pos}
                  </option>
                ))}
            </Select>
          ))}
        </div>
        {compare.filter(Boolean).length > 0 && (
          <DataTable
            rows={compare
              .map((id) => m.byId.get(id))
              .filter((p): p is Player => !!p)}
            columns={extendedColumns.slice(0, 17)}
            id={(p) => p.id}
          />
        )}
      </Panel>
      <Panel
        title="League player pool"
        note="Surplus index is normalized remaining-season value, not a market price."
      >
        <DataTable
          rows={rows}
          columns={all ? extendedColumns : playerColumns}
          id={(p) => p.id}
          initialSort="index"
          sortState={{
            key: filters.playerSort ?? "index",
            desc: filters.playerDirection !== "asc",
          }}
          onSort={(s) =>
            onFilters({
              playerSort: s.key,
              playerDirection: s.desc ? "desc" : "asc",
            })
          }
        />
      </Panel>
    </>
  );
}
export function PlayerDetail({ m, id }: { m: Model; id: string }) {
  const p = m.byId.get(id);
  if (!p)
    return (
      <Panel title="Player unavailable">
        <p>This player is not in the current snapshot.</p>
      </Panel>
    );
  const scores = m.dataset.tables.ModelHistory.filter(
    (r) => str(r.PlayerID) === id && r.HistoryStatus === "Valid",
  ).sort((a, b) => num(a.Week) - num(b.Week));
  const pool = m.pools.find((x) => x.position === p.pos)!;
  return (
    <>
      <div className="player-heading">
        <div>
          <span className="position-label">{p.pos}</span>
          <h2>{p.name}</h2>
          <p>
            {p.nfl} · Player ID {p.id} ·{" "}
            {p.owner === "0"
              ? "Available / waivers"
              : str(
                  m.dataset.tables.ModelTeams.find(
                    (t) => str(t.TeamID) === p.owner,
                  )?.TeamName,
                )}
          </p>
        </div>
        <Signal text={p.injury} />
        <PlayerSignals p={p} />
        <Trend p={p} />
      </div>
      {/* Explain the automatic classification using the same domain gates shown in player popovers. */}
      <GemEvidence p={p} />
      <div className="metric-grid">
        <Metric label="Actual season PPG" value={fmt(p.actual)} kind="fact" />
        <Metric
          label="Recent PPG"
          value={fmt(p.recent)}
          kind="fact"
          note="Latest three played games"
        />
        <Metric
          label="ESPN season PPG"
          value={fmt(p.projected)}
          kind="projection"
        />
        <Metric
          label={`ESPN Week ${m.current}`}
          value={fmt(p.weekly)}
          kind="projection"
        />
      </div>
      <div className="metric-grid">
        <Metric label="Expected PPG" value={fmt(p.expected)} />
        <Metric label="Consistency loss" value={fmt(p.penalty)} />
        <Metric label="Value PPG" value={fmt(p.value)} />
        <Metric label="Surplus index" value={fmt(p.index)} />
      </div>
      <Panel title="Why this value?" note={`${p.status}; ${p.baselineStatus}`}>
        <p>
          Expected PPG blends observed scoring with ESPN’s season forecast.
          Value PPG deducts your consistency adjustment. VORP compares Value PPG
          with available positional replacements over the remaining games.
        </p>
        <div className="metric-grid">
          <Metric label="Actual-results weight" value={pct(p.weight)} />
          <Metric label="VORP through final week" value={fmt(p.vorp)} />
          <Metric label="Replacement Value PPG" value={fmt(p.baseline)} />
          <Metric label="Available remaining games" value={p.available} />
        </div>
        <details>
          <summary>View calculation inputs and results</summary>
          <dl className="definition-grid">
            {extendedColumns
              .filter((c) => !["name", "gem", "trend"].includes(c.key))
              .map((c) => (
                <div key={c.key}>
                  <dt className={c.kind}>{c.label}</dt>
                  <dd className={c.kind}>
                    {typeof c.value(p) === "number"
                      ? fmt(c.value(p))
                      : str(c.value(p)) || "n.a."}
                  </dd>
                </div>
              ))}
          </dl>
        </details>
      </Panel>
      <div className="two-col">
        <Panel
          title="Completed-game scoring"
          note="Zero and negative scores count; byes and nonparticipation do not."
        >
          <ScoreChart
            scores={scores.map((r) => ({
              label: `W${r.Week}`,
              score: num(r.Points),
            }))}
          />
          <p>
            {p.games} played games · sample SD{" "}
            <span className="fact">{fmt(p.scoringSD)}</span>
          </p>
        </Panel>
        <Panel title="Gem and regression evidence" note={p.explanation}>
          <p>
            <Signal text={p.regression} />
          </p>
          <p>
            Scoring gap:{" "}
            <span className="model">
              {signed(p.gap)} PPG ({pct(p.gapPct)})
            </span>
          </p>
          <p>
            Workload: <span className="fact">{fmt(p.workload)} / game</span> ·
            support:{" "}
            {p.workloadSupport ? "Meets screen" : "Below screen / not modeled"}
          </p>
          <p>
            Trend: last 3 versus all earlier games. Earlier mean{" "}
            <span className="fact">{fmt(p.earlier)}</span>;{" "}
            {p.games === 5
              ? "early sample of just two earlier games."
              : "at least two earlier games required."}
          </p>
          <p>
            Expected touchdowns: <span className="model">{fmt(p.xtd)}</span> ·
            supporting estimate only.
          </p>
        </Panel>
      </div>
      {/* Role evidence remains independent of scoring labels and has its own source and sample window. */}
      <Panel title="Role and opportunity" note={p.opportunity.source}>
        <div className="metric-grid">
          <Metric
            label="Recent opportunities / game"
            value={fmt(p.opportunity.recentRate)}
            kind="fact"
          />
          <Metric
            label="Earlier opportunities / game"
            value={fmt(p.opportunity.priorRate)}
            kind="fact"
          />
          <Metric
            label="Role increase / game"
            value={signed(p.opportunity.delta)}
            kind="fact"
          />
          <Metric
            label="Experimental role forecast PPG"
            value={fmt(p.roleForecast)}
            kind={p.roleForecast === null ? "muted" : "model"}
          />
        </div>
        <p>
          {p.opportunity.recentGames} recent played games versus{" "}
          {p.opportunity.priorGames} earlier games. RB opportunities are carries
          plus targets; receiving and rushing work are shown separately for PPR
          evaluation. QB role trends cover rushing; passing attempts can be
          supplied as player-week evidence.
        </p>
        <div className="metric-grid">
          <Metric
            label="Recent carries / game"
            value={fmt(p.opportunity.recentCarries)}
            kind={p.opportunity.recentCarries === null ? "muted" : "fact"}
          />
          <Metric
            label="Recent targets / game"
            value={fmt(p.opportunity.recentTargets)}
            kind={p.opportunity.recentTargets === null ? "muted" : "fact"}
          />
          <Metric
            label="Recent catches / game"
            value={fmt(p.opportunity.recentReceptions)}
            kind={p.opportunity.recentReceptions === null ? "muted" : "fact"}
          />
          <Metric
            label="Recent pass attempts / game"
            value={fmt(p.opportunity.recentPassAttempts)}
            kind={p.opportunity.recentPassAttempts === null ? "muted" : "fact"}
          />
          <Metric
            label="Original blended forecast PPG"
            value={fmt(p.blendedExpected)}
          />
          <Metric
            label="Usage-based xFP / game"
            value={fmt(p.opportunity.usageXFP)}
            kind={p.opportunity.usageXFP === null ? "muted" : "model"}
          />
          <Metric
            label="FPOE / game"
            value={signed(p.opportunity.fpoe)}
            kind={p.opportunity.fpoe === null ? "muted" : "model"}
          />
          <Metric
            label="Recent mean WOPR"
            value={fmt(p.opportunity.wopr)}
            kind={p.opportunity.wopr === null ? "muted" : "model"}
          />
          <Metric
            label="Recent snap share"
            value={pct(p.opportunity.snapShare)}
            kind={p.opportunity.snapShare === null ? "muted" : "fact"}
          />
          <Metric
            label="Recent route participation"
            value={pct(p.opportunity.routes)}
            kind={p.opportunity.routes === null ? "muted" : "fact"}
          />
          <Metric
            label="Carries inside 5 / game"
            value={fmt(p.opportunity.rushInside5)}
            kind={p.opportunity.rushInside5 === null ? "muted" : "fact"}
          />
          <Metric
            label="Red-zone targets / game"
            value={fmt(p.opportunity.redZoneTargets)}
            kind={p.opportunity.redZoneTargets === null ? "muted" : "fact"}
          />
        </div>
        <p>{p.opportunity.supplementalStatus}</p>
        <p>
          Blended Expected PPG is a forecast. Usage-based xFP describes
          completed opportunities; FPOE is actual scoring minus that xFP over
          the same games. Role forecasts affect value only through the explicit
          scenario weight. See Model &amp; audit for held-out errors and source
          imports.
        </p>
      </Panel>
      <Panel
        title="Current market reference"
        note={marketStatus(p.opportunity.market)}
      >
        <div className="metric-grid">
          <Metric
            label="ROS overall rank"
            value={fmt(p.opportunity.market?.ROSOverallRank)}
            kind={
              p.opportunity.market?.ROSOverallRank == null ? "muted" : "model"
            }
          />
          <Metric
            label="External trade value"
            value={fmt(p.opportunity.market?.TradeValue)}
            kind={p.opportunity.market?.TradeValue == null ? "muted" : "model"}
          />
        </div>
        {p.opportunity.market && (
          <p>
            {p.opportunity.market.Source} · {p.opportunity.market.AsOfUTC}. This
            reference is separate from the linear surplus index and draft ADP.
          </p>
        )}
        {p.uncertain && (
          <p>
            Availability is conditional.{" "}
            {p.opportunity.returnWeek === null
              ? "Return date unknown; inspect the downside scenario."
              : `User-selected return scenario: Week ${p.opportunity.returnWeek}.`}{" "}
            Set a sourced scenario in Model &amp; audit.
          </p>
        )}
      </Panel>
      <Panel
        title={`${p.pos} replacement pool`}
        note={`${pool.eligible} eligible available players · ${pool.status}. Waiver claims are not guaranteed.`}
      >
        <DataTable
          rows={pool.candidates}
          columns={playerColumns.slice(0, 7)}
          id={(p) => p.id}
        />
      </Panel>
    </>
  );
}
function ScoreChart({
  scores,
}: {
  scores: { label: string; score: number }[];
}) {
  const max = Math.max(1, ...scores.map((s) => Math.abs(s.score)));
  return (
    <div
      className="score-chart"
      role="img"
      aria-label={scores
        .map((s) => `${s.label}: ${fmt(s.score)} points`)
        .join(", ")}
    >
      {scores.map((s, i) => (
        <div key={i}>
          <b className="fact">{fmt(s.score, 1)}</b>
          <span className="score-column">
            <i
              className={s.score < 0 ? "negative" : ""}
              style={{
                height: `${Math.max(2, (Math.abs(s.score) / max) * 100)}%`,
              }}
            />
          </span>
          <small>{s.label}</small>
        </div>
      ))}
    </div>
  );
}
// Keep screener edits local until Apply, while existing app state owns saved queries.
export function GemView({
  m,
  filters,
  onFilters,
}: {
  m: Model;
  filters: Record<string, string>;
  onFilters: (p: Record<string, string>) => void;
}) {
  const teamIds = m.dataset.tables.ModelTeams.map((t) => str(t.TeamID));
  const defaultTeam = str(
    (
      m.dataset.tables.ModelTeams.find((t) => t.TeamName === "Los Chilones") ??
      m.dataset.tables.ModelTeams[0]
    )?.TeamID,
  );
  const restored = decodeGemFilters(filters, defaultTeam);
  const savedKey = JSON.stringify(restored.draft);
  const [edit, setEdit] = useState({ base: savedKey, draft: restored.draft });
  const [pending, setPending] = useState<{
    draft: GemDraft;
    resetSort: boolean;
  } | null>(null);
  const [generation, setGeneration] = useState(0);
  const draft = edit.draft;
  const dirty = JSON.stringify(draft) !== savedKey;
  const savedChanged =
    edit.base !== savedKey && JSON.stringify(draft) !== edit.base;
  const applied = validateGemDraft(restored.draft, teamIds);
  const validation = validateGemDraft(draft, teamIds);
  const appliedIssue =
    restored.issue || Object.values(applied.errors).join(" ");
  const query = appliedIssue ? null : applied.query;
  const result = query
    ? screenGems(m.players, query)
    : { matches: [], incomplete: [] };
  // Explain categorical exclusions without silently changing a numeric search.
  const hiddenBySignalsOrPool = query
    ? screenGems(m.players, {
        ...query,
        pool: "All",
        signals: [...gemSignals],
        classification: "All classifications",
      }).matches.length - result.matches.length
    : 0;
  const advancedCount =
    gemThresholds.filter((f) => f.advanced && restored.draft[f.key] !== "")
      .length +
    Number(restored.draft.aboveReplacement) +
    Number(restored.draft.includeMissing);

  // Adopt refreshed/synced saved filters only when doing so will not discard edits.
  useEffect(() => {
    setEdit((previous) =>
      JSON.stringify(previous.draft) === previous.base
        ? { base: savedKey, draft: restored.draft }
        : previous,
    );
  }, [savedKey]);

  // Apply a complete valid patch, including explicit clearing of old thresholds.
  function apply(next: GemDraft, resetSort = false) {
    const valid = validateGemDraft(next, teamIds).query;
    if (!valid) return;
    const patch = encodeGemFilters(valid);
    const canonical = decodeGemFilters(patch, defaultTeam).draft;
    setEdit({ base: JSON.stringify(canonical), draft: canonical });
    setPending(null);
    setGeneration((g) => g + 1);
    onFilters({
      ...patch,
      ...(resetSort ? { gemSort: "priority", gemDirection: "desc" } : {}),
    });
  }

  // Presets, reset, and chip removals ask before replacing unapplied local edits.
  function replace(next: GemDraft, resetSort = false) {
    if (dirty) setPending({ draft: next, resetSort });
    else apply(next, resetSort);
  }

  // Numeric controls preserve raw text and expose field errors to keyboard readers.
  function threshold(f: (typeof gemThresholds)[number]) {
    const error = validation.errors[f.key];
    return (
      <label className="control" key={f.key}>
        <span>{f.label}</span>
        <input
          type="text"
          inputMode="decimal"
          // Keep the accessible label stable when inline validation text appears.
          aria-label={f.label}
          value={draft[f.key]}
          placeholder="Any"
          aria-invalid={!!error}
          aria-describedby={error ? `gem-${f.key}-error` : undefined}
          onChange={(e) =>
            setEdit({ ...edit, draft: { ...draft, [f.key]: e.target.value } })
          }
        />
        {error && (
          <small className="danger-text" id={`gem-${f.key}-error`}>
            {error}
          </small>
        )}
      </label>
    );
  }

  // Reuse current metric renderers while adding search-specific evidence and warnings.
  const playerMetrics: Column<Player>[] = [
    playerColumns[0],
    { key: "position", label: "Position", kind: "fact", value: (p) => p.pos },
    {
      key: "owner",
      label: "Ownership / team",
      kind: "fact",
      value: (p) =>
        p.owner === "0"
          ? "Available / waivers"
          : str(
              m.dataset.tables.ModelTeams.find((t) => str(t.TeamID) === p.owner)
                ?.TeamName,
            ),
    },
    {
      key: "priority",
      label: "Signal",
      kind: "model",
      value: (p) => -p.priority,
      render: (p) => <PlayerSignals p={p} />,
    },
    playerColumns[8],
    playerColumns[2],
    playerColumns[6],
    playerColumns[1],
    playerColumns[3],
    {
      key: "gap",
      label: "Projection gap PPG",
      kind: "model",
      value: (p) => p.gap,
    },
    {
      key: "games",
      label: "Games played",
      kind: "fact",
      value: (p) => p.games,
    },
    {
      key: "replacementGap",
      label: "Vs replacement PPG",
      kind: "model",
      value: (p) =>
        p.value !== null && p.baseline !== null ? p.value - p.baseline : null,
    },
    {
      key: "status",
      label: "Injury / data / baseline",
      kind: "fact",
      value: (p) => `${p.injury}; ${p.status}; ${p.baselineStatus}`,
    },
    // Keep the existing forecast, adjusted value, baseline, gap percent and workload columns.
    playerColumns[4],
    playerColumns[5],
    extendedColumns[16],
    ...extendedColumns.slice(18, 22),
    // Role, usage and market evidence follow the existing screener metrics.
    ...extendedColumns.slice(-11),
    { key: "why", label: "Why flagged", value: (p) => p.explanation },
  ];
  const columns: Column<GemResult>[] = playerMetrics.map((c) => ({
    ...c,
    value: (r) => c.value(r.player),
    render: c.render ? (r) => c.render!(r.player) : undefined,
  }));
  columns.splice(13, 0, {
    key: "matching",
    label: "Matching evidence",
    value: (r) => [...r.missing, ...r.evidence].join(" - "),
    render: (r) => (
      // Round visible explanations while preserving exact comparisons in the tooltip.
      <span
        className="gem-evidence"
        title={[...r.missing, ...r.evidence].join(" - ")}
      >
        {r.missing.length ? "Incomplete: " : "Matches: "}
        {[...r.missing, ...r.evidence]
          .join(" - ")
          .replace(/[+-]?\d+\.\d+/g, (value) => fmt(Number(value)))}
      </span>
    ),
  });

  // Both sections share the applied sort; remounting resets only their visible batch.
  function resultsTable(rows: GemResult[], section: string) {
    return (
      <DataTable
        key={`${section}-${savedKey}-${m.dataset.hash}-${generation}`}
        rows={rows}
        columns={columns}
        id={(r) => r.player.id}
        initialSort="priority"
        sortState={{
          key: filters.gemSort ?? "priority",
          desc: filters.gemDirection !== "asc",
        }}
        onSort={(s) =>
          onFilters({ gemSort: s.key, gemDirection: s.desc ? "desc" : "asc" })
        }
        tieBreaker={(a, b) => cmpId(a.player.id, b.player.id)}
      />
    );
  }

  return (
    <>
      {/* Existing ownership/position controls and new signals share one Apply action. */}
      <Panel
        title="Gem filters"
        note="Automatic Gems require sustained workload, meaningful growth and active availability. Watch means promising evidence that does not yet pass every gate. OR between signals; AND between categories."
      >
        {/* Classification uses the current imported snapshot with no manual role review or approval. */}
        <p>
          Every player is classified automatically from imported played-game
          workload and availability. Missing news or role commentary never
          blocks a Gem. Labels describe the imported snapshot; warnings identify
          uncertainty.
        </p>
        <form
          className="gem-filters"
          onSubmit={(e) => {
            e.preventDefault();
            apply(draft);
          }}
        >
          <div className="toolbar">
            <Select
              label="Player pool"
              value={draft.pool}
              change={(pool) => setEdit({ ...edit, draft: { ...draft, pool } })}
            >
              {["Available", "All", "Selected team"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
            {draft.pool === "Selected team" && (
              <Select
                label="Team"
                value={draft.team}
                change={(team) =>
                  setEdit({ ...edit, draft: { ...draft, team } })
                }
              >
                <option value="">Choose team</option>
                <TeamsOptions d={m.dataset} />
              </Select>
            )}
            {/* Classification is independent of supporting signals and numeric filters. */}
            <Select
              label="Breakout classification"
              value={draft.classification}
              change={(classification) =>
                setEdit({ ...edit, draft: { ...draft, classification } })
              }
            >
              {gemClassifications.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </Select>
            <Select
              label="Position"
              value={draft.position}
              change={(position) =>
                setEdit({ ...edit, draft: { ...draft, position } })
              }
            >
              {["RB / WR / TE", "All", "QB", "RB", "WR", "TE", "K", "D/ST"].map(
                (x) => (
                  <option key={x}>{x}</option>
                ),
              )}
            </Select>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.injured}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    draft: { ...draft, injured: e.target.checked },
                  })
                }
              />
              Include injured
            </label>
          </div>
          <fieldset>
            <legend>Signals - match any selected</legend>
            <div className="toolbar">
              {gemSignals.map((signal) => (
                <label className="check" key={signal}>
                  <input
                    type="checkbox"
                    checked={draft.signals.includes(signal)}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        draft: {
                          ...draft,
                          signals: e.target.checked
                            ? [...draft.signals, signal]
                            : draft.signals.filter((s) => s !== signal),
                        },
                      })
                    }
                  />
                  {signal}
                </label>
              ))}
            </div>
            <div className="button-row">
              <button
                className="subtle"
                type="button"
                onClick={() =>
                  setEdit({
                    ...edit,
                    draft: { ...draft, signals: [...gemSignals] },
                  })
                }
              >
                Select all signals
              </button>
              <button
                className="subtle"
                type="button"
                onClick={() =>
                  setEdit({ ...edit, draft: { ...draft, signals: [] } })
                }
              >
                Clear signals
              </button>
            </div>
            {/* Clearing signal choices permits numeric-only searches, including saved ones. */}
            <p>
              No signal selections means Any signal. Classification and numeric
              filters still apply. Choose All player pool to include rostered
              players as well as free agents.
            </p>
          </fieldset>
          {/* Use current control styles; extra thresholds remain discoverable when collapsed. */}
          <div className="toolbar">
            {gemThresholds.filter((f) => !f.advanced).map(threshold)}
          </div>
          <p>
            Trend = latest three played-game PPG minus earlier-game PPG. Surplus
            index = the app's trade/value index, normalized remaining-season
            surplus, not a market price.
          </p>
          <details>
            <summary>Advanced filters ({advancedCount} applied)</summary>
            <div className="toolbar">
              {gemThresholds.filter((f) => f.advanced).map(threshold)}
            </div>
            <p>
              Projection gap compares actual season PPG with ESPN's season
              projected PPG, not this week's matchup projection.
            </p>
            <div className="toolbar">
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.aboveReplacement}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      draft: { ...draft, aboveReplacement: e.target.checked },
                    })
                  }
                />
                Above replacement only
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.includeMissing}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      draft: { ...draft, includeMissing: e.target.checked },
                    })
                  }
                />
                Show players with missing filter data
              </label>
            </div>
          </details>
          {Object.entries(validation.errors)
            .filter(([key]) => !gemThresholds.some((f) => f.key === key))
            .map(([key, error]) => (
              <p className="danger-text" key={key}>
                {error}
              </p>
            ))}
          {dirty && (
            <p className="warning-text">
              Unapplied changes - results still use saved filters.
            </p>
          )}
          {savedChanged && (
            <div className="notice warning">
              Saved filters changed while you were editing. Continue editing, or{" "}
              <button
                type="button"
                onClick={() =>
                  setEdit({ base: savedKey, draft: restored.draft })
                }
              >
                Load saved filters
              </button>
              .
            </div>
          )}
          <div className="button-row">
            <button className="button primary" disabled={!validation.query}>
              Apply filters
            </button>
            <button
              className="button"
              type="button"
              onClick={() =>
                replace(defaultGemDraft(restored.draft.team), true)
              }
            >
              Reset screener
            </button>
            <button
              className="button"
              type="button"
              onClick={() => replace(risingGemDraft(restored.draft.team))}
            >
              Rising targets
            </button>
          </div>
          <p>
            Rising targets is an editable example search, not a validated
            cutoff.
          </p>
        </form>
        {/* Resolve destructive-to-draft actions locally without changing cloud conflict handling. */}
        {pending && (
          <div className="notice warning" role="alert">
            This action replaces unapplied edits.
            <div className="button-row">
              <button
                className="button"
                onClick={() => apply(pending.draft, pending.resetSort)}
              >
                Discard edits and continue
              </button>
              <button className="button" onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </Panel>
      {/* Saved-query summaries and removable chips never silently relax a search. */}
      {appliedIssue ? (
        <div className="notice danger" role="alert">
          {appliedIssue} Correct the controls and Apply, or Reset screener.
        </div>
      ) : (
        query && (
          <>
            <div className="notice gem-query">
              <b>Applied search:</b> {gemQuerySummary(query)}
              <div className="button-row">
                {query.signals.map((s) => (
                  <button
                    className="subtle"
                    key={s}
                    onClick={() =>
                      replace({
                        ...restored.draft,
                        signals: query.signals.filter((x) => x !== s),
                      })
                    }
                    aria-label={`Remove signal ${s}`}
                  >
                    {s} x
                  </button>
                ))}
                {gemThresholds
                  .filter((f) => query[f.key] !== null)
                  .map((f) => (
                    <button
                      className="subtle"
                      key={f.key}
                      onClick={() =>
                        replace({ ...restored.draft, [f.key]: "" })
                      }
                      aria-label={`Remove ${f.label}`}
                    >
                      {f.metric} {query[f.key]} x
                    </button>
                  ))}
                {query.aboveReplacement && (
                  <button
                    className="subtle"
                    onClick={() =>
                      replace({ ...restored.draft, aboveReplacement: false })
                    }
                  >
                    Remove above replacement x
                  </button>
                )}
              </div>
            </div>
            <div className="notice gem-snapshot">
              Gem flags are a watchlist. Check replacement value and lineup
              benefit before adding. Trends use the latest three games versus
              earlier games; five total games is still an early sample. Source
              refresh:{" "}
              <span className="fact">
                {m.dataset.sourceUTC
                  ? new Date(m.dataset.sourceUTC).toLocaleString()
                  : "Unavailable"}
              </span>
              . Filters do not refresh ESPN.
            </div>
            <p role="status" aria-live="polite">
              {result.matches.length} confirmed matches
              {query.includeMissing
                ? `; ${result.incomplete.length} with incomplete evidence`
                : ""}
              .
            </p>
            <Panel
              title={`${result.matches.length} players to investigate`}
              note="Confirmed matches meet every active filter. Scoring gaps and season workload evidence; no extra valuation bonus."
            >
              {/* Offer an explicit broader pool while preserving every numeric condition. */}
              {hiddenBySignalsOrPool > 0 && (
                <div className="notice warning gem-query">
                  {hiddenBySignalsOrPool} additional player
                  {hiddenBySignalsOrPool === 1 ? "" : "s"} would match your
                  other filters but are hidden by the selected signals,
                  classification or player pool.
                  <div className="button-row">
                    <button
                      className="button"
                      onClick={() =>
                        replace({
                          ...restored.draft,
                          pool: "All",
                          signals: [...gemSignals],
                          classification: "All classifications",
                        })
                      }
                    >
                      Search all players and signals
                    </button>
                  </div>
                </div>
              )}
              {!result.matches.length && (
                <p>
                  No players meet every active filter. Remove a threshold above
                  or Reset screener.
                </p>
              )}
              {resultsTable(result.matches, "matches")}
            </Panel>
            {/* Unavailable evidence remains separate from confirmed matches and retains warnings. */}
            {query.includeMissing && (
              <Panel
                title={`${result.incomplete.length} players with incomplete evidence`}
                note="Cannot confirm these players meet every filter."
              >
                <div className="notice warning">
                  Missing active metrics are listed in Matching evidence. Known
                  failures are excluded.
                </div>
                {resultsTable(result.incomplete, "incomplete")}
              </Panel>
            )}
          </>
        )
      )}
    </>
  );
}
export function Weekly({ m }: { m: Model }) {
  return (
    <Panel
      title={`Week ${m.current} streamers`}
      note="Current ESPN matchup projections shown separately from long-term player value."
    >
      <DataTable
        rows={m.players.filter((p) => ["K", "D/ST"].includes(p.pos))}
        initialSort="weekly"
        id={(p) => p.id}
        columns={[
          playerColumns[0],
          {
            key: "opponent",
            label: "Opponent",
            kind: "fact",
            value: (p) => p.opponent,
          },
          { key: "bye", label: "Bye week", kind: "fact", value: (p) => p.bye },
          playerColumns[1],
          playerColumns[2],
          {
            key: "weekly",
            label: "ESPN weekly projection",
            kind: "projection",
            value: (p) => p.weekly,
          },
          {
            key: "owner",
            label: "Ownership",
            kind: "fact",
            value: (p) =>
              p.owner === "0"
                ? "Available / waivers"
                : str(
                    m.dataset.tables.ModelTeams.find(
                      (t) => str(t.TeamID) === p.owner,
                    )?.TeamName,
                  ),
          },
          playerColumns[9],
        ]}
      />
    </Panel>
  );
}
export function TradeView({
  m,
  draft,
  change,
  lineupsRaw,
}: {
  m: Model;
  draft: Draft;
  change: (d: Draft) => void;
  lineupsRaw?: string;
}) {
  const [result, setResult] = useState<TradeResult | null>(null),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [searchA, setSearchA] = useState(""),
    [searchB, setSearchB] = useState("");
  useEffect(() => {
    const worker = new Worker(
        new URL("../workers/model.worker.ts", import.meta.url),
        { type: "module" },
      ),
      id = crypto.randomUUID();
    setPending(true);
    setResult(null);
    worker.onmessage = (e) => {
      if (e.data.id !== id) return;
      if (e.data.error) setMessage(e.data.error);
      else {
        setResult(e.data.result);
        setMessage("");
      }
      setPending(false);
    };
    worker.onerror = () => {
      setMessage("Trade calculation failed.");
      setPending(false);
    };
    worker.postMessage({
      id,
      type: "trade",
      dataset: m.dataset,
      settings: m.settings,
      draft,
      // The trade worker uses the same supplemental sources and return scenarios as the player screens.
      filters: {
        [evidenceKey]: m.evidenceRaw,
        [roleScenarioKey]: String(m.roleScenarioWeight),
        [starterLineupsKey]: lineupsRaw ?? "",
      },
    });
    return () => worker.terminate();
  }, [
    m.dataset.hash,
    JSON.stringify(m.settings),
    JSON.stringify(draft),
    m.evidenceRaw,
    m.roleScenarioWeight,
    lineupsRaw,
  ]);
  function side(isA: boolean) {
    const team = isA ? draft.teamA : draft.teamB,
      ids = isA ? draft.give : draft.get,
      search = isA ? searchA : searchB,
      setSearch = isA ? setSearchA : setSearchB,
      choose = (next: string[]) =>
        change({ ...draft, [isA ? "give" : "get"]: next });
    return (
      <div className="trade-side">
        <div className="eyebrow">
          {isA ? "YOUR TEAM · OUTGOING" : "COUNTERPARTY · INCOMING"}
        </div>
        <Select
          label={isA ? "Your team" : "Other team"}
          value={team}
          change={(v) =>
            change({
              ...draft,
              [isA ? "teamA" : "teamB"]: v,
              [isA ? "give" : "get"]: [],
            })
          }
        >
          <TeamsOptions d={m.dataset} />
        </Select>
        <label className="control">
          <span>Search this roster</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter player names…"
          />
        </label>
        {/* Native options stay selectable; each chosen player gets a separate clickable name. */}
        <p className="muted">
          Select a player, then click their name below for stats.
        </p>
        {Array.from({ length: 5 }, (_, i) => (
          <div className="trade-player-slot" key={i}>
            <div className="trade-select-row">
              <span>{i + 1}</span>
              <select
                aria-label={`${isA ? "Outgoing" : "Incoming"} player ${i + 1}`}
                value={ids[i] ?? ""}
                onChange={(e) => {
                  const next = [...ids];
                  next[i] = e.target.value;
                  choose(next.filter(Boolean));
                }}
              >
                <option value="">Choose player</option>
                {m.players
                  .filter(
                    (p) =>
                      p.owner === team &&
                      (p.name.toLowerCase().includes(search.toLowerCase()) ||
                        ids.includes(p.id)),
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.pos} · {fmt(p.index)} index
                    </option>
                  ))}
              </select>
              {ids[i] && (
                <button
                  className="subtle"
                  aria-label={`Remove ${m.byId.get(ids[i])?.name ?? ids[i]}`}
                  onClick={() => choose(ids.filter((_, j) => j !== i))}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            {m.byId.get(ids[i]) && (
              <div className="trade-selected-player">
                <PlayerName p={m.byId.get(ids[i])!} />
              </div>
            )}
          </div>
        ))}
        <details>
          <summary>Optional player IDs</summary>
          <label className="control">
            <span>Comma-separated IDs</span>
            <input
              aria-label={isA ? "Outgoing IDs" : "Incoming IDs"}
              value={ids.join(", ")}
              onChange={(e) =>
                choose(
                  e.target.value
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean)
                    .slice(0, 5),
                )
              }
            />
          </label>
        </details>
      </div>
    );
  }
  const r = result?.valid ? result : null,
    tone =
      r?.advantage == null
        ? r && r.outgoing === 0 && r.incoming > 0
          ? "good"
          : "neutral"
        : r.advantage > 0
          ? "good"
          : r.advantage === 0
            ? "neutral"
            : r.advantage > -m.settings.BadLossPct
              ? "orange"
              : "bad",
    bar = r?.advantage ?? (r && r.outgoing === 0 && r.incoming > 0 ? 1 : 0),
    names = (ids: string[]) =>
      // Transaction suggestions can be inspected without navigating away from the draft.
      ids.length
        ? ids.map((id, i) => (
            <span key={`${id}-${i}`}>
              {i > 0 && ", "}
              {m.byId.get(id) ? <PlayerName p={m.byId.get(id)!} /> : id}
            </span>
          ))
        : "None";
  return (
    <>
      <div className="trade-builder">
        {side(true)}
        <div className="trade-swap">
          <ArrowLeftRight size={23} />
        </div>
        {side(false)}
      </div>
      {/* Search preserves the outgoing draft and loads only an explicitly selected counterparty/package. */}
      <TradeSearch
        m={m}
        draft={draft}
        lineupsRaw={lineupsRaw}
        change={change}
      />
      {pending && (
        <div className="notice" role="status">
          Evaluating both rosters and proposed transactions…
        </div>
      )}
      {message && (
        <p role="alert" className="notice danger">
          {message}
        </p>
      )}
      {result && !result.valid && (
        <div className="notice">{result.errors.join(" ")}</div>
      )}
      {r && (
        <>
          <Panel
            title="Surplus exchange"
            note="Your perspective. Deal grade excludes the consolidation premium and lineup impact."
          >
            <div className={`deal-heading ${tone}`}>
              <div>
                <span className="eyebrow">SURPLUS DEAL GRADE</span>
                <h2>{r.grade}</h2>
                {r.uncertainty.length > 0 && <Signal text="CONDITIONAL" />}
              </div>
              <strong>
                {r.advantage === null ? "Percentage n.a." : pct(r.advantage)}
              </strong>
            </div>
            <div className="advantage-labels">
              <span>Favors the other team</span>
              <b>Even</b>
              <span>Favors you</span>
            </div>
            <div
              className={`advantage-bar ${tone}`}
              role="meter"
              aria-label="Surplus advantage"
              aria-valuemin={-100}
              aria-valuemax={100}
              aria-valuenow={Math.round(Math.max(-1, Math.min(1, bar)) * 100)}
              aria-valuetext={
                r.advantage === null
                  ? r.grade
                  : `${pct(r.advantage)} surplus advantage`
              }
            >
              <i
                style={{
                  left: bar >= 0 ? "50%" : `${50 + Math.max(-1, bar) * 50}%`,
                  width: `${Math.abs(Math.max(-1, Math.min(1, bar))) * 50}%`,
                }}
              />
              <b />
            </div>
            <p className="muted">
              Bar caps at ±100%; the percentage and grade remain uncapped. A
              large percentage can represent a small absolute gain.
            </p>
            <div className="metric-grid">
              <Metric label="Outgoing surplus points" value={fmt(r.outgoing)} />
              <Metric label="Incoming surplus points" value={fmt(r.incoming)} />
              <Metric label="Surplus difference" value={signed(r.difference)} />
              <Metric
                label="Needed to enter fair band"
                value={fmt(r.neededFair)}
              />
            </div>
          </Panel>
          <div className="two-col">
            <Panel
              title="Your direct starter impact"
              note="Uses your marked starters. A bench-only departure costs zero direct starting points; trade value and coverage remain separate."
            >
              <div className="metric-grid two">
                <Metric
                  label="Expected scoring gain / week"
                  value={signed(r.directA.expectedPerWeek)}
                />
                <Metric
                  label={`Expected gain through W${m.final}`}
                  value={signed(r.directA.expected)}
                />
                <Metric
                  label="Adjusted value gain / week"
                  value={signed(r.directA.valuePerWeek)}
                />
                <Metric
                  label="Direct expected gain this week"
                  value={signed(r.directA.weekly[0]?.expectedGain ?? null)}
                />
              </div>
              <p>
                Lineup source: {r.directA.source}. Existing bench replacements:{" "}
                {names(r.directA.replacements)}. Modeled incoming starters:{" "}
                {names(r.directA.promotedIncoming)}.
              </p>
              {[...r.directA.errors, ...r.directA.warnings].map((issue) => (
                <p className="notice warning" key={issue}>
                  {issue}
                </p>
              ))}
            </Panel>
            <Panel
              title="Other team’s direct starter impact"
              note="Uses their imported or saved starters. Incoming scoring upgrades and named replacements are modeled."
            >
              <div className="metric-grid two">
                <Metric
                  label="Expected scoring gain / week"
                  value={signed(r.directB.expectedPerWeek)}
                />
                <Metric
                  label={`Expected gain through W${m.final}`}
                  value={signed(r.directB.expected)}
                />
                <Metric
                  label="Adjusted value gain / week"
                  value={signed(r.directB.valuePerWeek)}
                />
                <Metric
                  label="Direct expected gain this week"
                  value={signed(r.directB.weekly[0]?.expectedGain ?? null)}
                />
              </div>
              <p>
                Lineup source: {r.directB.source}. Existing bench replacements:{" "}
                {names(r.directB.replacements)}. Modeled incoming starters:{" "}
                {names(r.directB.promotedIncoming)}.
              </p>
              {[...r.directB.errors, ...r.directB.warnings].map((issue) => (
                <p className="notice warning" key={issue}>
                  {issue}
                </p>
              ))}
            </Panel>
          </div>
          {/* The former all-roster optimization remains separate for hypothetical future backup/bye coverage. */}
          <details>
            <summary>Modeled future coverage impact (includes bench)</summary>
            <Panel
              title="Optimized future lineups and coverage"
              note="Assumes the app can start any available rostered player. This may include a benched QB during a bye; it is separate from your direct starter score."
            >
              <div className="metric-grid">
                <Metric
                  label="Your modeled coverage gain / week"
                  value={signed(r.a.expectedPerWeek)}
                />
                <Metric
                  label="Their modeled coverage gain / week"
                  value={signed(r.b.expectedPerWeek)}
                />
                <Metric
                  label="Your downside value gain total"
                  value={signed(r.a.downside)}
                />
                <Metric
                  label="Their downside value gain total"
                  value={signed(r.b.downside)}
                />
              </div>
            </Panel>
          </details>
          {/* Current provider references are kept distinct from model surplus and lineup gains. */}
          <Panel title="Market reference" note={r.market.status}>
            <div className="metric-grid two">
              <Metric
                label="Outgoing external value"
                value={fmt(r.market.outgoing)}
              />
              <Metric
                label="Incoming external value"
                value={fmt(r.market.incoming)}
              />
            </div>
            <p>
              {r.market.source || "No complete comparable source supplied."}{" "}
              Provider units differ from surplus points. These sums do not apply
              the consolidation premium and do not predict whether a manager
              will accept.
            </p>
          </Panel>
          <Panel
            title="Requirements and conditions"
            note="Package requirements are separate from the deal grade."
          >
            <div className="three-col">
              <div className="requirement">
                <Signal text={`${r.surplusTest} · surplus-value test`} />
                <p>
                  Actual {fmt(r.actualSurplus)} / required{" "}
                  {fmt(r.requiredSurplus)} surplus points
                </p>
                <strong className="model">
                  Shortfall {fmt(r.surplusShortfall)}
                </strong>
              </div>
              <div className="requirement">
                <Signal text={`${r.pointsTest} · fantasy-points test`} />
                <p>
                  Actual {fmt(r.actualPoints)} / required{" "}
                  {fmt(r.requiredPoints)} adjusted points
                </p>
                <strong className="model">
                  Shortfall {fmt(r.pointsShortfall)}
                </strong>
              </div>
              <div className="requirement">
                <Signal
                  text={`${r.legality ? "PASS" : "FAIL"} · roster legality`}
                />
                <p>
                  {draft.give.length === draft.get.length
                    ? "Equal size: no premium."
                    : `${fmt(m.settings.Premium * 100, 0)}% applied once to the smaller package.`}
                </p>
                <p>
                  Drop replacement cost:{" "}
                  <span className="model">{fmt(r.dropCost)} points</span>
                </p>
              </div>
            </div>
            {r.uncertainty.length > 0 ? (
              <div className="notice warning">
                CONDITIONAL: {r.uncertainty.join("; ")}.
              </div>
            ) : (
              <p>No flagged uncertainty.</p>
            )}
          </Panel>
          <Panel
            title="Weekly direct starter impact"
            note="Your marked starter group is held across the remaining weeks; byes and known availability still apply. Existing bench players enter only as named replacements for departing starters. Incoming players may improve starters. Expected PPG is a model estimate, not ESPN’s weekly forecast."
          >
            <DataTable
              rows={r.directA.weekly.map((w, i) => ({
                ...w,
                their: r.directB.weekly[i].expectedGain,
              }))}
              id={(w) => str(w.week)}
              columns={[
                {
                  key: "week",
                  label: "Week",
                  kind: "fact",
                  value: (w) => w.week,
                },
                {
                  key: "before",
                  label: "Your before expected",
                  kind: "model",
                  value: (w) => w.beforeExpected,
                },
                {
                  key: "after",
                  label: "Your after expected",
                  kind: "model",
                  value: (w) => w.afterExpected,
                },
                {
                  key: "gain",
                  label: "Your expected gain",
                  kind: "model",
                  value: (w) => w.expectedGain,
                },
                {
                  key: "their",
                  label: "Their expected gain",
                  kind: "model",
                  value: (w) => w.their,
                },
                {
                  key: "value",
                  label: "Your value gain",
                  kind: "model",
                  value: (w) => w.valueGain,
                },
                {
                  key: "unfilled",
                  label: "Your unfilled slots",
                  kind: "model",
                  value: (w) => w.unfilled,
                },
              ]}
            />
            <details>
              <summary>Inspect your before/after starters</summary>
              {r.directA.weekly.map((w) => (
                <p key={w.week}>
                  <b>Week {w.week}:</b>{" "}
                  <span>
                    Before:{" "}
                    {w.beforeIds
                      .map((id) => (id ? m.byId.get(id)?.name : "Unfilled"))
                      .join(" · ")}
                    . After:{" "}
                  </span>
                  {/* Keep every automatically selected incoming upgrade or replacement inspectable. */}
                  {w.ids.map((id, i) => (
                    <span key={i}>
                      {i > 0 && " · "}
                      {w.slots[i]}:{" "}
                      {id && m.byId.get(id) ? (
                        <PlayerName p={m.byId.get(id)!} />
                      ) : (
                        "Unfilled"
                      )}
                    </span>
                  ))}
                </p>
              ))}
            </details>
          </Panel>
          <Panel
            title="Required changes and optional pickups"
            note="Waiver claims are proposals. Their gains are not attributed to the trade alone."
          >
            <div className="two-col">
              <div>
                <h3>Your roster</h3>
                <p>Required drops: {names(r.dropsA)}</p>
                <p>IR assignments: {names(r.irA)}</p>
                <p>Proposed waiver adds: {names(r.addsA)}</p>
                <p>
                  Additional waiver expected gain:{" "}
                  <span className="model">
                    {signed(r.a.waiverExpected)} total points
                  </span>
                </p>
              </div>
              <div>
                <h3>Other roster</h3>
                <p>Required drops: {names(r.dropsB)}</p>
                <p>IR assignments: {names(r.irB)}</p>
                <p>Proposed waiver adds: {names(r.addsB)}</p>
                <p>
                  Additional waiver expected gain:{" "}
                  <span className="model">
                    {signed(r.b.waiverExpected)} total points
                  </span>
                </p>
              </div>
            </div>
            <details>
              <summary>Counts and current-week backup depth</summary>
              <Depth
                m={m}
                before={r.initialA}
                after={r.legalA}
                otherBefore={r.initialB}
                otherAfter={r.legalB}
              />
            </details>
          </Panel>
        </>
      )}
    </>
  );
}
function Depth({
  m,
  before,
  after,
  otherBefore,
  otherAfter,
}: {
  m: Model;
  before: string[];
  after: string[];
  otherBefore: string[];
  otherAfter: string[];
}) {
  function backups(ids: string[], pos: string) {
    const used = new Set(lineup(m, ids, m.current).ids),
      ir = new Set(irAssignments(m, ids));
    return ids.filter((id) => {
      const p = m.byId.get(id)!;
      return (
        p.pos === pos &&
        available(m, p, m.current) &&
        !used.has(id) &&
        !ir.has(id)
      );
    }).length;
  }
  return (
    <DataTable
      rows={["QB", "RB", "WR", "TE", "K", "D/ST"]}
      id={(x) => x}
      columns={[
        { key: "pos", label: "Position", value: (x) => x },
        {
          key: "yourBefore",
          label: "Your before backups",
          kind: "model",
          value: (x) => backups(before, x),
        },
        {
          key: "yourAfter",
          label: "Your trade backups",
          kind: "model",
          value: (x) => backups(after, x),
        },
        {
          key: "theirBefore",
          label: "Their before backups",
          kind: "model",
          value: (x) => backups(otherBefore, x),
        },
        {
          key: "theirAfter",
          label: "Their trade backups",
          kind: "model",
          value: (x) => backups(otherAfter, x),
        },
      ]}
    />
  );
}
export function ModelView({
  m,
  change,
}: {
  m: Model;
  change: (s: Settings) => void;
}) {
  const [message, setMessage] = useState("");
  const settingLabels: Record<string, string> = {
    PriorGames: "Prior games for forecast confidence",
    RecentWeight: "Recent PPG weight",
    ConsistencyCoefficient: "Consistency coefficient",
    ConsistencyCap: "Consistency cap",
    MinConsistencyGames: "Minimum games for consistency",
    Premium: "Consolidation premium (0.25–0.35)",
    FairBandPct: "Fair band",
    ExcellentPct: "Excellent begins",
    StealPct: "Steal begins",
    BadLossPct: "Bad loss begins",
    HorribleLossPct: "Horrible loss begins",
  };
  return (
    <>
      <Panel
        title="Model settings"
        note="Provisional assumptions. Changing these recalculates values; it does not change recorded scoring or ESPN projections."
      >
        {message && (
          <p className="notice danger" role="alert">
            {message}
          </p>
        )}
        <div className="settings-grid">
          {Object.entries(m.settings).map(([key, value]) => (
            <label className="control" key={key}>
              <span>
                {settingLabels[key] ?? key.replace(/([A-Z])/g, " $1").trim()}
              </span>
              <input
                type="number"
                step="any"
                value={value}
                onChange={(e) => {
                  const candidate = {
                    ...m.settings,
                    [key]: e.target.valueAsNumber,
                  };
                  const result = settingsSchema.safeParse(candidate);
                  if (result.success) {
                    change(result.data);
                    setMessage("");
                  } else
                    setMessage(
                      `${key}: ${result.error.issues.map((x) => x.message).join("; ")}`,
                    );
                }}
              />
            </label>
          ))}
        </div>
        <p>
          Expected PPG is the scoring forecast. Value PPG adjusts it for
          consistency. Surplus index measures value above available
          replacements.
        </p>
      </Panel>
      <Panel
        title="Replacement baseline audit"
        note="Mean of the top three eligible available players. Hypothetical trades do not change these pools."
      >
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
                  .map((x) => `${x.name} (${x.id}): ${fmt(x.value)}`)
                  .join("; "),
              // Replacement candidates expose the same stats as rostered players.
              render: (p) =>
                p.candidates.map((x, i) => (
                  <span key={x.id}>
                    {i > 0 && "; "}
                    <PlayerName p={x} /> ({x.id}): {fmt(x.value)}
                  </span>
                )),
            },
            { key: "status", label: "Status", value: (p) => p.status },
          ]}
        />
      </Panel>
      <Panel
        title="Source data audit"
        note="Only supported model tables are imported. Connections, credentials and workbook instructions are excluded."
      >
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
              columns={Object.keys(m.dataset.tables[name][0] ?? {}).map(
                (key) => ({
                  key,
                  label: key,
                  value: (r: Record<string, unknown>) => r[key],
                }),
              )}
            />
          </details>
        ))}
      </Panel>
    </>
  );
}
export function Account({
  w,
  config,
  email,
  configure,
  client,
  runSync,
  signOut,
  status,
  notify,
  importClick,
  clear,
}: {
  w: Workspace | null;
  config: CloudConfig;
  email: string;
  configure: (c: CloudConfig) => void;
  client: ReturnType<typeof cloudClient>;
  runSync: () => void;
  signOut: () => void;
  status: string;
  notify: (s: string) => void;
  importClick: () => void;
  clear: (cloud: boolean) => void;
}) {
  const [url, setUrl] = useState(config.url),
    [key, setKey] = useState(config.key),
    [login, setLogin] = useState(""),
    [password, setPassword] = useState(""),
    [authBusy, setAuthBusy] = useState(false);
  async function auth(signup = false) {
    if (!client) return;
    setAuthBusy(true);
    try {
      const { error } = signup
        ? await client.auth.signUp({
            email: login,
            password,
            options: {
              emailRedirectTo: location.origin + import.meta.env.BASE_URL,
            },
          })
        : await client.auth.signInWithPassword({ email: login, password });
      if (error) throw error;
      setPassword("");
      notify(
        signup
          ? "Account request submitted. Check your email if confirmation is enabled."
          : "",
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthBusy(false);
    }
  }
  return (
    <>
      <Panel
        title="Current dataset"
        note="Refresh All in Excel, wait, recalculate, save, then import."
      >
        <div className="metric-grid">
          <Metric
            label="Players"
            value={w?.dataset?.tables.ModelPlayers.length ?? "None"}
            kind="fact"
          />
          <Metric
            label="Source refresh"
            value={
              w?.dataset?.sourceUTC
                ? new Date(w.dataset.sourceUTC).toLocaleString()
                : "Unavailable"
            }
            kind="fact"
          />
          <Metric
            label="Imported"
            value={
              w?.dataset
                ? new Date(w.dataset.importedAt).toLocaleString()
                : "Not imported"
            }
            kind="fact"
          />
          <Metric label="Sync" value={status} kind="note" />
        </div>
        <div className="button-row">
          <button className="button primary" onClick={importClick}>
            <Upload size={16} />
            Import / replace
          </button>
          <button className="button" onClick={runSync} disabled={!email || !w}>
            Sync now
          </button>
          <button className="subtle" disabled={!w} onClick={() => clear(false)}>
            Remove from this device
          </button>
          <button
            className="subtle danger-text"
            disabled={!email || !w}
            onClick={() => clear(true)}
          >
            Delete cloud workspace
          </button>
        </div>
        <p>
          The app retains the current extracted dataset, not the Excel file.
          Older offline devices update when they reconnect. Provider backups
          follow your Supabase plan’s retention.
        </p>
      </Panel>
      <Panel
        title="Supabase synchronization"
        note="Uses Trainwise’s Supabase project with separate fantasy storage."
      >
        {!config.url && (
          <div className="notice warning">
            Cloud sync needs your Supabase project and the included database
            migration. Local import and analysis already work.
          </div>
        )}
        <p>
          Sign in with your Trainwise account once this project is configured.
          Fantasy keeps its own login session and workspace. Signing out here
          leaves your Trainwise sessions active.
        </p>
        <details open={!config.url}>
          <summary>Project configuration</summary>
          <p>
            Apply <code>supabase/migrations/001_workspace.sql</code> from this
            app’s repository in your selected project. Never enter a
            secret/service-role key.
          </p>
          <div className="two-col">
            <label className="control">
              <span>Project URL</span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-project.supabase.co"
              />
            </label>
            <label className="control">
              <span>Publishable key</span>
              <input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="sb_publishable_…"
                autoComplete="off"
              />
            </label>
          </div>
          <button
            className="button"
            onClick={() => {
              try {
                configure({ url, key });
              } catch (e) {
                notify(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Save public configuration
          </button>
        </details>
        {email ? (
          <div className="signed-in">
            <CheckCircle2 size={22} />
            <p>
              Signed in as <b>{email}</b>
            </p>
            <button className="button" onClick={signOut}>
              Sign out and clear local account data
            </button>
          </div>
        ) : client ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void auth();
            }}
          >
            <div className="two-col">
              <label className="control">
                <span>Email</span>
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                />
              </label>
              <label className="control">
                <span>Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            </div>
            <div className="button-row">
              <button className="button primary" disabled={authBusy}>
                Sign in
              </button>
              <button
                className="button"
                type="button"
                disabled={authBusy}
                onClick={() => auth(true)}
              >
                Create account
              </button>
              <button
                type="button"
                className="subtle"
                onClick={async () => {
                  if (!login) {
                    notify("Enter your email first.");
                    return;
                  }
                  const { error } = await client.auth.resetPasswordForEmail(
                    login,
                    {
                      redirectTo:
                        location.origin + import.meta.env.BASE_URL + "#/data",
                    },
                  );
                  notify(error?.message ?? "Password reset email requested.");
                }}
              >
                Reset password
              </button>
            </div>
          </form>
        ) : null}
      </Panel>
    </>
  );
}
