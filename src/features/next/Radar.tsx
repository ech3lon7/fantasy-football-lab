import type { RadarAxis } from "../../domain/view/player-card";

// Hand-built radar comparing the player with the position average; missing axes are drawn as gaps, never as zero.
export function Radar({ axes }: { axes: RadarAxis[] }) {
  const size = 260,
    center = size / 2,
    radius = 90;
  // Place a 0 to 1 value on the axis at index i; this is geometry only, the values come from the domain.
  const point = (i: number, scaled: number) => {
    const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    return [
      center + Math.cos(angle) * radius * scaled,
      center + Math.sin(angle) * radius * scaled,
    ];
  };
  const ring = (scaled: number) =>
    axes.map((_, i) => point(i, scaled).join(",")).join(" ");
  const shape = axes
    .map((a, i) => (a.scaled === null ? null : point(i, a.scaled).join(",")))
    .filter(Boolean)
    .join(" ");
  const missing = axes.filter((a) => a.scaled === null);
  const summary = axes
    .map(
      (a) =>
        `${a.label} ${a.value === null ? "unavailable" : a.value.toFixed(1)}${a.average === null ? "" : `, position average ${a.average.toFixed(1)}`}`,
    )
    .join("; ");
  return (
    <figure className="gd-radar">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Radar against the position average. ${summary}`}
      >
        <polygon className="gd-radar-grid" points={ring(1)} />
        <polygon className="gd-radar-avg" points={ring(0.5)} />
        {shape && <polygon className="gd-radar-shape" points={shape} />}
        {axes.map((a, i) => {
          const [x, y] = point(i, 1.22);
          return (
            <text
              key={a.key}
              x={x}
              y={y}
              textAnchor="middle"
              className={a.scaled === null ? "gd-radar-gap" : "gd-radar-label"}
            >
              {a.label}
              {a.scaled === null ? " —" : ""}
            </text>
          );
        })}
      </svg>
      <figcaption>
        The dashed ring is the position average.
        {missing.length > 0 &&
          ` Not shown, no data: ${missing.map((a) => a.label).join(", ")}.`}
      </figcaption>
    </figure>
  );
}
