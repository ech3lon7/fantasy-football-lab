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
  tableNames,
  settingsSchema,
  type Settings,
  type Draft,
  type Workspace,
} from "../domain/contracts";
import type { Model, Player } from "../domain/valuation";
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
  DataTable,
  playerColumns,
  extendedColumns,
  fmt,
  signed,
  pct,
} from "../ui/components";
import { Panel, Select, TeamsOptions } from "../ui/layout";
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
}: {
  m: Model;
  grades: PositionGrade[];
  team: string;
}) {
  const ids = roster(m, team),
    players = ids.map((id) => m.byId.get(id)!),
    ls = horizon(m, ids),
    starters = lineup(m, ids, m.current),
    expected = ls.length
      ? ls.reduce((a, l) => a + l.expected, 0) / ls.length
      : null,
    watch = players.filter(
      (p) => p.regression === "BUY LOW" || p.priority <= 4,
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
              <a className="watch-row" href={`#/player/${p.id}`} key={p.id}>
                <div>
                  <b>{p.name}</b>
                  <small>
                    {p.pos} · {p.nfl}
                  </small>
                </div>
                <div>
                  <Signal text={p.gem} />
                  <Trend p={p} />
                </div>
              </a>
            ))
          ) : (
            <p>No qualifying gem or BUY LOW signals on this snapshot.</p>
          )}
          <a className="text-link" href="#/gems">
            Search available gems <ArrowUpRight size={16} />
          </a>
        </Panel>
      </div>
      <Panel
        title="Your roster"
        note="Click a player for the calculation behind their value."
      >
        <DataTable
          rows={players}
          columns={playerColumns}
          id={(p) => p.id}
          initialSort="index"
        />
      </Panel>
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
        <Signal text={p.gem} />
        <Trend p={p} />
      </div>
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
export function GemView({
  m,
  filters,
  onFilters,
}: {
  m: Model;
  filters: Record<string, string>;
  onFilters: (p: Record<string, string>) => void;
}) {
  const pool = filters.gemPool ?? "Available",
    team =
      filters.gemTeam ??
      str(
        (
          m.dataset.tables.ModelTeams.find(
            (t) => t.TeamName === "Los Chilones",
          ) ?? m.dataset.tables.ModelTeams[0]
        ).TeamID,
      ),
    pos = filters.gemPos ?? "RB / WR / TE",
    signal = filters.gemSignal ?? "Candidates and watches",
    injured = filters.gemInjured === "true";
  const setPool = (v: string) => onFilters({ gemPool: v }),
    setTeam = (v: string) => onFilters({ gemTeam: v }),
    setPos = (v: string) => onFilters({ gemPos: v }),
    setSignal = (v: string) => onFilters({ gemSignal: v }),
    setInjured = (v: boolean) => onFilters({ gemInjured: String(v) });
  const rows = m.players.filter(
    (p) =>
      (pool === "All" ||
        (pool === "Available" && p.owner === "0") ||
        (pool === "Selected team" && p.owner === team)) &&
      (pos === "All" ||
        (pos === "RB / WR / TE" && ["RB", "WR", "TE"].includes(p.pos)) ||
        p.pos === pos) &&
      (signal === "All signals" ||
        (signal === "Candidates and watches" && p.priority <= 4) ||
        p.gem === signal) &&
      (injured || !p.uncertain),
  );
  return (
    <>
      <div className="toolbar">
        <Select label="Player pool" value={pool} change={setPool}>
          {["Available", "All", "Selected team"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </Select>
        {pool === "Selected team" && (
          <Select label="Team" value={team} change={setTeam}>
            <TeamsOptions d={m.dataset} />
          </Select>
        )}
        <Select label="Position" value={pos} change={setPos}>
          {["RB / WR / TE", "All", "QB", "RB", "WR", "TE", "K", "D/ST"].map(
            (x) => (
              <option key={x}>{x}</option>
            ),
          )}
        </Select>
        <Select label="Signals" value={signal} change={setSignal}>
          {[
            "Candidates and watches",
            "All signals",
            "Gem candidate",
            "Opportunity watch",
            "Projection-gap watch",
            "Emerging",
            "TD caution",
            "No gem signal",
          ].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </Select>
        <label className="check">
          <input
            type="checkbox"
            checked={injured}
            onChange={(e) => setInjured(e.target.checked)}
          />{" "}
          Include injured
        </label>
      </div>
      <div className="notice">
        Gem flags are a watchlist. Check value versus replacement and your
        lineup benefit before adding. Trends use the latest three games versus
        earlier games; five total games is still an early sample.
      </div>
      <Panel
        title={`${rows.length} players to investigate`}
        note="Scoring gaps and season workload evidence. No extra valuation bonus."
      >
        <DataTable
          rows={rows}
          initialSort="priority"
          sortState={{
            key: filters.gemSort ?? "priority",
            desc: filters.gemDirection !== "asc",
          }}
          onSort={(s) =>
            onFilters({ gemSort: s.key, gemDirection: s.desc ? "desc" : "asc" })
          }
          columns={[
            playerColumns[0],
            {
              key: "priority",
              label: "Priority",
              kind: "model",
              value: (p) => -p.priority,
              render: (p) => <Signal text={p.gem} />,
            },
            playerColumns[8],
            ...playerColumns.slice(1, 7),
            ...extendedColumns.slice(16, 22),
            {
              key: "replacementGap",
              label: "Vs replacement PPG",
              kind: "model",
              value: (p) =>
                p.value !== null && p.baseline !== null
                  ? p.value - p.baseline
                  : null,
            },
            { key: "why", label: "Why flagged", value: (p) => p.explanation },
          ]}
          id={(p) => p.id}
        />
      </Panel>
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
}: {
  m: Model;
  draft: Draft;
  change: (d: Draft) => void;
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
    });
    return () => worker.terminate();
  }, [m.dataset.hash, JSON.stringify(m.settings), JSON.stringify(draft)]);
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
        {Array.from({ length: 5 }, (_, i) => (
          <div className="trade-select-row" key={i}>
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
      ids.map((id) => m.byId.get(id)?.name ?? id).join(", ") || "None";
  return (
    <>
      <div className="trade-builder">
        {side(true)}
        <div className="trade-swap">
          <ArrowLeftRight size={23} />
        </div>
        {side(false)}
      </div>
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
              title="Your lineup impact"
              note="Trade plus required drops / IR; waiver benefit is separate."
            >
              <div className="metric-grid two">
                <Metric
                  label="Expected scoring gain / week"
                  value={signed(r.a.expectedPerWeek)}
                />
                <Metric
                  label={`Expected gain through W${m.final}`}
                  value={signed(r.a.expected)}
                />
                <Metric
                  label="Adjusted value gain / week"
                  value={signed(r.a.valuePerWeek)}
                />
                <Metric
                  label="Downside value gain total"
                  value={signed(r.a.downside)}
                />
              </div>
            </Panel>
            <Panel
              title="Other team’s lineup impact"
              note="Evaluate whether the deal solves a need for both teams."
            >
              <div className="metric-grid two">
                <Metric
                  label="Expected scoring gain / week"
                  value={signed(r.b.expectedPerWeek)}
                />
                <Metric
                  label={`Expected gain through W${m.final}`}
                  value={signed(r.b.expected)}
                />
                <Metric
                  label="Adjusted value gain / week"
                  value={signed(r.b.valuePerWeek)}
                />
                <Metric
                  label="Downside value gain total"
                  value={signed(r.b.downside)}
                />
              </div>
            </Panel>
          </div>
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
            title="Weekly trade-only impact"
            note="Average weekly gain divides total gain by every remaining fantasy scoring period. It is a model estimate, not ESPN’s matchup forecast."
          >
            <DataTable
              rows={r.a.weekly.map((w, i) => ({
                ...w,
                their: r.b.weekly[i].expectedGain,
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
              <summary>Inspect your selected lineups</summary>
              {r.a.weekly.map((w) => (
                <p key={w.week}>
                  <b>Week {w.week}:</b>{" "}
                  {w.ids
                    .map(
                      (id, i) =>
                        `${w.slots[i]}: ${id ? m.byId.get(id)?.name : "Unfilled"}`,
                    )
                    .join(" · ")}
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
        ? await client.auth.signUp({ email: login, password })
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
        note="Use a dedicated fantasy table, even when sharing the Trainwise project."
      >
        {!config.url && (
          <div className="notice warning">
            Cloud sync needs your Supabase project and the included database
            migration. Local import and analysis already work.
          </div>
        )}
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
