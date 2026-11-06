import { useState, useId } from "react";
import type { PlayerTrendSummary, PlayerTrendPoint } from "../domain/player-trend";

// Renders an interactive, responsive stock-style chart showing Fast MA, Slow MA, and hollow volume bars
export function PlayerStockChart({
  trend,
  playerName,
  position,
  height = 220,
}: {
  trend: PlayerTrendSummary;
  playerName: string;
  position: string;
  height?: number;
}) {
  const [activePoint, setActivePoint] = useState<PlayerTrendPoint | null>(null);
  const chartId = useId();

  if (!trend.series || trend.series.length === 0) {
    return (
      <div className="player-stock-chart-empty muted">
        No completed game history available for trend analysis.
      </div>
    );
  }

  const series = trend.series;
  const latest = trend.latest;

  // Chart layout dimensions and padding
  const svgWidth = 600;
  const svgHeight = height;
  const padLeft = 45;
  const padRight = 25;
  const padTop = 25;
  const padBottom = 35;
  const plotWidth = svgWidth - padLeft - padRight;
  const plotHeight = svgHeight - padTop - padBottom;

  // Determine scaling boundaries for fantasy points (Y axis)
  const maxPoints = Math.max(
    ...series.map((s) => Math.max(s.points, s.fastMA, s.slowMA)),
    15,
  );
  const yMax = Math.ceil(maxPoints / 5) * 5;
  const yMin = 0;

  // Determine volume scaling boundaries (for bottom-third volume bars)
  const maxVolume = Math.max(...series.map((s) => s.volume), 5);
  const volumeMaxHeight = plotHeight * 0.35;

  // Coordinate mapping functions
  const getX = (index: number) => {
    if (series.length === 1) return padLeft + plotWidth / 2;
    return padLeft + (index / (series.length - 1)) * plotWidth;
  };

  const getY = (val: number) => {
    const clamped = Math.max(yMin, Math.min(yMax, val));
    return padTop + plotHeight - ((clamped - yMin) / (yMax - yMin)) * plotHeight;
  };

  const getVolumeHeight = (vol: number) => {
    return (vol / maxVolume) * volumeMaxHeight;
  };

  // Build SVG path strings for raw points, Fast MA curve, and Slow MA curve
  const pointsPath = series
    .map((s, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(s.points)}`)
    .join(" ");

  const fastMaPath = series
    .map((s, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(s.fastMA)}`)
    .join(" ");

  const slowMaPath = series
    .map((s, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(s.slowMA)}`)
    .join(" ");

  // Fast MA area fill path closed along the bottom baseline
  const areaFillPath = `${fastMaPath} L ${getX(series.length - 1)} ${padTop + plotHeight} L ${getX(0)} ${padTop + plotHeight} Z`;

  // Color selection based on trend momentum status
  const strokeColor =
    latest?.tone === "good"
      ? "var(--good, #22c55e)"
      : latest?.tone === "orange"
        ? "var(--orange, #f59e0b)"
        : latest?.tone === "bad"
          ? "var(--bad, #ef4444)"
          : "var(--neutral-line, #94a3b8)";

  // Y-axis grid tick marks (4 intervals)
  const yTicks = [0, yMax * 0.33, yMax * 0.66, yMax];

  return (
    <div className="player-stock-chart-container" role="region" aria-label={`Performance stock trend chart for ${playerName}`}>
      {/* Legend and active status strip */}
      <div className="stock-chart-header">
        <div className="stock-chart-legend">
          <span className="legend-item fast-ma" style={{ color: strokeColor }}>
            <span className="legend-swatch solid" style={{ backgroundColor: strokeColor }} />
            Fast MA (2-game)
          </span>
          <span className="legend-item slow-ma">
            <span className="legend-swatch dashed" />
            Slow MA (5-game)
          </span>
          <span className="legend-item raw-pts">
            <span className="legend-swatch dotted" />
            Points
          </span>
          <span className="legend-item volume">
            <span className="legend-swatch hollow" />
            {position === "QB" ? "Pass Att." : "Touches"}
          </span>
        </div>
        {latest && (
          <div className={`stock-status-badge ${latest.tone}`}>
            {latest.badge} · {latest.label}
          </div>
        )}
      </div>

      {/* SVG Stock Chart Visual Canvas */}
      <div className="stock-chart-svg-wrap">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="player-stock-svg"
          preserveAspectRatio="xMidYMid meet"
          onMouseLeave={() => setActivePoint(null)}
        >
          <defs>
            {/* Linear gradient fill under the Fast MA line */}
            <linearGradient id={`gradient-${chartId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.22" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Horizontal grid lines and Y-axis scale values */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={padLeft}
                y1={getY(tick)}
                x2={svgWidth - padRight}
                y2={getY(tick)}
                className="stock-grid-line"
              />
              <text
                x={padLeft - 8}
                y={getY(tick) + 4}
                className="stock-axis-label"
                textAnchor="end"
              >
                {Math.round(tick)}
              </text>
            </g>
          ))}

          {/* Hollow volume bars at the bottom representing touches/opportunities */}
          {series.map((s, i) => {
            const barWidth = Math.max(plotWidth / (series.length * 2.5), 8);
            const x = getX(i) - barWidth / 2;
            const barH = getVolumeHeight(s.volume);
            const y = padTop + plotHeight - barH;
            return (
              <rect
                key={`vol-${s.week}`}
                x={x}
                y={y}
                width={barWidth}
                height={barH}
                rx={2}
                className="stock-volume-bar"
              />
            );
          })}

          {/* Gradient area fill under Fast MA */}
          <path d={areaFillPath} fill={`url(#gradient-${chartId})`} className="stock-area-fill" />

          {/* Raw points dotted line and data nodes */}
          <path d={pointsPath} className="stock-points-line" />
          {series.map((s, i) => (
            <circle
              key={`pt-${s.week}`}
              cx={getX(i)}
              cy={getY(s.points)}
              r={3}
              className="stock-point-node"
            />
          ))}

          {/* Slow MA baseline dashed anchor curve */}
          <path d={slowMaPath} className="stock-slow-ma-line" />

          {/* Fast MA primary responsive momentum curve */}
          <path
            d={fastMaPath}
            className="stock-fast-ma-line"
            style={{ stroke: strokeColor }}
          />

          {/* X-axis week indicators along bottom baseline */}
          {series.map((s, i) => (
            <text
              key={`lbl-${s.week}`}
              x={getX(i)}
              y={svgHeight - 10}
              className="stock-week-label"
              textAnchor="middle"
            >
              W{s.week}
            </text>
          ))}

          {/* Interactive hover crosshair and nodes */}
          {activePoint && (
            <g className="stock-interactive-overlay">
              {(() => {
                const idx = series.findIndex((p) => p.week === activePoint.week);
                if (idx < 0) return null;
                const x = getX(idx);
                return (
                  <>
                    <line
                      x1={x}
                      y1={padTop}
                      x2={x}
                      y2={padTop + plotHeight}
                      className="stock-crosshair-line"
                    />
                    <circle
                      cx={x}
                      cy={getY(activePoint.fastMA)}
                      r={5}
                      className="stock-focus-node fast"
                      style={{ fill: strokeColor }}
                    />
                    <circle
                      cx={x}
                      cy={getY(activePoint.slowMA)}
                      r={4}
                      className="stock-focus-node slow"
                    />
                  </>
                );
              })()}
            </g>
          )}

          {/* Invisible interactive hover target bands across columns */}
          {series.map((s, i) => {
            const bandWidth = plotWidth / series.length;
            const x = getX(i) - bandWidth / 2;
            return (
              <rect
                key={`hit-${s.week}`}
                x={x}
                y={padTop}
                width={bandWidth}
                height={plotHeight}
                fill="transparent"
                onMouseEnter={() => setActivePoint(s)}
                onTouchStart={() => setActivePoint(s)}
                className="stock-hit-area"
              />
            );
          })}
        </svg>

        {/* Floating tooltip inspection card when hovering over a week node */}
        {activePoint && (
          <div className="stock-tooltip-popover">
            <div className="tooltip-week-title">Week {activePoint.week}</div>
            <div className="tooltip-stat-row">
              <span className="tooltip-label">Points:</span>
              <strong>{activePoint.points.toFixed(1)}</strong>
            </div>
            <div className="tooltip-stat-row">
              <span className="tooltip-label">Fast MA (2G):</span>
              <span style={{ color: strokeColor }}>{activePoint.fastMA.toFixed(1)}</span>
            </div>
            <div className="tooltip-stat-row">
              <span className="tooltip-label">Slow MA (5G):</span>
              <span>{activePoint.slowMA.toFixed(1)}</span>
            </div>
            <div className="tooltip-stat-row">
              <span className="tooltip-label">{position === "QB" ? "Pass Att:" : "Touches:"}</span>
              <span>{Math.round(activePoint.volume)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
