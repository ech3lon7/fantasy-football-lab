import { positions, type Draft } from "./contracts";
import { teamsAssessment } from "./lineups";
import { positionGradeScale } from "./trade-search";
import type { TradeResult } from "./trades";
import type { Model } from "./valuation";

// Grade limits are optional preferences and never change the existing scoring, valuation, or grading formulas.
export interface ChainGradeLimit {
  side: "own" | "other" | "both";
  maximumDrop: number;
}
export interface ChainPositionChange {
  position: string;
  before: string;
  after: string;
  drop: number | null;
}
export interface ChainPositionImpact {
  own: ChainPositionChange[];
  other: ChainPositionChange[];
}

// Reassess both legal rosters at this exact step, including required drops and IR, with the existing league-relative Teams grades.
export function chainPositionImpact(
  m: Model,
  draft: Draft,
  result: TradeResult,
): ChainPositionImpact {
  if (!result.valid || !result.legality) return { own: [], other: [] };
  const own = new Set(result.legalA),
    other = new Set(result.legalB),
    ir = new Set([...result.irA, ...result.irB]);
  const players = m.players.map((p) => {
    const owner = own.has(p.id)
      ? draft.teamA
      : other.has(p.id)
        ? draft.teamB
        : [draft.teamA, draft.teamB].includes(p.owner)
          ? "0"
          : p.owner;
    return {
      ...p,
      owner,
      slot: ir.has(p.id) ? 21 : owner !== p.owner ? 20 : p.slot,
    };
  });
  const before = teamsAssessment(m),
    after = teamsAssessment({
      ...m,
      players,
      byId: new Map(players.map((p) => [p.id, p])),
    });
  const affected = new Set(
    [...draft.give, ...draft.get, ...result.dropsA, ...result.dropsB].map(
      (id) => m.byId.get(id)!.pos,
    ),
  );
  const changes = (team: string) =>
    [...positions, "FLEX"]
      .filter(
        (position) =>
          affected.has(position as (typeof positions)[number]) ||
          (position === "FLEX" &&
            ["RB", "WR", "TE"].some((p) =>
              affected.has(p as (typeof positions)[number]),
            )),
      )
      .filter((position) => {
        // A roster format without this starter position has no applicable grade to protect.
        const field =
          position === "FLEX"
            ? "FlexSlots"
            : position === "D/ST"
              ? "DSTSlots"
              : `${position}Slots`;
        return Number(m.dataset.tables.ModelContext[0][field]) > 0;
      })
      .map((position) => {
        const a =
            before.get(team)?.find((g) => g.position === position)?.grade ??
            "n.a.",
          b =
            after.get(team)?.find((g) => g.position === position)?.grade ??
            "n.a.";
        const first = positionGradeScale.findIndex((g) => g === a),
          last = positionGradeScale.findIndex((g) => g === b);
        return {
          position,
          before: a,
          after: b,
          drop: first < 0 || last < 0 ? null : Math.max(0, first - last),
        };
      });
  return { own: changes(draft.teamA), other: changes(draft.teamB) };
}

// A total EPPG gain cannot rescue a failed explicit grade limit; unavailable grades do not silently count as unchanged.
export function chainGradeFailures(
  impact: ChainPositionImpact,
  limit?: ChainGradeLimit,
): string[] {
  if (!limit) return [];
  return (["own", "other"] as const).flatMap((side) =>
    limit.side !== "both" && limit.side !== side
      ? []
      : impact[side]
          .filter((row) => row.drop === null || row.drop > limit.maximumDrop)
          .map(
            (row) =>
              `${side === "own" ? "Your" : "Their"} ${row.position}: ${row.before} → ${row.after}; ${row.drop === null ? "grade unavailable" : `drops ${row.drop} grade steps (maximum ${limit.maximumDrop})`}.`,
          ),
  );
}
