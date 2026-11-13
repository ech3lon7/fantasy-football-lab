import {
  defaultGemDraft,
  encodeGemFilters,
  gemSignals,
  risingGemDraft,
  screenGems,
  validateGemDraft,
  type GemDraft,
  type GemQuery,
  type GemResult,
} from "../gem-screening";
import { nextRefreshDefaults } from "../next-refresh";
import { playerSignals, type Model, type Player } from "../valuation";
import { teamColors } from "./nfl-colors";
import { playedHistory } from "../opportunity";
import { n, num } from "../contracts";

export const poolOptions = ["Available", "All", "Selected team"] as const;
export const positionOptions = [
  "RB / WR / TE",
  "All",
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "D/ST",
  "K / D/ST",
] as const;

export interface ScoutingPreset {
  id: string;
  label: string;
  draft: (team: string) => GemDraft;
}

// The built-in saved searches; each is only a starting draft and never changes the screening rules.
export const scoutingPresets: ScoutingPreset[] = [
  {
    id: "all",
    label: "All players",
    draft: (team) => ({
      ...defaultGemDraft(team),
      pool: "All",
      position: "All",
    }),
  },
  { id: "gem", label: "Gem screener", draft: defaultGemDraft },
  { id: "rising", label: "Rising targets", draft: risingGemDraft },
  {
    id: "buysell",
    label: "Buy low · sell high",
    draft: (team) => ({
      ...defaultGemDraft(team),
      pool: "All",
      regression: "either",
    }),
  },
  {
    id: "streamers",
    label: "Weekly streamers",
    draft: (team) => ({ ...defaultGemDraft(team), position: "K / D/ST" }),
  },
];

// Compare two queries by what they filter on, ignoring the unused team when the pool is not "Selected team".
const fingerprint = (q: GemQuery) => {
  const patch = encodeGemFilters(q);
  if (q.pool !== "Selected team") patch.gemTeam = "";
  return JSON.stringify(Object.entries(patch).sort());
};

// Return the built-in saved search the query matches exactly, or null when it has been edited.
export function activePresetId(
  query: GemQuery,
  team: string,
  teamIds: string[],
): string | null {
  for (const preset of scoutingPresets) {
    const valid = validateGemDraft(preset.draft(team), teamIds).query;
    if (valid && fingerprint(valid) === fingerprint(query)) return preset.id;
  }
  return null;
}

export interface Facets {
  // Matches for the current query.
  total: number;
  // Players that would match your other filters but are hidden by pool, signals or classification.
  hidden: number;
  pool: Record<string, number>;
  position: Record<string, number>;
  signals: Record<string, number>;
  // Count if the flag were switched on (or off, if it is on now).
  flags: { goldenCross: number; deathCross: number; injured: number };
}

const count = (players: Player[], q: GemQuery) =>
  screenGems(players, q).matches.length;

// For every option of every facet, the number of matches if that option were toggled; no Apply step is needed.
export function facetCounts(players: Player[], q: GemQuery): Facets {
  const total = count(players, q);
  const withSignals = (signal: string) => ({
    ...q,
    signals: q.signals.includes(signal)
      ? q.signals.filter((s) => s !== signal)
      : [...q.signals, signal],
  });
  return {
    total,
    hidden:
      count(players, {
        ...q,
        pool: "All",
        signals: [],
        classification: "All classifications",
      }) - total,
    pool: Object.fromEntries(
      poolOptions.map((pool) => [pool, count(players, { ...q, pool })]),
    ),
    position: Object.fromEntries(
      positionOptions.map((position) => [
        position,
        count(players, { ...q, position }),
      ]),
    ),
    signals: Object.fromEntries(
      gemSignals.map((s) => [s, count(players, withSignals(s))]),
    ),
    flags: {
      goldenCross: count(players, { ...q, goldenCross: !q.goldenCross }),
      deathCross: count(players, { ...q, deathCross: !q.deathCross }),
      injured: count(players, { ...q, injured: !q.injured }),
    },
  };
}

// Sort results by Expected PPG by default; unavailable values sort last, ties break by player id.
export function sortScouting(
  rows: GemResult[],
  key: string,
  desc: boolean,
): GemResult[] {
  const read = (r: GemResult): number | string | null => {
    const p = r.player;
    switch (key) {
      case "mppg":
        return p.mppg ?? null;
      case "name":
        return p.name;
      case "recent":
        return p.recent;
      case "index":
        return p.index;
      case "trend":
        return p.trendDelta;
      case "value":
        return p.value;
      default:
        return p.blendedExpected;
    }
  };
  return [...rows].sort((a, b) => {
    const x = read(a),
      y = read(b);
    if (x === null) return y === null ? +a.player.id - +b.player.id : 1;
    if (y === null) return -1;
    const diff =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y));
    return (desc ? -diff : diff) || +a.player.id - +b.player.id;
  });
}

export interface SavedSearch {
  id: string;
  name: string;
  // The encoded gem filters, so a saved search loads through the same decoder as the current filters.
  filters: Record<string, string>;
}

// Keep user-saved searches in the existing string-valued filter record.
export const savedSearchesKey = "scoutingSavedSearches";
const maxSaved = 20;

// Parse saved searches and drop anything malformed so one bad entry never hides the rest.
export function readSavedSearches(raw?: string): SavedSearch[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is SavedSearch =>
        !!x &&
        typeof x.id === "string" &&
        typeof x.name === "string" &&
        !!x.filters &&
        typeof x.filters === "object" &&
        Object.values(x.filters).every((v) => typeof v === "string"),
    );
  } catch {
    return [];
  }
}

// Save under a name; the same name replaces the earlier search, and the list is capped.
export function addSavedSearch(
  raw: string | undefined,
  name: string,
  filters: Record<string, string>,
): string {
  const clean = name.trim().slice(0, 40);
  if (!clean) return raw ?? "";
  const rest = readSavedSearches(raw).filter(
    (s) => s.name.toLowerCase() !== clean.toLowerCase(),
  );
  const next = [
    ...rest,
    { id: `s${Date.now().toString(36)}`, name: clean, filters },
  ].slice(-maxSaved);
  return JSON.stringify(next);
}

export function removeSavedSearch(raw: string | undefined, id: string): string {
  return JSON.stringify(readSavedSearches(raw).filter((s) => s.id !== id));
}

// A patch that restores a saved or built-in search exactly, clearing the optional criteria first.
export function filtersPatch(q: GemQuery): Record<string, string> {
  return { gemSignalMode: "", gemRegression: "", ...encodeGemFilters(q) };
}

export interface ScoutCard {
  id: string;
  name: string;
  pos: string;
  nfl: string;
  colors: { background: string; ink: string };
  eppg: string | null;
  recent: string | null;
  surplus: string | null;
  surplusNumber: number;
  labels: string[];
  sparkline: string;
  // Floor, expected and ceiling stay null when the next-game range is unavailable, never zero.
  range: {
    floor: number | null;
    expected: number | null;
    ceiling: number | null;
  };
  // Short reasons shown with incomplete evidence; empty for confirmed matches.
  missing: string[];
}

export function buildSparkline(scores: (number | null)[], width = 100, height = 30): string {
  const valid = scores.filter((v): v is number => v !== null && Number.isFinite(v));
  if (valid.length < 2) return "";
  let hi = Math.max(...valid);
  const lo = Math.min(...valid);
  if (hi === lo) hi = lo + 1;
  const n = scores.length;
  let d = "";
  let pen = false;
  scores.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      pen = false;
      return;
    }
    const x = 2 + (i * (width - 4)) / Math.max(1, n - 1);
    const y = height - 3 - ((v - lo) / (hi - lo)) * (height - 6);
    d += (pen ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1) + " ";
    pen = true;
  });
  return d.trim();
}

const one = (x: number | null, digits = 1) =>
  x === null || !Number.isFinite(x) ? null : x.toFixed(digits);

// Everything a scouting card shows, with one shared scale so floor-to-ceiling bars are comparable.
export function scoutCards(
  m: Model,
  rows: GemResult[],
): { cards: ScoutCard[]; scale: { min: number; max: number } } {
  const historyMap = playedHistory(m.dataset);
  const cards = rows.map(({ player: p, missing }) => {
    const defaults = nextRefreshDefaults(m, p);
    const playerRows = historyMap.get(p.id) ?? [];
    // Up to last 9 completed weeks for the sparkline
    const weeklyScores: (number | null)[] = [];
    const maxWeek = Math.max(0, ...playerRows.map((r) => num(r.Week)));
    const startWeek = Math.max(1, maxWeek - 8);
    for (let w = startWeek; w <= maxWeek; w++) {
      const match = playerRows.find((r) => num(r.Week) === w);
      weeklyScores.push(match ? n(match.Points) : null);
    }

    return {
      id: p.id,
      name: p.name,
      pos: p.pos,
      nfl: p.nfl,
      colors: teamColors(p.nfl),
      eppg: one(p.blendedExpected),
      recent: one(p.recent),
      surplus: one(p.index, 0),
      surplusNumber: Math.max(0, Math.min(100, p.index ?? 0)),
      labels: playerSignals(p).filter((x) => x && !/^(none|no )/i.test(x)),
      sparkline: buildSparkline(weeklyScores),
      range: {
        floor: defaults.lower,
        expected: p.blendedExpected,
        ceiling: defaults.higher,
      },
      missing,
    };
  });
  const ceilings = cards
    .map((c) => c.range.ceiling)
    .filter((v): v is number => v !== null);
  return {
    cards,
    scale: {
      min: 0,
      max: ceilings.length ? Math.ceil(Math.max(...ceilings)) : 1,
    },
  };
}
