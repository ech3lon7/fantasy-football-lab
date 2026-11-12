import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import {
  initialState,
  type Dataset,
  type Workspace,
} from "../../src/domain/contracts";

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
         import {fromTables} from './src/import/workbook.ts';
         const d = await starterFixture();
         d.tables.ModelContext[0].BenchSlots = 0;
         d.tables.ModelContext[0].QBSlots = 1;
         d.tables.ModelContext[0].RBSlots = 1;
         d.tables.ModelContext[0].WRSlots = 1;
         d.tables.ModelContext[0].TESlots = 0;
         d.tables.ModelContext[0].FlexSlots = 0;
         d.tables.ModelContext[0].KSlots = 0;
         d.tables.ModelContext[0].DSTSlots = 0;
         d.tables.ModelContext[0].QBLimit = 1;
         process.stdout.write(JSON.stringify(await fromTables(d.tables, d.settings)));`,
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
      filters: { feelTheme: "dark", feelAnimation: "off" },
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

test.describe("Section 4: Simulation status and roster-limit warnings", () => {
  test("shows simulation chip, warning tone, note, and popover with plain language", async ({
    page,
  }) => {
    await seed(page);

    await page.goto("./#/roster");
    const simulator = page.locator("section").filter({
      has: page.getByRole("heading", {
        name: "Hypothetical roster simulator",
        exact: true,
      }),
    });
    await expect(simulator).toBeVisible();

    // Create a new simulation
    await simulator
      .getByRole("textbox", { name: "Simulation name", exact: true })
      .fill("Draft 2026");
    await simulator
      .getByRole("button", { name: "New simulation", exact: true })
      .click();

    // Add player 200 (QB from Team 2) to Team 1 without dropping anyone
    // Since capacity is 3 and Team 1 already has 3 players, adding player 200 causes roster over capacity!
    await simulator.getByText("Advanced roster moves", { exact: true }).click();
    await simulator
      .getByRole("combobox", { name: "League player", exact: true })
      .selectOption("200");
    await simulator
      .getByRole("button", { name: "Move player to selected team", exact: true })
      .click();

    // Save to slot 1
    await simulator
      .getByRole("button", { name: "Save to slot 1", exact: true })
      .click();

    // 1. Check chip text reads "Simulation: Draft 2026" (never "Hypothetical:")
    const chip = page.locator(".gd-header button.gd-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("Simulation: Draft 2026");
    await expect(chip).not.toContainText("Hypothetical:");

    // 2. Chip has warning tone (gd-chip-warning) because the team is over capacity
    await expect(chip).toHaveClass(/gd-chip-warning/);

    // 3. Old toolbar banner should NOT exist
    await expect(page.locator(".toolbar .notice.danger")).toHaveCount(0);

    // 4. One-line simulation note is visible on the screen
    const note = page.locator(".gd-simulation-note");
    await expect(note).toBeVisible();
    await expect(note).toContainText("In your simulation ‘Draft 2026’");

    // 5. Click the simulation chip to open the popover
    await chip.click();
    const popover = page.locator(".gd-popover");
    await expect(popover).toBeVisible();
    await expect(
      popover.getByRole("heading", { name: "Simulation: Draft 2026" }),
    ).toBeVisible();
    await expect(popover.locator(".gd-sim-issue-msg").first()).toContainText(
      "In your simulation ‘Draft 2026’",
    );
    await expect(popover.locator(".gd-sim-issue-msg").first()).toContainText(
      "Suggested drop:",
    );
    await expect(
      popover.getByRole("button", { name: "Apply suggested drop" }).first(),
    ).toBeVisible();
    await expect(
      popover.getByRole("button", { name: "Switch to live roster" }),
    ).toBeVisible();
    await expect(
      popover.getByRole("link", { name: "Open simulation" }),
    ).toBeVisible();

    // Capture screenshot for Section 4
    fs.mkdirSync("test-results/shots/section-4", { recursive: true });
    await page.screenshot({
      path: "test-results/shots/section-4/simulation-popover-dark.png",
      fullPage: true,
    });

    // 6. Test clicking "Apply suggested drop"
    await popover
      .getByRole("button", { name: "Apply suggested drop" })
      .first()
      .click();
    await expect(popover).not.toBeVisible();

    // After applying the drop, the capacity issue is resolved!
    // Reopen popover
    await chip.click();
    await expect(popover).toBeVisible();

    // 7. Test clicking "Switch to live roster"
    await popover.getByRole("button", { name: "Switch to live roster" }).click();
    await expect(popover).not.toBeVisible();
    // After switching to live roster, the simulation chip is gone
    await expect(page.locator(".gd-header .gd-chip")).toHaveCount(0);
  });

  test("refuses reserved names Live and Live roster", async ({ page }) => {
    await seed(page);
    await page.goto("./#/roster");

    const simulator = page.locator("section").filter({
      has: page.getByRole("heading", {
        name: "Hypothetical roster simulator",
        exact: true,
      }),
    });
    await expect(simulator).toBeVisible();

    const nameInput = simulator.getByRole("textbox", {
      name: "Simulation name",
      exact: true,
    });
    await nameInput.fill("Live");
    await simulator
      .getByRole("button", { name: "New simulation", exact: true })
      .click();

    await expect(simulator.getByRole("alert")).toContainText(
      "‘Live’ and ‘Live roster’ are reserved for the real roster. Choose another name for your simulation.",
    );
  });
});
