import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
// Compare the new read-only explanations with the real model's active labels in both player surfaces.
import { evaluate } from "../../src/domain/valuation";
import { activeTagExplanations } from "../../src/domain/tag-evidence";
import { gemSignals, gemThresholds } from "../../src/domain/gem-screening";
import { filterHelp } from "../../src/ui/FilterHelp";
import {
  initialState,
  mean,
  sd,
  type Workspace,
  type Dataset,
} from "../../src/domain/contracts";

// Seed only this isolated test browser with a complete synthetic league snapshot.
async function seed(
  page: Page,
  filters: Record<string, string> = {},
  reduced = false,
  analytical = false,
) {
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
    // Four strong played games confirm Gem while preserving the fixture's rising-scoring search.
    { id: 2, scores: [8, 16, 16, 16, 16], projection: 8, targets: 200 },
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
        // Weekly workload drives automatic qualification; no manual context is seeded for any test player.
        Targets:
          x.id === 2
            ? i < 1
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
  // Only the decline workflow receives an Amon-Ra-like workload; existing fixtures and scoring remain unchanged.
  if (reduced)
    d.tables.ModelHistory.filter((h) => h.PlayerID === 2).forEach((h, i) => {
      h.Targets = [14, 13, 8, 11, 11][i];
    });
  Object.assign(
    d.tables.ModelPlayers.find((p) => p.PlayerID === 107)!,
    { Targets: 10, ReceivingTD: 3 },
  );
  // Only explanation tests need complete touchdown counts and distinct regression/gap examples; prior fixtures remain unchanged.
  if (analytical) {
    for (const h of d.tables.ModelHistory)
      Object.assign(h, { ReceivingTD: 0, RushTD: 0 });
    d.tables.ModelHistory.filter((h) => h.PlayerID === 107).forEach((h, i) =>
      Object.assign(h, {
        Targets: 2,
        RushAttempts: 0,
        ReceivingTD: i === 0 ? 3 : 0,
      }),
    );
    Object.assign(
      d.tables.ModelPlayers.find((p) => p.PlayerID === 108)!,
      { Targets: 12 },
    );
    d.tables.ModelHistory.filter((h) => h.PlayerID === 108).forEach((h) => {
      h.Targets = 3;
    });
  }
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
      filters: { playersSearch: "retain-me", ...filters },
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
  return dataset;
}

// Every signal and screener selection keeps its help after leaving and returning, without changing filter values.
test("all screener signals and controls retain repeatable marker-free help", async ({
  page,
}) => {
  // Retired saved selections disappear automatically without hiding valid choices or numeric criteria.
  await seed(page, {
    gemFilterVersion: "2",
    gemSignals: '["Gem","Watch","Insufficient data","Not applicable"]',
    gemTrendMin: "2",
  });
  const filters = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Gem filters", exact: true }),
  });
  for (const label of ["Insufficient data", "Not applicable"])
    await expect(
      filters.getByRole("checkbox", { name: label, exact: true }),
    ).toHaveCount(0);
  await expect(
    filters.getByRole("checkbox", { name: "Gem", exact: true }),
  ).toBeChecked();
  await expect(
    filters.getByRole("checkbox", { name: "Watch", exact: true }),
  ).toBeChecked();
  await expect(
    filters.getByLabel("Minimum trend PPG", { exact: true }),
  ).toHaveValue("2");
  const before = await filters
    .locator("input, select")
    .evaluateAll((controls) =>
      controls.map((control) => ({
        value: (control as HTMLInputElement).value,
        checked: (control as HTMLInputElement).checked,
      })),
    );
  await filters
    .locator("summary")
    .filter({ hasText: "Advanced filters" })
    .click();
  const labels = [
    ...gemSignals,
    "Player pool",
    "Breakout classification",
    "Position",
    "Include injured",
    "Signals - match any selected",
    ...gemThresholds.map((field) => field.label),
    "Above replacement only",
    "Show players with missing filter data",
    "Rising targets",
  ];
  for (const label of labels) {
    const trigger = filters.getByText(label, { exact: true });
    for (let visit = 0; visit < 2; visit++) {
      await trigger.hover();
      await expect(
        page.getByRole("tooltip"),
        `${label}, visit ${visit + 1}`,
      ).toHaveText(filterHelp[label]);
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
    }
  }
  await expect(page.getByRole("button", { name: /^Help:/ })).toHaveCount(0);
  expect(
    await filters.locator("input, select").evaluateAll((controls) =>
      controls.map((control) => ({
        value: (control as HTMLInputElement).value,
        checked: (control as HTMLInputElement).checked,
      })),
    ),
  ).toEqual(before);
  // The team selector is conditional on the chosen pool and must also retain its shared help.
  await filters
    .getByRole("combobox", { name: "Player pool", exact: true })
    .selectOption("Selected team");
  await filters.getByText("Team", { exact: true }).hover();
  await expect(page.getByRole("tooltip")).toHaveText(filterHelp.Team);
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

// Signal badges use the same explanations in player tables, profiles and inspection popovers.
test("player signal badges retain help across player surfaces", async ({
  page,
}) => {
  await seed(page, {}, true, true);
  await page.goto("./#/players");
  for (const label of ["Gem", "Watch", "Projection-gap watch"]) {
    const badge = page
      .locator(".signal")
      .getByText(label, { exact: true })
      .first();
    await badge.hover();
    await expect(page.getByRole("tooltip")).toHaveText(filterHelp[label]);
    await page.mouse.move(0, 0);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  }
  // Inspecting a player still opens their popover; help does not intercept the existing link action.
  await page.locator('a[href="#/player/2"]').first().click();
  const popover = page.getByRole("dialog");
  await expect(popover).toBeVisible();
  await popover.locator(".signal").getByText("Gem", { exact: true }).hover();
  await expect(page.getByRole("tooltip")).toHaveText(filterHelp.Gem);
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(popover).toBeVisible();
  for (const [id, labels] of [
    ["2", ["Gem", "Scoring breakout watch", "Reduced workload", "BUY LOW"]],
    ["106", ["Watch", "Role-growth watch"]],
    ["107", ["SELL HIGH", "TD caution"]],
    ["108", ["Projection-gap watch"]],
  ] as const) {
    await page.goto(`./#/player/${id}`);
    for (const label of labels) {
      await page.locator(".signal").getByText(label, { exact: true }).hover();
      await expect(page.getByRole("tooltip")).toHaveText(filterHelp[label]);
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
    }
  }
  await expect(page.getByRole("button", { name: /^Help:/ })).toHaveCount(0);
});

// Every displayed analytical label has its own collapsed explanation, with no inactive, injury, trend or data-status sections.
test("active analytical tag explanations agree across popovers and profiles", async ({
  page,
}) => {
  const dataset = await seed(page, {}, true, true);
  const model = evaluate(dataset, dataset.settings);
  const expected: Record<string, string[]> = {
    "2": ["Gem", "Scoring breakout watch", "Reduced workload", "BUY LOW"],
    "106": ["Watch", "Role-growth watch"],
    "107": ["SELL HIGH", "TD caution"],
    "108": ["Projection-gap watch"],
  };
  for (const [id, tags] of Object.entries(expected)) {
    const p = model.byId.get(id)!;
    expect(
      [
        ...activeTagExplanations(p, model).map((e) => e.tag),
        ...(p.gem === "Gem" ? ["Gem"] : []),
      ].sort(),
      JSON.stringify({
        id,
        regression: p.regression,
        opportunities: p.opportunities,
        td: p.td,
        peer: p.regressionEvidence,
      }),
    ).toEqual([...tags].sort());
    await page.goto(`./#/player/${id}`);
    await expect(
      page.locator("summary").filter({ hasText: /^Why .+\?$/ }),
    ).toHaveCount(tags.length);
    for (const tag of tags) {
      const summary = page.getByText(`Why ${tag}?`, { exact: true });
      await expect(summary).toBeVisible();
      const details = summary.locator("..");
      await expect(details).not.toHaveAttribute("open");
      await summary.click();
      await expect(details.getByRole("table")).toBeVisible();
      // Every active tag shares numerical comparisons while retaining its original evidence and source weeks.
      const table = details.getByRole("table");
      await expect(
        table.getByRole("columnheader", { name: "Margin", exact: true }),
      ).toBeVisible();
      await expect(table.locator("td strong")).not.toHaveCount(0);
      await expect(table).toContainText(
        /above minimum|below maximum|at threshold/,
      );
      const explanation = activeTagExplanations(p, model).find(
        (e) => e.tag === tag,
      );
      if (explanation) {
        await expect(details).toContainText(explanation.meaning);
        await expect(details).toContainText(explanation.interpretation);
        await expect(details).toContainText(explanation.limitations);
        await expect(details).toContainText(explanation.rows[0].actual);
        for (const row of explanation.rows) {
          for (const comparison of row.comparisons ?? []) {
            await expect(table).toContainText(comparison.required);
            await expect(table).toContainText(comparison.actual);
            await expect(table).toContainText(comparison.margin);
          }
        }
        // Numerical game evidence remains visible in every active explanation, not just aggregate averages.
        const gameEvidence = explanation.rows.find((row) =>
          row.check.includes("played-game evidence"),
        );
        expect(gameEvidence).toBeDefined();
        await expect(details).toContainText(gameEvidence!.actual);
      }
      await summary.click();
    }
  }
  // The same shared component appears in a player popover, and opening evidence leaves the route and selected player intact.
  await page.goto("./#/players");
  await page.locator('a[href="#/player/2"]').first().click();
  const dialog = page.getByRole("dialog");
  for (const tag of expected["2"])
    await expect(
      dialog.getByText(`Why ${tag}?`, { exact: true }),
    ).toBeVisible();
  await dialog.getByText("Why BUY LOW?", { exact: true }).click();
  await expect(
    dialog.getByRole("table", { name: "BUY LOW evidence checks", exact: true }),
  ).toContainText("80th-percentile");
  // The popover uses the same comparison table as the profile, including its numeric margin column.
  await expect(
    dialog
      .getByRole("table", { name: "BUY LOW evidence checks", exact: true })
      .getByRole("columnheader", { name: "Margin", exact: true }),
  ).toBeVisible();
  await expect(
    dialog
      .getByRole("table", { name: "BUY LOW evidence checks", exact: true })
      .locator("td.fact"),
  ).not.toHaveCount(0);
  await expect(
    dialog
      .getByRole("table", { name: "BUY LOW evidence checks", exact: true })
      .locator("td.model"),
  ).not.toHaveCount(0);
  await expect(
    dialog.getByRole("table", { name: "BUY LOW evidence checks", exact: true }),
  ).toContainText("2026 W1: 8.00 points; 14.00 targets; 0.00 TDs");
  await dialog.getByRole("button", { name: "Close player details" }).click();
  await page.goto("./#/player/107");
  await page.getByText("Why SELL HIGH?", { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/analytical-tags-mobile.png",
    fullPage: true,
  });
  await page
    .getByText("Why SELL HIGH?", { exact: true })
    .locator("..")
    .screenshot({ path: "test-results/sell-high-explanation-mobile.png" });
  await page.goto("./#/player/100");
  await expect(
    page.locator("summary").filter({ hasText: /^Why .+\?$/ }),
  ).toHaveCount(0);
});

// Loading imported data and an old saved query must identify Gems automatically, ignoring obsolete manual-review settings.
test("automatic Gems need no review, relabeling or Apply after saved-filter migration", async ({
  page,
}) => {
  await seed(page, {
    gemFilterVersion: "1",
    gemSignals: '["Gem candidate"]',
    gemPool: "All",
    gemPos: "WR",
    gemTrendMin: "2",
    gemRoleReviews: "obsolete invalid review data",
    gemBreakoutRules: "obsolete invalid manual configuration",
  });
  await expect(page.getByRole("status")).toContainText("1 confirmed matches");
  await expect(page.getByLabel("Gem", { exact: true })).toBeChecked();
  await expect(
    page.getByLabel("Minimum trend PPG", { exact: true }),
  ).toHaveValue("2");
  await page.getByRole("link", { name: /Synthetic 2 WR/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Why Gem?", { exact: true }).click();
  await expect(
    dialog.getByRole("table", { name: "Breakout evidence checks" }),
  ).toContainText("Previous window scoring support");
  await expect(
    dialog
      .getByRole("table", { name: "Breakout evidence checks" })
      .getByRole("cell", { name: "PASS", exact: true }),
  ).toHaveCount(10);
  await expect(dialog).toContainText(
    "no manual role review, approval or news entry is required",
  );
  // Inspect the shared full-profile evidence without full-page capture moving the popover's anchor out of view.
  await dialog.getByRole("button", { name: "Close player details" }).click();
  await page.goto("./#/player/2");
  await page.getByText("Why Gem?", { exact: true }).click();
  await page.screenshot({
    path: "test-results/gem-confirmation-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/gem-confirmation-mobile.png",
    fullPage: true,
  });
  await page.goto("./#/gems");
  await page.reload();
  await expect(page.getByRole("status")).toContainText("1 confirmed matches");
  await page.goto("./#/model");
  await expect(
    page.getByRole("heading", {
      name: "Gem rules and role reviews",
      exact: true,
    }),
  ).toHaveCount(0);
});

// The independent decline signal filters automatically, survives reload, and exposes evidence in existing player views.
test("sustained reduced workload remains selectable, persistent and independent of confirmed Gem", async ({
  page,
}) => {
  await seed(
    page,
    {
      gemFilterVersion: "2",
      gemSignals: '["Reduced workload"]',
      gemPool: "All",
      gemPos: "WR",
    },
    true,
  );
  await expect(page.getByRole("status")).toContainText("1 confirmed matches");
  await expect(
    page.getByLabel("Reduced workload", { exact: true }),
  ).toBeChecked();
  await expect(
    page.locator(".signal.caution").filter({ hasText: "Reduced workload" }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Synthetic 2 WR/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Why Gem?", { exact: true }).click();
  await dialog.getByText("Why Reduced workload?", { exact: true }).click();
  await expect(
    dialog.getByRole("table", {
      name: "Reduced workload evidence checks",
      exact: true,
    }),
  ).toContainText("13.50 → 10.00");
  await expect(dialog).toContainText(
    "3/3 recent games meet the decline minimum",
  );
  await page.reload();
  await expect(page.getByRole("status")).toContainText("1 confirmed matches");
  await expect(
    page.getByLabel("Reduced workload", { exact: true }),
  ).toBeChecked();
  await page.goto("./#/player/2");
  await page.getByText("Why Reduced workload?", { exact: true }).click();
  await expect(
    page.getByRole("table", {
      name: "Reduced workload evidence checks",
      exact: true,
    }),
  ).toContainText("-25.93%");
});

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
  await seed(page, { gemSignal: "Watch", gemPool: "All" });
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
    // Rising scoring remains an independent signal alongside the redesigned primary classification.
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
  // Apply updates the UI before its queued IndexedDB write finishes; reload only after the exact filters are durable.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("fantasy-football-lab", 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            const workspace = await new Promise<Workspace | undefined>(
              (resolve, reject) => {
                const request = db
                  .transaction("current")
                  .objectStore("current")
                  .get("local");
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              },
            );
            return workspace?.state.filters;
          } finally {
            db.close();
          }
        }),
      { message: "Applied Gem filters must reach IndexedDB before reload" },
    )
    .toMatchObject({
      gemFilterVersion: "2",
      gemSignals: "[]",
      gemPool: "All",
      gemPos: "RB",
      gemTrendMin: "2",
    });
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
