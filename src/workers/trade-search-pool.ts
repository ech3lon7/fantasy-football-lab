import type { SearchRow } from "../domain/trade-search";
import type { TeamProgress, UsefulCoverage } from "../domain/useful-move-search";
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
  for (const part of parts) Object.assign(byTeam, part.beamCutoffsByTeam);
  return {
    singles: parts.reduce((n, p) => n + p.singles, 0),
    extensions: parts.reduce((n, p) => n + p.extensions, 0),
    opponents: parts.reduce((n, p) => n + p.opponents, 0),
    beamCutoffs: parts.reduce((n, p) => n + p.beamCutoffs, 0),
    beamCutoffsByTeam: byTeam,
  };
}

// Run the slices in helper workers, streaming each slice's one-for-ones as they finish. Terminating the parent worker ends them all.
export function runPooled(
  base: Omit<PartRequest, "opponents">,
  slices: string[][],
  spawn: () => Worker,
  onSingles: (rows: SearchRow[]) => void,
  onTeam?: (event: TeamProgress) => void,
): Promise<{ rows: SearchRow[]; coverage: UsefulCoverage }> {
  return new Promise((resolve, reject) => {
    const workers: Worker[] = [];
    const singles = new Map<number, SearchRow[]>();
    const done = new Map<number, { rows: SearchRow[]; coverage: UsefulCoverage }>();
    const stop = () => workers.forEach((w) => w.terminate());
    slices.forEach((opponents, index) => {
      let worker: Worker;
      try {
        worker = spawn();
      } catch (error) {
        stop();
        reject(error);
        return;
      }
      workers.push(worker);
      worker.onmessage = (event: MessageEvent<PartMessage>) => {
        const message = event.data;
        if (message.type === "singles") {
          singles.set(index, message.rows);
          onSingles([...singles.values()].flat());
        } else if (message.type === "team") {
          onTeam?.(message);
        } else if (message.type === "done") {
          done.set(index, { rows: message.rows, coverage: message.coverage });
          worker.terminate();
          if (done.size === slices.length) {
            const parts = [...done.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);
            resolve({ rows: parts.flatMap((p) => p.rows), coverage: mergeCoverage(parts.map((p) => p.coverage)) });
          }
        } else {
          stop();
          reject(new Error(message.message));
        }
      };
      worker.onerror = () => {
        stop();
        reject(new Error("A search helper failed."));
      };
      worker.postMessage({ ...base, opponents } satisfies PartRequest);
    });
  });
}
