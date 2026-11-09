import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import {
  initialState,
  type Dataset,
  type Workspace,
} from "../../src/domain/contracts";
import { openTradeDetails, openTradeFilters } from "./trade-workspace-helpers";

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
  await page.getByRole("link", { name: "Trade analyzer", exact: true }).click();
  await openTradeDetails(page);
  await openTradeFilters(page);
  return dataset;
}

test.describe("Positional Grade Search E2E", () => {
  // Test 1: Find Trades with Positional Grade Goals
  test("Find Trades renders and applies positional grade impact goals", async ({
    page,
  }) => {
    // Seed standard starter fixture where all standard positions are active
    await seedWorkspace(page, "starter");

    // Verify Find matching trades heading is visible
    await expect(
      page.getByRole("heading", { name: "Find matching trades", exact: true }),
    ).toBeVisible();

    // Locate the "Team needs" filter group within standard trade filters and ensure it is expanded
    const teamNeedsGroup = page.locator(
      '#standard-trade-filters details.trade-filter-category[data-category="Team needs"]',
    );
    await expect(teamNeedsGroup).toBeVisible();

    if ((await teamNeedsGroup.getAttribute("open")) === null) {
      await teamNeedsGroup.locator(":scope > summary").click();
    }
    await expect(teamNeedsGroup).toHaveAttribute("open", "");

    // Verify Team needs preview displays all 7 positional grade tiles
    const previewTiles = teamNeedsGroup.locator(".trade-grade-tiles .trade-grade-tile");
    await expect(previewTiles).toHaveCount(7);
    for (const pos of ["QB", "RB", "WR", "TE", "FLEX", "K", "D/ST"]) {
      await expect(teamNeedsGroup.locator(".trade-grade-tiles").getByText(pos, { exact: true })).toBeVisible();
    }

    // Verify Positional Grade Goals controls container renders inside Team needs
    const gradeImpactControls = teamNeedsGroup.locator(
      ".grade-impact-container",
    );
    await expect(gradeImpactControls).toBeVisible();
    await expect(
      gradeImpactControls.getByText("Positional Grade Goals", { exact: true }),
    ).toBeVisible();

    // Empty state should be visible before adding any goals
    await expect(
      gradeImpactControls.locator(".grade-impact-empty"),
    ).toBeVisible();
    await expect(
      gradeImpactControls.locator(".grade-impact-empty"),
    ).toContainText("No positional grade goals configured.");

    // Click "+ Add Positional Goal" button
    const addGoalBtn = gradeImpactControls.getByRole("button", {
      name: "+ Add Positional Goal",
      exact: true,
    });
    await expect(addGoalBtn).toBeVisible();
    await addGoalBtn.click();

    // Locate the added rule row
    const ruleRow = gradeImpactControls.locator(".grade-impact-row").first();
    await expect(ruleRow).toBeVisible();

    // Configure the rule: Your team -> WR -> Upgrade ≥ 1 step
    const teamSelect = ruleRow.locator(
      'select[aria-label="Standard search grade goal 1 team"]',
    );
    const posSelect = ruleRow.locator(
      'select[aria-label="Standard search grade goal 1 position"]',
    );
    const targetSelect = ruleRow.locator(
      'select[aria-label="Standard search grade goal 1 target"]',
    );

    await expect(teamSelect).toBeVisible();
    await teamSelect.selectOption("own");

    await expect(posSelect).toBeVisible();
    await expect(posSelect.locator('option[value="OVERALL"]')).toHaveText("Overall (Net)");
    await posSelect.selectOption("WR");

    await expect(targetSelect).toBeVisible();
    // Value 1 corresponds to "Upgrade ≥ 1 step"
    await targetSelect.selectOption("1");

    // Verify active filter chip appears with expected text
    const activeChip = page.locator(
      '.active-filter-chips button[aria-label="Remove Grade goal: Your WR (upgrade ≥ 1 step)"]',
    );
    await expect(activeChip).toBeVisible();
    await expect(activeChip).toContainText("Grade goal: Your WR (upgrade ≥ 1 step)");

    // Verify standard search execution button is enabled and click to run search
    const runSearchBtn = page.getByRole("button", {
      name: "Run standard trade search",
      exact: true,
    });
    await expect(runSearchBtn).toBeEnabled();
    await runSearchBtn.click();

    // Await search results: team header toggle button
    const teamHeaderBtn = page.locator("tbody > tr > th button").first();
    await expect(teamHeaderBtn).toBeVisible({ timeout: 20000 });
    // Expand team results if collapsed
    if ((await teamHeaderBtn.getAttribute("aria-expanded")) !== "true") {
      await teamHeaderBtn.click();
    }

    // Verify candidate trade result row is rendered
    const resultRow = page.locator("tr[data-trade-result]").first();
    await expect(resultRow).toBeVisible();

    // Verify that the candidate row displays the position grade chip with WR upgrade transition
    const gradeChip = page.locator(".position-grade-chip.good").first();
    await expect(gradeChip).toBeVisible();
    await expect(gradeChip).toContainText("WR");
    await expect(gradeChip.locator(".pos-grades")).toContainText("→");

    // Capture screenshot of the configured Find Trades positional grade goals and matching result row
    await captureScreenshot(page, "find-trades-grade-goals.png");
  });

  // Test 2: Chain Planner with Positional Grade Goals
  test("Chain Planner renders and applies positional grade impact goals with filtered starter positions", async ({
    page,
  }) => {
    // Seed fair chain fixture where starter slots are restricted to RB, WR, TE (QBSlots = 0, FlexSlots = 0)
    await seedWorkspace(page, "chain");

    // Switch to Chain Planner mode in the Trade Analyzer workspace
    const chainTabBtn = page.getByRole("button", {
      name: "Two-trade chain planner",
      exact: true,
    });
    await expect(chainTabBtn).toBeVisible();
    await chainTabBtn.click();

    // Verify Chain Planner heading is visible
    await expect(
      page.getByRole("heading", {
        name: "Two-trade chain planner",
        exact: true,
      }),
    ).toBeVisible();

    // Open Chain filter drawer
    await openTradeFilters(page, "Chain");

    // Locate Leg 1 ("First trade") and Leg 2 ("Second trade") control sections
    const leg1 = page
      .locator("details.trade-chain-leg")
      .filter({ hasText: "First trade" });
    const leg2 = page
      .locator("details.trade-chain-leg")
      .filter({ hasText: "Second trade" });

    await expect(leg1).toBeVisible();
    await expect(leg2).toBeVisible();

    // Ensure Leg 1 and Leg 2 disclosures are open
    if ((await leg1.getAttribute("open")) === null) {
      await leg1.locator(":scope > summary").click();
    }
    if ((await leg2.getAttribute("open")) === null) {
      await leg2.locator(":scope > summary").click();
    }
    await expect(leg1).toHaveAttribute("open", "");
    await expect(leg2).toHaveAttribute("open", "");

    // Verify Positional Grade Goals controls render in Leg 1
    const leg1GradeControls = leg1.locator(".grade-impact-container");
    await expect(leg1GradeControls).toBeVisible();
    await expect(
      leg1GradeControls.getByText("Positional Grade Goals", { exact: true }),
    ).toBeVisible();

    // Click "+ Add Positional Goal" on Leg 1
    const leg1AddBtn = leg1GradeControls.getByRole("button", {
      name: "+ Add Positional Goal",
      exact: true,
    });
    await expect(leg1AddBtn).toBeVisible();
    await leg1AddBtn.click();

    // Verify positions in dropdown are filtered to available starter positions (RB, WR, TE)
    const leg1PosSelect = leg1.locator(
      'select[aria-label="First trade grade goal 1 position"]',
    );
    await expect(leg1PosSelect).toBeVisible();
    const availableOptions = await leg1PosSelect
      .locator("option")
      .allTextContents();
    expect(availableOptions).toEqual(["RB", "WR", "TE", "Overall (Net)"]);
    // Confirm unstarted positions are excluded
    expect(availableOptions).not.toContain("QB");
    expect(availableOptions).not.toContain("K");
    expect(availableOptions).not.toContain("D/ST");
    expect(availableOptions).not.toContain("FLEX");

    // Configure grade goal on Leg 1: TE No drop (≥ 0)
    await leg1PosSelect.selectOption("TE");
    const leg1TargetSelect = leg1.locator(
      'select[aria-label="First trade grade goal 1 target"]',
    );
    await leg1TargetSelect.selectOption("0");

    // Verify chain requirement chip displays the active grade goal for Leg 1
    const leg1Chip = page.locator(
      '.active-filter-chips button[aria-label="Clear First trade grade goals"]',
    );
    await expect(leg1Chip).toBeVisible();
    await expect(leg1Chip).toContainText("First trade: 1 grade goal");

    // Configure a grade goal on Leg 2 as well to verify multi-leg goal support
    const leg2GradeControls = leg2.locator(".grade-impact-container");
    await expect(leg2GradeControls).toBeVisible();
    const leg2AddBtn = leg2GradeControls.getByRole("button", {
      name: "+ Add Positional Goal",
      exact: true,
    });
    await expect(leg2AddBtn).toBeVisible();
    await leg2AddBtn.click();

    // Verify Leg 2 position selector also reflects available starter positions
    const leg2PosSelect = leg2.locator(
      'select[aria-label="Second trade grade goal 1 position"]',
    );
    await expect(leg2PosSelect).toBeVisible();
    const leg2Options = await leg2PosSelect
      .locator("option")
      .allTextContents();
    expect(leg2Options).toEqual(["RB", "WR", "TE", "Overall (Net)"]);

    // Configure Leg 2 goal for WR Upgrade >= 1 step
    await leg2PosSelect.selectOption("WR");
    const leg2TargetSelect = leg2.locator(
      'select[aria-label="Second trade grade goal 1 target"]',
    );
    await leg2TargetSelect.selectOption("1");

    // Verify chain requirement chip displays the active grade goal for Leg 2
    const leg2Chip = page.locator(
      '.active-filter-chips button[aria-label="Clear Second trade grade goals"]',
    );
    await expect(leg2Chip).toBeVisible();
    await expect(leg2Chip).toContainText("Second trade: 1 grade goal");

    // Configure offer/receive and team bounds to quickly execute search with real solutions
    for (const name of ["First trade", "Second trade"]) {
      const group = page.getByRole("group", { name, exact: true });
      await group
        .getByRole("combobox", { name: `${name} offer maximum`, exact: true })
        .selectOption(name === "Second trade" ? "2" : "1");
      if (name === "Second trade") {
        await group
          .getByRole("combobox", { name: `${name} offer minimum`, exact: true })
          .selectOption("2");
      }
      await group
        .getByRole("combobox", { name: `${name} receive maximum`, exact: true })
        .selectOption("1");
      await group.locator("summary").filter({ hasText: new RegExp(`^${name} teams`) }).click();
      await group
        .getByRole("checkbox", {
          name: `Override ${name.toLowerCase()} teams`,
          exact: true,
        })
        .check();
      await group
        .getByRole("button", { name: "Clear selection", exact: true })
        .click();
      await group
        .getByRole("checkbox", {
          name: `${name} team: ${name === "First trade" ? "Chain B" : "Chain C"}`,
          exact: true,
        })
        .check();
    }

    // Run chain trade search
    const runChainSearchBtn = page.getByRole("button", {
      name: "Search trade chains",
      exact: true,
    });
    await expect(runChainSearchBtn).toBeEnabled();
    await runChainSearchBtn.click();

    // Verify qualifying chains found message
    await expect(
      page.getByText(/[1-9][0-9]* qualifying chains found/),
    ).toBeVisible({ timeout: 25000 });

    // Capture screenshot of the configured Chain Planner positional grade goals and active chips
    await captureScreenshot(page, "chain-planner-grade-goals.png");
  });
});
