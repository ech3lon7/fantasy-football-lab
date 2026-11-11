import { n, num } from "../contracts";
import { irAssignments, lineup, roster, type PositionGrade } from "../lineups";
import { playedHistory } from "../opportunity";
import { playerSignals, type Model, type Player } from "../valuation";

// Grade letters map onto the six-step colour scale; "n.a." and unknown values have no tone, never the lowest one.
export function gradeTone(grade: string): 1 | 2 | 3 | 4 | 5 | 6 | null {
  if (grade === "F") return 1;
  if (/^D/.test(grade)) return 2;
  if (/^C/.test(grade)) return 3;
  if (/^B/.test(grade)) return 4;
  if (grade === "A+") return 6;
  if (/^A/.test(grade)) return 5;
  return null;
}

export type Role = "Starter" | "Bench" | "IR";

export interface StripPoint {
  week: number;
  // Null when the game's points are not recorded; a missing score is a gap, not zero.
  points: number | null;
}

export interface DepthTile {
  id: string;
  name: string;
  pos: string;
  nfl: string;
  role: Role;
  // The lineup slot a starter fills, such as FLEX; null for bench and IR players.
  slot: string | null;
  eppg: string | null;
  injury: string;
  labels: string[];
  // Up to nine most recent played games, oldest first.
  strip: StripPoint[];
}

export interface DepthGroup {
  position: string;
  grade: string;
  tone: ReturnType<typeof gradeTone>;
  tiles: DepthTile[];
  // The highest recorded score in the group's strips, so every strip in a group shares one scale.
  scaleMax: number;
}

const order = ["QB", "RB", "WR", "TE", "K", "D/ST"];

// The depth chart for one team: starters first in each position, then bench and IR, using the active roster.
export function depthChart(
  m: Model,
  team: string,
  grades: PositionGrade[],
): DepthGroup[] {
  const ids = roster(m, team),
    // Mirror the current-week modeled lineup so starters here are the starters everywhere else.
    week = lineup(
      m,
      ids,
      m.current,
      false,
      false,
      m.ignoreTemporaryAbsences ? "expected" : "value",
    ),
    slotOf = new Map<string, string>();
  week.ids.forEach((id, i) => {
    if (id) slotOf.set(id, week.slots[i]);
  });
  const ir = new Set(irAssignments(m, ids)),
    history = playedHistory(m.dataset);
  const tile = (p: Player): DepthTile => {
    const slot = slotOf.get(p.id) ?? null;
    return {
      id: p.id,
      name: p.name,
      pos: p.pos,
      nfl: p.nfl,
      role: slot ? "Starter" : ir.has(p.id) ? "IR" : "Bench",
      slot,
      eppg: p.blendedExpected === null ? null : p.blendedExpected.toFixed(1),
      injury: p.injury,
      labels: playerSignals(p).filter((x) => x && !/^(none|no )/i.test(x)),
      strip: (history.get(p.id) ?? [])
        .slice(-9)
        .map((r) => ({ week: num(r.Week), points: n(r.Points) })),
    };
  };
  const rank: Record<Role, number> = { Starter: 0, Bench: 1, IR: 2 };
  return order
    .map((position) => {
      const tiles = ids
        .map((id) => m.byId.get(id))
        .filter((p): p is Player => !!p && p.pos === position)
        .map(tile)
        .sort(
          (a, b) =>
            rank[a.role] - rank[b.role] ||
            Number(b.eppg ?? -1) - Number(a.eppg ?? -1) ||
            +a.id - +b.id,
        );
      const grade =
        grades.find((g) => g.position === position)?.grade ?? "n.a.";
      const scores = tiles.flatMap((t) =>
        t.strip.flatMap((s) => (s.points === null ? [] : [s.points])),
      );
      return {
        position,
        grade,
        tone: gradeTone(grade),
        tiles,
        scaleMax: Math.max(1, ...scores),
      };
    })
    .filter((g) => g.tiles.length > 0);
}

export const leagueColumns = ["QB", "RB", "WR", "TE", "FLEX", "K", "D/ST"];

export interface LeagueCell {
  position: string;
  grade: string;
  tone: ReturnType<typeof gradeTone>;
  // Why the grade is unavailable; empty when there is one.
  reason: string;
}

export interface LeagueRow {
  teamId: string;
  name: string;
  cells: LeagueCell[];
}

// Every team by position with its grade on the shared scale; unavailable grades carry the reason.
export function leagueGrid(
  m: Model,
  grades: Map<string, PositionGrade[]>,
): LeagueRow[] {
  return m.dataset.tables.ModelTeams.map((t) => {
    const teamId = String(t.TeamID),
      rows = grades.get(teamId) ?? [];
    return {
      teamId,
      name: String(t.TeamName),
      cells: leagueColumns.map((position) => {
        const row = rows.find((g) => g.position === position),
          grade = row?.grade ?? "n.a.";
        return {
          position,
          grade,
          tone: gradeTone(grade),
          reason:
            grade === "n.a."
              ? row
                ? row.status === "Available"
                  ? "Not enough usable player values or league data to grade."
                  : row.status
                : "No starter slot at this position."
              : "",
        };
      }),
    };
  });
}

// The players behind one grade cell; FLEX lists the starters filling it, since any RB, WR or TE can.
export function positionPlayers(
  m: Model,
  team: string,
  grades: PositionGrade[],
  position: string,
): { grade: string; tiles: DepthTile[] } {
  const chart = depthChart(m, team, grades);
  const grade = grades.find((g) => g.position === position)?.grade ?? "n.a.";
  if (position === "FLEX")
    return {
      grade,
      tiles: chart.flatMap((g) => g.tiles).filter((t) => t.slot === "FLEX"),
    };
  return {
    grade,
    tiles: chart.find((g) => g.position === position)?.tiles ?? [],
  };
}
