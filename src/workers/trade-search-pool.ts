import type { SearchRow } from "../domain/trade-search";
import type { SearchInputs, TeamProgress, UsefulCoverage } from "../domain/useful-move-search";
import type { evaluate } from "../domain/valuation";
import type { applyRosterScenario } from "../domain/roster-scenarios";

// What a helper worker needs to rebuild the same model and search its share of the opponents.
export interface PartRequest {
  dataset: Parameters<typeof evaluate>[0];
  settings: Parameters<typeof evaluate>[1];
  evidence: string;
  roleWeight: string;
  scenario?: Parameters<typeof applyRosterScenario>[1];
  lineupsRaw?: string;
  teamA: string;
  basis: string | undefined;
  protectedIds: string[];
  inputs?: SearchInputs;
  opponents: string[];
  beam?: number;
}
export type PartMessage =
  | { type: "singles"; rows: SearchRow[] }
  | ({ type: "team" } & TeamProgress)
  | { type: "done"; rows: SearchRow[]; coverage: UsefulCoverage }
  | { type: "error"; message: string };

export const MAX_POOL = 4;

// One helper per core but one, at most four, never more than there are opponents. Without nested workers there is no pool.
export function poolSize(opponents: number, cores: number | undefined, available: boolean): number {
  if (!available) return 1;
  return Math.max(1, Math.min(MAX_POOL, (cores ?? 2) - 1, opponents));
}

// Deal opponents out round-robin so every helper gets a similar share.
export function partition<T>(items: T[], parts: number): T[][] {
  const out: T[][] = Array.from({ length: parts }, () => []);
  items.forEach((item, i) => out[i % parts].push(item));
  return out.filter((part) => part.length);
}

export function mergeCoverage(parts: UsefulCoverage[]): UsefulCoverage {
  const byTeam: UsefulCoverage["beamCutoffsByTeam"] = {};
  const floorByTeam: UsefulCoverage["floorSkippedByTeam"] = {};
  for (const part of parts) {
    if (part.beamCutoffsByTeam) Object.assign(byTeam, part.beamCutoffsByTeam);
    if (part.floorSkippedByTeam) Object.assign(floorByTeam, part.floorSkippedByTeam);
  }
  return {
    singles: parts.reduce((n, p) => n + p.singles, 0),
    extensions: parts.reduce((n, p) => n + p.extensions, 0),
    opponents: parts.reduce((n, p) => n + p.opponents, 0),
    beamCutoffs: parts.reduce((n, p) => n + p.beamCutoffs, 0),
    beamCutoffsByTeam: byTeam,
    floorSkipped: parts.reduce((n, p) => n + (p.floorSkipped ?? 0), 0),
    floorSkippedByTeam: floorByTeam,
  };
}

// Run independent slices and retry a failed helper's slice on the parent worker.
export async function runPooled(
  base: Omit<PartRequest, "opponents">,
  slices: string[][],
  spawn: () => Worker,
  onSingles: (rows: SearchRow[]) => void,
  onTeam?: (event: TeamProgress) => void,
  retry?: (opponents: string[], partial: (rows: SearchRow[]) => void) => Promise<{ rows: SearchRow[]; coverage: UsefulCoverage }>,
): Promise<{ rows: SearchRow[]; coverage: UsefulCoverage; missing: string[] }> {
  const singles = new Map<number, SearchRow[]>();
  const publish = (index: number, rows: SearchRow[]) => { singles.set(index, rows); onSingles([...singles.values()].flat()); };
  const parts = await Promise.all(slices.map((opponents, index) => new Promise<{ rows: SearchRow[]; coverage: UsefulCoverage; missing: string[] }>((resolve, reject) => {
    let worker: Worker | undefined, settled = false;
    const fail = () => {
      if (settled) return;
      settled = true; worker?.terminate(); singles.delete(index);
      if (!retry) { reject(new Error("A search helper failed.")); return; }
      retry(opponents, (rows) => publish(index, rows)).then(
        (result) => resolve({ ...result, missing: [] }),
        () => resolve({ rows: [], coverage: mergeCoverage([]), missing: opponents }),
      );
    };
    try { worker = spawn(); } catch { fail(); return; }
    worker.onmessage = (event: MessageEvent<PartMessage>) => {
      if (settled) return;
      const message = event.data;
      if (message.type === "singles") publish(index, message.rows);
      else if (message.type === "team") onTeam?.(message);
      else if (message.type === "done") { settled = true; worker?.terminate(); resolve({ rows: message.rows, coverage: message.coverage, missing: [] }); }
      else fail();
    };
    worker.onerror = fail;
    try { worker.postMessage({ ...base, opponents } satisfies PartRequest); } catch { fail(); }
  })));
  return { rows: parts.flatMap((part) => part.rows), coverage: mergeCoverage(parts.map((part) => part.coverage)),
    missing: parts.flatMap((part) => part.missing) };
}
