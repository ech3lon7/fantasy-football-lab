import { useMemo } from "react";
import type { Draft } from "../../domain/contracts";
import type { PositionGrade } from "../../domain/lineups";
import type { Model } from "../../domain/valuation";
import {
  tickerItems,
  weekSummary,
  type OutlookPoint,
  type WeekSummary,
} from "../../domain/view/week";
import { GradeBadge } from "./Roster";

// The outlook line chart: the user's modeled starters against the league median, one point per remaining week.
function OutlookChart({ summary }: { summary: WeekSummary }) {
  const { points, peak, dip } = summary.outlook,
    width = 640,
    height = 220,
    pad = { left: 8, right: 8, top: 24, bottom: 28 };
  const values = points.flatMap((p) =>
    [p.mine, p.median].filter((v): v is number => v !== null),
  );
  if (points.length === 0 || values.length === 0)
    return <p className="gd-muted">{summary.outlook.reason}</p>;
  // Chart geometry only: values and weeks come from the domain.
  const lo = Math.min(...values),
    hi = Math.max(...values),
    span = hi - lo || 1,
    x = (i: number) =>
      pad.left +
      (points.length === 1
        ? (width - pad.left - pad.right) / 2
        : (i / (points.length - 1)) * (width - pad.left - pad.right)),
    y = (v: number) =>
      pad.top + (1 - (v - lo) / span) * (height - pad.top - pad.bottom);
  // A missing week breaks the line instead of dropping to zero.
  const path = (read: (p: OutlookPoint) => number | null) => {
    let d = "",
      pen = false;
    points.forEach((p, i) => {
      const v = read(p);
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };
  const label = (week: number | undefined) => {
    const i = points.findIndex((p) => p.week === week);
    return i < 0
      ? null
      : points[i].mine === null
        ? null
        : { x: x(i), y: y(points[i].mine!) };
  };
  // Labels near an edge grow inward instead of being clipped.
  const anchor = (at: number) =>
    at < width * 0.18 ? "start" : at > width * 0.82 ? "end" : "middle";
  const peakAt = label(peak?.week),
    dipAt = label(dip?.week);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="gd-outlook-svg"
      role="img"
      aria-label={`Modeled starting score by week. Average ${summary.outlook.average ?? "unavailable"}; league median average ${summary.outlook.medianAverage ?? "unavailable"}.`}
    >
      <path className="gd-outlook-median" d={path((p) => p.median)} />
      <path className="gd-outlook-mine" d={path((p) => p.mine)} />
      {peakAt && peak && (
        <text
          x={peakAt.x}
          y={peakAt.y - 8}
          textAnchor={anchor(peakAt.x)}
          className="gd-outlook-tag"
        >
          Peak {peak.value}
        </text>
      )}
      {dipAt && dip && (
        <text
          x={dipAt.x}
          y={dipAt.y + 16}
          textAnchor={anchor(dipAt.x)}
          className="gd-outlook-tag"
        >
          {dip.note}
        </text>
      )}
      {points.map((p, i) => (
        <text
          key={p.week}
          x={x(i)}
          y={height - 6}
          textAnchor="middle"
          className="gd-outlook-axis"
        >
          W{p.week}
        </text>
      ))}
    </svg>
  );
}

// The This week screen: headline, outlook against the league median, up to three moves and the position scoreboard.
export function Week({
  m,
  team,
  teamName,
  grades,
  draft,
  basis,
}: {
  m: Model;
  team: string;
  teamName: string;
  grades: PositionGrade[];
  draft: Draft;
  basis: string | undefined;
}) {
  const s = useMemo(
    () => weekSummary(m, team, grades, draft, basis),
    [m, team, grades, draft, basis],
  );
  const { outlook } = s;
  return (
    <div className="gd-week">
      <section className="gd-hero">
        <div>
          <small className="gd-eyebrow">
            WEEK {s.week} · {teamName}
          </small>
          <h2>{s.headline}</h2>
          <p>{s.deck}</p>
          <div className="gd-row">
            <a className="gd-cta" href="#/trade">
              Open the trade room
            </a>
            <a className="gd-pill" href="#/roster">
              See the depth chart
            </a>
          </div>
        </div>
        <section className="gd-outlook" aria-label="Starting score outlook">
          <small className="gd-eyebrow">
            ▲ STARTING SCORE OUTLOOK · YOUR MODELED STARTERS
          </small>
          <div className="gd-outlook-top">
            <div>
              <strong>{outlook.average ?? "—"}</strong>
              <small>
                avg modeled pts / week, W{outlook.points[0]?.week ?? "—"}–
                {outlook.points.at(-1)?.week ?? "—"}
              </small>
            </div>
            <div>
              <strong
                className={
                  outlook.gap === null
                    ? ""
                    : outlook.gap.startsWith("-")
                      ? "below"
                      : "above"
                }
              >
                {outlook.gap ?? "—"}
              </strong>
              <small>vs league median {outlook.medianAverage ?? "—"}</small>
            </div>
          </div>
          <OutlookChart summary={s} />
        </section>
      </section>

      {s.moves.length > 0 && (
        <section aria-label="Moves this week">
          <h2 className="gd-h2">
            {["Three", "One", "Two", "Three"][s.moves.length]} move
            {s.moves.length === 1 ? "" : "s"} this week
          </h2>
          <div className="gd-moves">
            {s.moves.map((move) => (
              <a
                key={move.kind}
                className={`gd-move gd-move-${move.kind}`}
                href={move.href}
              >
                <small>
                  {move.kind === "trade"
                    ? "Trade"
                    : move.kind === "waiver"
                      ? "Waiver"
                      : "Lineup"}
                </small>
                <h3>{move.title}</h3>
                {move.big && (
                  <strong>
                    {move.big}
                    <small> {move.unit}</small>
                  </strong>
                )}
                <p>{move.line}</p>
              </a>
            ))}
          </div>
        </section>
      )}

      <section aria-label="Scoreboard" className="gd-score">
        <h2 className="gd-h2">Scoreboard · you vs league median</h2>
        <div
          className="gd-score-rows"
          role="table"
          aria-label="Starter value by position"
        >
          <div className="gd-score-head" role="row">
            <span role="columnheader">Pos</span>
            <span role="columnheader">You</span>
            <span role="columnheader">Median</span>
            <span role="columnheader">Grade</span>
          </div>
          {s.scoreboard.rows.map((r) => (
            <div className="gd-score-row" role="row" key={r.position}>
              <b role="rowheader">{r.position}</b>
              <span
                className="gd-bar"
                role="cell"
                title={r.reason || undefined}
              >
                {r.mineShare !== null && (
                  <i
                    data-side={r.side ?? undefined}
                    style={{ width: `${r.mineShare * 100}%` }}
                  />
                )}
                <em>{r.mine ?? "—"}</em>
              </span>
              <span className="gd-bar gd-bar-median" role="cell">
                {r.medianShare !== null && (
                  <i style={{ width: `${r.medianShare * 100}%` }} />
                )}
                <em>{r.median ?? "—"}</em>
              </span>
              <span role="cell">
                <GradeBadge grade={r.grade} tone={r.tone} />
              </span>
            </div>
          ))}
        </div>
        <p className="gd-muted">{s.scoreboard.note}</p>
      </section>
    </div>
  );
}

// The signals ticker under the header: active labels, scrolling only at Full animation and a scrollable row otherwise.
export function SignalsTicker({ m, team }: { m: Model | null; team: string }) {
  const items = useMemo(() => (m ? tickerItems(m, team) : []), [m, team]);
  if (items.length === 0) return null;
  const row = (suffix: string) =>
    items.map((i, n) => (
      <a
        key={`${suffix}${i.id}-${i.label}-${n}`}
        href={`#/player/${i.id}`}
        className="gd-tick"
        data-direction={i.direction}
        aria-hidden={suffix ? true : undefined}
        tabIndex={suffix ? -1 : undefined}
      >
        <span aria-hidden="true">{i.direction === "up" ? "▲" : "▼"}</span>{" "}
        {i.name} · {i.label}
      </a>
    ));
  return (
    <div className="gd-ticker" role="region" aria-label="Signals">
      <b>SIGNALS</b>
      <div className="gd-ticker-track">
        <div className="gd-ticker-run">
          {row("")}
          {/* The copy lets the Full-animation scroll loop without a gap; it is hidden from keyboards and readers. */}
          {row("copy-")}
        </div>
      </div>
    </div>
  );
}

// The preview's first-import state, in the new look.
export function GamedayWelcome({ onImport }: { onImport: () => void }) {
  return (
    <section className="gd-hero gd-welcome">
      <div>
        <small className="gd-eyebrow">A CLEARER VIEW OF YOUR LEAGUE</small>
        <h2>Turn your workbook into your next move.</h2>
        <p>
          Your roster, trades, player trends and hidden gems in one connected
          workspace. Start with your refreshed V5.2 workbook.
        </p>
        <div className="gd-row">
          <button type="button" className="gd-cta" onClick={onImport}>
            Import your league
          </button>
        </div>
        <small className="gd-muted">
          Parsed on your device. Your Excel file stays yours.
        </small>
      </div>
    </section>
  );
}
