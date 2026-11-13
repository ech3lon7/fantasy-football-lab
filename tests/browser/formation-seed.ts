import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import {
  initialState,
  type Dataset,
  type Workspace,
} from "../../src/domain/contracts";

// Seed only this isolated test browser with the formation roster: two teams, nine ESPN starters,
// bye and out bench cover, an IR player and engineered soft, tough and neutral matchups.
export async function seedFormation(
  page: Page,
  options: { byeStarter?: boolean; optimal?: boolean } = {},
  filters: Record<string, string> = {},
) {
  const dataset: Dataset = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import {formationFixture} from './tests/fixtures.ts';process.stdout.write(JSON.stringify(await formationFixture(${JSON.stringify(options)})));`,
      ],
      { encoding: "utf8" },
    ),
  );
  const state = initialState(dataset);
  const workspace: Workspace = {
    owner: "local",
    dataset,
    state: { ...state, filters: { ...state.filters, ...filters } },
    datasetRevision: 0,
    stateRevision: 0,
    pendingDataset: false,
    pendingState: false,
    requestId: crypto.randomUUID(),
    stateRequestId: crypto.randomUUID(),
  };
  await page.goto("./");
  await page.evaluate(async (w) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fantasy-football-lab", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("current"))
          request.result.createObjectStore("current");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("current", "readwrite");
      tx.objectStore("current").put(w, "local");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, workspace);
  await page.goto("./#/roster");
  await page.reload();
  return dataset;
}
