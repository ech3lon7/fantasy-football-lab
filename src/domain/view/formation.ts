import { cmpId } from "../contracts";
import type { PositionGrade } from "../lineups";
import { irAssignments, roster } from "../lineups";
import { calculateMppg, type MppgResult } from "../mppg";
import { playerMatchups } from "../matchups";
import type { FormationSlot, SlotKind } from "../lineup-optimizer";
import { readStarterLineup, starterTemplate } from "../starter-lineups";
import type { Model, Player } from "../valuation";
import { combineSpreads } from "./odds";
import { gradeTone as gradeToneOf } from "./roster";

// This week's matchup colour, never the only signal: every card also carries the tone word.
export type FormationTone = "good" | "neutral" | "bad" | "out";

export interface BackupView {
  playerId: string | null;
  shortName: string;
  // Last name only, used by the phone layout (E10.5).
  lastName: string;
  fullName: string;
  pos: string;
  mppgText: string;
  buildLine: string;
  tone: FormationTone;
  empty: boolean;
}

export interface SlotCardView {
  // RB1, WR2, FLEX and so on, in the order the cards are read.
  label: string;
  // The template index this card fills, used to match Optimize changes to cards.
  index: number;
  // The underlying position the slot accepts.
  slot: SlotKind;
  row: 1 | 2;
  column: number;
  playerId: string | null;
  shortName: string;
  fullName: string;
  pos: string;
  nfl: string;
  mppgText: string;
  buildLine: string;
  tone: FormationTone;
  matchupLine: string;
  accessibleName: string;
  // The player's real position in the FLEX slot, for the yellow chip; null elsewhere.
  flexPos: string | null;
  grade: string;
  gradeTone: 1 | 2 | 3 | 4 | 5 | 6 | null;
  backups: [BackupView, BackupView];
}

export interface FormationView {
  source: string;
  cards: SlotCardView[];
  total: number;
  spread: number;
  hasPlayers: boolean;
}

const round = (value: number) => Math.round(value * 10) / 10;

const toneWords: Record<FormationTone, string> = {
  good: "good matchup",
  neutral: "neutral",
  bad: "bad matchup",
  out: "out",
};

// The visible grid order: row 1 (WR1, QB, TE, WR2), then row 2 (RB1, RB2, FLEX, K, D/ST).
const layout: {
  slot: SlotKind;
  occurrence: number;
  row: 1 | 2;
  column: number;
}[] = [
  { slot: "WR", occurrence: 0, row: 1, column: 1 },
  { slot: "QB", occurrence: 0, row: 1, column: 4 },
  { slot: "TE", occurrence: 0, row: 1, column: 5 },
  { slot: "WR", occurrence: 1, row: 1, column: 7 },
  { slot: "RB", occurrence: 0, row: 2, column: 3 },
  { slot: "RB", occurrence: 1, row: 2, column: 4 },
  { slot: "FLEX", occurrence: 0, row: 2, column: 5 },
  { slot: "K", occurrence: 0, row: 2, column: 6 },
  { slot: "D/ST", occurrence: 0, row: 2, column: 7 },
];

// The lineup the formation opens on, and the bar's source label (decision B1).
export function formationLineup(m: Model, team: string, raw?: string) {
  const selection = readStarterLineup(m, team, raw);
  const template = starterTemplate(m, selection.ids, selection.assignments);
  const lineup: FormationSlot[] = template.slots.map((slot, index) => ({
    slot: slot as SlotKind,
    index,
    playerId: template.ids[index] ?? null,
  }));
  return {
    lineup,
    source:
      selection.source === "Saved app lineup"
        ? "Your saved lineup"
        : "Your ESPN lineup",
    errors: selection.errors,
    warnings: selection.warnings,
  };
}

// Null MPPG is never zero: byes, outs and unavailable projections keep their own wording.
export function mppgBadge(mppg: { value: number | null; reason: string }): string {
  if (mppg.value !== null) return mppg.value.toFixed(1);
  if (mppg.reason === "Bye week") return "BYE";
  if (mppg.reason === "Out") return "OUT";
  return "—";
}

// Condensed capital short names; team defenses keep their full team name.
export function shortName(p: { name: string; pos?: string }): string {
  if (p.pos === "D/ST") return p.name.toUpperCase();
  const parts = p.name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0].toUpperCase();
  return `${parts[0][0]}.${parts.slice(1).join(" ")}`.toUpperCase();
}

// The phone backup rule: the last name only, unless the name is a team defense.
export function backupLastName(p: { name: string; pos?: string }): string {
  if (p.pos === "D/ST") return p.name.toUpperCase();
  const parts = p.name.trim().split(/\s+/).filter(Boolean);
  // Generational suffixes are not surnames; the full name remains accessible on the player link.
  if (parts.length > 1 && /^(?:jr\.?|sr\.?|ii|iii|iv|v)$/i.test(parts[parts.length - 1])) parts.pop();
  return (parts[parts.length - 1] ?? "").toUpperCase();
}

// Good (soft), bad (tough), neutral for missing information, and grey for a bye or confirmed absence.
export function formationTone(
  matchup: { tone: string; bye: boolean; status?: string } | null,
  mppg: { value: number | null; reason: string },
): FormationTone {
  if (matchup?.bye || mppg.reason === "Bye week" || mppg.reason === "Out") return "out";
  if (!matchup || matchup.status === "unavailable" || mppg.value === null) return "neutral";
  if (matchup.tone === "soft") return "good";
  if (matchup.tone === "tough") return "bad";
  return "neutral";
}

// Matchup line for the photo panel; byes carry no "vs" line.
function matchupLine(
  matchup: { opponent: string; bye: boolean } | null,
  tone: FormationTone,
): string {
  if (!matchup) return "";
  if (matchup.bye) return "Bye week";
  return `vs ${matchup.opponent} · ${toneWords[tone]}`;
}

// Slot labels in template order: RB1/RB2 and WR1/WR2, everything else by name.
function labelFor(slot: SlotKind, occurrence: number) {
  return slot === "RB" || slot === "WR"
    ? `${slot}${occurrence + 1}`
    : slot;
}

interface BenchPlayer {
  player: Player;
  mppg: MppgResult;
}

// Ranking keeps real values first and puts bye/out players last, never dropping them.
function compareBench(a: BenchPlayer, b: BenchPlayer) {
  const av = a.mppg.value,
    bv = b.mppg.value;
  if (av === null && bv !== null) return 1;
  if (av !== null && bv === null) return -1;
  if (av !== null && bv !== null && av !== bv) return bv - av;
  const ae = a.player.blendedExpected ?? -Infinity,
    be = b.player.blendedExpected ?? -Infinity;
  if (ae !== be) return be - ae;
  return cmpId(a.player.id, b.player.id);
}

function emptyBackup(): BackupView {
  return {
    playerId: null,
    shortName: "No backup",
    lastName: "",
    fullName: "",
    pos: "",
    mppgText: "",
    buildLine: "",
    tone: "out",
    empty: true,
  };
}

// Draw the nine slot cards, their two backups and the starter totals from the displayed lineup.
export function formationView(
  m: Model,
  team: string,
  grades: PositionGrade[],
  lineup: FormationSlot[],
  source: string,
): FormationView {
  const starters = new Set(
      lineup.map((slot) => slot.playerId).filter((id): id is string => !!id),
    ),
    ir = new Set([
      ...irAssignments(m, roster(m, team)),
      ...roster(m, team).filter((id) => m.byId.get(id)?.slot === 21),
    ]),
    bench: BenchPlayer[] = [];
  for (const id of roster(m, team)) {
    if (starters.has(id) || ir.has(id)) continue;
    const player = m.byId.get(id);
    if (player) bench.push({ player, mppg: calculateMppg(m, player) });
  }

  // One read per player, reused for cards, backups and totals.
  const mppgById = new Map<string, MppgResult>();
  for (const id of starters) {
    const player = m.byId.get(id);
    if (player) mppgById.set(id, calculateMppg(m, player));
  }

  const cards: SlotCardView[] = [];
  const occurrences: Partial<Record<SlotKind, number>> = {};
  const byOccurrence = new Map<string, FormationSlot>();
  for (const entry of [...lineup].sort((a, b) => a.index - b.index)) {
    const occurrence = occurrences[entry.slot] ?? 0;
    occurrences[entry.slot] = occurrence + 1;
    byOccurrence.set(`${entry.slot}/${occurrence}`, entry);
  }

  for (const place of layout) {
    const entry = byOccurrence.get(`${place.slot}/${place.occurrence}`);
    if (!entry) continue;
    const label = labelFor(place.slot, place.occurrence);
    const player = entry.playerId ? (m.byId.get(entry.playerId) ?? null) : null;
    const mppg = player
      ? (mppgById.get(player.id) ?? calculateMppg(m, player))
      : null;
    const matchup = player ? (playerMatchups(m, player)[0] ?? null) : null;
    // An unfilled slot is grey even though missing player information is otherwise neutral.
    const tone = player ? formationTone(matchup, mppg!) : "out";
    const provider = mppg ?? { value: null, reason: "", buildLine: "" };
    const line = matchupLine(matchup, tone);
    const mppgText = mppgBadge(provider);
    const grade =
      grades.find((g) => g.position === place.slot)?.grade ?? "n.a.";

    const eligible = bench
      .filter((candidate) =>
        place.slot === "FLEX"
          ? ["RB", "WR", "TE"].includes(candidate.player.pos)
          : candidate.player.pos === place.slot,
      )
      .sort(compareBench)
      .slice(0, 2);
    const backups = [0, 1].map((index): BackupView => {
      const candidate = eligible[index];
      if (!candidate) return emptyBackup();
      const candidateMatchup = playerMatchups(m, candidate.player)[0] ?? null;
      const candidateTone = formationTone(candidateMatchup, candidate.mppg);
      return {
        playerId: candidate.player.id,
        shortName: shortName(candidate.player),
        lastName: backupLastName(candidate.player),
        fullName: candidate.player.name,
        pos: candidate.player.pos,
        mppgText: mppgBadge(candidate.mppg),
        buildLine: candidate.mppg.buildLine,
        tone: candidateTone,
        empty: false,
      };
    }) as [BackupView, BackupView];

    cards.push({
      label,
      index: entry.index,
      slot: place.slot,
      row: place.row,
      column: place.column,
      playerId: player?.id ?? null,
      shortName: player ? shortName(player) : "EMPTY",
      fullName: player ? player.name : "Empty",
      pos: player?.pos ?? "",
      nfl: player?.nfl ?? "",
      mppgText,
      buildLine: provider.buildLine,
      tone,
      matchupLine: line,
      accessibleName: player
        ? `${player.name}, ${label}, MPPG ${mppgText}${line ? `, ${line}` : ""}`
        : `${label}, empty slot, MPPG ${mppgText}`,
      flexPos: place.slot === "FLEX" && player ? player.pos : null,
      grade,
      gradeTone: gradeToneOf(grade),
      backups,
    });
  }

  const total = round(
      [...starters].reduce(
        (sum, id) => sum + (mppgById.get(id)?.value ?? 0),
        0,
      ),
    ),
    spread = round(
      combineSpreads(
        [...starters]
          .map((id) => mppgById.get(id)?.spread ?? null)
          .filter((value): value is number => value !== null),
      ),
    );

  return {
    source,
    cards,
    total,
    spread,
    hasPlayers: cards.some((card) => card.playerId !== null),
  };
}
