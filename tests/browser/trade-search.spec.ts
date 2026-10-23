import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  initialState,
  type Dataset,
  type Workspace,
} from "../../src/domain/contracts";
import { evaluate } from "../../src/domain/valuation";
import { evaluateTrade } from "../../src/domain/trades";

// Seed only synthetic data and a known bench outgoing player through the app's normal local workspace store.
async function seed(
  page: Page,
  withDepth = false,
  withOffers = false,
  bestRoster = false,
) {
  const dataset: Dataset = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        // Optional synthetic reserves/offers reproduce starter-versus-bench and duplicate-comparison cases.
        `import {tradeSearchFixture} from './tests/fixtures.ts';
         import {fromTables} from './src/import/workbook.ts';
         const d=await tradeSearchFixture();
         if(${withDepth}) {
           d.tables.ModelPlayers.push({...d.tables.ModelPlayers.find(p=>p.PlayerID===102), PlayerID:201,Player:'Depth QB',OnTeamID:2, ActualPoints:25, Actual_PPG:5, Last3_PPG:5, ESPN_Projected_PPG:5, ESPN_Projected_Total:85});
           d.tables.ModelHistory.push(...d.tables.ModelHistory.filter(h=>h.PlayerID===102).map(h=>({...h,PlayerID:201,Points:5})));
           d.tables.ModelRosters.push({PlayerID:201,TeamID:2,LineupSlotID:20});
         }
         // Only the best-roster workflow needs a benched QB stronger than their starter, keeping prior fixtures unchanged.
         if(${bestRoster}) {
           Object.assign(d.tables.ModelPlayers.find(p=>p.PlayerID===201),{ActualPoints:125,Actual_PPG:25,Last3_PPG:25,ESPN_Projected_PPG:25,ESPN_Projected_Total:425});
           d.tables.ModelHistory.filter(h=>h.PlayerID===201).forEach(h=>{h.Points=25});
         }
         // Keep replacement free agents intact while adding two benched offers and two distinct comparison roles.
         if(${withOffers}) {
           for(const [id,name,score] of [[400,'Offer WR A',12.97],[401,'Offer WR B',12.49]]) {
             d.tables.ModelPlayers.push({...d.tables.ModelPlayers.find(p=>p.PlayerID===2),PlayerID:id,Player:name,OnTeamID:1});
             d.tables.ModelHistory.push(...d.tables.ModelHistory.filter(h=>h.PlayerID===2).map(h=>({...h,PlayerID:id})));
             d.tables.ModelRosters.push({PlayerID:id,TeamID:1,LineupSlotID:20});
             const p=d.tables.ModelPlayers.find(p=>p.PlayerID===id);
             Object.assign(p,{ActualPoints:score*5,Actual_PPG:score,Last3_PPG:score,ESPN_Projected_PPG:score,ESPN_Projected_Total:score*17});
             d.tables.ModelHistory.filter(h=>h.PlayerID===id).forEach(h=>{h.Points=score});
           }
           for(const [id,name,score] of [[2,'Their starter WR',9.72],[300,'Their bench WR',10.5]]) {
             Object.assign(d.tables.ModelPlayers.find(p=>p.PlayerID===id),{Player:name,ActualPoints:score*5,Actual_PPG:score,Last3_PPG:score,ESPN_Projected_PPG:score,ESPN_Projected_Total:score*17});
             d.tables.ModelHistory.filter(h=>h.PlayerID===id).forEach(h=>{h.Points=score});
           }
         }
         process.stdout.write(JSON.stringify(await fromTables(d.tables,d.settings)));`,
      ],
      { encoding: "utf8" },
    ),
  );
  const w: Workspace = {
    owner: "local",
    dataset,
    state: {
      ...initialState(dataset),
      draft: { teamA: "1", teamB: "2", give: ["101"], get: [] },
    },
    datasetRevision: 0,
    stateRevision: 0,
    pendingDataset: false,
    pendingState: false,
    requestId: "test",
    stateRequestId: "test",
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
  await page.goto("./#/trades");
  await expect(
    page.getByRole("heading", { name: "Find matching trades", exact: true }),
  ).toBeVisible();
  return dataset;
}
const panel = (page: Page) =>
  page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Find matching trades",
      exact: true,
    }),
  });

// Screen weekly averages in the actual worker, combine both teams' bounds, and preserve the disabled path.
test("weekly sliders filter exact averages for either or both teams without changing the horizon", async ({
  page,
}) => {
  await seed(page);
  const search = panel(page);
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("100");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("500");
  const ownToggle = search.getByLabel("Filter your weekly gain", {
    exact: true,
  });
  const otherToggle = search.getByLabel("Filter their weekly gain", {
    exact: true,
  });
  await expect(ownToggle).not.toBeChecked();
  await expect(otherToggle).not.toBeChecked();
  await ownToggle.check();
  await search
    .getByLabel("Your minimum weekly gain (points/week)", { exact: true })
    .fill("2");
  await expect(
    search.getByLabel("Your minimum weekly gain slider", { exact: true }),
  ).toHaveValue("2");
  // Slider movement writes the exact numeric field, and typing negative/wider limits is never clamped.
  await search
    .getByLabel("Your minimum weekly gain slider", { exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    search.getByLabel("Your minimum weekly gain (points/week)", {
      exact: true,
    }),
  ).toHaveValue("2.01");
  await search
    .getByLabel("Your minimum weekly gain (points/week)", { exact: true })
    .fill("2");
  await search
    .getByLabel("Your maximum weekly gain (points/week)", { exact: true })
    .fill("15");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("11 index matches.", { exact: false }),
  ).toBeVisible();
  await expect(
    search.getByText(/Trades excluded by weekly-gain limits: 1/),
  ).toBeVisible();
  await expect(
    search.getByRole("link", { name: "Incoming QB", exact: true }),
  ).toHaveCount(0);
  const first = search.locator("tbody tr").first();
  await first.getByText("Trade details", { exact: true }).click();
  await expect(first.getByText(/Your horizon gain:/)).toContainText("+180.00");
  await expect(first.locator("td").nth(2)).toHaveText("+15.00");
  // Both sides must pass: existing bench replacements hold their gain at +20/week, below this +21/week requirement.
  await otherToggle.check();
  await expect(
    first.getByRole("button", { name: "Load trade" }),
  ).toBeDisabled();
  await search
    .getByLabel("Their minimum weekly gain (points/week)", { exact: true })
    .fill("21");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("0 index matches.", { exact: false }),
  ).toBeVisible();
  await ownToggle.uncheck();
  await search
    .getByLabel("Their minimum weekly gain (points/week)", { exact: true })
    .fill("10");
  await search
    .getByLabel("Their maximum weekly gain (points/week)", { exact: true })
    .fill("20");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("12 index matches.", { exact: false }),
  ).toBeVisible();
  await expect(
    search
      .locator("tbody tr")
      .getByRole("link", { name: "Incoming QB", exact: true }),
  ).toBeVisible();
  await search
    .getByLabel("Their maximum weekly gain (points/week)", { exact: true })
    .fill("19.99");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("0 index matches.", { exact: false }),
  ).toBeVisible();
  // Disabled filters ignore remembered values; negative ranges, invalid order and blank limits have explicit semantics.
  await otherToggle.uncheck();
  await ownToggle.check();
  await search
    .getByLabel("Your minimum weekly gain (points/week)", { exact: true })
    .fill("-500");
  await search
    .getByLabel("Your maximum weekly gain (points/week)", { exact: true })
    .fill("500");
  await expect(
    search.getByLabel("Your minimum weekly gain slider", { exact: true }),
  ).toHaveAttribute("min", "-500");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await search.screenshot({ path: "test-results/trade-weekly-mobile.png" });
  await search
    .getByLabel("Your minimum weekly gain (points/week)", { exact: true })
    .fill("501");
  await expect(
    search.getByRole("button", { name: "Search", exact: true }),
  ).toBeDisabled();
  await expect(
    search.getByText("Your minimum weekly gain cannot exceed its maximum.", {
      exact: true,
    }),
  ).toBeVisible();
  await search
    .getByLabel("Your maximum weekly gain (points/week)", { exact: true })
    .fill("");
  await expect(
    search.getByRole("button", { name: "Search", exact: true }),
  ).toBeEnabled();
  await ownToggle.uncheck();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("12 index matches.", { exact: false }),
  ).toBeVisible();
  await expect(
    search.getByText(/Trades excluded by weekly-gain limits:/),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Outgoing player 1", { exact: true }),
  ).toHaveValue("101");
  await expect(
    page.getByLabel("Incoming player 1", { exact: true }),
  ).toHaveValue("");
});

// The optional worker filter uses current-roster Expected PPG, with a user's reserve eligible to improve their starter.
test("positional-upgrade filter supports starter, depth, either and disabled behavior", async ({
  page,
}) => {
  await seed(page, true);
  const search = panel(page);
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("100");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("500");
  const toggle = search.getByLabel(
    "Only show positional upgrades for the other team",
    { exact: true },
  );
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(
    search.getByLabel("Upgrade target", { exact: true }),
  ).toHaveValue("starter");
  await expect(
    search.getByLabel("Minimum Expected PPG upgrade", { exact: true }),
  ).toHaveValue("1");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("13 index matches.", { exact: false }),
  ).toBeVisible();
  const row = search.locator("tbody tr").filter({
    has: page.getByRole("link", { name: "Incoming QB", exact: true }),
  });
  await row.getByText("Trade details", { exact: true }).click();
  await expect(row.getByText(/Starter upgrade: Bench QB/)).toContainText(
    "+20.00 Expected PPG",
  );
  await expect(row.getByText(/Starter upgrade: Bench QB/)).toContainText(
    "Current-roster comparison before trade",
  );
  // Changing enabled criteria invalidates old results; raising the starter threshold excludes the team entirely.
  await search
    .getByLabel("Minimum Expected PPG upgrade", { exact: true })
    .fill("22");
  await expect(row.getByRole("button", { name: "Load trade" })).toBeDisabled();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("0 index matches.", { exact: false }),
  ).toBeVisible();
  await expect(
    search.getByText(/Teams excluded by positional-upgrade filter: 1/),
  ).toBeVisible();
  // Actual bench depth is a different target: this outgoing QB qualifies only for the bench at this threshold.
  for (const mode of ["depth", "either"]) {
    await search
      .getByLabel("Upgrade target", { exact: true })
      .selectOption(mode);
    if (mode === "either") {
      await search
        .getByLabel("Minimum starter upgrades", { exact: true })
        .fill("0");
      await search
        .getByLabel("Minimum bench upgrades", { exact: true })
        .fill("1");
    }
    await search.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      search.getByText("13 index matches.", { exact: false }),
    ).toBeVisible();
    await row.getByText("Trade details", { exact: true }).click();
    await expect(row.getByText(/Depth upgrade: Bench QB/)).toContainText(
      "+25.00 Expected PPG",
    );
  }
  // Reused controls and comparison details must remain contained within the mobile page width.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await search.screenshot({ path: "test-results/trade-upgrade-mobile.png" });
  // Invalid enabled thresholds block search, but disabling the filter ignores hidden criteria and restores all matches.
  await search
    .getByLabel("Minimum Expected PPG upgrade", { exact: true })
    .fill("");
  await expect(
    search.getByRole("button", { name: "Search", exact: true }),
  ).toBeDisabled();
  await toggle.uncheck();
  await expect(
    search.getByRole("button", { name: "Search", exact: true }),
  ).toBeEnabled();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("13 index matches.", { exact: false }),
  ).toBeVisible();
  await expect(
    search.getByText(/Teams excluded by positional-upgrade filter:/),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Outgoing player 1", { exact: true }),
  ).toHaveValue("101");
  await expect(
    page.getByLabel("Incoming player 1", { exact: true }),
  ).toHaveValue("");
});

// Reproduce both reported duplicate patterns through the actual search worker and rendered trade details.
test("upgrade assignments never reuse an opposing player or label one offer as both starter and depth", async ({
  page,
}) => {
  await seed(page, true, true);
  await page
    .getByLabel("Outgoing player 1", { exact: true })
    .selectOption("400");
  await page
    .getByLabel("Outgoing player 2", { exact: true })
    .selectOption("401");
  const search = panel(page);
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("100");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("500");
  await search
    .getByLabel("Only show positional upgrades for the other team", {
      exact: true,
    })
    .check();
  await search
    .getByLabel("Upgrade target", { exact: true })
    .selectOption("either");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("13 index matches.", { exact: false }),
  ).toBeVisible();
  const details = search.locator("tbody tr").first().locator("details");
  await details.locator("summary").click();
  await expect(details.getByText(/Starter upgrade: Offer WR A/)).toContainText(
    "Their starter WR",
  );
  await expect(details.getByText(/Depth upgrade: Offer WR B/)).toContainText(
    "Their bench WR",
  );
  await expect(
    details.getByText(/Starter upgrade:|Depth upgrade:/),
  ).toHaveCount(2);
  await expect(
    details.getByText(/Depth upgrade: Offer WR A|Starter upgrade: Offer WR B/),
  ).toHaveCount(0);
  await search
    .getByLabel("Upgrade target", { exact: true })
    .selectOption("starter");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("13 index matches.", { exact: false }),
  ).toBeVisible();
  await details.locator("summary").click();
  await expect(
    details.getByText(/Starter upgrade:|Depth upgrade:/),
  ).toHaveCount(1);
  await expect(
    details.getByText(/No distinct qualifying upgrade for:/),
  ).toContainText("Offer WR B");
  // A single benched QB qualifies for both roles, but Either must render only its prioritized starter assignment.
  await page
    .getByLabel("Outgoing player 1", { exact: true })
    .selectOption("101");
  await page.getByLabel("Outgoing player 2", { exact: true }).selectOption("");
  await search
    .getByLabel("Upgrade target", { exact: true })
    .selectOption("either");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("13 index matches.", { exact: false }),
  ).toBeVisible();
  await details.locator("summary").click();
  await expect(details.getByText(/Starter upgrade: Bench QB/)).toHaveCount(1);
  await expect(details.getByText(/Depth upgrade: Bench QB/)).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

// Exercise real worker results, player popovers, safe loading, context invalidation and numeric/slider controls.
test("single-player discovery agrees with the loaded analyzer and preserves outgoing players", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const d = await seed(page),
    search = panel(page);
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("100");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("100");
  await expect(search.getByLabel("Below outgoing total slider")).toHaveValue(
    "100",
  );
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("12 index matches.", { exact: false }),
  ).toBeVisible();
  const row = search.locator("tbody tr").filter({
    has: page.getByRole("link", { name: "Incoming QB", exact: true }),
  });
  await expect(row.locator("td").nth(2)).toHaveText("0.00");
  await row.getByRole("link", { name: "Incoming QB", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await row.getByRole("button", { name: "Load trade" }).click();
  await expect(
    page.getByLabel("Outgoing player 1", { exact: true }),
  ).toHaveValue("101");
  await expect(
    page.getByLabel("Incoming player 1", { exact: true }),
  ).toHaveValue("200");
  const r = evaluateTrade(evaluate(d, d.settings), {
    teamA: "1",
    teamB: "2",
    give: ["101"],
    get: ["200"],
  });
  if (!r.valid) throw Error(r.errors.join());
  const direct = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Your direct starter impact",
      exact: true,
    }),
  });
  await expect(
    direct
      .locator(".metric")
      .filter({
        has: page.getByText("Expected scoring gain / week", { exact: true }),
      })
      .locator("strong"),
  ).toHaveText(r.directA.expectedPerWeek!.toFixed(2));
  await expect(
    search.getByRole("button", { name: "Load trade" }).first(),
  ).toBeEnabled();
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("101");
  await expect(search.getByText(/Search inputs changed/)).toBeVisible();
  await expect(
    search.getByRole("button", { name: "Load trade" }).first(),
  ).toBeDisabled();
  // Reverting an edit cannot revive a terminated search worker or stale pagination.
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("100");
  await expect(
    search.getByRole("button", { name: "Load trade" }).first(),
  ).toBeDisabled();
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("");
  await expect(
    search.getByRole("button", { name: "Search", exact: true }),
  ).toBeDisabled();
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("500");
  await expect(
    search.getByLabel("Above outgoing total slider"),
  ).toHaveAttribute("max", "500");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await search.screenshot({ path: "test-results/trade-search-mobile.png" });
  expect(errors).toEqual([]);
});

// Package discovery must enumerate all matches before ranking and page beyond the first fifty without rerunning.
test("packages paginate complete results and load exactly the selected receive count", async ({
  page,
}) => {
  await seed(page);
  const search = panel(page);
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("100");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("500");
  await search.getByLabel("Create package", { exact: true }).check();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("66 index matches.", { exact: false }),
  ).toBeVisible();
  await expect(search.locator("tbody tr")).toHaveCount(50);
  await search.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(search.locator("tbody tr")).toHaveCount(66);
  // An injured player remains discoverable and its uncertainty is explicit in the result details.
  const injured = search
    .locator("tbody tr")
    .filter({
      has: page.getByRole("link", { name: "Search WR 0", exact: true }),
    })
    .first();
  await injured.getByText("Trade details", { exact: true }).click();
  await expect(
    injured.getByText("Search WR 0: QUESTIONABLE", { exact: true }),
  ).toBeVisible();
  await search.getByRole("button", { name: "Load trade" }).first().click();
  await expect(
    page.getByLabel("Outgoing player 1", { exact: true }),
  ).toHaveValue("101");
  await expect(
    page.getByLabel("Incoming player 2", { exact: true }),
  ).not.toHaveValue("");
  await expect(
    page.getByLabel("Incoming player 3", { exact: true }),
  ).toHaveValue("");
  // Exercise all remaining package counts through the actual worker and analyzer selectors.
  for (const [count, matches] of [
    [1, 12],
    [3, 220],
    [4, 495],
    [5, 792],
  ]) {
    await search
      .getByLabel("Players to receive", { exact: true })
      .selectOption(String(count));
    await search.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      search.getByText(`${matches} index matches.`, { exact: false }),
    ).toBeVisible({ timeout: 60000 });
    await search.getByRole("button", { name: "Load trade" }).first().click();
    await expect(
      page.getByLabel(`Incoming player ${count}`, { exact: true }),
    ).not.toHaveValue("");
    if (count < 5)
      await expect(
        page.getByLabel(`Incoming player ${count + 1}`, { exact: true }),
      ).toHaveValue("");
  }
  await search.screenshot({ path: "test-results/trade-search-desktop.png" });
});

// Cancellation/navigation must terminate real searches; a restart cannot receive an old request's completion.
test("large searches show progress and support cancel, restart and navigation", async ({
  page,
}) => {
  await seed(page);
  const search = panel(page);
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("100");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("500");
  await search.getByLabel("Create package", { exact: true }).check();
  await search
    .getByLabel("Players to receive", { exact: true })
    .selectOption("5");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  await search.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    search.getByText("Search cancelled.", { exact: true }),
  ).toBeVisible();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await search.getByLabel("Create package", { exact: true }).uncheck();
  await expect(search.getByText(/Search inputs changed/)).toBeVisible();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("12 index matches.", { exact: false }),
  ).toBeVisible();
  await search.getByLabel("Create package", { exact: true }).check();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await page.goto("./#/overview");
  await page.goto("./#/trades");
  await expect(
    panel(page).getByRole("button", { name: "Search", exact: true }),
  ).toBeVisible();
  await expect(panel(page).locator("tbody tr")).toHaveCount(0);
  // A successful empty search has its own result message, rather than resembling cancellation or failure.
  await panel(page)
    .getByRole("button", { name: "Search", exact: true })
    .click();
  await expect(
    panel(page).getByText("0 index matches.", { exact: false }),
  ).toBeVisible();
  await expect(
    panel(page).getByText(
      "No packages match this index range and incoming count.",
      { exact: true },
    ),
  ).toBeVisible();
});

// Combine the real worker's deficit controls with the same grades visible in Team Rosters.
test("deficit filtering selects one offered position and invalidates changed grade searches", async ({
  page,
}) => {
  await seed(page, false, true);
  const search = panel(page);
  await page
    .getByLabel("Outgoing player 2", { exact: true })
    .selectOption("400");
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("500");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("500");
  const toggle = search.getByLabel("Only teams with a positional deficit", {
    exact: true,
  });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(
    search.getByLabel("Deficit position", { exact: true }),
  ).toHaveValue("QB");
  await expect(
    search.getByLabel("Maximum position grade", { exact: true }),
  ).toHaveValue("C+");
  await search
    .getByLabel("Maximum position grade", { exact: true })
    .selectOption("F");
  await search
    .getByLabel("Only show positional upgrades for the other team", {
      exact: true,
    })
    .check();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("12 index matches.", { exact: false }),
  ).toBeVisible();
  const row = search.locator("tbody tr").first();
  await row.getByText("Trade details", { exact: true }).click();
  await expect(row.getByText(/Their QB grade:/)).toContainText(
    "F (required F or lower)",
  );
  await search
    .getByLabel("Deficit position", { exact: true })
    .selectOption("WR");
  await expect(row.getByRole("button", { name: "Load trade" })).toBeDisabled();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("0 index matches.", { exact: false }),
  ).toBeVisible();
  await expect(
    search.getByText(/Teams excluded by positional-deficit filter: 1/),
  ).toBeVisible();
  await search
    .getByLabel("Maximum position grade", { exact: true })
    .selectOption("A+");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("12 index matches.", { exact: false }),
  ).toBeVisible();
  // Removing the explicitly chosen WR offer requires a new valid position instead of silently using QB.
  await page.getByLabel("Outgoing player 2", { exact: true }).selectOption("");
  await expect(
    search.getByRole("button", { name: "Search", exact: true }),
  ).toBeDisabled();
  await expect(
    search.getByText(
      "Choose an offered deficit position and a valid grade ceiling.",
      { exact: true },
    ),
  ).toBeVisible();
  await toggle.uncheck();
  await expect(
    search.getByRole("button", { name: "Search", exact: true }),
  ).toBeEnabled();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("12 index matches.", { exact: false }),
  ).toBeVisible();
});

// Opening a match lazily explains both teams' actual slot changes, including bench promotions and bye weeks.
test("trade details show named weekly scoring replacements from the captured lineups", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page);
  await page
    .getByLabel("Outgoing player 1", { exact: true })
    .selectOption("100");
  const search = panel(page);
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("500");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("500");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("12 index matches.", { exact: false }),
  ).toBeVisible();
  const row = search.locator("tbody tr").filter({
    has: page.getByRole("link", { name: "Synthetic 2", exact: true }),
  });
  await row.getByText("Trade details", { exact: true }).click();
  await expect(
    row.getByText("Your scoring lineup", { exact: true }),
  ).toBeVisible();
  await expect(row.getByText(/Bench replacements: Bench QB/)).toBeVisible();
  await expect(row.getByText(/Bench replacements: Search WR 0/)).toBeVisible();
  await row
    .getByText("Your weekly scoring replacements", { exact: true })
    .click();
  const own = row
    .locator("details")
    .filter({
      has: page.locator("summary", {
        hasText: "Your weekly scoring replacements",
      }),
    })
    .last();
  await expect(own.getByText(/QB: Main QB/).first()).toContainText("Bench QB");
  await expect(own.getByText(/QB: Unfilled/)).toContainText("+30.00 points");
  await row
    .getByText("Their weekly scoring replacements", { exact: true })
    .click();
  const other = row
    .locator("details")
    .filter({
      has: page.locator("summary", {
        hasText: "Their weekly scoring replacements",
      }),
    })
    .last();
  await expect(other.getByText(/QB: Incoming QB/).first()).toContainText(
    "Main QB",
  );
  await expect(other.getByText(/WR: Synthetic 2/).first()).toContainText(
    "Search WR 0",
  );
  // Collapse the checked weekly rows before inspecting the compact scoring summaries.
  await row
    .getByText("Your weekly scoring replacements", { exact: true })
    .click();
  await row
    .getByText("Their weekly scoring replacements", { exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // Capture the full details column at desktop width; mobile containment is asserted above.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await row.locator("td").last().scrollIntoViewIfNeeded();
  await row.locator("td").last().screenshot({
    path: "test-results/trade-lineup-details-desktop.png",
  });
  expect(errors).toEqual([]);
});

// Required counts use distinct offers/opponents and both Either minimums in the actual search worker.
test("upgrade counts require all requested starter and bench matches", async ({
  page,
}) => {
  await seed(page, true, true);
  await page
    .getByLabel("Outgoing player 1", { exact: true })
    .selectOption("400");
  await page
    .getByLabel("Outgoing player 2", { exact: true })
    .selectOption("401");
  const search = panel(page);
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("500");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("500");
  await search
    .getByLabel("Only show positional upgrades for the other team", {
      exact: true,
    })
    .check();
  await expect(
    search.getByLabel("Minimum starter upgrades", { exact: true }),
  ).toHaveValue("1");
  await search
    .getByLabel("Minimum starter upgrades", { exact: true })
    .fill("2");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("0 index matches.", { exact: false }),
  ).toBeVisible();
  await expect(
    search.getByText(/Teams excluded by positional-upgrade filter: 1/),
  ).toBeVisible();
  await search
    .getByLabel("Upgrade target", { exact: true })
    .selectOption("either");
  await search
    .getByLabel("Minimum starter upgrades", { exact: true })
    .fill("1");
  await search.getByLabel("Minimum bench upgrades", { exact: true }).fill("1");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("13 index matches.", { exact: false }),
  ).toBeVisible();
  const row = search.locator("tbody tr").first();
  await row.getByText("Trade details", { exact: true }).click();
  await expect(row.getByText(/Starter upgrade:/)).toHaveCount(1);
  await expect(row.getByText(/Depth upgrade:/)).toHaveCount(1);
  await search.getByLabel("Minimum bench upgrades", { exact: true }).fill("2");
  await expect(row.getByRole("button", { name: "Load trade" })).toBeDisabled();
  await expect(
    search.getByRole("button", { name: "Search", exact: true }),
  ).toBeDisabled();
  await search
    .getByLabel("Minimum starter upgrades", { exact: true })
    .fill("0");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("0 index matches.", { exact: false }),
  ).toBeVisible();
  // Invalid fractional, zero-total and oversized counts block requests, but disabling the filter ignores them.
  await search.getByLabel("Minimum bench upgrades", { exact: true }).fill("0");
  await expect(
    search.getByRole("button", { name: "Search", exact: true }),
  ).toBeDisabled();
  await search
    .getByLabel("Minimum bench upgrades", { exact: true })
    .fill("1.5");
  await expect(
    search.getByText(
      /Requires at least 0 starter upgrades and Unavailable bench upgrades/,
    ),
  ).toBeVisible();
  await expect(
    search.getByRole("button", { name: "Search", exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await search.screenshot({
    path: "test-results/trade-upgrade-counts-mobile.png",
  });
  await search
    .getByLabel("Only show positional upgrades for the other team", {
      exact: true,
    })
    .uncheck();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("13 index matches.", { exact: false }),
  ).toBeVisible();
});

// Verify the actual worker uses their benched best QB and counts distinct positions instead of repeated QB comparisons.
test("best-at-position target compares the full roster and enforces distinct-position minimums", async ({
  page,
}) => {
  await seed(page, true, false, true);
  const search = panel(page);
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("500");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("500");
  await search
    .getByLabel("Only show positional upgrades for the other team", {
      exact: true,
    })
    .check();
  await search
    .getByLabel("Minimum Expected PPG upgrade", { exact: true })
    .fill("6");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("13 index matches.", { exact: false }),
  ).toBeVisible();
  await search
    .getByLabel("Upgrade target", { exact: true })
    .selectOption("best");
  await expect(
    search.getByLabel("Minimum positions upgraded", { exact: true }),
  ).toHaveValue("1");
  await expect(
    search.getByRole("button", { name: "Load trade" }).first(),
  ).toBeDisabled();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("0 index matches.", { exact: false }),
  ).toBeVisible();
  await search
    .getByLabel("Minimum Expected PPG upgrade", { exact: true })
    .fill("5");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("13 index matches.", { exact: false }),
  ).toBeVisible();
  const row = search.locator("tbody tr").first();
  await row.getByText("Trade details", { exact: true }).click();
  await expect(
    row.getByText(/Best-at-position upgrade: Bench QB/),
  ).toContainText("Depth QB (25.00)");
  await expect(
    row.getByText(/Best-at-position upgrade: Bench QB/),
  ).toContainText("+5.00 Expected PPG");
  await expect(row.getByText(/Starter upgrade:|Depth upgrade:/)).toHaveCount(0);
  // A second QB offer does not create a second position or permit reusing their best QB.
  await page
    .getByLabel("Outgoing player 2", { exact: true })
    .selectOption("100");
  await search
    .getByLabel("Minimum positions upgraded", { exact: true })
    .fill("2");
  await expect(
    search.getByRole("button", { name: "Search", exact: true }),
  ).toBeDisabled();
  await expect(
    search.getByText(
      "The best-at-position minimum cannot exceed the number of distinct offered positions.",
      { exact: true },
    ),
  ).toBeVisible();
  await search
    .getByLabel("Minimum positions upgraded", { exact: true })
    .fill("1");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("13 index matches.", { exact: false }),
  ).toBeVisible();
  await row.getByText("Trade details", { exact: true }).click();
  await expect(row.getByText(/Best-at-position upgrade:/)).toHaveCount(1);
  await expect(
    row.getByText(/No distinct qualifying upgrade for:/),
  ).toContainText("Main QB");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await search.screenshot({
    path: "test-results/trade-best-position-mobile.png",
  });
});
