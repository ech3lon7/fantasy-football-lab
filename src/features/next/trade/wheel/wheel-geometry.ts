// Pure geometry of the filter wheel, in the Chalk Playbook board's 640 x 640 view box. Angles are degrees, 0 pointing right and
// increasing clockwise on screen, so -90 is the top. Nothing here touches the DOM.

export const VIEW = 640;
export const CENTER = 320;
// Ring radii from the board: the broken outer circle, the dashed inner circle, the selected wedge and the slider track.
export const RING = {
  inner: 82,
  outer: 172,
  wedgeInner: 86,
  wedgeOuter: 184,
  slider: 214,
} as const;
export const SLIDER_FROM = -150;
export const SLIDER_TO = -30;
export const PAGE_SIZE = 8;

// Coordinates are written to one decimal with no trailing zero, as on the board.
const n = (x: number) => String(Math.round(x * 10) / 10);

export const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export function polar(
  radius: number,
  degrees: number,
  cx = CENTER,
  cy = CENTER,
) {
  return {
    x: cx + radius * Math.cos(toRadians(degrees)),
    y: cy + radius * Math.sin(toRadians(degrees)),
  };
}

// Segment widths follow the board: the top (and, with an even count, the bottom) segment is 56 degrees wide and the rest share
// what is left, which gives 62 degrees to each side segment of six. The first segment is centred at the top; the rest go clockwise.
const NARROW = 56;
export function segmentEdges(count: number) {
  const narrow = count % 2 === 0 ? [0, count / 2] : [0];
  const wide = (360 - NARROW * narrow.length) / (count - narrow.length);
  const edges = [-90 - NARROW / 2];
  for (let i = 0; i < count; i++)
    edges.push(edges[i] + (narrow.includes(i) ? NARROW : wide));
  return edges;
}

export function segmentBounds(index: number, count: number) {
  const edges = segmentEdges(count);
  return { from: edges[index], to: edges[index + 1] };
}

export function segmentCenter(index: number, count: number) {
  const { from, to } = segmentBounds(index, count);
  return (from + to) / 2;
}

// A wedge between two radii and two angles, as the selected segment on the board.
export function wedgePath(
  inner: number,
  outer: number,
  from: number,
  to: number,
) {
  const a = polar(outer, from);
  const b = polar(outer, to);
  const c = polar(inner, to);
  const d = polar(inner, from);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M${n(a.x)} ${n(a.y)} A${outer} ${outer} 0 ${large} 1 ${n(b.x)} ${n(b.y)} L${n(c.x)} ${n(c.y)} A${inner} ${inner} 0 ${large} 0 ${n(d.x)} ${n(d.y)} Z`;
}

// An open arc, clockwise.
export function arcPath(radius: number, from: number, to: number) {
  const a = polar(radius, from);
  const b = polar(radius, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M${n(a.x)} ${n(a.y)} A${radius} ${radius} 0 ${large} 1 ${n(b.x)} ${n(b.y)}`;
}

// The spoke on the leading edge of a segment, from the outer circle in to the inner one.
export function spoke(index: number, count: number) {
  const angle = segmentBounds(index, count).from;
  const outer = polar(RING.outer, angle);
  const inner = polar(RING.inner, angle);
  return { x1: outer.x, y1: outer.y, x2: inner.x, y2: inner.y };
}

export function labelPoint(
  index: number,
  count: number,
  radius = (RING.inner + RING.outer) / 2,
) {
  return polar(radius, segmentCenter(index, count));
}

// Values run -2 to +1 (or any range) along the slider track.
export function valueToAngle(
  value: number,
  min: number,
  max: number,
  from = SLIDER_FROM,
  to = SLIDER_TO,
) {
  return from + ((value - min) / (max - min)) * (to - from);
}

export function snapValue(
  value: number,
  min: number,
  max: number,
  step: number,
) {
  // A value that is not a number falls back to the top of the range, which is the default for Their EPPG gain.
  if (!Number.isFinite(value)) return max;
  const snapped = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, Math.round(snapped * 1e6) / 1e6));
}

export function angleToValue(
  angle: number,
  min: number,
  max: number,
  step: number,
  from = SLIDER_FROM,
  to = SLIDER_TO,
) {
  const clamped = Math.min(to, Math.max(from, angle));
  return snapValue(
    min + ((clamped - from) / (to - from)) * (max - min),
    min,
    max,
    step,
  );
}

// The angle of a pointer around the wheel centre, in the same convention.
export function pointerAngle(x: number, y: number, cx = CENTER, cy = CENTER) {
  return (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
}

// A small chevron at the end of the route, pointing along the track.
export function arrowHead(radius: number, angle: number, size: number) {
  const tip = polar(radius, angle + 1.5);
  const tangent = angle + 90;
  const back = (offset: number) => ({
    x: tip.x - size * Math.cos(toRadians(tangent + offset)),
    y: tip.y - size * Math.sin(toRadians(tangent + offset)),
  });
  const left = back(-40);
  const right = back(40);
  return `M${n(left.x)} ${n(left.y)} L${n(tip.x)} ${n(tip.y)} L${n(right.x)} ${n(right.y)}`;
}

// Long lists show eight at a time and rotate to the rest.
export function pageSlice<T>(items: T[], page: number, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const at = Math.min(pages - 1, Math.max(0, page));
  return { items: items.slice(at * size, at * size + size), page: at, pages };
}
