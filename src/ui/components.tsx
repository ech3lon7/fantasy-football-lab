import { useState, type ReactNode } from "react";
import type { Player } from "../domain/valuation";
import { playerSignals } from "../domain/valuation";
import { PlayerName } from "./PlayerName";
export const fmt = (x: unknown, digits = 2) =>
  typeof x === "number" && Number.isFinite(x)
    ? x.toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : "n.a.";
export const signed = (x: number | null) =>
  x === null ? "n.a." : `${x > 0 ? "+" : ""}${fmt(x)}`;
export const pct = (x: number | null) =>
  x === null ? "n.a." : `${x > 0 ? "+" : ""}${fmt(x * 100, 1)}%`;
export function Metric({
  label,
  value,
  kind = "model",
  note,
}: {
  label: string;
  value: ReactNode;
  kind?: string;
  note?: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={kind}>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
export function Signal({ text }: { text: string }) {
  return (
    <span
      className={`signal ${text === "Gem" || text === "Gem candidate" ? "candidate" : text === "Watch" || text === "Opportunity watch" || text === "BUY LOW" ? "watch" : /caution|SELL HIGH|issue|FAIL|UNAVAILABLE/.test(text) ? "caution" : /Emerging|Conditional|CONDITIONAL|Projection-gap/.test(text) ? "conditional" : ""}`}
    >
      {text}
    </span>
  );
}
export function Trend({ p }: { p: Player }) {
  return (
    <span
      className={`trend ${p.arrow === "↑" ? "up" : p.arrow === "↓" ? "down" : ""}`}
      aria-label={`${p.arrow === "↑" ? "Up" : p.arrow === "↓" ? "Down" : p.arrow === "→" ? "Stable" : "Unavailable"} scoring trend`}
    >
      {p.arrow} <span className="fact">{signed(p.trendDelta)}</span>
    </span>
  );
}
// Render independent evidence together so a caution cannot hide a rising role.
export function PlayerSignals({ p }: { p: Player }) {
  return (
    <span>
      {playerSignals(p).map((text) => (
        <Signal key={text} text={text} />
      ))}
    </span>
  );
}
export interface Column<T> {
  key: string;
  label: string;
  kind?: string;
  value: (x: T) => unknown;
  render?: (x: T) => ReactNode;
}
export function DataTable<T>({
  rows,
  columns,
  id,
  initialSort,
  sortState,
  onSort,
  tieBreaker,
}: {
  rows: T[];
  columns: Column<T>[];
  id: (r: T) => string;
  initialSort?: string;
  sortState?: { key: string; desc: boolean };
  onSort?: (s: { key: string; desc: boolean }) => void;
  // Screens may opt into stable ties without changing other tables' ordering.
  tieBreaker?: (a: T, b: T) => number;
}) {
  const [localSort, setSort] = useState({
      key: initialSort ?? columns[0]?.key,
      desc: !!initialSort,
    }),
    [limit, setLimit] = useState(50);
  const sort = sortState ?? localSort;
  const col = columns.find((c) => c.key === sort.key) ?? columns[0];
  const ordered = [...rows].sort((a, b) => {
    const x = col.value(a),
      y = col.value(b);
    // Keep unavailable values last; the screener also orders equal values by ID.
    if (x == null) return y == null ? (tieBreaker?.(a, b) ?? 0) : 1;
    if (y == null) return -1;
    const v =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y));
    return (sort.desc ? -v : v) || (tieBreaker?.(a, b) ?? 0);
  });
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  aria-sort={
                    sort.key === c.key
                      ? sort.desc
                        ? "descending"
                        : "ascending"
                      : "none"
                  }
                >
                  <button
                    className={c.kind ?? ""}
                    onClick={() => {
                      const next = {
                        key: c.key,
                        desc: sort.key === c.key ? !sort.desc : true,
                      };
                      setSort(next);
                      onSort?.(next);
                    }}
                  >
                    {c.label}
                    {sort.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordered.slice(0, limit).map((r) => (
              <tr key={id(r)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.kind ?? ""}>
                    {c.render
                      ? c.render(r)
                      : typeof c.value(r) === "number"
                        ? fmt(c.value(r))
                        : String(c.value(r) ?? "n.a.")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p className="empty-line">No players match these filters.</p>
      )}
      <div className="table-footer">
        <span>
          {Math.min(limit, rows.length)} of {rows.length} records
        </span>
        {limit < rows.length && (
          <button className="subtle" onClick={() => setLimit((n) => n + 100)}>
            Show more
          </button>
        )}
      </div>
    </>
  );
}
export const playerColumns: Column<Player>[] = [
  {
    key: "name",
    label: "Player",
    kind: "fact",
    value: (p) => p.name,
    render: (p) => (
      <PlayerName p={p} className="player-link">
        <b>{p.name}</b>
        <small>
          {p.pos} · {p.nfl}
        </small>
      </PlayerName>
    ),
  },
  { key: "actual", label: "Actual PPG", kind: "fact", value: (p) => p.actual },
  { key: "recent", label: "Recent PPG", kind: "fact", value: (p) => p.recent },
  {
    key: "projected",
    label: "ESPN PPG",
    kind: "projection",
    value: (p) => p.projected,
  },
  {
    key: "expected",
    label: "Expected PPG",
    kind: "model",
    value: (p) => p.expected,
  },
  { key: "value", label: "Value PPG", kind: "model", value: (p) => p.value },
  {
    key: "index",
    label: "Surplus index",
    kind: "model",
    value: (p) => p.index,
  },
  {
    key: "gem",
    label: "Gem signal",
    kind: "model",
    value: (p) => p.gem,
    render: (p) => <PlayerSignals p={p} />,
  },
  {
    key: "trend",
    label: "Trend Δ PPG",
    kind: "fact",
    value: (p) => p.trendDelta,
    render: (p) => <Trend p={p} />,
  },
  {
    key: "injury",
    label: "Injury",
    kind: "fact",
    value: (p) => p.injury,
    render: (p) => <Signal text={p.injury} />,
  },
];
export const extendedColumns: Column<Player>[] = [
  ...playerColumns,
  {
    key: "weekly",
    label: "ESPN this week",
    kind: "projection",
    value: (p) => p.weekly,
  },
  {
    key: "penalty",
    label: "Consistency loss",
    kind: "model",
    value: (p) => p.penalty,
  },
  {
    key: "weight",
    label: "Actual weight",
    kind: "model",
    value: (p) => p.weight,
    render: (p) => pct(p.weight),
  },
  { key: "games", label: "Played games", kind: "fact", value: (p) => p.games },
  {
    key: "available",
    label: "Available games",
    kind: "model",
    value: (p) => p.available,
  },
  { key: "vorp", label: "VORP", kind: "model", value: (p) => p.vorp },
  {
    key: "baseline",
    label: "Replacement PPG",
    kind: "model",
    value: (p) => p.baseline,
  },
  {
    key: "gap",
    label: "Projection gap PPG",
    kind: "model",
    value: (p) => p.gap,
  },
  {
    key: "gapPct",
    label: "Projection gap %",
    kind: "model",
    value: (p) => p.gapPct,
    render: (p) => pct(p.gapPct),
  },
  {
    key: "workload",
    label: "Workload / game",
    kind: "fact",
    value: (p) => p.workload,
  },
  {
    key: "targets",
    label: "Target share",
    kind: "fact",
    value: (p) => p.targetShare,
    render: (p) => pct(p.targetShare),
  },
  {
    key: "rush",
    label: "Rush share",
    kind: "fact",
    value: (p) => p.rushShare,
    render: (p) => pct(p.rushShare),
  },
  { key: "xtd", label: "Expected TD", kind: "model", value: (p) => p.xtd },
  {
    key: "regression",
    label: "Buy low / sell high",
    kind: "model",
    value: (p) => p.regression,
    render: (p) => <Signal text={p.regression} />,
  },
  { key: "adp", label: "Draft ADP", kind: "fact", value: (p) => p.adp },
  { key: "edge", label: "Draft ADP edge", kind: "model", value: (p) => p.edge },
  { key: "bye", label: "Bye", kind: "fact", value: (p) => p.bye },
  {
    key: "opponent",
    label: "Opponent",
    kind: "fact",
    value: (p) => p.opponent,
  },
  {
    key: "slot",
    label: "ESPN roster slot",
    kind: "fact",
    value: (p) => p.slot,
    render: (p) =>
      (
        ({
          0: "QB starter",
          2: "RB starter",
          4: "WR starter",
          6: "TE starter",
          16: "D/ST starter",
          17: "K starter",
          20: "Bench",
          21: "IR",
          23: "FLEX starter",
        }) as Record<number, string>
      )[p.slot] ?? "Unknown",
  },
  {
    key: "points",
    label: "Actual season points",
    kind: "fact",
    value: (p) => p.raw.ActualPoints,
  },
  {
    key: "ros",
    label: "Remaining adjusted points",
    kind: "model",
    value: (p) => (p.value === null ? null : p.value * p.available),
  },
  {
    key: "status",
    label: "Data status",
    value: (p) => `${p.status}; ${p.baselineStatus}`,
  },
  { key: "id", label: "Player ID", kind: "fact", value: (p) => p.id },
  // New evidence follows the existing columns so established column selections keep their order.
  {
    key: "recentCarries",
    label: "Recent carries / game",
    kind: "fact",
    value: (p) => p.opportunity.recentCarries,
  },
  {
    key: "recentTargets",
    label: "Recent targets / game",
    kind: "fact",
    value: (p) => p.opportunity.recentTargets,
  },
  {
    key: "recentReceptions",
    label: "Recent catches / game",
    kind: "fact",
    value: (p) => p.opportunity.recentReceptions,
  },
  {
    key: "roleChange",
    label: "Role increase / game",
    kind: "fact",
    value: (p) => p.opportunity.delta,
  },
  {
    key: "roleForecast",
    label: "Experimental role forecast PPG",
    kind: "model",
    value: (p) => p.roleForecast,
  },
  {
    key: "usageXFP",
    label: "Usage-based xFP / game",
    kind: "model",
    value: (p) => p.opportunity.usageXFP,
  },
  {
    key: "fpoe",
    label: "FPOE / game",
    kind: "model",
    value: (p) => p.opportunity.fpoe,
  },
  {
    key: "wopr",
    label: "Recent mean WOPR",
    kind: "model",
    value: (p) => p.opportunity.wopr,
  },
  {
    key: "marketRank",
    label: "Current ROS overall rank",
    kind: "model",
    value: (p) => p.opportunity.market?.ROSOverallRank ?? null,
  },
  {
    key: "marketValue",
    label: "External trade value",
    kind: "model",
    value: (p) => p.opportunity.market?.TradeValue ?? null,
  },
  {
    key: "returnWeek",
    label: "Return-week scenario",
    kind: "model",
    value: (p) => p.opportunity.returnWeek,
  },
];
export function Legend() {
  return (
    <div className="legend">
      <span className="fact">● Recorded facts</span>
      <span className="projection">● ESPN projections</span>
      <span className="model">● Blends / model</span>
      <span className="input">● Editable</span>
      <span>Shading identifies warnings or inputs.</span>
    </div>
  );
}
