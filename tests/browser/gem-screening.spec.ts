import { test, expect, type Page } from "@playwright/test";
import { openTradeFilters } from "./trade-workspace-helpers";
import { execFileSync } from "node:child_process";
// Compare the new read-only explanations with the real model's active labels in both player surfaces.
import { evaluate } from "../../src/domain/valuation";
import { activeTagExplanations } from "../../src/domain/tag-evidence";
import { gemSignals, gemThresholds } from "../../src/domain/gem-screening";
import { filterHelp } from "../../src/ui/FilterHelp";
import type { GemJournal } from "../../src/domain/gem-tracking";
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
  preGem = false,
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
  // Only this workflow needs an emerging one-window player; existing Gem/Watch fixtures retain their answers.
  if (preGem) patterns.find((p) => p.id === 2)!.scores = [0, 0, 16, 17, 18];
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

// Applied positive-only filtering excludes mixed positive/red tags, persists on reload and clears independently of other criteria.
test("positive labels only excludes mixed red badges and restores applied state", async ({ page }) => {
  await seed(page, { gemPool: "All", gemFilterVersion: "3", gemSignals: JSON.stringify(gemSignals) }, true, true);
  const toggle = page.getByRole("checkbox", { name: "Positive labels only", exact: true });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole("link", { name: /Synthetic 2 WR/ })).toBeVisible();
  await toggle.check();
  await expect(page.getByRole("link", { name: /Synthetic 2 WR/ })).toBeVisible();
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("1 confirmed matches");
  await expect(page.getByRole("link", { name: /Synthetic 106 WR/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Synthetic 2 WR/ })).toHaveCount(0);
  await expect(page.locator(".signal.caution")).toHaveCount(0);
  await expect(page.locator(".trend.down")).toHaveCount(0);
  await expect(page.locator(".gem-query").filter({ has: page.getByText("Applied search:", { exact: true }) })).toContainText("Positive labels only (no red labels)");
  await page.screenshot({ path: "test-results/gem-positive-labels.png", fullPage: true });
  await page.reload();
  await expect(toggle).toBeChecked();
  await expect(page.getByRole("status")).toContainText("1 confirmed matches");
  await page.getByRole("button", { name: "Remove positive labels only filter", exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole("combobox", { name: "Player pool", exact: true })).toHaveValue("All");
  await expect(page.getByRole("link", { name: /Synthetic 2 WR/ })).toBeVisible();
});

// The primary stage, exact evidence, included-game date and discovery choices agree across every shared player surface.
test("Pre-gem filters and evidence persist across screener, roster, profile, popover and trade controls", async ({ page }) => {
  await seed(page, {}, false, false, true);
  await page.getByRole("button", { name: "Clear signals", exact: true }).click();
  await page.getByLabel("Pre-gem", { exact: true }).check();
  await page.getByRole("combobox", { name: "Player pool", exact: true }).selectOption("All");
  await page.getByRole("combobox", { name: "Breakout classification", exact: true }).selectOption("Pre-gem only");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(page.locator('a[href="#/player/2"]').first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Pre-gem", { exact: true })).toBeChecked();
  await page.locator('a[href="#/player/2"]').first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Evaluated through Week 5", { exact: true })).toBeVisible();
  // The earned Pre-gem chip is selected by default and its exact gates remain visible.
  await expect(
    dialog.getByRole("button", { name: "Pre-gem", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    dialog.getByText("WHY PRE-GEM?", { exact: true }),
  ).toBeVisible();
  const evidence = dialog.locator(".label-why-panel");
  await expect(evidence).toContainText("Recent 3 · PPG");
  await expect(evidence).toContainText("17.00 PPG");
  await expect(evidence).toContainText("≥ 16.00");
  await expect(evidence).toContainText("8.00 targets/game");
  await expect(evidence.locator('[data-gate-status="FAIL"]')).toHaveCount(0);
  await dialog.getByRole("link", { name: "Open full player page", exact: true }).click();
  await expect(page.getByText("WHY PRE-GEM?", { exact: true })).toBeVisible();
  await page.goto("./#/teams");
  await page.getByRole("combobox", { name: "Team", exact: true }).selectOption("2");
  await expect(page.locator("tr").filter({ has: page.locator('a[href="#/player/2"]') }).getByText("Pre-gem", { exact: true })).toBeVisible();
  await page.goto("./#/trades");
  await openTradeFilters(page);
  await page.getByRole("combobox", { name: "Search goal", exact: true }).selectOption("custom");
  await page.getByRole("checkbox", { name: "Pre-gem", exact: true }).check();
  await expect(page.getByLabel("Minimum incoming Gem/Pre-gem/Watch matches", { exact: true })).toBeVisible();
});

// Inspect only this isolated browser's private journal; test fixtures never reach cloud services or publication assets.
async function readTracking(
  page: Page,
  key = "gem-tracking:local",
): Promise<GemJournal | undefined> {
  return page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fantasy-football-lab", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise<GemJournal | undefined>(
      (resolve, reject) => {
        const request = db
          .transaction("current")
          .objectStore("current")
          .get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      },
    );
    db.close();
    return value;
  }, key);
}

// The production app records automatically on load, deduplicates reloads, scores later imports and clears its local journal with the workspace.
test("prospective Gem tracking persists once, scores follow-up imports and stays account scoped", async ({
  page,
}) => {
  const dataset = await seed(page);
  await page.goto("./#/model");
  const panel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Prospective Gem tracking",
        exact: true,
      }),
    });
  await expect(panel.getByText(/Week 5 observation recorded/)).toBeVisible();
  await expect
    .poll(async () => (await readTracking(page))?.cohorts[0].checkpoints.length)
    .toBe(1);
  const first = await readTracking(page);
  await page.reload();
  await expect(panel.getByText(/Week 5 observation recorded/)).toBeVisible();
  expect(await readTracking(page)).toEqual(first);
  await panel.getByText("Method and storage", { exact: true }).click();
  await expect(
    panel.getByText(/Stored only in this browser for this account/),
  ).toBeVisible();

  // Advance the complete synthetic import, not the recorded classifications; all old player scores and weeks remain intact.
  const future = structuredClone(dataset);
  future.tables.ModelContext[0].CurrentWeek = 11;
  future.tables.ModelContext[0].RefreshUTC = new Date().toISOString();
  for (const p of future.tables.ModelPlayers) {
    for (let week = 6; week <= 10; week++)
      future.tables.ModelHistory.push({
        PlayerID: p.PlayerID,
        Season: 2026,
        Week: week,
        Points: p.PlayerID === 2 ? 20 : 10,
        Games: 1,
        HistoryStatus: "Valid",
        Targets: 8,
        RushAttempts: 20,
      });
    const scores = future.tables.ModelHistory.filter(
      (h) => h.PlayerID === p.PlayerID,
    ).map((h) => Number(h.Points));
    Object.assign(p, {
      GamesPlayed: scores.length,
      Season_Games: scores.length,
      ActualPoints: scores.reduce((a, b) => a + b, 0),
      Actual_PPG: mean(scores),
      Last3_PPG: mean(scores.slice(-3)),
      ScoreSD: sd(scores),
    });
  }
  const next: Dataset = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "import fs from 'node:fs';import {fromTables} from './src/import/workbook.ts';const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(await fromTables(d.tables,d.settings)));",
      ],
      { input: JSON.stringify(future), encoding: "utf8" },
    ),
  );
  await page.evaluate(async (dataset) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("fantasy-football-lab", 1);
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("current", "readwrite"),
        store = tx.objectStore("current"),
        request = store.get("local");
      request.onsuccess = () => {
        store.put({ ...request.result, dataset }, "local");
        store.put(
          { version: 999, privateAccount: true },
          "gem-tracking:another-account",
        );
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, next);
  await page.reload();
  await expect(panel.getByText(/Week 10 observation recorded/)).toBeVisible();
  const scored = await readTracking(page);
  expect(scored!.cohorts[0].checkpoints[0].cases).toEqual(
    first!.cohorts[0].checkpoints[0].cases,
  );
  expect(scored!.cohorts[0].checkpoints[0].outcomes.three).toBeDefined();
  expect(scored!.cohorts[0].checkpoints[0].outcomes.five).toBeDefined();
  expect(await readTracking(page, "gem-tracking:another-account")).toEqual({
    version: 999,
    privateAccount: true,
  });
  await panel.getByText(/2026 · cohort 1/).click();
  await expect(
    panel.getByRole("columnheader", {
      name: "First recorded: successful / scored",
    }),
  ).toBeVisible();
  await expect(
    panel.getByText("Without game-workload floor", { exact: true }),
  ).toHaveCount(6);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  // Existing account-data removal deletes only the active account's journal, and pending saves cannot resurrect it.
  await page.goto("./#/data");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Remove from this device", exact: true })
    .click();
  await expect.poll(() => readTracking(page)).toBeUndefined();
  expect(await readTracking(page, "gem-tracking:another-account")).toEqual({
    version: 999,
    privateAccount: true,
  });
});

// A malformed/future-version journal must never prevent application startup or be silently reset by a reload.
test("unsupported prospective journal stays preserved while live Gem evidence remains usable", async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("fantasy-football-lab", 1);
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("current", "readwrite");
      tx.objectStore("current").put({ version: 999 }, "gem-tracking:local");
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.goto("./#/model");
  await page.reload();
  await expect(
    page.getByText(
      /Saved Gem tracking is unreadable or from an unsupported version/,
    ),
  ).toBeVisible();
  expect(await readTracking(page)).toEqual({ version: 999 });
  await page.goto("./#/player/2");
  await page.getByRole("button", { name: "Gem", exact: true }).click();
  // Gem caveats and the research note live in the closed Details section.
  await page.getByText("Details and caveats", { exact: true }).click();
  await expect(
    page.getByText(/Provisional floor; historically redundant/),
  ).toHaveCount(1);
  await expect(
    page.getByText(/494 weekly labels; 154 first alerts/),
  ).toBeVisible();
  await expect(
    page.locator('[data-gate-id="gem.previous-scoring-support"]'),
  ).toContainText("Previous 3 · scoring games");
  await expect(
    page.locator('[data-gate-id="gem.previous-scoring-support"]'),
  ).toContainText("3 games");
});

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
    "Signals - require all selected",
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
    // Every earned label has a chip; near misses may add extra dashed chips.
    for (const tag of tags)
      await expect(
        page.getByRole("button", { name: tag, exact: true }),
      ).toBeVisible();
    for (const tag of tags) {
      const chip = page.getByRole("button", { name: tag, exact: true });
      await chip.click();
      await expect(chip).toHaveAttribute("aria-pressed", "true");
      const panel = page.locator(".label-why-panel");
      await expect(
        panel.getByText(`WHY ${tag.toUpperCase()}?`, { exact: true }),
      ).toBeVisible();
      // Earned labels show no failed gate and keep a non-empty evidence surface.
      await expect(panel.locator('[data-gate-status="FAIL"]')).toHaveCount(0);
      await expect(panel.locator('[data-gate-status="PASS"]')).not.toHaveCount(0);
      await expect(panel.locator(".label-why-row")).not.toHaveCount(0);
      // The details keep the full meaning, limits, research note and window reachable.
      const details = panel.locator(".label-why-details");
      // Details may stay open when switching chips; open it only when it is closed.
      if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open)))
        await details
          .getByText("Details and caveats", { exact: true })
          .click();
      if (tag === "Gem") {
        await expect(details).toContainText(
          "Strong actual scoring backed by sustained workload in both consecutive, overlapping three-game windows. Workload growth is not required.",
        );
        await expect(details).toContainText(
          "494 weekly labels; 154 first alerts",
        );
        await expect(details).toContainText(
          "no manual role review, approval or news entry is required",
        );
        await expect(panel).toContainText("Historical reference");
        await expect(panel).toContainText(
          "a typical starting WR gets about 8.3 targets a game",
        );
      } else {
        const explanation = activeTagExplanations(p, model).find(
          (e) => e.tag === tag,
        )!;
        await expect(details).toContainText(explanation.meaning);
        if (explanation.interpretation)
          await expect(details).toContainText(explanation.interpretation);
        if (explanation.limitations)
          await expect(details).toContainText(explanation.limitations);
      }
      await expect(details).toContainText(model.dataset.sourceUTC ?? "Unavailable");
      // Charts exist only for rolling-average labels and never invent a zero for a gap.
      if (["BUY LOW", "SELL HIGH", "TD caution"].includes(tag)) {
        await expect(panel.locator(".label-why-chart")).toHaveCount(0);
      } else {
        await expect(panel.locator(".label-why-chart")).not.toHaveCount(0);
      }
      // The game table reveals the same history on request.
      const show = panel.getByRole("button", { name: /Show the \d+ games/ });
      if (await show.count()) {
        await show.click();
        await expect(panel.locator(".label-why-games tbody tr")).not.toHaveCount(
          0,
        );
      }
    }
  }
  // The same shared component appears in a player popover, and opening evidence leaves the route and selected player intact.
  await page.goto("./#/players");
  await page.locator('a[href="#/player/2"]').first().click();
  const dialog = page.getByRole("dialog");
  for (const tag of expected["2"])
    await expect(
      dialog.getByRole("button", { name: tag, exact: true }),
    ).toBeVisible();
  await dialog.getByRole("button", { name: "BUY LOW", exact: true }).click();
  const buy = dialog.locator(".label-why-panel");
  for (const id of ["regression.volume", "regression.td-rate"])
    await expect(buy.locator(`[data-gate-id="${id}"]`)).toBeVisible();
  // The passing opportunity sample collapses into a compact trust pill.
  await expect(buy.locator(".label-why-collapsed-pill")).toContainText(
    "Opportunities (sample)",
  );
  // The popover shares the profile's mini bars and exact margins without the old wide columns.
  await expect(buy.locator(".label-why-mini-dot--met")).not.toHaveCount(0);
  await expect(buy.locator(".label-why-mini-threshold")).not.toHaveCount(0);
  await buy.getByRole("button", { name: /Show the \d+ games/ }).click();
  await expect(buy.locator(".label-why-games")).toContainText("W1");
  await expect(buy.locator(".label-why-games tbody tr").first()).toContainText(
    "8",
  );
  await dialog.getByRole("button", { name: "Close player details" }).click();
  await page.goto("./#/player/107");
  await page.getByRole("button", { name: "SELL HIGH", exact: true }).click();
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
    .locator(".label-why-panel")
    .screenshot({ path: "test-results/sell-high-explanation-mobile.png" });
  await page.goto("./#/player/100");
  await expect(page.locator(".label-why-chip--earned")).toHaveCount(0);
});

// Audit keeps repeated weekly labels separate from first discoveries and displays effective settings without changing filters.
test("historical label audit exposes version-bound research and shared parameter bindings", async ({
  page,
}) => {
  await seed(page);
  await page.goto("./#/model");
  const panel = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Player-label evidence",
      exact: true,
    }),
  });
  await expect(panel).toContainText(
    "label-rules-1 / automatic-breakout-3 / historical-label-context-1",
  );
  await panel.getByText("Historical label research", { exact: true }).click();
  await expect(panel).toContainText("323/494");
  await expect(panel).toContainText("96/154");
  await expect(panel).toContainText("33 season-weeks");
  await expect(panel).toContainText(
    "Not acquisition success or an individual probability",
  );
  await panel
    .getByText("Active label rules and parameters", { exact: true })
    .click();
  await expect(panel).toContainText("Gem + Watch.positions.WR.mean");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({
    path: "test-results/historical-label-audit-mobile.png",
  });
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
  await dialog.getByRole("button", { name: "Gem", exact: true }).click();
  const gemPanel = dialog.locator(".label-why-panel");
  await expect(
    gemPanel.locator('[data-gate-id="gem.previous-scoring-support"]'),
  ).toContainText("Previous 3 · scoring games");
  // Eight signal rows plus two collapsed trust checks keep all ten Gem checks present.
  await expect(
    gemPanel.locator('[data-gate-status="PASS"], .label-why-collapsed-pill'),
  ).toHaveCount(10);
  await gemPanel.getByText("Details and caveats", { exact: true }).click();
  await expect(gemPanel).toContainText(
    "no manual role review, approval or news entry is required",
  );
  // Inspect the shared full-profile evidence without full-page capture moving the popover's anchor out of view.
  await dialog.getByRole("button", { name: "Close player details" }).click();
  await page.goto("./#/player/2");
  await page.getByRole("button", { name: "Gem", exact: true }).click();
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
  await dialog.getByRole("button", { name: "Gem", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Reduced workload", exact: true })
    .click();
  const reduced = dialog.locator(".label-why-panel");
  await expect(reduced).toContainText("13.50");
  await expect(reduced).toContainText("10.00");
  await expect(reduced).toContainText("Games clearly lower");
  await expect(reduced).toContainText("3 games");
  await page.reload();
  await expect(page.getByRole("status")).toContainText("1 confirmed matches");
  await expect(
    page.getByLabel("Reduced workload", { exact: true }),
  ).toBeChecked();
  await page.goto("./#/player/2");
  await page
    .getByRole("button", { name: "Reduced workload", exact: true })
    .click();
  await expect(page.locator(".label-why-panel")).toContainText("25.93%");
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
    page.getByText(/Role forecast scenario: 25%/),
  ).toBeVisible();
  await page.goto("./#/players");
  await expect(
    page.getByText(/Role forecast scenario: 25%/),
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
  await page.getByLabel("Watch", { exact: true }).check();
  await page.getByLabel("Role-growth watch", { exact: true }).check();
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
  await expect(page.getByRole("status")).toContainText("1 confirmed matches");
  await expect(page.locator(".gem-query").filter({ has: page.getByText("Applied search:", { exact: true }) })).toContainText("Watch AND Role-growth watch");
  await expect(page.getByRole("link", { name: /Synthetic 2 WR/ })).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: /^Matches: Watch/ }),
  ).toBeVisible();

  // Invalid drafts leave applied results unchanged and survive until corrected.
  await page.getByLabel("Minimum surplus index", { exact: true }).fill("80");
  await page.getByLabel("Maximum surplus index", { exact: true }).fill("10");
  await expect(
    page.getByRole("button", { name: "Apply filters", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("1 confirmed matches");
  await page.reload();
  await expect(
    page.getByLabel("Minimum surplus index", { exact: true }),
  ).toHaveValue("0");
  await expect(page.getByRole("status")).toContainText("1 confirmed matches");

  // Missing recent/earlier trend evidence is displayed separately after explicit opt-in.
  await page.getByRole("button", { name: "Clear signals", exact: true }).click();
  await page.getByRole("combobox", { name: "Breakout classification", exact: true }).selectOption("Gem + Watch");
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
  // Selecting every signal no longer bypasses matching; clearing restores an unrestricted label search.
  await expect(page.getByRole("status")).toContainText("0 confirmed matches");
  await page.reload();
  for (const label of gemSignals) await expect(page.getByRole("checkbox", { name: label, exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Clear signals", exact: true }).click();
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
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
      // Applying uses the new label-aware format; an explicitly empty signal selection still means Any signal.
      gemFilterVersion: "4",
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

// Mini bars keep favorability and qualification symbols independent while retaining exact values in text.
test("mini bars show favorable direction, exact cutoffs and symbols without changing badges",async({page})=>{
  await seed(page,{},true);
  await page.goto("./#/player/2");
  await page.getByRole("button",{name:"Gem",exact:true}).click();
  const gem=page.locator(".label-why-panel");
  await expect(gem.getByText("WHY GEM?",{exact:true})).toBeVisible();
  // Eight signal rows stay visible; the two passing trust checks collapse into pills.
  await expect(gem.locator('[data-gate-status="PASS"]')).toHaveCount(8);
  await expect(gem.locator(".label-why-collapsed-pill")).toHaveCount(2);
  await expect(gem).not.toContainText(/\b(PASS|FAIL)\b/);
  const scoring=gem.locator('[data-gate-id="gem.recent-ppg"]');
  await expect(scoring).toContainText("Recent 3 · PPG");
  await expect(scoring).toContainText("16.00");
  await expect(scoring.locator(".label-why-mini-dot--met")).toBeVisible();
  await expect(scoring.locator(".label-why-mini-threshold")).toBeVisible();
  await expect(gem.getByText(/Available to play/)).toBeVisible();
  await gem.screenshot({path:"test-results/label-why-positive.png"});
  await page.getByRole("button",{name:"Reduced workload",exact:true}).click();
  const risk=page.locator(".label-why-panel");
  const decline=risk.locator('[data-gate-id="reduced.decline-share"]');
  const positions=await decline.evaluate(el=>({player:parseFloat((el.querySelector(".label-why-mini-dot") as HTMLElement).style.left),threshold:parseFloat((el.querySelector(".label-why-mini-threshold") as HTMLElement).style.left)}));
  expect(positions.player).toBeLessThan(positions.threshold);
  await expect(risk.locator('[data-gate-status="PASS"]')).not.toHaveCount(0);
  await expect(risk).toContainText("13.50");
  await expect(risk).toContainText("10.00");
  await risk.screenshot({path:"test-results/label-why-negative.png"});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await risk.screenshot({path:"test-results/label-why-mobile.png"});
});
