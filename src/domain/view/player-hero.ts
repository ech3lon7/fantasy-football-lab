import { TIER_MIN_GAMES, type PlayerTier } from "../player-tier";

// Display-only pieces of the player card header. Nothing here changes a valuation, grade, lineup or trade result.

// Recent 3 within this many points of Expected PPG reads as Steady.
export const FORM_BAND = 1;

export type FormKind = "hot" | "cold" | "steady" | "unknown";

export interface FormBar {
  kind: FormKind;
  // The word is always shown; colour never carries the meaning alone.
  label: string;
  // null when the bar cannot be drawn: a missing number is never treated as zero.
  widthPct: number | null;
  tip: string;
}

const one = (x: number | null) => (x === null ? "—" : x.toFixed(1));

// Recent 3 against Expected PPG: width = 50% + (Recent 3 - EPPG) / EPPG x 120%, clamped to 6-100%.
export function formBar(recent: number | null, eppg: number | null): FormBar {
  const tip = `Recent 3 ${one(recent)} vs Expected PPG ${one(eppg)}`;
  if (recent === null || eppg === null || !(eppg > 0))
    return { kind: "unknown", label: "No recent games", widthPct: null, tip };
  const diff = recent - eppg;
  const widthPct = Math.min(100, Math.max(6, 50 + (diff / eppg) * 120));
  const kind: FormKind =
    diff > FORM_BAND ? "hot" : diff < -FORM_BAND ? "cold" : "steady";
  return {
    kind,
    label: kind === "hot" ? "Hot" : kind === "cold" ? "Cold" : "Steady",
    widthPct,
    tip,
  };
}

// First name above, last name large; a defense shows its team name then D/ST. Suffixes stay with the last name.
export function splitName(
  name: string,
  pos: string,
): { first: string; last: string } {
  const text = name.trim();
  if (pos === "D/ST") return { first: text, last: "D/ST" };
  const parts = text.split(/\s+/);
  if (parts.length < 2) return { first: "", last: text };
  const lower = parts.map((p) => p.toLowerCase());
  // "St. Brown", "Van Dyke" and "De La Cruz" style particles belong to the last name.
  const particle = (i: number) =>
    ["st.", "van", "von", "de", "la", "del", "di", "mc"].includes(lower[i]);
  let start = parts.length - 1;
  if (/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(parts[start]) && start > 1)
    start -= 1;
  while (start > 1 && particle(start - 1)) start -= 1;
  return {
    first: parts.slice(0, start).join(" "),
    last: parts.slice(start).join(" "),
  };
}

const positionNames: Record<string, string> = {
  QB: "Quarterback",
  RB: "Running back",
  WR: "Wide receiver",
  TE: "Tight end",
  K: "Kicker",
  "D/ST": "Defense / special teams",
};
export const positionName = (pos: string): string => positionNames[pos] ?? pos;

export interface TierBadge {
  tier: Exclude<PlayerTier, null>;
  text: string;
  aria: string;
  tip: string;
}

const badgeText = {
  superstar: "★ Superstar",
  star: "Star",
  good: "Good",
} as const;
const badgeName = {
  superstar: "Superstar",
  star: "Star",
  good: "Good",
} as const;

// The badge is a button that replays the entrance; it names the tier and states the rank behind it.
export function tierBadge(
  tier: PlayerTier,
  rank: number | null,
): TierBadge | null {
  if (!tier) return null;
  return {
    tier,
    text: badgeText[tier],
    aria: `${badgeName[tier]}, replay the card entrance`,
    tip: `${rank === null ? "" : `#${rank} `}in fantasy points per game across every position (minimum ${TIER_MIN_GAMES} games). Click to replay.`,
  };
}

// The darkening at the lightest point of the hero gradient: the smallest amount (at least 8%) that gives white text 4.5:1.
// Black laid over the colour at this opacity scales each sRGB channel by (1 - shade); then the usual relative luminance.
const linear = (v: number) =>
  v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const luminance = (hex: string, shade: number) => {
  const c = (i: number) =>
    linear((parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255) * (1 - shade));
  return 0.2126 * c(0) + 0.7152 * c(1) + 0.0722 * c(2);
};

// Contrast of white text against the team colour after the given black overlay.
export const whiteContrast = (hex: string, shade: number): number =>
  1.05 / (luminance(hex, shade) + 0.05);

export function heroShade(hex: string): number {
  const base = 0.08;
  if (whiteContrast(hex, base) >= 4.5) return base;
  let low = base;
  let high = 0.75;
  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2;
    if (whiteContrast(hex, mid) >= 4.5) high = mid;
    else low = mid;
  }
  // Rounded up to a thousandth, so the value written to the stylesheet never falls below the threshold.
  return Math.min(0.75, Math.ceil(high * 1000) / 1000);
}

const screens: Record<string, string> = {
  overview: "This week",
  week: "This week",
  roster: "Roster",
  players: "Scouting",
  gems: "Scouting",
  scouting: "Scouting",
  teams: "League",
  league: "League",
  trade: "Trade room",
  lab: "Lab",
};

// "Gameday / Scouting / Player card": the middle part is the screen the card was opened from, when that is known.
export function breadcrumb(hash: string): string {
  const screen = screens[hash.replace(/^#\/?/, "").split("/")[0]];
  return screen ? `Gameday / ${screen} / Player card` : "Gameday / Player card";
}
