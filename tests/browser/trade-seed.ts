import type { Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  initialState,
  type Dataset,
  type Draft,
  type Workspace,
} from "../../src/domain/contracts";

// Seed a synthetic league through the same IndexedDB path a real import uses, so the workers and the screens run unchanged.
// "search" is the two-team league with ten extra WRs; "chain" is the three-team league that yields safe and speculative chains;
// "tiers" is the two-team league with free agents in every player-card tier.
export async function seedTradeLeague(
  page: Page,
  which: "search" | "chain" | "tiers",
  draft: Draft,
  filters: Record<string, string> = {},
) {
  const [file, fn] =
    which === "search"
      ? ["./tests/fixtures.ts", "tradeSearchFixture"]
      : which === "tiers"
        ? ["./tests/tier-fixture.ts", "tierFixture"]
        : ["./tests/chain-fixture.ts", "fairChainFixture"];
  const dataset: Dataset = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import {${fn}} from '${file}';process.stdout.write(JSON.stringify(await ${fn}()));`,
      ],
      { encoding: "utf8" },
    ),
  );
  const workspace: Workspace = {
    owner: "local",
    dataset,
    state: { ...initialState(dataset), draft, filters: { ...filters } },
    datasetRevision: 0,
    stateRevision: 0,
    pendingDataset: false,
    pendingState: false,
    requestId: "trade-seed",
    stateRequestId: "trade-seed",
  };
  // Headshots are not part of the test; the initials fallback is what the screens must show offline.
  await page.route("https://a.espncdn.com/**", (route) => route.abort());
  await page.goto("./");
  await page.evaluate(async (value) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("fantasy-football-lab", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("current");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("current", "readwrite");
      tx.objectStore("current").put(value, "local");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, workspace);
  await page.reload();
}
