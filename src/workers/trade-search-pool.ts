import type { evaluate } from "../domain/valuation";
import type { applyRosterScenario } from "../domain/roster-scenarios";
import type { ManagerSettings } from "../domain/manager-expectations";
import type {
  CompleteTrade,
  CompleteCoverage,
} from "../domain/complete-trade-search";

// What a helper worker needs to rebuild the same model and search its share of the opponents.
export interface PartRequest {
  dataset: Parameters<typeof evaluate>[0];
  settings: Parameters<typeof evaluate>[1];
  evidence: string;
  roleWeight: string;
  scenario?: Parameters<typeof applyRosterScenario>[1];
  lineupsRaw?: string;
  teamA: string;
  manager: ManagerSettings;
  opponents: string[];
}

export type PartMessage =
  | {
      type: "team-rows";
      team: string;
      possible: number;
      scored: number;
      kept: number;
      rows: CompleteTrade[];
    }
  | { type: "done"; rows: CompleteTrade[]; coverage: CompleteCoverage }
  | { type: "error"; message: string };

export const MAX_POOL = 4;

// One helper per core but one, at most four, never more than there are opponents. Without nested workers there is no pool.
export function poolSize(
  opponents: number,
  cores: number | undefined,
  available: boolean,
): number {
  if (!available) return 1;
  return Math.max(1, Math.min(MAX_POOL, (cores ?? 2) - 1, opponents));
}

// Deal opponents out round-robin so every helper gets a similar share.
export function partition<T>(items: T[], parts: number): T[][] {
  const out: T[][] = Array.from({ length: parts }, () => []);
  items.forEach((item, i) => out[i % parts].push(item));
  return out.filter((part) => part.length);
}

export function mergeCoverage(parts: CompleteCoverage[]): CompleteCoverage {
  return {
    possible: parts.reduce((n, p) => n + p.possible, 0),
    scored: parts.reduce((n, p) => n + p.scored, 0),
    kept: parts.reduce((n, p) => n + p.kept, 0),
    opponents: parts.reduce((n, p) => n + p.opponents, 0),
  };
}

// Run independent slices and retry a failed helper's slice on the parent worker.
export async function runPooled(
  base: Omit<PartRequest, "opponents">,
  slices: string[][],
  spawn: () => Worker,
  onTeamRows: (event: {
    team: string;
    possible: number;
    scored: number;
    kept: number;
    rows: CompleteTrade[];
  }) => void,
  retry?: (
    opponents: string[],
  ) => Promise<{ rows: CompleteTrade[]; coverage: CompleteCoverage }>,
): Promise<{
  rows: CompleteTrade[];
  coverage: CompleteCoverage;
  missing: string[];
}> {
  const parts = await Promise.all(
    slices.map(
      (opponents) =>
        new Promise<{
          rows: CompleteTrade[];
          coverage: CompleteCoverage;
          missing: string[];
        }>((resolve, reject) => {
          let worker: Worker | undefined,
            settled = false;
          const fail = () => {
            if (settled) return;
            settled = true;
            worker?.terminate();
            if (!retry) {
              reject(new Error("A search helper failed."));
              return;
            }
            retry(opponents).then(
              (result) => resolve({ ...result, missing: [] }),
              () =>
                resolve({
                  rows: [],
                  coverage: { possible: 0, scored: 0, kept: 0, opponents: 0 },
                  missing: opponents,
                }),
            );
          };
          try {
            worker = spawn();
          } catch {
            fail();
            return;
          }
          worker.onmessage = (event: MessageEvent<PartMessage>) => {
            if (settled) return;
            const message = event.data;
            if (message.type === "team-rows") {
              onTeamRows(message);
            } else if (message.type === "done") {
              settled = true;
              worker?.terminate();
              resolve({
                rows: message.rows,
                coverage: message.coverage,
                missing: [],
              });
            } else {
              fail();
            }
          };
          worker.onerror = fail;
          try {
            worker.postMessage({ ...base, opponents } satisfies PartRequest);
          } catch {
            fail();
          }
        }),
    ),
  );
  return {
    rows: parts.flatMap((part) => part.rows),
    coverage: mergeCoverage(parts.map((part) => part.coverage)),
    missing: parts.flatMap((part) => part.missing),
  };
}
