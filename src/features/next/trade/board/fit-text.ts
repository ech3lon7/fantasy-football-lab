// The hub's value text starts at 48px and shrinks to as small as 28px so that it fits inside the inner circle and never touches a
// segment label. Pure: the caller measures the text at 48px and passes the width of the space it may use.
export const HUB_FONT_MAX = 48;
export const HUB_FONT_MIN = 28;

export function fitFontSize(widthAtMax: number, boxWidth: number): number {
  if (!(widthAtMax > 0) || !(boxWidth > 0)) return HUB_FONT_MAX;
  const size = Math.floor((HUB_FONT_MAX * boxWidth) / widthAtMax);
  return Math.max(HUB_FONT_MIN, Math.min(HUB_FONT_MAX, size));
}
