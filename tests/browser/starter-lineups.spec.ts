import { openManualPlayers } from "./trade-workspace-helpers";
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { starterLineupsKey } from "../../src/domain/starter-lineups";
import {
  initialState,
  type Dataset,
  type Workspace,
} from "../../src/domain/contracts";

// Seed the real application with a canonical synthetic roster, never a real account or workbook.
async function seed(page: Page) {
  const dataset: Dataset = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "import {starterFixture} from './tests/fixtures.ts';process.stdout.write(JSON.stringify(await starterFixture()));",
      ],
      { encoding: "utf8" },
    ),
  );
  const w: Workspace = {
    owner: "local",
    dataset,
    state: {
      ...initialState(dataset),
      filters: { playersSearch: "retain-me" },
    },
    datasetRevision: 0,
    stateRevision: 0,
    pendingDataset: false,
    pendingState: false,
    requestId: crypto.randomUUID(),
    stateRequestId: crypto.randomUUID(),
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
      const tx = db.transaction("current", "readwrite");
      tx.objectStore("current").put(value, "local");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, w);
  await page.reload();
  await page.goto("./#/roster");
  await expect(
    page.getByRole("heading", { name: "Manage starters", exact: true }),
  ).toBeVisible();
}

// Read the committed local workspace: an optimistic on-screen update does not mean the queued IndexedDB save has finished.
async function storedStarterState(page: Page) {
  return page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fantasy-football-lab", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const workspace = await new Promise<Workspace>((resolve, reject) => {
        const request = db
          .transaction("current")
          .objectStore("current")
          .get("local");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const raw = workspace.state.filters[key];
      return {
        starters: raw
          ? (JSON.parse(raw).teams[workspace.state.preferredTeam]?.starters ??
            [])
          : [],
        playersSearch: workspace.state.filters.playersSearch,
      };
    } finally {
      db.close();
    }
  }, starterLineupsKey);
}

// Saving app choices validates slots, survives reload and reset, and retains unrelated filter state.
test("starter controls save, enforce QB limits, reset, and fit a mobile screen", async ({
  page,
}) => {
  await seed(page);
  const editor = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Manage starters", exact: true }),
    });
  await expect(
    editor.getByRole("combobox", {
      name: "Lineup status: Main QB",
      exact: true,
    }),
  ).toHaveValue("Starter");
  await expect(
    editor.getByRole("combobox", {
      name: "Lineup status: Bench QB",
      exact: true,
    }),
  ).toHaveValue("Bench");
  await editor
    .getByRole("combobox", { name: "Lineup status: Bench QB", exact: true })
    .selectOption("Starter");
  await expect(editor.getByRole("alert")).toContainText(
    "QB: at most 1 starters",
  );
  await expect(
    editor.getByRole("button", { name: "Save lineup", exact: true }),
  ).toBeDisabled();
  await editor
    .getByRole("combobox", { name: "Lineup status: Main QB", exact: true })
    .selectOption("Bench");
  await editor
    .getByRole("button", { name: "Save lineup", exact: true })
    .click();
  await expect(
    editor.getByText(/Lineup source: Saved app lineup/),
  ).toBeVisible();
  // Wait for the real write, preserving the original reload assertion instead of racing the browser's save queue in CI.
  await expect
    .poll(() => storedStarterState(page))
    .toEqual({
      starters: ["1", "101"],
      playersSearch: "retain-me",
    });
  await page.reload();
  await expect(
    editor.getByRole("combobox", {
      name: "Lineup status: Bench QB",
      exact: true,
    }),
  ).toHaveValue("Starter");
  await expect(
    editor.getByRole("combobox", {
      name: "Lineup status: Main QB",
      exact: true,
    }),
  ).toHaveValue("Bench");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await editor.screenshot({ path: "test-results/starter-editor-mobile.png" });
  await editor
    .getByRole("button", { name: "Reset to imported lineup", exact: true })
    .click();
  await expect(
    editor.getByRole("combobox", {
      name: "Lineup status: Main QB",
      exact: true,
    }),
  ).toHaveValue("Starter");
  await expect(
    editor.getByRole("combobox", {
      name: "Lineup status: Bench QB",
      exact: true,
    }),
  ).toHaveValue("Bench");
  // Reset must also be committed and survive reload without deleting unrelated saved filters.
  await expect
    .poll(() => storedStarterState(page))
    .toEqual({
      starters: [],
      playersSearch: "retain-me",
    });
  await page.reload();
  await expect(
    editor.getByRole("combobox", {
      name: "Lineup status: Main QB",
      exact: true,
    }),
  ).toHaveValue("Starter");
  await expect(
    editor.getByRole("combobox", {
      name: "Lineup status: Bench QB",
      exact: true,
    }),
  ).toHaveValue("Bench");
});

// The saved plan must reach the evaluator: bench loss is zero even when value exchange and optimized coverage are negative.
test("bench trades keep direct points unchanged while exchange grade and coverage remain separate", async ({
  page,
}) => {
  await seed(page);
  await page.goto("./#/trade");
  await openManualPlayers(page);
  await page.getByRole("combobox", { name: "Trade partner" }).selectOption("2");
  await page
    .locator('.gd-picker[aria-label="Players you send"]')
    .getByRole("button", { name: /Bench QB/ })
    .click();
  await page
    .locator('.gd-picker[aria-label="Players you receive"]')
    .getByRole("button", { name: /Incoming QB/ })
    .click();
  const verdicts = page.getByRole("region", { name: "Verdicts" });
  const lineupGain = verdicts
    .locator(".srow")
    .filter({ hasText: "▲ Lineup impact" })
    .locator(".v");
  const exchange = verdicts
    .locator(".srow")
    .filter({ hasText: "Surplus exchange" })
    .locator(".v");
  // Scoring on the marked starters leaves a bench-for-bench trade at no gain, while the exchange stays horrible.
  // Use the current select while retaining the bench-versus-starter scoring assertions.
  await page.getByRole("combobox", { name: "Lineup basis", exact: true }).selectOption("marked-starters");
  await expect(lineupGain).toHaveText(/^\+?0\.0/);
  await expect(exchange).toHaveText("Horrible deal");
  // Optimized coverage, which includes the bench, is a separate and negative result.
  await page
    .getByText("Optimized future lineups and coverage", { exact: true })
    .click();
  const coverage = page
    .locator("details")
    .filter({ hasText: "Optimized future lineups and coverage" });
  await expect(
    coverage.getByRole("row", { name: /^You/ }).locator("td").first(),
  ).toHaveText(/^-|^−/);
  // A saved starter switch must change the marked-starter result without changing the selected package.
  await page.goto("./#/roster");
  await page
    .getByRole("combobox", { name: "Lineup status: Main QB", exact: true })
    .selectOption("Bench");
  await page
    .getByRole("combobox", { name: "Lineup status: Bench QB", exact: true })
    .selectOption("Starter");
  await page.getByRole("button", { name: "Save lineup", exact: true }).click();
  await expect(page.getByText(/Lineup source: Saved app lineup/)).toBeVisible();
  await page.goto("./#/trade");
  await openManualPlayers(page);
  // Use the current select while retaining the bench-versus-starter scoring assertions.
  await page.getByRole("combobox", { name: "Lineup basis", exact: true }).selectOption("marked-starters");
  await expect(lineupGain).toHaveText(/^-|^−/);
  await expect(
    page
      .locator('.gd-picker[aria-label="Players you send"]')
      .getByRole("button", { name: /Bench QB/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page
      .locator('.gd-picker[aria-label="Players you receive"]')
      .getByRole("button", { name: /Incoming QB/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(exchange).toHaveText("Horrible deal");
});
