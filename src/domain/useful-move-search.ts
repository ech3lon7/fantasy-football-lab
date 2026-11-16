import { cmpId } from "./contracts";

// These limits are the approved search floor and the starting per-team, per-size beam.
// Apply the approved loss floor independently to each side of a trade.
export const FLOOR_MAX_LOSS_OWN = 3;
export const FLOOR_MAX_LOSS_OTHER = 2;
export const BEAM_PER_TEAM = 200;
type Impacts = { add: Map<string, Map<string, number | null>>; leave: Map<string, Map<string, number | null>> };
export interface UsefulCoverage {
  singles: number; extensions: number; opponents: number; beamCutoffs: number;
  beamCutoffsByTeam: Record<string, Record<string, number>>;
  missingTeams?: string[];
}
// One opponent's progress: its one-for-ones are done (done false), or all its packages are (done true).
export interface TeamProgress {
  team: string;
  singles: number;
  extensions: number;
  done: boolean;
}
export interface UsefulOffer { team: string; give: string[]; get: string[] }
export interface UsefulEvaluation extends UsefulOffer { legal: boolean | null; changed: boolean; own: number | null; other: number | null; seedKey?: string }
export interface UsefulRow<T extends UsefulEvaluation> { trade: T; variants: T[] }

// Canonical player order prevents the same package from being evaluated repeatedly.
function offerKey(p: UsefulOffer) { return `${p.team}|${[...p.give].sort().join(",")}|${[...p.get].sort().join(",")}`; }
function subset(a: string[], b: string[]) { return a.every((id) => b.includes(id)); }
// Retain only legal trades with changed lineups and measurable gains within the agreed floor.
function passesFloor(r: UsefulEvaluation) {
  return r.legal === true && r.changed && r.own !== null && r.other !== null &&
    Number.isFinite(r.own) && Number.isFinite(r.other) && r.own >= -FLOOR_MAX_LOSS_OWN && r.other >= -FLOOR_MAX_LOSS_OTHER;
}

// Evaluate all singles, then rank guided packages by their potential lineup impact before full evaluation.
export async function buildUsefulMoves<T extends UsefulEvaluation>(
  roster: { own: string[]; opponents: Record<string, string[]> }, impacts: Impacts, protectedIds: string[],
  evaluate: (offer: UsefulOffer) => T, onSingles?: (rows: T[]) => void, beam = BEAM_PER_TEAM,
  onTeam?: (event: TeamProgress) => void, metadata = true,
) {
  const ours = roster.own.filter((id) => !protectedIds.includes(id));
  const evaluated = new Set<string>(), retained: T[] = [], singles: T[] = [];
  const coverage: UsefulCoverage = { singles: 0, extensions: 0, opponents: Object.keys(roster.opponents).length, beamCutoffs: 0,
    beamCutoffsByTeam: {} as Record<string, Record<string, number>> };
  const score = (team: string, give: string[], get: string[]) => {
    const values = [...give.map((id) => impacts.add.get(team)?.get(id)), ...get.map((id) => impacts.add.get("own")?.get(id)),
      ...give.map((id) => impacts.leave.get("own")?.get(id)), ...get.map((id) => impacts.leave.get(team)?.get(id))];
    if (values.some((v) => v == null)) return null;
    return values.slice(0, give.length + get.length).reduce<number>((a, b) => a + b!, 0) -
      values.slice(give.length + get.length).reduce<number>((a, b) => a + b!, 0);
  };
  // Every one-for-one reaches the original evaluator, including players with unavailable impact estimates.
  const extByTeam: Record<string, number> = {};
  // Each retained package carries its grouping single without affecting evaluation or ranking.
  const singleSeed = (team: string, give: string, get: string) => JSON.stringify([team, [give], [get]]);
  for (const [team, theirs] of Object.entries(roster.opponents)) {
  for (const give of ours) for (const get of theirs) {
    const offer = { team, give: [give], get: [get] }; evaluated.add(offerKey(offer)); coverage.singles++;
    const row = evaluate(offer); if (metadata) row.seedKey = singleSeed(team, give, get);
    singles.push(row); if (passesFloor(row)) retained.push(row);
    // Early batches let the first rows appear long before every one-for-one is checked.
    if (coverage.singles % 100 === 0) onSingles?.([...retained]);
  }
  onTeam?.({ team, singles: ours.length * theirs.length, extensions: 0, done: false });
  }
  onSingles?.([...retained]);
  // Yield to the worker event loop so filters and browsing can respond while extensions are built.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  // Grow only from retained packages; each size is capped independently for each opponent.
  for (let total = 3; total <= 6; total++) for (const [team] of Object.entries(roster.opponents)) {
    const candidates = new Map<string, { offer: UsefulOffer; score: number }>();
    const seeds = new Map<string, string>();
    const teamRows = retained.filter((r) => r.team === team);
    const addCandidate = (give: string[], get: string[], pathSeed?: string) => {
      if (give.length < 1 || get.length < 1 || give.length > 3 || get.length > 3 || give.length + get.length !== total) return;
      const offer = { team, give, get }, key = offerKey(offer), value = score(team, give, get);
      if (!evaluated.has(key) && value !== null) {
        candidates.set(key, { offer, score: value });
        if (metadata && pathSeed) {
          // Every 2-for-1 uses the higher-departure-impact player, including sweeteners.
          const seed = give.length === 2 && get.length === 1
            ? singleSeed(team, [...give].sort((a, b) => (impacts.leave.get("own")?.get(b) ?? 0) - (impacts.leave.get("own")?.get(a) ?? 0) || cmpId(a, b))[0], get[0])
            : pathSeed;
          const previous = seeds.get(key);
          if (!previous || seed < previous) seeds.set(key, seed);
        }
      }
    };
    const top = [...ours].filter((id) => (impacts.add.get(team)?.get(id) ?? 0) > 0)
      .sort((a, b) => (impacts.add.get(team)?.get(b) ?? 0) - (impacts.add.get(team)?.get(a) ?? 0) || a.localeCompare(b)).slice(0, 5);
    // Sweeteners and consolidations start from every single, including those below the floor.
    const extensionBases = total === 3 ? singles.filter((r) => r.team === team) : teamRows;
    for (const row of extensionBases) {
      for (const id of top) if (!row.give.includes(id)) {
        const give = [...row.give, id];
        addCandidate(give, row.get, row.seedKey);
      }
      // Consolidations can use any second player when the incoming gain exceeds both departure losses.
      if (row.give.length === 1 && row.get.length === 1) for (const id of ours) if (!row.give.includes(id)) {
        const give = [...row.give, id], gain = impacts.add.get("own")?.get(row.get[0]);
        const first = impacts.leave.get("own")?.get(give[0]), second = impacts.leave.get("own")?.get(give[1]);
        if (gain != null && first != null && second != null && gain > first + second) addCandidate(give, row.get, row.seedKey);
      }
      for (const other of teamRows) if (teamRows.includes(row) && row !== other && !row.give.some((id) => other.give.includes(id)) && !row.get.some((id) => other.get.includes(id)))
        addCandidate([...row.give, ...other.give], [...row.get, ...other.get],
          row.own! > other.own! ? row.seedKey : row.own! < other.own! ? other.seedKey : [row.seedKey, other.seedKey].filter((x): x is string => !!x).sort()[0]);
    }
    const ranked = [...candidates.values()].sort((a, b) => b.score - a.score || offerKey(a.offer).localeCompare(offerKey(b.offer)));
    // A separate beam for each give/get size avoids one package shape crowding out another.
    const counts = new Map<string, number>();
    for (const candidate of ranked) {
      const size = `${candidate.offer.give.length}:${candidate.offer.get.length}`, count = counts.get(size) ?? 0;
      if (count >= beam) {
        coverage.beamCutoffs++;
        const teamCutoffs = coverage.beamCutoffsByTeam[team] ??= {};
        teamCutoffs[size] = (teamCutoffs[size] ?? 0) + 1;
        continue;
      }
      counts.set(size, count + 1); evaluated.add(offerKey(candidate.offer)); coverage.extensions++; extByTeam[team] = (extByTeam[team] ?? 0) + 1;
      const row = evaluate(candidate.offer); if (metadata) row.seedKey = seeds.get(offerKey(candidate.offer));
      if (passesFloor(row)) retained.push(row);
      // Regular yields keep filter messages responsive without reducing search coverage.
      if (coverage.extensions % 25 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    // The last size pass finishes this opponent.
    if (total === 6) onTeam?.({ team, singles: ours.length * (roster.opponents[team]?.length ?? 0), extensions: extByTeam[team] ?? 0, done: true });
  }
  // Attach near-identical supersets to their smaller core without rounding gains before comparison.
  const rows: UsefulRow<T>[] = [];
  for (const trade of retained.sort((a, b) => a.give.length + a.get.length - b.give.length - b.get.length)) {
    const core = rows.find(({ trade: base }) => base.team === trade.team && subset(base.give, trade.give) && subset(base.get, trade.get) &&
      Math.abs(base.own! - trade.own!) <= .05 && Math.abs(base.other! - trade.other!) <= .05);
    if (core) core.variants.push(trade); else rows.push({ trade, variants: [] });
  }
  return { rows, coverage };
}



