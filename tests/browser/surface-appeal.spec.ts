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
  await page.getByRole("link", { name: "Trade analyzer", exact: true }).click();
  const panel = page
    .locator("section.panel")
    .filter({
      has: page.getByRole("heading", {
        name: "Find matching trades",
        exact: true,
      }),
    });
  await expect(
    panel.getByRole("checkbox", {
      name: "Find trades with surface appeal",
      exact: true,
    }),
  ).not.toBeChecked();
  await panel
    .getByRole("combobox", { name: "Search goal", exact: true })
    .selectOption("surface");
  await panel.getByText("Advanced search controls", { exact: true }).click();
  await panel
    .getByRole("checkbox", { name: "Create package", exact: true })
    .uncheck();
  return panel;
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

// A genuine model/source disagreement remains discoverable, its exact sources are inspectable, and optional strict value gates are honored.
test("finds surface-appeal trades, explains source lineups, and restores saved controls", async ({
  page,
}) => {
  const panel = await seed(page);
  const original = await stored(page);
  await expect(
    panel.getByRole("checkbox", {
      name: "Require both model value tests",
      exact: true,
    }),
  ).not.toBeChecked();
  await panel.getByRole("button", { name: "Search", exact: true }).click();
  await expect(panel.getByText(/1 index matches/)).toBeVisible();
  const row = panel.locator("table.trade-search-results > tbody > tr[data-trade-result]");
  await expect(row).toHaveCount(1);
  await expect(
    row.getByRole("cell", { name: "+12.50", exact: true }),
  ).toBeVisible();
  await expect(
    row.getByRole("cell", { name: "-2.50", exact: true }),
  ).toBeVisible();
  await expect(row.locator(":scope > td.fact")).toHaveText("+8.00");
  await expect(row.locator(":scope > td.projection")).toHaveText("+3.00");
  await expect(row.getByText("FAIL", { exact: true })).toHaveCount(2);
  await row.getByText("Trade details", { exact: true }).click();
  const evidence = row.getByLabel("Surface appeal evidence", { exact: true });
  await expect(evidence).toContainText("Season-average lineup (PPG)");
  await expect(
    evidence.getByRole("cell", { name: "22.00", exact: true }),
  ).toBeVisible();
  await expect(
    evidence.getByRole("cell", { name: "27.00", exact: true }),
  ).toBeVisible();
  await evidence
    .getByText("Surface lineup player comparisons", { exact: true })
    .click();
  await expect(evidence).toContainText("Chain Starter RB");
  await expect(evidence).toContainText("0.00 (unfilled)");
  await row.getByRole("button", { name: "Save trade", exact: true }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(
          (await stored(page)).state.filters.savedTrades ?? '{"trades":[]}',
        ).trades.length,
    )
    .toBe(1);
  const saved = JSON.parse((await stored(page)).state.filters.savedTrades)
    .trades[0];
  expect(saved.query.surface).toEqual({
    metric: "both",
    minimum: 0,
    requireValueTests: false,
  });
  expect((await stored(page)).dataset).toEqual(original.dataset);
  await panel
    .getByRole("checkbox", {
      name: "Require both model value tests",
      exact: true,
    })
    .check();
  await expect(panel.getByText(/Search inputs changed/)).toBeVisible();
  await panel.getByRole("button", { name: "Search", exact: true }).click();
  await expect(panel.getByText(/0 index matches/)).toBeVisible();
  await panel.getByText("Why trades were excluded", { exact: true }).click();
  await expect(
    panel.getByText(/Trades excluded by surface appeal/),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(
    panel.getByRole("checkbox", {
      name: "Find trades with surface appeal",
      exact: true,
    }),
  ).not.toBeChecked();
  const card = page
    .locator("details")
    .filter({
      has: page.locator("summary", {
        hasText: "Chain Starter RB → Chain Bridge WR",
      }),
    });
  await card.locator(":scope > summary").click();
  await card
    .getByRole("button", { name: "Load saved trade", exact: true })
    .click();
  await expect(
    panel.getByRole("checkbox", {
      name: "Find trades with surface appeal",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    panel.getByRole("combobox", { name: "Surface metric", exact: true }),
  ).toHaveValue("both");
  await expect(
    panel.getByRole("checkbox", {
      name: "Require both model value tests",
      exact: true,
    }),
  ).not.toBeChecked();
  await page
    .getByRole("heading", { name: "Find matching trades", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/surface-appeal-controls.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
});

// Missing ESPN data cannot become a zero-based bargain; selecting Average alone explicitly changes the required source.
test("keeps missing projections unavailable and filters each selected source independently", async ({
  page,
}) => {
  const panel = await seed(page, true);
  await panel
    .getByRole("checkbox", {
      name: "Show near misses and adjustments",
      exact: true,
    })
    .check();
  await panel.getByRole("button", { name: "Search", exact: true }).click();
  await expect(panel.getByText(/0 index matches/)).toBeVisible();
  await panel.getByText(/Near misses and possible adjustments/).click();
  await expect(
    panel
      .getByText("Their ESPN weekly-projection lineup gain is unavailable.", {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await expect(
    panel
      .getByLabel("Surface appeal evidence")
      .first()
      .getByRole("cell", { name: "Unavailable", exact: true })
      .first(),
  ).toBeVisible();
  await panel
    .getByRole("combobox", { name: "Surface metric", exact: true })
    .selectOption("average");
  await panel
    .getByRole("spinbutton", {
      name: "Minimum apparent lineup gain",
      exact: true,
    })
    .fill("8.1");
  await panel.getByRole("button", { name: "Search", exact: true }).click();
  await expect(panel.getByText(/0 index matches/)).toBeVisible();
  await panel
    .getByRole("spinbutton", {
      name: "Minimum apparent lineup gain",
      exact: true,
    })
    .fill("8");
  await panel.getByRole("button", { name: "Search", exact: true }).click();
  await expect(panel.getByText(/1 index matches/)).toBeVisible();
  const row = panel.locator("table.trade-search-results > tbody > tr[data-trade-result]");
  await expect(row.locator(":scope > td.fact")).toHaveText("+8.00");
  await expect(row.locator(":scope > td.projection")).toHaveText("Unavailable");
});
