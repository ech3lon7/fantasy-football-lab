import type { IconKind } from "./wheel-model";

// Chalk drawn as SVG strokes: 2.5px, round caps, no fills. These are decoration, so they are hidden from assistive technology.

// The yellow hatch of a selected segment: 35 degrees, 7px apart, 55% opacity.
export function ChalkDefs({ id }: { id: string }) {
  return (
    <defs>
      <pattern
        id={id}
        width="7"
        height="7"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(35)"
      >
        <line
          x1="0"
          y1="0"
          x2="0"
          y2="7"
          stroke="var(--gw-yellow)"
          strokeWidth="2"
          opacity="0.55"
        />
      </pattern>
    </defs>
  );
}

// The doodle of a category: O for Players, X for Positions, OO for Teams, three lines for Size, bars for Grades, an arrow for Gains.
export function ChalkIcon({
  kind,
  x,
  y,
}: {
  kind: IconKind;
  x: number;
  y: number;
}) {
  return (
    <g
      className="gd-chalk-icon"
      transform={`translate(${x} ${y})`}
      fill="none"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {kind === "o" && <circle r="9" />}
      {kind === "x" && <path d="M-9 -9 L9 9 M9 -9 L-9 9" />}
      {kind === "oo" && (
        <>
          <circle cx="-10" r="7" />
          <circle cx="10" r="7" />
        </>
      )}
      {kind === "lines" && <path d="M-10 -8 h20 M-10 0 h20 M-10 8 h20" />}
      {kind === "bars" && <path d="M-10 10 v-12 M0 10 v-20 M10 10 v-8" />}
      {kind === "arrow" && <path d="M-10 8 L10 -8 M0 -8 h10 v10" />}
      {kind === "link" && (
        <>
          <ellipse cx="-6" rx="9" ry="6" />
          <ellipse cx="6" rx="9" ry="6" />
        </>
      )}
    </g>
  );
}

// A tick or an X scribbled to show an option is on. `on` draws it; the stroke is drawn in with pathLength 1.
export function ChalkTick({
  x,
  y,
  on,
  size = 8,
}: {
  x: number;
  y: number;
  on: boolean;
  size?: number;
}) {
  return (
    <path
      className="gd-chalk-tick"
      data-on={on}
      d={`M${x - size} ${y} L${x - size / 3} ${y + size * 0.8} L${x + size} ${y - size * 0.8}`}
      pathLength={1}
      fill="none"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    />
  );
}
