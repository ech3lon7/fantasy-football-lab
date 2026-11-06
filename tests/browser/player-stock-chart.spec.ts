import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  initialState,
  type Dataset,
  type Workspace,
} from "../../src/domain/contracts";

// Exercise the built app and real workers using synthetic league data
async function seed(page: Page) {
  const dataset: Dataset = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import {starterFixture} from './tests/fixtures.ts';
         const d = await starterFixture();
         process.stdout.write(JSON.stringify(d));`,
      ],
      { encoding: "utf8" },
    ),
  );
  const workspace: Workspace = {
    owner: "local",
    dataset,
    state: {
      ...initialState(dataset),
      draft: { teamA: "1", teamB: "2", give: ["101"], get: ["200"] },
    },
    datasetRevision: 0,
    stateRevision: 0,
    pendingDataset: false,
    pendingState: false,
    requestId: "test",
    stateRequestId: "test",
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
  }, workspace);
  await page.reload();
  return dataset;
}

test("player stock chart renders on full player page and stock pill displays in popover", async ({
  page,
}) => {
  await seed(page);

  // 1. Full Player Page Verification
  await page.goto("./#/player/100");
  await expect(page.getByRole("heading", { name: "Main QB" })).toBeVisible();

  // Stock status pill in heading
  const headingPill = page.locator(".player-heading .stock-trend-pill");
  await expect(headingPill).toBeVisible();

  // Stock chart panel
  const chartPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Performance momentum & moving averages" }),
  });
  await expect(chartPanel).toBeVisible();

  const chart = chartPanel.locator(".player-stock-chart-container");
  await expect(chart).toBeVisible();

  // SVG canvas, lines and volume bars
  await expect(chart.locator("svg.player-stock-svg")).toBeVisible();
  await expect(chart.locator(".stock-fast-ma-line")).toBeAttached();
  await expect(chart.locator(".stock-slow-ma-line")).toBeAttached();
  await expect(chart.locator(".stock-points-line")).toBeAttached();
  await expect(chart.locator(".stock-volume-bar").first()).toBeAttached();

  // Hover over first hit area to verify tooltip
  const hitArea = chart.locator(".stock-hit-area").first();
  await hitArea.hover();
  const tooltip = chart.locator(".stock-tooltip-popover");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Week");

  // Capture screenshot of the full stock chart on player page
  await chartPanel.screenshot({
    path: "C:/Users/israe/.gemini/antigravity/brain/2eea40f1-347c-49f2-855d-0f59973c47d2/player-stock-chart.png",
  });

  // 2. Player Popover Verification
  await page.goto("./#/overview");
  // Click on player link to trigger popover
  const playerNameLink = page.locator("a.player-link").filter({ hasText: "Main QB" }).first();
  await playerNameLink.click();

  const popover = page.locator("#player-popover");
  await expect(popover).toBeVisible();
  const popoverPill = popover.locator(".stock-trend-pill");
  await expect(popoverPill).toBeVisible();

  // Capture screenshot of player popover showing the stock momentum pill
  await popover.screenshot({
    path: "C:/Users/israe/.gemini/antigravity/brain/2eea40f1-347c-49f2-855d-0f59973c47d2/player-popover-stock-pill.png",
  });
});
