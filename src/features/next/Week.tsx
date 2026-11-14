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
import { PlayerPhoto } from "../../ui/PlayerPhoto";
import type { Digest } from "../../domain/view/since-import";
import { SimulationNote } from "./SimulationIssuePopover";
import { weeklyLineup } from "../../domain/lineups";
import { playerMatchups } from "../../domain/matchups";
import { useOpenPlayer } from "./PlayerCard";
import { MPPG_METHOD_NOTE } from "../../domain/mppg";

// The outlook line chart: the user's modeled starters against the league median, one point per remaining week.
function OutlookChart({ summary }: { summary: WeekSummary }) {
  const { points, peak, dip } = summary.outlook,
    width = 640,
    height = 230,
    pad = { left: 24, right: 24, top: 32, bottom: 32 };
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
  // Area fill under your line down to chart bottom
  const areaPath = () => {
    const valid = points.filter((p) => p.mine !== null);
    if (valid.length < 2) return "";
    let d = "";
    valid.forEach((p, i) => {
      const idx = points.indexOf(p);
      d += `${i === 0 ? "M" : "L"}${x(idx).toFixed(1)},${y(p.mine!).toFixed(1)} `;
    });
    const lastIdx = points.indexOf(valid.at(-1)!);
    const firstIdx = points.indexOf(valid[0]);
    d += `L${x(lastIdx).toFixed(1)},${height - pad.bottom} L${x(firstIdx).toFixed(1)},${height - pad.bottom} Z`;
    return d.trim();
  };
  const peakAt = label(peak?.week),
    dipAt = label(dip?.week);
  return (
    <div className="gd-outlook-chart-wrap">
      <div className="gd-outlook-legend">
        <span className="gd-outlook-legend-item mine">
          <span className="gd-outlook-legend-swatch mine" />
          <span>Your starters</span>
        </span>
        <span className="gd-outlook-legend-item median">
          <span className="gd-outlook-legend-swatch median" />
          <span>League median</span>
        </span>
      </div>
      <div className="gd-outlook-chart-box">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="gd-outlook-svg"
          role="img"
          aria-label={`Modeled starting score by week. Average ${summary.outlook.average ?? "unavailable"}; league median average ${summary.outlook.medianAverage ?? "unavailable"}.`}
        >
          <path className="gd-outlook-area" d={areaPath()} />
          <path className="gd-outlook-median" d={path((p) => p.median)} />
          <path className="gd-outlook-mine" d={path((p) => p.mine)} />
          {points.map((p, i) => (
            <g key={`dots-${p.week}`}>
              {p.median !== null && (
                <circle
                  className="gd-outlook-dot-median"
                  cx={x(i)}
                  cy={y(p.median)}
                  r={3}
                />
              )}
              {p.mine !== null && (
                <circle
                  className="gd-outlook-dot-mine"
                  cx={x(i)}
                  cy={y(p.mine)}
                  r={4.5}
                />
              )}
            </g>
          ))}
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
        {peakAt && peak && (
          <div
            className="gd-outlook-bubble popin"
            style={{
              left: `${(peakAt.x / width) * 100}%`,
              top: `${(peakAt.y / height) * 100}%`,
            }}
          >
            Peak {peak.value}
          </div>
        )}
        {dipAt && dip && (
          <div
            className="gd-outlook-bubble popin"
            style={{
              left: `${(dipAt.x / width) * 100}%`,
              top: `${(dipAt.y / height) * 100}%`,
            }}
          >
            {dip.note}
          </div>
        )}
      </div>
    </div>
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
  digest,
  onApplyDrop,
  onSwitchToLive,
}: {
  // What changed since the previous import; null hides the section entirely.
  digest: Digest | null;
  m: Model;
  team: string;
  teamName: string;
  grades: PositionGrade[];
  draft: Draft;
  basis: string | undefined;
  onApplyDrop?: (team: string, playerId: string) => void;
  onSwitchToLive?: () => void;
}) {
  const s = useMemo(
    () => weekSummary(m, team, grades, draft, basis),
    [m, team, grades, draft, basis],
  );
  const { outlook } = s;
  const wl = useMemo(() => weeklyLineup(m, team), [m, team]);
  const openPlayer = useOpenPlayer();
  return (
    <div className="gd-week">
      <SimulationNote
        simulation={m.simulation}
        team={team}
        onApplyDrop={onApplyDrop}
        onSwitchToLive={onSwitchToLive}
      />
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

      {/* 3.1 Week N lineup · by MPPG */}
      <section aria-label={`Week ${wl.week} lineup by MPPG`} style={{ marginTop: "16px" }}>
        <h2 className="gd-h2" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
          / WEEK {wl.week} LINEUP · BY MPPG
        </h2>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px 20px" }}>
          <div className="wtot">
            <div>
              <div className="gd-muted" style={{ fontSize: "12.5px", fontWeight: 700, textTransform: "uppercase" }}>
                ▲ Starters · Week {wl.week} MPPG
              </div>
              <div className="wtot-score">
                <strong>{wl.totalMppg.toFixed(1)}</strong>
                <span>± {wl.totalSpread.toFixed(1)}</span>
              </div>
            </div>
            <div className="gd-muted" style={{ fontSize: "14px", fontWeight: 600 }}>
              {wl.gainText} over your season lineup this week
            </div>
          </div>

          <div className="gd-muted" style={{ fontSize: "12.5px", lineHeight: "1.4" }}>
            {MPPG_METHOD_NOTE}
          </div>

          {wl.hasSwaps && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "4px 0" }}>
              {wl.swaps.map((sw) => (
                <div key={`${sw.startId}-${sw.overId}`} className="wsw">
                  <span>
                    Start{" "}
                    <button
                      type="button"
                      className="wsw-btn"
                      onClick={() => openPlayer(sw.startId)}
                    >
                      {sw.startName}
                    </button>{" "}
                    over{" "}
                    <button
                      type="button"
                      className="wsw-btn"
                      onClick={() => openPlayer(sw.overId)}
                    >
                      {sw.overName}
                    </button>
                  </span>
                  <b className="num" style={{ fontWeight: 800 }}>{sw.gainText}</b>
                  <div className="wsw-meta">{sw.reason}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: "6px" }}>
            <div className="wl wl-h">
              <span>Slot</span>
              <span>Starter</span>
              <span>MPPG</span>
              <span>Matchup</span>
            </div>
            {wl.slots.map((row, idx) => {
              const p = row.player;
              const matchups = p ? playerMatchups(m, p) : [];
              const currMu = matchups.find((mu) => mu.week === wl.week);
              const tone = currMu?.tone ?? "neutral";
              const muLabel = currMu?.shortText.split(" · ")[0] ?? (currMu?.bye ? "Bye" : "—");

              return (
                <div
                  key={`${row.slot}-${idx}`}
                  className={`wl${row.isNewStarter ? " wl-diff" : ""}`}
                >
                  <b style={{ fontFamily: "var(--gd-font-mono, monospace)", fontSize: "14px" }}>
                    {row.slot}
                  </b>
                  <div className="wln">
                    {p ? (
                      <button
                        type="button"
                        style={{
                          background: "transparent",
                          border: 0,
                          padding: 0,
                          color: "var(--gd-ink)",
                          fontWeight: 700,
                          textAlign: "left",
                          cursor: "pointer",
                          fontSize: "14.5px",
                        }}
                        onClick={() => openPlayer(p.id)}
                      >
                        {p.name}
                      </button>
                    ) : (
                      <span className="gd-muted">Unfilled</span>
                    )}
                    {row.mppg?.buildLine && (
                      <small title={row.mppg.buildLine}>{row.mppg.buildLine}</small>
                    )}
                  </div>
                  <div>
                    {row.mppg?.value !== null && row.mppg?.value !== undefined ? (
                      <>
                        <b className="num" style={{ fontWeight: 700 }}>
                          {row.mppg.value.toFixed(1)}
                        </b>{" "}
                        <span className="gd-muted num" style={{ fontSize: "12px" }}>
                          ± {row.mppg.spread?.toFixed(1) ?? "0.0"}
                        </span>
                      </>
                    ) : (
                      <span className="gd-muted">{row.mppg?.reason ?? "—"}</span>
                    )}
                  </div>
                  <div>
                    {currMu && (
                      <span
                        className="mu-chip"
                        data-tone={tone}
                        title={currMu.text}
                      >
                        {currMu.bye ? "Bye" : muLabel.replace(/^W\d+\s*/, "")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="gd-muted" style={{ fontSize: "13px", marginTop: "4px" }}>
            {wl.note}
          </div>
        </div>
      </section>

      {digest && (
        <section aria-label="Since last import">
          <h2 className="gd-h2">Since last import</h2>
          <ul className="gd-digest">
            {digest.items.map((i) => {
              const p = m.byId.get(i.playerId) ?? {
                id: i.playerId,
                name: i.name,
              };
              return (
                <li key={`${i.kind}-${i.playerId}-${i.label ?? ""}`}>
                  <PlayerPhoto player={p} size={24} />
                  <span className="gd-digest-kind" data-kind={i.kind}>
                    {i.kind === "new-label"
                      ? "New label"
                      : i.kind === "lost-label"
                        ? "Lost label"
                        : "EPPG mover"}
                  </span>
                  {i.kind === "eppg-mover" ? (
                    <>
                      <b>{i.name}</b>
                      <span>
                        {i.from!.toFixed(1)} → {i.to!.toFixed(1)}
                      </span>
                      <strong>
                        {i.delta! > 0 ? "+" : ""}
                        {i.delta!.toFixed(1)}
                      </strong>
                    </>
                  ) : (
                    <>
                      <b>{i.name}</b>
                      <span>
                        {i.kind === "new-label" ? "earned" : "no longer has"}{" "}
                        {i.label}
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <small className="gd-muted">
            Compared with the previous import
            {digest.comparedTo
              ? ` (source ${new Date(digest.comparedTo).toLocaleString()})`
              : ""}
            . The app keeps a small summary of that import on this device, not
            the workbook.
          </small>
        </section>
      )}

      {s.moves.length > 0 && (
        <section aria-label="Moves this week">
          <h2 className="gd-h2">
            {(["Zero", "One", "Two", "Three"][s.moves.length] ?? `${s.moves.length}`)} move
            {s.moves.length === 1 ? "" : "s"} this week
          </h2>
          <div className="gd-moves">
            {s.moves.map((move) => {
              const p = move.playerId ? m.byId.get(move.playerId) : undefined;
              const buttonLabel =
                move.kind === "trade"
                  ? "Review the deal"
                  : move.kind === "waiver"
                    ? "Scout him"
                    : "Open depth chart";
              return (
                <a
                  key={move.kind}
                  className={`gd-move gd-move-${move.kind}`}
                  href={move.href}
                >
                  {/* Move recommendations use the player's photo as a translucent card background. */}
                  {p && <span className="gd-move-photo"><PlayerPhoto player={p} size="fill" /></span>}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "8px",
                    }}
                  >
                    <small>
                      {move.kind === "trade"
                        ? "Trade"
                        : move.kind === "waiver"
                          ? "Waiver"
                          : "Lineup"}
                    </small>
                  </div>
                  <h3>{move.title}</h3>
                  {move.big && (
                    <strong>
                      {move.big}
                      <small> {move.unit}</small>
                    </strong>
                  )}
                  <p>{move.line}</p>
                  <span className="gd-move-btn">
                    {buttonLabel}
                  </span>
                </a>
              );
            })}
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
