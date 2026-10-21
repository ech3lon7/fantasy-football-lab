import { test, expect, type Page } from "@playwright/test";
import { gemContextKey, gemVersion } from "../../src/domain/gems";
import { execFileSync } from "node:child_process";
import {
  initialState,
  mean,
  sd,
  type Workspace,
  type Dataset,
} from "../../src/domain/contracts";

// Seed only this isolated test browser with a complete synthetic league snapshot.
async function seed(page: Page, filters: Record<string, string> = {}) {
  // Run the existing fixture through tsx so its JSON imports need no production change.
  const d: Dataset = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "import {fixture} from './tests/fixtures.ts';process.stdout.write(JSON.stringify(await fixture()));",
      ],
      { encoding: "utf8" },
    ),
  );
  for (const p of d.tables.ModelPlayers)
    Object.assign(p, {
      Targets: 0,
      RushAttempts: 0,
      ReceivingTD: 0,
      RushTD: 0,
    });
  const patterns = [
    // Reproduce a rostered, rising RB that the default gem labels do not classify.
    { id: 1, scores: [6, 6, 21, 21, 21], projection: 15, targets: 0 },
    { id: 2, scores: [8, 8, 16, 16, 16], projection: 8, targets: 200 },
    { id: 106, scores: [6, 6, 12, 12, 12], projection: 15, targets: 200 },
    { id: 108, scores: [6, 6, 12, 12], projection: 6, targets: 200 },
  ];
  // Scoring history and cached aggregates agree, so the real import/model contract applies.
  for (const x of patterns) {
    const p = d.tables.ModelPlayers.find((p) => p.PlayerID === x.id)!;
    Object.assign(p, {
      Targets: x.targets,
      GamesPlayed: x.scores.length,
      Season_Games: x.scores.length,
      ActualPoints: x.scores.reduce((a, b) => a + b, 0),
      Actual_PPG: mean(x.scores),
      Last3_PPG: mean(x.scores.slice(-3)),
      ScoreSD: sd(x.scores),
      ESPN_Projected_PPG: x.projection,
      ESPN_Projected_Total: x.projection * 17,
    });
    d.tables.ModelHistory = d.tables.ModelHistory.filter(
      (h) => h.PlayerID !== x.id,
    );
    x.scores.forEach((Points, i) =>
      d.tables.ModelHistory.push({
        PlayerID: x.id,
        Season: 2026,
        Week: i + 1,
        Points,
        Games: 1,
        HistoryStatus: "Valid",
        // Real weekly counts are required by the stricter breakout classifier.
        Targets:
          x.id === 2
            ? i < 2
              ? 2
              : 8
            : x.id === 106
              ? i < 2
                ? 3
                : 6
              : x.id === 108
                ? 8
                : 0,
        RushAttempts: 0,
        SourceRefreshUTC: d.sourceUTC,
      }),
    );
  }
  Object.assign(
    d.tables.ModelPlayers.find((p) => p.PlayerID === 107)!,
    { Targets: 10, ReceivingTD: 3 },
  );
  // Extra non-gem QBs make pagination and deterministic equal-value ordering observable.
  const template = d.tables.ModelPlayers.find((p) => p.PlayerID === 100)!;
  const history = d.tables.ModelHistory.filter((h) => h.PlayerID === 100);
  for (let i = 0; i < 60; i++) {
    const id = 2000 + i;
    d.tables.ModelPlayers.push({
      ...template,
      PlayerID: id,
      Player: `Synthetic ${id}`,
    });
    d.tables.ModelHistory.push(...history.map((h) => ({ ...h, PlayerID: id })));
  }
  // Reuse the actual importer validation and canonical hash for the modified synthetic rows.
  const dataset: Dataset = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "import fs from 'node:fs';import {fromTables} from './src/import/workbook.ts';const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(await fromTables(d.tables,d.settings)));",
      ],
      { input: JSON.stringify(d), encoding: "utf8" },
    ),
  );
  const w: Workspace = {
    owner: "local",
    dataset,
    state: {
      ...initialState(dataset),
      filters: {
        playersSearch: "retain-me",
        [gemContextKey]: JSON.stringify({
          version: gemVersion,
          datasetHash: dataset.hash,
          rows: [
            {
              PlayerID: "2",
              Week: 6,
              ThroughWeek: 5,
              Outlook: "Supported ongoing opportunity",
              Source: "Synthetic role report",
              AsOfUTC: new Date().toISOString(),
              Reason: "Synthetic ongoing starting opportunity.",
            },
          ],
        }),
        ...filters,
      },
    },
    datasetRevision: 0,
    stateRevision: 0,
    pendingDataset: false,
    pendingState: false,
    requestId: crypto.randomUUID(),
    stateRequestId: crypto.randomUUID(),
  };
  await page.goto("./");
  await page.evaluate(async (workspace) => {
    // This helper writes only the test context's IndexedDB, never a hosted database.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fantasy-football-lab", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("current"))
          request.result.createObjectStore("current");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("current", "readwrite");
      tx.objectStore("current").put(workspace, "local");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, w);
  await page.goto("./#/gems");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Gem filters", exact: true }),
  ).toBeVisible();
}

// Exercise the real CSV UI, persisted source evidence and the opt-in forecast scenario across screens.
test("sourced usage and market evidence survives reload and remains separate from forecasts", async ({
  page,
}) => {
  await seed(page);
  await page.goto("./#/model");
  const timestamp = new Date().toISOString();
  const csv = [
    "PlayerID,Week,Source,AsOfUTC,UsageXFP,RouteParticipation,TargetShare,AirYardsShare,TradeValue,MarketFormat,ReturnWeek",
    ...[3, 4, 5].map(
      (w) => `1,${w},Synthetic usage,${timestamp},12,0.7,0.2,0.3,,,`,
    ),
    `1,6,Synthetic market,${timestamp},,,,,50,redraft-1qb-ppr,9`,
    `2,6,Synthetic market,${timestamp},,,,,60,redraft-1qb-ppr,`,
  ].join("\n");
  await page
    .getByLabel("Import supplemental evidence CSV", { exact: true })
    .setInputFiles({
      name: "synthetic-evidence.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
  // Wait for the persisted model result; recalculation can replace the transient save notice.
  await expect(
    page.getByText(
      "5 current evidence rows. Imports replace this evidence set. Source files are not retained.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.goto("./#/player/1");
  const role = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Role and opportunity",
      exact: true,
    }),
  });
  await expect(role.getByText("12.00", { exact: true })).toBeVisible();
  await expect(role.getByText("0.51", { exact: true })).toBeVisible();
  await expect(page.getByText(/Synthetic market ·/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Synthetic market ·/)).toBeVisible();
  await page.goto("./#/model");
  await page
    .getByLabel("Experimental role forecast weight (0–1)", { exact: true })
    .fill("0.25");
  await page
    .getByRole("button", { name: "Apply role scenario", exact: true })
    .click();
  await expect(
    page.getByText(/Experimental role forecast scenario: 25%/),
  ).toBeVisible();
  await page.goto("./#/players");
  await expect(
    page.getByText(/Experimental role forecast scenario: 25%/),
  ).toBeVisible();
  await page.goto("./#/model");
  await expect(
    page.getByLabel("Experimental role forecast weight (0–1)", { exact: true }),
  ).toHaveValue("0.25");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/opportunity-model-mobile.png",
    fullPage: true,
  });
});

// Exercise a complete user search, validation, missing evidence and saved-query restoration.
test("gem search combines signals and thresholds, persists applied state and separates unknowns", async ({
  page,
}) => {
  await seed(page);
  await page
    .getByRole("button", { name: "Clear signals", exact: true })
    .click();
  await page.getByLabel("Gem", { exact: true }).check();
  await page.getByLabel("Watch", { exact: true }).check();
  await page
    .getByRole("combobox", { name: "Player pool", exact: true })
    .selectOption("All");
  await page.getByLabel("Minimum trend PPG", { exact: true }).fill("2");
  await page.getByLabel("Minimum surplus index", { exact: true }).fill("0");
  await page.getByLabel("Maximum surplus index", { exact: true }).fill("100");
  await page.getByLabel("Minimum recent PPG", { exact: true }).fill("12");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("2 confirmed matches");
  await expect(page.getByRole("cell", { name: /^Matches: Gem/ })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: /^Matches: Watch/ }),
  ).toBeVisible();

  // Invalid drafts leave applied results unchanged and survive until corrected.
  await page.getByLabel("Minimum surplus index", { exact: true }).fill("80");
  await page.getByLabel("Maximum surplus index", { exact: true }).fill("10");
  await expect(
    page.getByRole("button", { name: "Apply filters", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("2 confirmed matches");
  await page.reload();
  await expect(
    page.getByLabel("Minimum surplus index", { exact: true }),
  ).toHaveValue("0");
  await expect(page.getByRole("status")).toContainText("2 confirmed matches");

  // Missing recent/earlier trend evidence is displayed separately after explicit opt-in.
  await page.getByText(/^Advanced filters/).click();
  await page.getByLabel("Minimum recent PPG", { exact: true }).fill("");
  await page
    .getByLabel("Show players with missing filter data", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "2 confirmed matches; 1 with incomplete evidence",
  );
  await expect(
    page.getByRole("heading", { name: "1 players with incomplete evidence" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: /^Incomplete: Trend PPG unavailable/ }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/gem-filters-desktop.png",
    fullPage: true,
  });

  // Discard confirmation protects unfinished edits from chips and presets.
  await page.getByLabel("Minimum trend PPG", { exact: true }).fill("3");
  await page
    .getByRole("button", { name: "Remove Minimum trend PPG", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "replaces unapplied edits",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByLabel("Minimum trend PPG", { exact: true }),
  ).toHaveValue("3");
  await page
    .getByRole("button", { name: "Rising targets", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Discard edits and continue", exact: true })
    .click();
  await expect(
    page.getByLabel("Minimum surplus index", { exact: true }),
  ).toHaveValue("10");
  await expect(
    page.getByLabel("Maximum surplus index", { exact: true }),
  ).toHaveValue("40");
  await expect(
    page.getByLabel("Minimum games played", { exact: true }),
  ).toHaveValue("5");
  await page.setViewportSize({ width: 390, height: 844 });
  // Mobile controls must fit the viewport; only the result table may scroll sideways.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Apply filters", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/gem-filters-mobile.png",
    fullPage: true,
  });
});

// Check legacy compatibility, reset isolation and full-dataset filtering before pagination.
test("legacy gem filters, reset and pagination retain unrelated state", async ({
  page,
}) => {
  await seed(page, { gemSignal: "Opportunity watch", gemPool: "All" });
  await expect(page.getByRole("alert")).toContainText("meanings changed");
  await expect(page.getByLabel("Watch", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Gem", { exact: true })).not.toBeChecked();
  await page
    .getByRole("button", { name: "Reset screener", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Position", exact: true })
    .selectOption("All");
  await page
    .getByRole("button", { name: "Select all signals", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(
    page.getByText("50 of 78 records", { exact: true }),
  ).toBeVisible();
  // Equal numeric values use PlayerID ties in either sort direction.
  await page.getByRole("button", { name: /^Surplus index/ }).click();
  await page.getByRole("button", { name: /^Surplus index/ }).click();
  await expect(
    page.locator("tbody tr").first().getByRole("link"),
  ).toContainText("Synthetic 100");
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(
    page.getByText("78 of 78 records", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Minimum surplus index", { exact: true }).fill("0");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(
    page.getByText("50 of 78 records", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByLabel("Minimum surplus index", { exact: true }),
  ).toHaveValue("0");
  // Reset and Apply merge only gem keys, preserving other screen preferences.
  const retained = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("fantasy-football-lab", 1);
      r.onsuccess = () => resolve(r.result);
    });
    const w = await new Promise<any>((resolve) => {
      const r = db.transaction("current").objectStore("current").get("local");
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return w.state.filters.playersSearch;
  });
  expect(retained).toBe("retain-me");
});

// Corrupt new-format state cannot silently fall back to broader legacy searches.
test("malformed saved gem filters require an explicit recovery", async ({
  page,
}) => {
  await seed(page, { gemFilterVersion: "999", gemSignals: '["Gem"]' });
  await expect(page.getByRole("alert")).toContainText("invalid or unsupported");
  await expect(page.getByRole("status")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Reset screener", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("confirmed matches");
});

// The diagnostic makes otherwise-matching RBs accessible without dropping their thresholds.
test("rising RB search explains signal/pool exclusions and explicitly includes them", async ({
  page,
}) => {
  await seed(page);
  await page
    .getByRole("combobox", { name: "Position", exact: true })
    .selectOption("RB");
  await page.getByLabel("Minimum trend PPG", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("0 confirmed matches");
  await expect(page.getByText(/1 additional player would match/)).toBeVisible();
  await page
    .getByRole("button", {
      name: "Search all players and signals",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText("1 confirmed matches");
  await expect(
    page.getByRole("link", { name: /Synthetic 1 RB/ }),
  ).toBeVisible();
  await expect(
    // Rising scoring now has its own label even when the old gem conditions fail.
    page.locator("td.model").filter({ hasText: "Scoring breakout watch" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Minimum trend PPG", { exact: true }),
  ).toHaveValue("2");
  await expect(
    page.getByRole("combobox", { name: "Position", exact: true }),
  ).toHaveValue("RB");
  await page.screenshot({
    path: "test-results/rising-rb-filter.png",
    fullPage: true,
  });
});

// Restore the exact empty-signal state reported by the user and verify numeric-only screening.
test("cleared saved signals permit rising RBs and survive Apply and reload", async ({
  page,
}) => {
  await seed(page, {
    gemFilterVersion: "1",
    gemSignals: "[]",
    gemPool: "Available",
    gemPos: "RB / WR / TE",
    gemTrendMin: "2",
  });
  await expect(
    page.getByText(/Applied search: Any signal AND Pool: Available/),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("1 confirmed matches");
  await page
    .getByRole("combobox", { name: "Player pool", exact: true })
    .selectOption("All");
  await page
    .getByRole("combobox", { name: "Position", exact: true })
    .selectOption("RB");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("1 confirmed matches");
  await expect(
    page.getByRole("link", { name: /Synthetic 1 RB/ }),
  ).toBeVisible();
  await expect(
    page.locator("td.model").filter({ hasText: "Scoring breakout watch" }),
  ).toBeVisible();
  // The trend's accessible name describes direction; verify its displayed number in the row.
  await expect(
    page
      .getByRole("row")
      .filter({ has: page.getByRole("link", { name: /Synthetic 1 RB/ }) }),
  ).toContainText("+15.00");
  await page.reload();
  await expect(
    page.getByText(/Applied search: Any signal AND Pool: All AND Position: RB/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Synthetic 1 RB/ }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Minimum trend PPG", { exact: true }),
  ).toHaveValue("2");
});

// Exercise review editing, worker invalidation, the shared popover evidence and the independent classification filter.
test("Gem role reviews update every player surface and persist without changing value", async ({
  page,
}) => {
  await seed(page);
  await page
    .getByRole("combobox", { name: "Player pool", exact: true })
    .selectOption("All");
  await page
    .getByRole("combobox", { name: "Breakout classification", exact: true })
    .selectOption("Gem only");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("1 confirmed matches");
  await page.getByRole("link", { name: /Synthetic 2 WR/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Why Gem?", { exact: true }).click();
  await expect(
    dialog.getByRole("table", { name: "Breakout evidence checks" }),
  ).toContainText("SUPPORTED");
  await page.screenshot({ path: "test-results/gem-evidence-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: /Synthetic 2 WR/ }).click();
  await dialog.getByText("Why Gem?", { exact: true }).click();
  await expect(dialog).toHaveAttribute("data-layout", "sheet");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/gem-evidence-mobile.png" });
  await dialog.getByRole("link", { name: "Open full player page" }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByText("Why Gem?", { exact: true }).click();
  await expect(
    page.getByRole("table", { name: "Breakout evidence checks" }),
  ).toContainText("Synthetic role report");
  await page.goto("./#/model");
  await page
    .getByRole("combobox", { name: "Role review player", exact: true })
    .selectOption("2");
  await page
    .getByRole("combobox", { name: "Role outlook", exact: true })
    .selectOption("Temporary opportunity");
  await page
    .getByRole("button", { name: "Save role review", exact: true })
    .click();
  await page.goto("./#/player/2");
  await expect(page.getByText("Why Watch?", { exact: true })).toBeVisible();
  await page.getByText("Why Watch?", { exact: true }).click();
  await expect(
    page.getByRole("table", { name: "Breakout evidence checks" }),
  ).toContainText("Temporary opportunity");
  await page.reload();
  await expect(page.getByText("Why Watch?", { exact: true })).toBeVisible();
  await page.goto("./#/gems");
  await expect(page.getByRole("status")).toContainText("0 confirmed matches");
  await page
    .getByRole("combobox", { name: "Breakout classification", exact: true })
    .selectOption("Gem + Watch");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("3 confirmed matches");
  // A sourced CSV restores only the role-review collection, then a rule edit changes classification.
  await page.goto("./#/model");
  await page
    .getByLabel("Import role reviews CSV", { exact: true })
    .setInputFiles({
      name: "role-reviews.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        `PlayerID,Week,ThroughWeek,Outlook,Source,AsOfUTC,Reason\n2,6,5,Supported ongoing opportunity,Synthetic ongoing source,${new Date().toISOString()},Documented continuing opportunity`,
      ),
    });
  // The import may remount this control while the worker replaces its model result.
  await expect(async () => {
    await page
      .getByRole("combobox", { name: "Role review player", exact: true })
      .selectOption("2");
    await expect(
      page.getByRole("combobox", { name: "Role outlook", exact: true }),
    ).toHaveValue("Supported ongoing opportunity", { timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await page.goto("./#/gems");
  await page
    .getByRole("combobox", { name: "Breakout classification", exact: true })
    .selectOption("Gem only");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("1 confirmed matches");
  await page.goto("./#/model");
  await page
    .getByText("Adjust provisional Gem thresholds", { exact: true })
    .click();
  const config = page.getByRole("textbox", {
    name: "Gem rule configuration (JSON)",
    exact: true,
  });
  const rules = JSON.parse(await config.inputValue());
  rules.positions.WR.mean = 9;
  await config.fill(JSON.stringify(rules));
  await page
    .getByRole("button", { name: "Apply Gem rules", exact: true })
    .click();
  await page.goto("./#/gems");
  await expect(page.getByRole("status")).toContainText("0 confirmed matches");
});
