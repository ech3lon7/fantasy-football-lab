import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  initialState,
  type Dataset,
  type Workspace,
} from "../../src/domain/contracts";

test("clicking player MA badge opens player card focused on the chart", async ({
  page,
}) => {
  const dataset: Dataset = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
    import {fixture} from './tests/fixtures.ts';
    import {fromTables} from './src/import/workbook.ts';
    import fs from 'node:fs';
    const d=await fixture([0,-2,12,10,30]);
    d.tables.ModelContext[0].ScoringItemsJSON=JSON.stringify(JSON.parse(fs.readFileSync('./src/domain/historical-scoring-spread.json','utf8')).scoring);
    d.tables.ModelPlayers.find(p=>p.PlayerID===1).Current_Week_Projection=null;
    d.tables.ModelPlayers.find(p=>p.PlayerID===2).Current_Week_Projection=0;
    process.stdout.write(JSON.stringify(await fromTables(d.tables,d.settings)));
  `,
      ],
      { encoding: "utf8" },
    ),
  );
  const workspace: Workspace = {
    owner: "local",
    dataset,
    state: initialState(dataset),
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
      request.onupgradeneeded = () =>
        request.result.createObjectStore("current");
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

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your roster", exact: true }),
  ).toBeVisible();

  await page.setViewportSize({ width: 1400, height: 900 });

  // 1. Go to Players view
  await page.goto("./#/players");
  await expect(page.getByRole("heading", { name: "League player pool" })).toBeVisible();

  // Find a player row with stock-trend-pill
  const pill = page.locator(".gem-player-name-row .stock-trend-pill").first();
  await expect(pill).toBeVisible();
  const pillText = await pill.innerText();
  console.log("Found MA badge in Players tab:", pillText);

  // Click the MA badge directly
  await pill.click();

  // Dialog / Player Popover must open
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Chart section must be visible inside the popover
  const chartSection = dialog.locator("#player-popover-chart-section");
  await expect(chartSection).toBeVisible();

  // Stock chart svg wrap must be visible
  const chartSvg = chartSection.locator(".player-stock-svg");
  await expect(chartSvg).toBeVisible();

  // Capture screenshot of player card opened directly to the chart
  const screenshotPath = "C:/Users/israe/.gemini/antigravity/brain/2eea40f1-347c-49f2-855d-0f59973c47d2/player-card-chart-popover.png";
  await page.screenshot({ path: screenshotPath, fullPage: false });

  // Close dialog
  await dialog.getByRole("button", { name: "Close player details" }).click();
  await expect(dialog).toHaveCount(0);
});
