import type { Model, Player } from "../valuation";

// The six Gameday Plus sections. Until each new screen exists, a section shows the current screen listed in `page`.
export const sections = [
  { id: "week", label: "This week", page: "overview" },
  { id: "roster", label: "Roster", page: "overview" },
  { id: "scouting", label: "Scouting", page: "players" },
  { id: "league", label: "League", page: "teams" },
  { id: "trade", label: "Trade room", page: "trades" },
  { id: "lab", label: "Lab", page: "model" },
] as const;
export type SectionId = (typeof sections)[number]["id"];

// Existing hash routes keep working: each old route belongs to one section.
const sectionByRoute: Record<string, SectionId> = {
  overview: "week",
  week: "week",
  roster: "roster",
  players: "scouting",
  player: "scouting",
  gems: "scouting",
  weekly: "scouting",
  scouting: "scouting",
  teams: "league",
  league: "league",
  trades: "trade",
  trade: "trade",
  journal: "trade",
  model: "lab",
  data: "lab",
  lab: "lab",
};

// Resolve which tab is active for a hash route such as "player/12" or "gems".
export const sectionForRoute = (route: string): SectionId | null =>
  sectionByRoute[route.split("/")[0]] ?? null;

// Resolve a new section route to the screen that renders it today; other routes pass through unchanged.
export const pageForRoute = (route: string): string => {
  const head = route.split("/")[0];
  return sections.find((s) => s.id === head)?.page ?? head;
};

export interface PlayerHit {
  id: string;
  name: string;
  pos: string;
  nfl: string;
  // Expected PPG stays null when the model cannot compute it; it is never shown as zero.
  eppg: number | null;
}

// Rank names that start a word first, then other substrings, then alphabetically; empty queries match nothing.
export function searchPlayers(m: Model, query: string, limit = 8): PlayerHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { p: Player; rank: number }[] = [];
  for (const p of m.players) {
    const name = p.name.toLowerCase();
    const at = name.indexOf(q);
    if (at < 0) continue;
    const wordStart = at === 0 || name[at - 1] === " ";
    scored.push({ p, rank: name.startsWith(q) ? 0 : wordStart ? 1 : 2 });
  }
  scored.sort(
    (a, b) =>
      a.rank - b.rank || a.p.name.localeCompare(b.p.name) || +a.p.id - +b.p.id,
  );
  return scored.slice(0, limit).map(({ p }) => ({
    id: p.id,
    name: p.name,
    pos: p.pos,
    nfl: p.nfl,
    eppg: p.expected,
  }));
}

// Describe how old the source data is; over 24 hours or a missing/invalid time is stale, as the app already treats it.
export function sourceFreshness(
  sourceUTC: string | null | undefined,
  now: number,
): { label: string; stale: boolean } {
  const at = sourceUTC ? Date.parse(sourceUTC) : NaN;
  if (!Number.isFinite(at))
    return { label: "Source time unavailable", stale: true };
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  const label =
    minutes < 60
      ? `Source ${minutes}m ago`
      : minutes < 1440
        ? `Source ${Math.floor(minutes / 60)}h ago`
        : `Source ${Math.floor(minutes / 1440)}d ago`;
  return { label, stale: now - at > 86400000 };
}
