import { test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { initialState, type Dataset, type Workspace } from "../../src/domain/contracts";
import { openTradeFilters } from "./trade-workspace-helpers";

async function seed(page: Page, filters: Record<string, string>) {
  const dataset: Dataset = JSON.parse(
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      "import {tradeSearchFixture} from './tests/fixtures.ts';process.stdout.write(JSON.stringify(await tradeSearchFixture()));"],
      { encoding: "utf8" }),
  );
  const w: Workspace = {
    owner: "local", dataset,
    state: { ...initialState(dataset), filters: { ...filters } },
    datasetRevision: 0, stateRevision: 0, pendingDataset: false, pendingState: false,
    requestId: "t", stateRequestId: "t",
  };
  await page.goto("./");
  await page.evaluate(async (value) => {
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open("fantasy-football-lab", 1); r.onupgradeneeded = () => r.result.createObjectStore("current"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise<void>((res, rej) => { const tx = db.transaction("current", "readwrite"); tx.objectStore("current").put(value, "local"); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    db.close();
  }, w);
  await page.reload();
}

test.use({ viewport: { width: 2000, height: 1120 } });
test("big find", async ({ page }) => {
  test.setTimeout(120000);
  await seed(page, { feelTheme: "dark", feelAnimation: "off" });
  await page.goto("./#/trade");
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "s9-review/big/find-collapsed.png" });
  await openTradeFilters(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "s9-review/big/find-open.png", fullPage: true });
  await page.getByRole("button", { name: "Run standard trade search" }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "s9-review/big/find-results.png", fullPage: true });
  await page.goto("./#/roster");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "s9-review/big/roster.png", fullPage: true });
  await page.goto("./#/lab/settings");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "s9-review/big/lab.png", fullPage: true });
});
