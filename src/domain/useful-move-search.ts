import { cmpId } from "./contracts";

// These limits are the approved search floor and the starting per-team, per-size beam.
// Apply the approved loss floor independently to each side of a trade.
export const FLOOR_MAX_LOSS_OWN = 3;
export const FLOOR_MAX_LOSS_OTHER = 2;
export const BEAM_PER_TEAM = 200;
type Impacts = { add: Map<string, Map<string, number | null>>; leave: Map<string, Map<string, number | null>> };
export interface UsefulCoverage {
  singles: number;
  extensions: number;
  opponents: number;
  beamCutoffs: number;
  beamCutoffsByTeam: Record<string, Record<string, number>>;
  floorSkipped: number;
  floorSkippedByTeam: Record<string, Record<string, number>>;
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

export interface SearchInputs {
  protectedIds: string[];      // Never trade (replaces today's protectedIds argument)
  givePool: string[];          // I give; empty = any of your players
  giveRequired: string[];      // I give "must" players, ⊆ givePool, at most 3
  getPool: string[];           // I get; empty = any of their players
  getRequired: string[];       // I get "must" players, ⊆ getPool, at most 3, all on one team
  exclude: string[];           // Exclude
  teams: string[] | null;      // Teams; null = all
}

export function defaultSearchInputs(protectedIds: string[] = []): SearchInputs {
  return {
    protectedIds,
    givePool: [],
    giveRequired: [],
    getPool: [],
    getRequired: [],
    exclude: [],
    teams: null,
  };
}

// Canonical player order prevents the same package from being evaluated repeatedly.
function offerKey(p: UsefulOffer) { return `${p.team}|${[...p.give].sort().join(",")}|${[...p.get].sort().join(",")}`; }
function subset(a: string[], b: string[]) { return a.every((id) => b.includes(id)); }
// Retain only legal trades with changed lineups and measurable gains within the agreed floor.
function passesFloor(r: UsefulEvaluation) {
  return r.legal === true && r.changed && r.own !== null && r.other !== null &&
    Number.isFinite(r.own) && Number.isFinite(r.other) && r.own >= -FLOOR_MAX_LOSS_OWN && r.other >= -FLOOR_MAX_LOSS_OTHER;
}

interface CandidateItem {
  key: string;
  offer: UsefulOffer;
  own: number;
  other: number;
}

function selectBeamCandidates(candidates: CandidateItem[], beam: number): { taken: CandidateItem[]; cutoffs: CandidateItem[] } {
  const half = Math.floor(beam / 2); // 100 when beam = 200
  const listA = [...candidates].sort((a, b) => b.own - a.own || a.key.localeCompare(b.key));
  const listB = [...candidates].sort((a, b) =>
    Math.min(b.own, b.other) - Math.min(a.own, a.other) || a.key.localeCompare(b.key)
  );

  const takenSet = new Set<string>();
  const taken: CandidateItem[] = [];

  let idxA = 0;
  while (idxA < listA.length && taken.length < half) {
    const c = listA[idxA++];
    takenSet.add(c.key);
    taken.push(c);
  }

  let idxB = 0;
  let takenFromB = 0;
  while (idxB < listB.length && takenFromB < half && taken.length < beam) {
    const c = listB[idxB++];
    if (!takenSet.has(c.key)) {
      takenSet.add(c.key);
      taken.push(c);
      takenFromB++;
    }
  }

  // If either list runs out first, keep taking alternately (next untaken from A, then next untaken from B) until 200 are taken or both lists are empty.
  while (taken.length < beam && (idxA < listA.length || idxB < listB.length)) {
    let advanced = false;
    while (idxA < listA.length) {
      const c = listA[idxA++];
      if (!takenSet.has(c.key)) {
        takenSet.add(c.key);
        taken.push(c);
        advanced = true;
        break;
      }
    }
    if (taken.length >= beam) break;
    while (idxB < listB.length) {
      const c = listB[idxB++];
      if (!takenSet.has(c.key)) {
        takenSet.add(c.key);
        taken.push(c);
        advanced = true;
        break;
      }
    }
    if (!advanced) break;
  }

  const cutoffs = candidates.filter((c) => !takenSet.has(c.key));
  return { taken, cutoffs };
}

// Evaluate all singles, then rank guided packages by their whole-package lineup impact before full evaluation.
export async function buildUsefulMoves<T extends UsefulEvaluation>(
  roster: { own: string[]; opponents: Record<string, string[]> },
  impacts: Impacts,
  inputsOrProtected: SearchInputs | string[],
  estimate: (offer: UsefulOffer) => { own: number | null; other: number | null },
  evaluate: (offer: UsefulOffer) => T,
  onSingles?: (rows: T[]) => void,
  beam = BEAM_PER_TEAM,
  onTeam?: (event: TeamProgress) => void,
  metadata = true,
) {
  const inputs: SearchInputs = Array.isArray(inputsOrProtected)
    ? defaultSearchInputs(inputsOrProtected)
    : inputsOrProtected;

  let ours = roster.own.filter((id) => !inputs.protectedIds.includes(id) && !inputs.exclude.includes(id));
  if (inputs.givePool.length > 0) ours = ours.filter((id) => inputs.givePool.includes(id));

  const activeOpponents: Record<string, string[]> = {};
  for (const [team, teamRoster] of Object.entries(roster.opponents)) {
    if (inputs.teams !== null && !inputs.teams.includes(team)) continue;
    if (inputs.getPool.length > 0 && !teamRoster.some((id) => inputs.getPool.includes(id))) continue;
    if (inputs.getRequired.length > 0 && !inputs.getRequired.every((id) => teamRoster.includes(id))) continue;
    let theirs = teamRoster.filter((id) => !inputs.exclude.includes(id));
    if (inputs.getPool.length > 0) theirs = theirs.filter((id) => inputs.getPool.includes(id));
    if (theirs.length > 0) activeOpponents[team] = theirs;
  }

  const evaluated = new Set<string>(), retained: T[] = [], singles: T[] = [];
  const coverage: UsefulCoverage = {
    singles: 0,
    extensions: 0,
    opponents: Object.keys(activeOpponents).length,
    beamCutoffs: 0,
    beamCutoffsByTeam: {} as Record<string, Record<string, number>>,
    floorSkipped: 0,
    floorSkippedByTeam: {} as Record<string, Record<string, number>>,
  };

  const extByTeam: Record<string, number> = {};
  const singleSeed = (team: string, give: string, get: string) => JSON.stringify([team, [give], [get]]);

  for (const [team, theirs] of Object.entries(activeOpponents)) {
    for (const give of ours) for (const get of theirs) {
      const offer = { team, give: [give], get: [get] };
      evaluated.add(offerKey(offer));
      coverage.singles++;
      const row = evaluate(offer);
      if (metadata) row.seedKey = singleSeed(team, give, get);
      singles.push(row);
      if (passesFloor(row)) retained.push(row);
      if (coverage.singles % 100 === 0) onSingles?.([...retained]);
    }
    onTeam?.({ team, singles: ours.length * theirs.length, extensions: 0, done: false });
  }
  onSingles?.([...retained]);

  // Yield to the worker event loop so filters and browsing can respond while extensions are built.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  for (let total = 3; total <= 6; total++) {
    for (const [team, theirs] of Object.entries(activeOpponents)) {
      const candidatesByShape = new Map<string, Map<string, { offer: UsefulOffer; est: { own: number; other: number } }>>();
      const seeds = new Map<string, string>();
      const teamRows = retained.filter((r) => r.team === team);

      const addCandidate = (give: string[], get: string[], pathSeed?: string) => {
        if (give.length < 1 || get.length < 1 || give.length > 3 || get.length > 3 || give.length + get.length !== total) return;
        const missingGive = inputs.giveRequired.filter((id) => !give.includes(id)).length;
        const missingGet = inputs.getRequired.filter((id) => !get.includes(id)).length;
        if (give.length + missingGive > 3 || get.length + missingGet > 3) return;

        const offer = { team, give, get };
        const key = offerKey(offer);
        if (evaluated.has(key)) return;

        const shape = `${give.length}:${get.length}`;
        let shapeMap = candidatesByShape.get(shape);
        if (!shapeMap) {
          shapeMap = new Map();
          candidatesByShape.set(shape, shapeMap);
        }
        if (shapeMap.has(key)) return;

        const est = estimate(offer);
        if (est.own === null || est.other === null || !Number.isFinite(est.own) || !Number.isFinite(est.other)) return;

        shapeMap.set(key, { offer, est: { own: est.own, other: est.other } });

        if (metadata && pathSeed) {
          let seed = pathSeed;
          if (give.length === 2 && get.length === 1) {
            const bestGive = [...give].sort((a, b) => (impacts.leave.get("own")?.get(b) ?? 0) - (impacts.leave.get("own")?.get(a) ?? 0) || cmpId(a, b))[0];
            seed = singleSeed(team, bestGive, get[0]);
          } else if (give.length === 1 && get.length === 2) {
            const bestGet = [...get].sort((a, b) => (impacts.add.get("own")?.get(b) ?? 0) - (impacts.add.get("own")?.get(a) ?? 0) || cmpId(a, b))[0];
            seed = singleSeed(team, give[0], bestGet);
          }
          const previous = seeds.get(key);
          if (!previous || seed < previous) seeds.set(key, seed);
        }
      };

      const topOurs = [...ours].filter((id) => (impacts.add.get(team)?.get(id) ?? 0) > 0)
        .sort((a, b) => (impacts.add.get(team)?.get(b) ?? 0) - (impacts.add.get(team)?.get(a) ?? 0) || a.localeCompare(b)).slice(0, 5);
      const topTheirs = [...theirs].filter((id) => (impacts.add.get("own")?.get(id) ?? 0) > 0)
        .sort((a, b) => (impacts.add.get("own")?.get(b) ?? 0) - (impacts.add.get("own")?.get(a) ?? 0) || a.localeCompare(b)).slice(0, 5);

      const extensionBases = total === 3 ? singles.filter((r) => r.team === team) : teamRows;
      for (const row of extensionBases) {
        // Rule 1: Sweetener (ours)
        for (const id of topOurs) if (!row.give.includes(id)) {
          addCandidate([...row.give, id], row.get, row.seedKey);
        }
        // Rule 2: Ask for more (theirs - mirror of sweetener)
        for (const id of topTheirs) if (!row.get.includes(id)) {
          addCandidate(row.give, [...row.get, id], row.seedKey);
        }
        // Rule 3: Our consolidation
        if (row.give.length === 1 && row.get.length === 1) {
          for (const id of ours) if (!row.give.includes(id)) {
            const give = [...row.give, id];
            const gain = impacts.add.get("own")?.get(row.get[0]);
            const first = impacts.leave.get("own")?.get(give[0]);
            const second = impacts.leave.get("own")?.get(give[1]);
            if (gain != null && first != null && second != null && gain > first + second) {
              addCandidate(give, row.get, row.seedKey);
            }
          }
        }
        // Rule 4: Their consolidation
        if (row.give.length === 1 && row.get.length === 1) {
          for (const id of theirs) if (!row.get.includes(id)) {
            const gain = impacts.add.get(team)?.get(row.give[0]);
            const first = impacts.leave.get(team)?.get(row.get[0]);
            const second = impacts.leave.get(team)?.get(id);
            if (gain != null && first != null && second != null && gain > first + second) {
              addCandidate(row.give, [...row.get, id], row.seedKey);
            }
          }
        }
      }

      // Rule 5: Merges (T3)
      const validSingles = singles.filter((s) => s.team === team && s.give.length === 1 && s.get.length === 1 && s.legal === true && s.own !== null && s.other !== null);
      const mergeParts = Array.from(new Set([...teamRows, ...validSingles]));
      for (let i = 0; i < mergeParts.length; i++) {
        const row = mergeParts[i];
        for (let j = i + 1; j < mergeParts.length; j++) {
          const other = mergeParts[j];
          if (row.give.length + other.give.length + row.get.length + other.get.length === total &&
              !row.give.some((id) => other.give.includes(id)) &&
              !row.get.some((id) => other.get.includes(id))) {
            const seedKey = row.own! > other.own! ? row.seedKey : row.own! < other.own! ? other.seedKey : [row.seedKey, other.seedKey].filter((x): x is string => !!x).sort()[0];
            addCandidate([...row.give, ...other.give], [...row.get, ...other.get], seedKey);
          }
        }
      }

      // T5: Fill up to beam (200) places for each shape
      for (const [shape, shapeMap] of candidatesByShape) {
        const allCandidates: CandidateItem[] = Array.from(shapeMap.entries()).map(([key, { offer, est }]) => ({
          key,
          offer,
          own: est.own,
          other: est.other,
        }));

        // Floor pre-check: drop any candidate whose estimate is own < -4 or other < -3
        const floorPassed: CandidateItem[] = [];
        for (const c of allCandidates) {
          if (c.own < -3 || c.other < -2) {
            coverage.floorSkipped++;
            const teamFloor = (coverage.floorSkippedByTeam[team] ??= {});
            teamFloor[shape] = (teamFloor[shape] ?? 0) + 1;
          } else {
            floorPassed.push(c);
          }
        }

        const { taken, cutoffs } = selectBeamCandidates(floorPassed, beam);

        if (cutoffs.length > 0) {
          coverage.beamCutoffs += cutoffs.length;
          const teamCutoffs = (coverage.beamCutoffsByTeam[team] ??= {});
          teamCutoffs[shape] = (teamCutoffs[shape] ?? 0) + cutoffs.length;
        }

        for (const candidate of taken) {
          evaluated.add(candidate.key);
          coverage.extensions++;
          extByTeam[team] = (extByTeam[team] ?? 0) + 1;
          const row = evaluate(candidate.offer);
          if (metadata) row.seedKey = seeds.get(candidate.key);
          if (passesFloor(row)) retained.push(row);
          if (coverage.extensions % 25 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }

      if (total === 6) onTeam?.({ team, singles: ours.length * (activeOpponents[team]?.length ?? 0), extensions: extByTeam[team] ?? 0, done: true });
    }
  }

  // Final returned rows: contain only trades that include every giveRequired and every getRequired player
  const matchesRequired = (trade: UsefulEvaluation) =>
    inputs.giveRequired.every((id) => trade.give.includes(id)) &&
    inputs.getRequired.every((id) => trade.get.includes(id));

  const validRetained = retained.filter(matchesRequired);

  const rows: UsefulRow<T>[] = [];
  for (const trade of validRetained.sort((a, b) => a.give.length + a.get.length - b.give.length - b.get.length)) {
    const core = rows.find(({ trade: base }) => base.team === trade.team && subset(base.give, trade.give) && subset(base.get, trade.get) &&
      Math.abs(base.own! - trade.own!) <= .05 && Math.abs(base.other! - trade.other!) <= .05);
    if (core) core.variants.push(trade); else rows.push({ trade, variants: [] });
  }
  return { rows, coverage };
}
