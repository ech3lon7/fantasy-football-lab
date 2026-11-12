import { useEffect, useId, useState } from "react";
import { Check, Minus, TriangleAlert, X } from "lucide-react";
import {
  labelWhy,
  type WhyChart,
  type WhyGate,
  type WhyGameRow,
} from "../domain/label-why";
import type { Model, Player } from "../domain/valuation";
import { FilterHelp } from "./FilterHelp";

// Presentation-only helpers keep formatting and SVG geometry out of the domain.
const two = (value: number) => value.toFixed(2);
const cell = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "–"
    : Number.isInteger(value)
      ? `${value}`
      : value.toFixed(2);

// Status is never colour-only: every row carries an icon with an accessible name.
function StatusIcon({ status }: { status: WhyGate["status"] }) {
  const Icon = status === "PASS" ? Check : status === "FAIL" ? X : Minus;
  return (
    <span
      className={`label-why-row-icon label-why-row-icon--${status.toLowerCase()}`}
      role="img"
      aria-label={
        status === "PASS"
          ? "Check met"
          : status === "FAIL"
            ? "Check not met"
            : "Unavailable"
      }
    >
      <Icon size={13} strokeWidth={3} aria-hidden="true" />
    </span>
  );
}

// The mini bar uses only domain-owned positions and the threshold's source colour.
function MiniBar({ gate }: { gate: WhyGate }) {
  if (!gate.meter) return <span className="label-why-mini" aria-hidden="true" />;
  const { player, threshold, favorableIncreases } = gate.meter;
  const segment =
    favorableIncreases
      ? { left: `${threshold}%`, width: `${Math.max(0, 100 - threshold)}%` }
      : { left: "0%", width: `${Math.max(0, threshold)}%` };
  const tone = gate.status === "PASS" ? "met" : "miss";
  return (
    <span className="label-why-mini" aria-hidden="true">
      <span className="label-why-mini-track" />
      <span
        className="label-why-mini-favorable"
        style={segment}
      />
      <span
        className={`label-why-mini-threshold label-why-mini-threshold--${gate.thresholdSource ?? "policy"}`}
        style={{ left: `${threshold}%` }}
      />
      <span
        className={`label-why-mini-dot label-why-mini-dot--${tone}`}
        style={{ left: `${player}%` }}
      />
    </span>
  );
}

// One row renders a single gate; the text carries the meaning when the mini bar is hidden.
function GateRow({ gate }: { gate: WhyGate }) {
  return (
    <div
      className={`label-why-row label-why-row--${gate.status.toLowerCase()}`}
      data-gate-id={gate.id}
      data-gate-status={gate.status}
    >
      <StatusIcon status={gate.status} />
      <div className="label-why-row-label">
        <strong>{gate.label}</strong>
        {gate.sublabel && <small>{gate.sublabel}</small>}
      </div>
      <div className="label-why-row-value">
        <span>{gate.value}</span>
        {gate.threshold && <small>{gate.threshold}</small>}
      </div>
      <MiniBar gate={gate} />
      <span className={`label-why-pill label-why-pill--${gate.margin.tone}`}>
        {gate.margin.text}
      </span>
    </div>
  );
}

// Passing trust conditions and spare numeric trust checks collapse into compact pills.
function isCollapsed(gate: WhyGate) {
  return (
    gate.group === "trust" &&
    gate.status === "PASS" &&
    (gate.kind === "condition" || gate.margin.tone === "spare")
  );
}

function CheckGroup({
  title,
  met,
  total,
  gates,
}: {
  title: string;
  met: number;
  total: number;
  gates: WhyGate[];
}) {
  const rows = gates.filter((gate) => !isCollapsed(gate));
  const pills = gates.filter(isCollapsed);
  return (
    <div className="label-why-group" role="group" aria-label={title}>
      <div className="label-why-group-head">
        <h4>{title}</h4>
        <span>
          {met} of {total}
        </span>
      </div>
      {rows.map((gate) => (
        <GateRow key={gate.id} gate={gate} />
      ))}
      {pills.length > 0 && (
        <div className="label-why-collapsed">
          {pills.map((gate) => (
            <span className="label-why-collapsed-pill" key={gate.id}>
              <Check size={11} strokeWidth={3} aria-hidden="true" />
              {gate.label}
              {gate.threshold && ` (${gate.threshold})`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// The chart draws only values the domain returned; a null bar stays a visible gap.
function Chart({ chart }: { chart: WhyChart }) {
  const width = 384,
    height = 150,
    left = 26,
    right = 8,
    top = 12,
    bottom = 28;
  const plotWidth = width - left - right,
    plotHeight = height - top - bottom,
    baseline = top + plotHeight;
  const values = [
    ...chart.bars.map((bar) => bar.value),
    ...chart.lines.map((line) => line.value),
  ].filter((value): value is number => value !== null && Number.isFinite(value));
  const ceiling = Math.ceil(Math.max(1, ...values) * 1.1);
  const y = (value: number) =>
    top + plotHeight - (Math.max(0, value) / ceiling) * plotHeight;
  const slot = plotWidth / Math.max(1, chart.bars.length);
  const center = (index: number) => left + index * slot + slot / 2;
  const barWidth = Math.max(4, slot * 0.58);
  const recentIndexes = chart.bars
    .map((bar, index) => (bar.window === "recent" ? index : -1))
    .filter((index) => index >= 0);
  const earlierIndexes = chart.bars
    .map((bar, index) => (bar.window === "earlier" ? index : -1))
    .filter((index) => index >= 0);
  const firstRecent = recentIndexes[0],
    lastEarlier = earlierIndexes[earlierIndexes.length - 1];
  // Label the ends and the window boundaries; every bar keeps a title for inspection.
  const labelIndexes = Array.from(
    new Set(
      [
        0,
        lastEarlier,
        firstRecent,
        chart.bars.length - 1,
      ].filter((index): index is number => index !== undefined && index >= 0),
    ),
  );
  const sourceColor = (source?: string) =>
    source === "setting"
      ? "var(--purple)"
      : source === "espn"
        ? "var(--blue)"
        : "#4A4652";
  return (
    <div className="label-why-chart">
      <h4>{chart.unitLabel}</h4>
      <svg
        className="label-why-chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={chart.ariaLabel}
      >
        <title>{chart.ariaLabel}</title>
        {/* Two gridlines keep the scale readable without turning the chart into an axis. */}
        {[0, 0.5].map((fraction) => (
          <g key={fraction}>
            <line
              x1={left}
              x2={left + plotWidth}
              y1={y(ceiling * fraction)}
              y2={y(ceiling * fraction)}
              stroke="#E3E1E8"
              strokeWidth={1}
            />
            <text
              x={left - 4}
              y={y(ceiling * fraction) + 3}
              textAnchor="end"
              fontSize={8}
              fill="#6E7B74"
            >
              {Math.round(ceiling * fraction)}
            </text>
          </g>
        ))}
        {/* Window bands and labels describe which games the averages use. */}
        {earlierIndexes.length > 0 && (
          <>
            <rect
              x={left + earlierIndexes[0] * slot}
              y={top}
              width={earlierIndexes.length * slot}
              height={plotHeight}
              fill="#F3F2F5"
            />
            <text
              x={center(earlierIndexes[Math.floor(earlierIndexes.length / 2)])}
              y={top + 8}
              textAnchor="middle"
              fontSize={8}
              fill="#6E7B74"
            >
              Earlier {earlierIndexes.length}
            </text>
          </>
        )}
        {recentIndexes.length > 0 && (
          <>
            <rect
              x={left + recentIndexes[0] * slot}
              y={top}
              width={recentIndexes.length * slot}
              height={plotHeight}
              fill="#FBEFF4"
            />
            <text
              x={center(recentIndexes[Math.floor(recentIndexes.length / 2)])}
              y={top + 8}
              textAnchor="middle"
              fontSize={8}
              fill="#7A1243"
            >
              Last 3
            </text>
          </>
        )}
        {/* Bars keep the recorded game value; a null bar is a gap, never a zero. */}
        {chart.bars.map((bar, index) => {
          const x = center(index) - barWidth / 2;
          const value = bar.value;
          if (value === null)
            return (
              <text
                key={`${bar.season}-${bar.week}`}
                x={center(index)}
                y={baseline - 2}
                textAnchor="middle"
                fontSize={9}
                fill="#6E7B74"
              >
                –
                <title>{`Week ${bar.week}: unavailable`}</title>
              </text>
            );
          const barHeight = Math.max(1, baseline - y(value));
          return (
            <rect
              key={`${bar.season}-${bar.week}`}
              x={x}
              y={baseline - barHeight}
              width={barWidth}
              height={barHeight}
              rx={2}
              fill={
                bar.window === "recent"
                  ? "var(--pink)"
                  : bar.window === "earlier"
                    ? "#A8A3B4"
                    : "#E3E1E8"
              }
            >
              <title>{`Week ${bar.week}: ${two(value)}`}</title>
            </rect>
          );
        })}
        {/* Reference lines use their source colour: purple setting, blue ESPN, dark grey rule. */}
        {chart.lines.map((line) => (
          <line
            key={`${line.kind}-${line.value}`}
            x1={left}
            x2={left + plotWidth}
            y1={y(line.value)}
            y2={y(line.value)}
            stroke={
              line.kind === "threshold"
                ? sourceColor(line.source)
                : line.kind === "espn"
                  ? "var(--blue)"
                  : line.kind === "recentAvg"
                    ? "#7A1243"
                    : "#4A4652"
            }
            strokeWidth={line.kind === "recentAvg" ? 2 : 1.5}
            strokeDasharray={
              line.kind === "threshold" || line.kind === "espn"
                ? "5 4"
                : undefined
            }
          />
        ))}
        {/* Jump and gap brackets connect the two averages without restating a formula. */}
        {(chart.jump || chart.gap) &&
          (firstRecent !== undefined || lastEarlier !== undefined) && (
            <Bracket
              x={
                firstRecent !== undefined
                  ? left + firstRecent * slot
                  : left + (lastEarlier ?? 0) * slot + slot
              }
              jump={chart.jump}
              gap={chart.gap}
              y={y}
            />
          )}
        {labelIndexes.map((index) => (
          <text
            key={index}
            x={center(index)}
            y={height - 8}
            textAnchor="middle"
            fontSize={9}
            fill="#6E7B74"
          >
            W{chart.bars[index].week}
          </text>
        ))}
      </svg>
      <div className="label-why-chart-legend">
        {chart.lines.map((line) => (
          <span key={`${line.kind}-${line.label}`}>
            <i
              className={`label-why-swatch label-why-swatch--${line.kind}${
                line.source ? ` label-why-swatch--${line.source}` : ""
              }`}
              aria-hidden="true"
            />
            {line.label} {two(line.value)}
          </span>
        ))}
      </div>
      {chart.note && <small className="label-why-chart-note">{chart.note}</small>}
    </div>
  );
}

// The bracket is purely decorative; the legend and verdict carry the same information in text.
function Bracket({
  x,
  jump,
  gap,
  y,
}: {
  x: number;
  jump?: WhyChart["jump"];
  gap?: WhyChart["gap"];
  y: (value: number) => number;
}) {
  const bracket = jump ?? gap;
  if (!bracket) return null;
  const stroke = jump?.tone === "spare" ? "#1E7B4F" : "#B4520A";
  const middle = (y(bracket.from) + y(bracket.to)) / 2;
  return (
    <g aria-hidden="true">
      <line
        x1={x}
        x2={x}
        y1={y(bracket.from)}
        y2={y(bracket.to)}
        stroke={stroke}
        strokeWidth={2}
      />
      <line
        x1={x - 3}
        x2={x + 3}
        y1={y(bracket.from)}
        y2={y(bracket.from)}
        stroke={stroke}
        strokeWidth={2}
      />
      <line
        x1={x - 3}
        x2={x + 3}
        y1={y(bracket.to)}
        y2={y(bracket.to)}
        stroke={stroke}
        strokeWidth={2}
      />
      <text x={x + 4} y={middle + 3} fontSize={9} fill={stroke}>
        {bracket.label}
      </text>
    </g>
  );
}

// The game table is the same history the chart uses, shown only on request.
function GameTable({ games }: { games: WhyGameRow[] }) {
  if (!games.length) return null;
  return (
    <table className="label-why-games">
      <caption>Games used by this label</caption>
      <thead>
        <tr>
          <th scope="col">Week</th>
          <th scope="col">Window</th>
          <th scope="col">Points</th>
          <th scope="col">Targets</th>
          <th scope="col">Carries</th>
          <th scope="col">TDs</th>
        </tr>
      </thead>
      <tbody>
        {games.map((game) => (
          <tr key={`${game.season}-${game.week}`}>
            <td>W{game.week}</td>
            <td>{game.window[0].toUpperCase() + game.window.slice(1)}</td>
            <td>{cell(game.points)}</td>
            <td>{cell(game.targets)}</td>
            <td>{cell(game.carries)}</td>
            <td>{cell(game.tds)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Render one selected label at a time; chips expose every earned label and near miss.
export function LabelWhy({ p, m }: { p: Player; m: Model }) {
  const labels = labelWhy(p, m);
  const panelId = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const [showGames, setShowGames] = useState(false);
  const tagsKey = labels.map((label) => label.tag).join("|");
  // Reset to the first label when the player or its label set changes.
  useEffect(() => {
    setSelected(labels[0]?.tag ?? null);
    setShowGames(false);
    // The tag list is the stable identity for this reset.
  }, [tagsKey]);
  if (!labels.length) return null;
  const active = labels.find((label) => label.tag === selected) ?? labels[0];
  const hasNear = labels.some((label) => label.state === "near");
  const gates = active.groups.flatMap((group) => group.gates);
  const historical = gates.filter((gate) => gate.historical);
  const nearSections = active.nearSections ?? [];
  return (
    <section className="label-why" aria-label="Label explanations">
      <div className="label-why-chips" role="group" aria-label="Labels">
        {labels.map((label) => (
          <button
            type="button"
            key={label.tag}
            aria-pressed={label.tag === active.tag}
            aria-controls={panelId}
            className={`label-why-chip label-why-chip--${label.state} label-why-chip--${label.tone}`}
            onClick={() => {
              setSelected(label.tag);
              setShowGames(false);
            }}
          >
            {label.state === "earned" ? (
              label.tone === "warning" ? (
                <TriangleAlert size={13} aria-hidden="true" />
              ) : (
                <Check size={13} aria-hidden="true" />
              )
            ) : (
              <span aria-hidden="true">◌</span>
            )}
            {label.state === "earned"
              ? label.tag
              : `${label.tag} · near miss`}
          </button>
        ))}
      </div>
      {hasNear && (
        <p className="label-why-hint">
          Dashed labels are near misses, not earned yet.
        </p>
      )}
      <div
        className="label-why-panel"
        id={panelId}
        role="region"
        aria-label={`Why ${active.state === "near" ? "not " : ""}${active.tag}`}
      >
        <p className="label-why-eyebrow">
          WHY {active.state === "near" ? "NOT " : ""}
          {active.tag.toUpperCase()}?
        </p>
        <div className="label-why-verdict">
          <span
            className={`label-why-verdict-icon label-why-verdict-icon--${active.state} label-why-verdict-icon--${active.tone}`}
          >
            {active.state === "near" ? (
              <X size={15} strokeWidth={3} aria-hidden="true" />
            ) : active.tone === "warning" ? (
              <TriangleAlert size={15} aria-hidden="true" />
            ) : (
              <Check size={15} strokeWidth={3} aria-hidden="true" />
            )}
          </span>
          {active.verdict}
        </div>
        <p className="label-why-summary">{active.summary}</p>
        {/* Warnings stay visible beside the summary, whether the label is earned or near. */}
        {active.warnings.map((warning) => (
          <p className="notice warning" key={warning}>
            {warning}
          </p>
        ))}
        {active.stale && (
          <p className="notice warning">
            Stale or undated snapshot. This explanation describes imported
            evidence, not verified current conditions.
          </p>
        )}
        <div className="label-why-grid">
          <div className="label-why-main">
            {active.state === "near" ? (
              <>
                {nearSections
                  .filter((section) => section.id === "not-met")
                  .map((section) => (
                    <CheckGroup
                      key={section.id}
                      title={section.title}
                      met={section.gates.filter((gate) => gate.status === "PASS").length}
                      total={section.count}
                      gates={section.gates}
                    />
                  ))}
                {nearSections
                  .filter((section) => section.id === "already-met")
                  .map((section) => (
                    <CheckGroup
                      key={section.id}
                      title={section.title}
                      met={section.count}
                      total={section.count}
                      gates={section.gates}
                    />
                  ))}
                {active.flip && (
                  <div className="label-why-flip">
                    <p className="label-why-card-eyebrow">WHAT WOULD FLIP IT</p>
                    <strong>{active.flip.headline}</strong>
                    <p>{active.flip.detail}</p>
                    <small>{active.flip.caveat}</small>
                  </div>
                )}
              </>
            ) : (
              <>
                {active.groups.map((group) => (
                  <CheckGroup
                    key={group.id}
                    title={group.title}
                    met={group.met}
                    total={group.total}
                    gates={group.gates}
                  />
                ))}
                {active.closest && (
                  <div className="label-why-closest">
                    <p className="label-why-card-eyebrow">
                      {active.closest.headline.toUpperCase()}
                    </p>
                    <p>{active.closest.detail}</p>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="label-why-side">
            {active.chart && <Chart chart={active.chart} />}
            {historical.length > 0 && (
              <div className="label-why-historical">
                <h4>Historical reference</h4>
                <ul>
                  {historical.map((gate) => (
                    <li key={gate.id}>
                      <FilterHelp
                        label="Historical reference"
                        help={gate.historical!.note}
                      >
                        <span
                          className={
                            gate.historical!.unavailable ? "muted" : "fact"
                          }
                        >
                          {gate.label}: {gate.historical!.short}
                        </span>
                      </FilterHelp>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="label-why-actions">
              {active.games.length > 0 && (
                <button
                  type="button"
                  className="label-why-action"
                  aria-expanded={showGames}
                  onClick={() => setShowGames((open) => !open)}
                >
                  {showGames ? "Hide the" : "Show the"} {active.games.length} games
                </button>
              )}
              {active.canAdjust && (
                <a className="button label-why-action" href="#/model">
                  Adjust thresholds
                </a>
              )}
            </div>
          </div>
        </div>
        {showGames && <GameTable games={active.games} />}
        <details className="label-why-details">
          <summary>Details and caveats</summary>
          <p>{active.details.meaning}</p>
          {active.details.interpretation && (
            <p>{active.details.interpretation}</p>
          )}
          {active.details.limitations && <p>{active.details.limitations}</p>}
          <p>
            <small>{active.details.researchNote}</small>
          </p>
          {active.details.window && <p>{active.details.window}</p>}
          {active.details.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
          <p>
            <small>
              Source refreshed: {active.details.sourceUTC ?? "Unavailable"}.
              Displayed numbers are rounded; labels use unrounded calculations.
            </small>
          </p>
        </details>
      </div>
    </section>
  );
}
