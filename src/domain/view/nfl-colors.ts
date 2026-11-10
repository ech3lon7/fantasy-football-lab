// Static NFL team colours for player surfaces; they are identical in light and dark themes by design.
const primary: Record<string, string> = {
  ARI: "#97233f",
  ATL: "#a71930",
  BAL: "#241773",
  BUF: "#00338d",
  CAR: "#0085ca",
  CHI: "#0b162a",
  CIN: "#fb4f14",
  CLE: "#311d00",
  DAL: "#003594",
  DEN: "#fb4f14",
  DET: "#0076b6",
  GB: "#203731",
  HOU: "#03202f",
  IND: "#002c5f",
  JAX: "#006778",
  KC: "#e31837",
  LV: "#202020",
  LAC: "#0080c6",
  LAR: "#003594",
  MIA: "#008e97",
  MIN: "#4f2683",
  NE: "#002244",
  NO: "#d3bc8d",
  NYG: "#0b2265",
  NYJ: "#125740",
  PHI: "#004c54",
  PIT: "#ffb612",
  SF: "#aa0000",
  SEA: "#002244",
  TB: "#d50a0a",
  TEN: "#4b92db",
  WSH: "#5a1414",
};
// Accept both common Washington and Las Vegas abbreviations.
const alias: Record<string, string> = { WAS: "WSH", LVR: "LV", JAC: "JAX" };

// Neutral grey used for free agents, unknown teams and synthetic data.
const neutral = "#4a5060";

// Choose white or dark text, whichever has the higher contrast against the colour.
export function readableInk(hex: string): string {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  // Contrast of white is 1.05/(L+0.05); of near-black (L≈0.008) is (L+0.05)/0.058.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.058
    ? "#ffffff"
    : "#14171f";
}

// Return the card colours for an NFL team abbreviation, with readable text.
export function teamColors(nfl: string): { background: string; ink: string } {
  const key = alias[nfl.toUpperCase()] ?? nfl.toUpperCase();
  const background = primary[key] ?? neutral;
  return { background, ink: readableInk(background) };
}
