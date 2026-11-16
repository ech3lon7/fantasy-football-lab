import { openTradeDetails, openTradeFilters, openLegacyTrades } from "./trade-workspace-helpers";
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  initialState,
  type Dataset,
  type Workspace,
} from "../../src/domain/contracts";

// Load the normal production app with a synthetic source disagreement, never a real workbook or account.
async function seed(page: Page, missing = false) {
  const dataset: Dataset = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import {surfaceFixture} from './tests/surface-fixture.ts';import {fromTables} from './src/import/workbook.ts';const d=await surfaceFixture();if(${missing})d.tables.ModelPlayers.find(p=>p.PlayerID===2).Current_Week_Projection=null;process.stdout.write(JSON.stringify(await fromTables(d.tables,d.settings)));`,
      ],
      { encoding: "utf8" },
    ),
  );
  const w: Workspace = {
    owner: "local",
    dataset,
    state: {
      ...initialState(dataset),
      draft: { teamA: "1", teamB: "2", give: ["1"], get: [] },
    },
    datasetRevision: 0,
    stateRevision: 0,
    pendingDataset: false,
    pendingState: false,
    requestId: crypto.randomUUID(),
    stateRequestId: crypto.randomUUID(),
  };
  // Simulate previously saved legacy controls; they must not silently filter this restored search.
  const legacy = { metric: "both", minimum: 9999, requireValueTests: true };
  w.state.filters.tradeSearchSettings = JSON.stringify({
    version: 1,
    standard: {
      query: {
        teamA: "1",
        give: ["1"],
        count: 1,
        below: 5,
        above: 5,
        indexMode: "automatic",
        discovery: { target: "2" },
        goal: "surface",
        surface: legacy,
      },
      controls: { goal: "surface", surface: legacy },
    },
  });
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
  }, w);
  await page.reload();
  await openLegacyTrades(page);
  await openTradeDetails(page);
  return page.locator(".gd-find");
}

// Read persistence only after the normal save queue commits, keeping the source and roster checkpoint separate from search criteria.
async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("fantasy-football-lab", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<Workspace>((resolve, reject) => {
        const r = db.transaction("current").objectStore("current").get("local");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });
}

// The old minimum and preset cannot hide trades after preferences or saved trades are restored.
test("retires legacy surface restrictions from preferences and saved trades", async ({
  page,
}) => {
  const panel = await seed(page);
  const original = await stored(page);
  // The old saved query still loads, but its settings are not copied into filters (trade-search fixes F7): a one-time toast says so,
  // replacing the old persistent line that listed the ignored settings, and they are not search controls any more.
  await expect(page.getByText(/Your old Find trades settings don't apply to the new search, so filters start at the defaults/)).toBeVisible();
  for (const retired of ["Enable Surface Trading", "Search goal", "Find trades with surface appeal", "Minimum apparent lineup gain"])
    await expect(panel.getByText(retired, { exact: false }).filter({ visible: true })).toHaveCount(0);
  await page.getByRole("dialog", { name: "Trade filters" }).getByRole("button", { name: "Search", exact: true }).click();
  // The old minimum of 9999 cannot hide anything.
  await expect(panel.getByText(/[\d,]+ ideas · [\d,]+ trades/).first()).toBeVisible({ timeout: 60000 });
  const row = panel.locator(".gd-res > .gd-res-group > .gd-res-row").first();
  await row.getByRole("button", { name: /^Save trade/ }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(
          (await stored(page)).state.filters.savedTrades ?? '{"trades":[]}',
        ).trades.length,
    )
    .toBe(1);
  let workspace = await stored(page);
  const saved = JSON.parse(workspace.state.filters.savedTrades);
  expect(saved.trades[0].query.surface).toBeUndefined();
  const summary = saved.trades[0].original;
  saved.trades[0].query.surface = {
    metric: "both",
    minimum: 9999,
    requireValueTests: true,
  };
  saved.trades[0].query.goal = "surface";
  workspace.state.filters.savedTrades = JSON.stringify(saved);
  // Reinsert a historical saved recipe through IndexedDB, then restore it through the normal Load saved trade action.
  await page.evaluate(async (value) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("fantasy-football-lab", 1);
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("current", "readwrite");
      tx.objectStore("current").put(value, "local");
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, workspace);
  await page.reload();
  await openLegacyTrades(page);
  await openTradeDetails(page);
  const card = page
    .locator("details:not(.trade-saved-drawer):not(.trade-full-analysis)")
    .filter({
      has: page.locator("summary", {
        // The search now ranks a different package first (a two-player offer), so the saved card is matched by what it gets.
        hasText: "→ Chain Bridge WR",
      }),
    });
  await card.locator(":scope > summary").click();
  await card
    .getByRole("button", { name: "Load saved trade", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Trade filters" }).getByRole("button", { name: "Search", exact: true }).click();
  await expect(panel.getByText(/[\d,]+ ideas · [\d,]+ trades/).first()).toBeVisible({ timeout: 60000 });
  workspace = await stored(page);
  expect(workspace.dataset).toEqual(original.dataset);
  expect(
    JSON.parse(workspace.state.filters.savedTrades).trades[0].original,
  ).toEqual(summary);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
});

// Surface Trading is no longer a search option: only the Manual analyzer keeps its one optional control, and it starts off.
test("only the Manual analyzer has a Surface Trading control; Find trades and the Chain planner have none", async ({
  page,
}) => {
  const panel = await seed(page, true);
  const control = page.getByRole("checkbox", { name: /Surface Trading/ }).filter({ visible: true });
  await page.getByRole("dialog", { name: "Trade filters" }).getByRole("button", { name: "Search", exact: true }).click();
  await expect(panel.getByText(/[\d,]+ ideas · [\d,]+ trades/).first()).toBeVisible({ timeout: 60000 });
  await expect(control).toHaveCount(0);
  await page.getByRole("tab", { name: "Chain planner" }).click();
  await openTradeFilters(page, "Chain");
  await expect(control).toHaveCount(0);
  await page.getByRole("button", { name: "Trade 2 settings" }).click();
  await openTradeFilters(page, "Chain");
  await expect(control).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /surface appeal/i })).toHaveCount(0);
  // The Manual analyzer's one control is present and starts off.
  await page.getByRole("tab", { name: "Manual analyzer" }).click();
  await openTradeFilters(page, "Manual");
  await expect(page.getByRole("checkbox", { name: "Enable Surface Trading", exact: true })).not.toBeChecked();
});
