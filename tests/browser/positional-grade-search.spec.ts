import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import {
  initialState,
  type Dataset,
  type Workspace,
} from "../../src/domain/contracts";
import { openTradeDetails, openTradeFilters, openLegacyTrades } from "./trade-workspace-helpers";

// Capture a screenshot into test-results/ and copy it into the visual artifact directory
async function captureScreenshot(page: Page, filename: string) {
  mkdirSync("test-results", { recursive: true });
  const localPath = `test-results/${filename}`;
  const artifactPath = `C:/Users/israe/.gemini/antigravity/brain/2eea40f1-347c-49f2-855d-0f59973c47d2/${filename}`;
  await page.screenshot({ path: localPath, fullPage: true });
  try {
    copyFileSync(localPath, artifactPath);
  } catch {
    // Artifact copy is optional in detached testing environments
  }
}

// Seed synthetic league workspace directly into IndexedDB, supporting starter or chain fixtures
async function seedWorkspace(
  page: Page,
  fixtureType: "starter" | "chain" = "starter",
) {
  // Execute tsx synchronously to build the synthetic dataset without hitting external services
  const dataset: Dataset = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        fixtureType === "starter"
          ? `import {tradeSearchFixture} from './tests/fixtures.ts';
             const d = await tradeSearchFixture();
             process.stdout.write(JSON.stringify(d));`
          : `import {fairChainFixture} from './tests/chain-fixture.ts';
             const d = await fairChainFixture();
             process.stdout.write(JSON.stringify(d));`,
      ],
      { encoding: "utf8" },
    ),
  );

  // Construct initial workspace state with default draft offer
  const workspace: Workspace = {
    owner: "local",
    dataset,
    state: {
      ...initialState(dataset),
      draft: {
        teamA: "1",
        teamB: "2",
        give: fixtureType === "starter" ? ["101"] : ["3", "8", "9"],
        get: [],
      },
    },
    datasetRevision: 0,
    stateRevision: 0,
    pendingDataset: false,
    pendingState: false,
    requestId: "test-grade-search",
    stateRequestId: "test-grade-search",
  };

  // Block external network requests during browser test run
  await page.route("https://a.espncdn.com/**", (route) => route.abort());

  // Navigate to root, initialize IndexedDB with workspace, and reload to pick up seeded state
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
  // Navigate to Trade Analyzer and expand base trade filters
  await openLegacyTrades(page);
  await openTradeDetails(page);
  return dataset;
}

test.describe("Positional Grade Search E2E", () => {
  // Test 1: Find Trades with positional grade goals, applied to the retained results without a new search.
  test("Find Trades renders and applies positional grade impact goals", async ({
    page,
  }) => {
    // Seed standard starter fixture where all standard positions are active
    await seedWorkspace(page, "starter");
    await expect(page.locator(".gd-find")).toBeVisible();
    await page.getByRole("button", { name: "Search all trades", exact: true }).click();
    await expect(page.getByText(/one-for-ones checked/)).toBeVisible({ timeout: 60000 });
    const topRows = page.locator(".gd-res > .gd-res-group > .gd-res-row");
    await expect(topRows.first()).toBeVisible();
    // Let the streamed list settle before measuring it.
    const shown = async () => Number((await page.getByText(/^[\d,]+ of [\d,]+ trades$/).innerText()).match(/\d+/)![0]);
    let before = await shown();
    await expect.poll(async () => { const now = await shown(); const same = now === before; before = now; return same; }, { intervals: [1500], timeout: 60000 }).toBe(true);

    // The Grades filter starts with no goals.
    await page.locator("details", { has: page.locator("summary", { hasText: /^Grades/ }) }).locator("> summary").click();
    const goals = page.locator(".gd-broad-filter-panel .gd-goals");
    await expect(goals).toContainText("No positional grade goals configured.");
    await goals.getByRole("button", { name: "+ Add goal", exact: true }).click();

    // Configure the rule: Your team -> WR -> Upgrade >= 1 step
    const team = goals.getByRole("combobox", { name: "Team", exact: true });
    const position = goals.getByRole("combobox", { name: "Position", exact: true });
    const steps = goals.getByRole("combobox", { name: "Grade steps", exact: true });
    await team.selectOption("own");
    await expect(position.locator('option[value="OVERALL"]')).toHaveText("Overall (net steps)");
    await position.selectOption("WR");
    await steps.selectOption("1");
    await expect(goals.locator(".gd-goal-line")).toContainText(/^Your WR/);

    // The list narrows at once: no new search ran, and every row left shows the WR upgrade as a grade-step chip.
    await expect(page.getByText(/one-for-ones checked/)).toHaveCount(1);
    await expect.poll(async () => Number((await page.getByText(/^[\d,]+ of [\d,]+ trades$/).innerText()).match(/\d+/)![0])).toBeLessThanOrEqual(before);
    await expect(topRows.first()).toBeVisible();
    const rows = await topRows.count();
    for (let i = 0; i < rows; i++) {
      const chip = topRows.nth(i).locator('.gd-chipg[data-tone="positive"]').filter({ hasText: "WR" }).first();
      await expect(chip).toBeVisible();
      await expect(chip).toContainText("→");
    }
    await expect(page.locator('.gd-hides[data-filter="gradeGoals"]')).toBeVisible();

    await captureScreenshot(page, "find-trades-grade-goals.png");
  });

  // Test 2: Chain Planner with Positional Grade Goals
  test("Chain Planner renders and applies positional grade impact goals with filtered starter positions", async ({
    page,
  }) => {
    // Seed fair chain fixture where starter slots are restricted to RB, WR, TE (QBSlots = 0, FlexSlots = 0)
    await seedWorkspace(page, "chain");
    await page.getByRole("tab", { name: "Chain planner", exact: true }).click();
    await expect(page.locator(".gd-chain")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Two-trade chain planner", exact: true }),
    ).toBeVisible();

    const legs = page.getByRole("region", { name: "Per-trade settings" });
    const expectedPositions = ["RB", "WR", "TE", "Overall (net steps)"];

    // Each trade has its own goals: configure Trade 1, then Trade 2.
    for (const [name, button, pick, steps] of [
      ["First trade", "Trade 1 settings", "TE", "0"],
      ["Second trade", "Trade 2 settings", "WR", "1"],
    ] as const) {
      await legs.getByRole("button", { name: button }).click();
      await openTradeFilters(page, "Chain");
      const goals = legs.getByRole("region", { name: `${name} positional grade goals` });
      await goals.getByRole("button", { name: "+ Add goal", exact: true }).click();
      // Positions are limited to the starter positions this league uses.
      const position = goals.getByRole("combobox", { name: `${name}: Position`, exact: true });
      expect(await position.locator("option").allTextContents()).toEqual(expectedPositions);
      await position.selectOption(pick);
      await goals.getByRole("combobox", { name: `${name}: Grade steps`, exact: true }).selectOption(steps);
      // The group's summary counts the goal.
      await expect(
        legs.locator("details.gd-fg").filter({
          has: page.locator(".gd-fg-title", { hasText: /^Positional grade goals$/ }),
        }).locator("> summary .gd-fs"),
      ).toContainText("1 on");

      // Bound the sizes and teams so the search is quick and real.
      await legs
        .getByRole("combobox", { name: `${name} offer maximum`, exact: true })
        .selectOption(name === "Second trade" ? "2" : "1");
      if (name === "Second trade")
        await legs
          .getByRole("combobox", { name: `${name} offer minimum`, exact: true })
          .selectOption("2");
      await legs
        .getByRole("combobox", { name: `${name} receive maximum`, exact: true })
        .selectOption("1");
      await legs
        .getByRole("checkbox", { name: `Override ${name.toLowerCase()} teams`, exact: true })
        .check();
      await legs.getByRole("button", { name: "Clear selection", exact: true }).click();
      await legs
        .getByRole("checkbox", {
          name: `${name} team: ${name === "First trade" ? "Chain B" : "Chain C"}`,
          exact: true,
        })
        .check();
    }

    const run = page.getByRole("button", { name: "Run chain trade search", exact: true });
    await expect(run).toBeEnabled();
    await run.click();
    await expect(page.getByText(/[1-9][0-9]* qualifying chains? found/)).toBeVisible({
      timeout: 25000,
    });

    await captureScreenshot(page, "chain-planner-grade-goals.png");
  });
});
