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

  // SVG canvas, lines, volume bars, and gold-dashed league average line
  await expect(chart.locator("svg.player-stock-svg")).toBeVisible();
  await expect(chart.locator(".stock-fast-ma-line")).toBeAttached();
  await expect(chart.locator(".stock-slow-ma-line")).toBeAttached();
  await expect(chart.locator(".stock-points-line")).toBeAttached();
  await expect(chart.locator(".stock-volume-bar").first()).toBeAttached();
  await expect(chart.locator(".stock-league-avg-line")).toBeAttached();
  await expect(chart.locator(".stock-target-vol-line")).toBeAttached();
  await expect(chart.locator(".legend-item.target-benchmark")).toContainText("35 Pass Att.");
  await expect(chart.locator(".stock-target-vol-label")).toContainText("35 Pass Att.");

  // Verify RB and WR volume benchmarks (18 Touches for RB, 7 Targets for WR)
  await page.goto("./#/player/1");
  const rbChart = page.locator(".player-stock-chart-container");
  await expect(rbChart.locator(".stock-target-vol-line")).toBeAttached();
  await expect(rbChart.locator(".legend-item.target-benchmark")).toContainText("18 Touches");
  await expect(rbChart.locator(".stock-target-vol-label")).toContainText("18 Touches");

  await page.goto("./#/player/2");
  const wrChart = page.locator(".player-stock-chart-container");
  await expect(wrChart.locator(".stock-target-vol-line")).toBeAttached();
  await expect(wrChart.locator(".legend-item.target-benchmark")).toContainText("7 Targets");
  await expect(wrChart.locator(".stock-target-vol-label")).toContainText("7 Targets");

  // Navigate back to Main QB for screenshot
  await page.goto("./#/player/100");

  // Verify "Completed-game scoring" is completely removed
  await expect(page.getByText("Completed-game scoring")).toHaveCount(0);

  // Hover over first hit area to verify tooltip positions dynamically
  const hitArea = chart.locator(".stock-hit-area").first();
  await hitArea.hover();
  const tooltip = chart.locator(".stock-tooltip-popover");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Week");
  // Check that the tooltip has dynamic left and top positioning
  const tooltipStyle = await tooltip.getAttribute("style");
  expect(tooltipStyle).toContain("left:");
  expect(tooltipStyle).toContain("top:");

  // Move mouse away to empty space and verify tooltip disappears
  await page.mouse.move(10, 10);
  await expect(tooltip).toHaveCount(0);

  // Hover again to keep tooltip visible for screenshot
  await hitArea.hover();
  await expect(tooltip).toBeVisible();

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


test("gem screener renders colored MA values next to player names and supports golden cross filter", async ({
  page,
}) => {
  await seed(page);

  // Navigate to Gem Screener
  await page.goto("./#/gems");
  await expect(page.getByRole("heading", { name: "Gem screener" })).toBeVisible();

  // Verify colored MA stock pills render right next to player names in the screener table
  const screenerPills = page.locator("a.player-link .stock-trend-pill");
  await expect(screenerPills.first()).toBeVisible();

  // Verify the "Golden cross only" filter checkbox exists
  const goldenCrossCheckbox = page.getByRole("checkbox", {
    name: "Golden cross only",
    exact: true,
  });
  await expect(goldenCrossCheckbox).toBeVisible();

  // Check Golden cross only filter and apply
  await goldenCrossCheckbox.check();
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();

  // Verify active filter chip for Golden cross appears
  const activeChip = page.locator(
    'button[aria-label="Remove bullish MA crossover filter"]',
  );
  await expect(activeChip).toBeVisible();
  await expect(activeChip).toContainText("Golden cross only");

  // Remove the chip
  await activeChip.click();
  await expect(activeChip).toHaveCount(0);
});
