import { openTradeDetails, openSavedTrades } from "./trade-workspace-helpers";
import { test, expect } from "@playwright/test";
import { openLegacyTrades } from "./trade-workspace-helpers";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import {
  initialState,
  type Dataset,
  type Workspace,
} from "../../src/domain/contracts";

// Seed a small real-shaped synthetic workspace through the same IndexedDB store as the app.
test("optional stress test stays isolated, validates edits, exports and restores saved assumptions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const dataset: Dataset = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
    import {starterFixture} from './tests/fixtures.ts';
    import {fromTables} from './src/import/workbook.ts';
    const d=await starterFixture();
    Object.assign(d.tables.ModelContext[0],{RBSlots:0,WRSlots:0,TESlots:0,KSlots:0,DSTSlots:0,FlexSlots:0,BenchSlots:3});
    // Non-QB players remain legal reserves after narrowing this fixture to one starting QB.
    d.tables.ModelRosters.filter(r=>![100,101,200].includes(Number(r.PlayerID))).forEach(r=>r.LineupSlotID=20);
    const p=d.tables.ModelPlayers.find(p=>p.PlayerID===200);
    Object.assign(p,{ActualPoints:175,Actual_PPG:35,Last3_PPG:35,ScoreSD:0,ESPN_Projected_PPG:35,ESPN_Projected_Total:595});
    d.tables.ModelHistory.filter(h=>h.PlayerID===200).forEach(h=>h.Points=35);
    process.stdout.write(JSON.stringify(await fromTables(d.tables,d.settings)));
  `,
      ],
      { encoding: "utf8" },
    ),
  );
  const state = initialState(dataset);
  // The stress tool always optimizes both rosters even when the ordinary analyzer uses marked starters.
  state.filters.tradeLineupBasis = "marked-starters";
  state.draft = { teamA: "1", teamB: "2", give: ["101"], get: ["200"] };
  const workspace: Workspace = {
    owner: "local",
    dataset,
    state,
    datasetRevision: 0,
    stateRevision: 0,
    pendingDataset: false,
    pendingState: false,
    requestId: "stress-test",
    stateRequestId: "stress-test",
  };
  await page.goto("./");
  await page.evaluate(async (value) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("fantasy-football-lab", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("current");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("current", "readwrite");
      t.objectStore("current").put(value, "local");
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
    db.close();
  }, workspace);
  await page.reload();
  await openLegacyTrades(page, "Manual analyzer");
  await openTradeDetails(page);
  const stress = page.locator(".trade-stress-test");
  await expect(stress).toBeVisible();
  await expect(stress).not.toHaveAttribute("open", "");
  const normal = page.getByRole("region", { name: "Trade scoring summary" });
  await expect(normal).toContainText("35.00");
  const original = await normal.innerText();
  await openTradeDetails(page);
  await stress.locator(":scope > summary").click();

  // A blank input is not zero; editing hides old results immediately and preserves the normal score strip.
  await stress
    .getByRole("button", { name: "Run stress test", exact: true })
    .click();
  await expect(stress.getByRole("alert")).toContainText("Select at least one");
  await stress
    .getByRole("checkbox", { name: "Adjust Incoming QB", exact: true })
    .check();
  const input = stress.getByRole("spinbutton", {
    name: "Assumed PPG for Incoming QB",
    exact: true,
  });
  await input.fill("");
  await stress
    .getByRole("button", { name: "Run stress test", exact: true })
    .click();
  await expect(stress.getByRole("alert")).toContainText("valid assumed PPG");
  await input.fill("25");
  await stress
    .getByRole("button", { name: "Run stress test", exact: true })
    .click();
  const table = stress.getByRole("table", {
    name: "Stress-test scoring comparison",
  });
  await expect(table).toBeVisible();
  await expect(table.getByRole("row", { name: /Current model/ })).toContainText(
    "+5.00",
  );
  await expect(
    table.getByRole("row", { name: /Your assumptions/ }),
  ).toContainText("-5.00");
  await expect(stress).toContainText("30.00 PPG");
  expect(await normal.innerText()).toBe(original);
  await stress
    .getByRole("combobox", { name: "Scoring reference for Incoming QB" })
    .selectOption({ label: "Recent actual PPG: 35.00" });
  await expect(table).not.toBeVisible();
  await input.fill("25");
  await stress
    .getByRole("button", { name: "Run stress test", exact: true })
    .click();
  await expect(table).toBeVisible();
  await stress
    .getByRole("button", { name: "Download stress-test debug" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: test.info().outputPath("stress-test-desktop.png"),
  });

  // Export the completed run, then ensure the existing saved-trade path restores inputs without restoring stale results.
  const download = page.waitForEvent("download");
  await stress
    .getByRole("button", { name: "Download stress-test debug" })
    .click();
  const file = await download;
  const report = JSON.parse(await fs.readFile((await file.path())!, "utf8"));
  expect(report.assumptions.adjustments).toEqual([{ player: "200", ppg: 25 }]);
  expect(report.result.scenario.own.gain).toBeCloseTo(-5);
  await page
    .getByRole("button", { name: "Save current trade", exact: true })
    .click();
  await expect(
    page.getByText(/Trade saved\. Duplicate packages/),
  ).toBeVisible();
  await openSavedTrades(page);
  const saved = page
    .locator(".trade-saved-drawer")
    .locator("details")
    .filter({
      has: page.locator("button").filter({ hasText: "Load saved trade" }),
    })
    .first();
  await saved.locator(":scope > summary").click();
  await expect(saved).toContainText("Stress-test assumptions:");
  await input.fill("15");
  await saved.getByRole("button", { name: "Load saved trade" }).click();
  await openTradeDetails(page);
  await stress.locator(":scope > summary").click();
  await expect(
    stress.getByRole("spinbutton", { name: "Assumed PPG for Incoming QB" }),
  ).toHaveValue("25");
  await expect(table).not.toBeVisible();
  await expect(stress).toContainText("Saved assumptions restored");
  await stress
    .getByRole("button", { name: "Run stress test", exact: true })
    .click();
  await expect(table).toBeVisible();
  // A full page reload retains only the saved recipe, never a stale calculated scenario.
  await page.reload();
  await openSavedTrades(page);
  await saved.locator(":scope > summary").click();
  await saved.getByRole("button", { name: "Load saved trade" }).click();
  await openTradeDetails(page);
  await stress.locator(":scope > summary").click();
  await expect(input).toHaveValue("25");
  await expect(table).not.toBeVisible();
  await stress
    .getByRole("button", { name: "Run stress test", exact: true })
    .click();
  await expect(table).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await stress.screenshot({
    path: test.info().outputPath("stress-test-mobile.png"),
  });
  expect(errors).toEqual([]);
});
