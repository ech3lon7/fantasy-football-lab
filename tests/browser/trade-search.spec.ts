import { test, expect, type Page, type Locator } from "@playwright/test";
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
  incomingSignals = false,
  guided = false,
  teamFilter = false,
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
         // Only incoming-filter tests need genuine domain-derived Gem/Watch labels; existing fixtures stay unchanged.
         if(${incomingSignals}) {
           for(const [id,score,targets] of [[2,18,[8,8,8,8,8]],[301,10,[2,2,8,8,8]],[302,10,[2,2,2,2,2]]]) {
             Object.assign(d.tables.ModelPlayers.find(p=>p.PlayerID===id),{ActualPoints:score*5,Actual_PPG:score,Last3_PPG:score,ScoreSD:0,ESPN_Projected_PPG:score,ESPN_Projected_Total:score*17});
             d.tables.ModelHistory.filter(h=>h.PlayerID===id).forEach((h,i)=>Object.assign(h,{Points:score,Targets:targets[i]}));
           }
         }
         // Only opponent-scope tests need more than one counterparty; all other browser fixtures stay unchanged.
         if(${teamFilter}) {
           d.tables.ModelContext[0].TeamCount=4;
           for(const team of [3,4]) {
             d.tables.ModelTeams.push({TeamID:team,TeamName:'Test '+team});
             for(const baseID of [200,2]) {
               const id=team*1000+baseID;
               const base=d.tables.ModelPlayers.find(p=>p.PlayerID===baseID);
               d.tables.ModelPlayers.push({...base,PlayerID:id,Player:'Team '+team+' '+base.Position,OnTeamID:team});
               d.tables.ModelHistory.push(...d.tables.ModelHistory.filter(h=>h.PlayerID===baseID).map(h=>({...h,PlayerID:id})));
               d.tables.ModelRosters.push({PlayerID:id,TeamID:team,LineupSlotID:baseID===200?0:4});
             }
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
  if (guided) return dataset;
  const search = panel(page);
  await search.getByLabel("Search goal", { exact: true }).selectOption("custom");
  await search.getByLabel("Use strict index range", { exact: true }).check();
  await search.getByLabel("Create package", { exact: true }).uncheck();
  return dataset;
}
const panel = (page: Page) =>
  page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Find matching trades",
      exact: true,
    }),
  });

// Zero qualified rows must explain that enumeration succeeded; outgoing pools do not implicitly enable multi-player returns.
test("pooled search shows its actual incoming scope and explains weekly-limit exclusions", async ({
  page,
}) => {
  await seed(page);
  const search = panel(page);
  await search
    .getByLabel("Find outgoing combinations", { exact: true })
    .check();
  await expect(
    search.getByLabel("Search package scope", { exact: true }),
  ).toHaveText("Offer 1 of 1 pooled players · Receive 1 player from one team.");
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("1000");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("1000");
  await search.getByLabel("Filter your weekly gain", { exact: true }).check();
  await search.getByLabel("Your minimum weekly gain (points/week)", { exact: true }).fill("1000");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByRole("status").filter({
      hasText:
        "12 index-matched trades were evaluated; 12 failed your weekly-gain limits.",
    }),
  ).toBeVisible();
  await search.getByLabel("Create package", { exact: true }).check();
  await expect(
    search.getByLabel("Search package scope", { exact: true }),
  ).toContainText("Receive 1–3 players");
});

// Clear optional restrictions in one action without silently unprotecting players or changing the selected trade's structure.
test("clear filters restores defaults and removes results while preserving players and package choices", async ({
  page,
}) => {
  await seed(page);
  const search = panel(page);
  await page
    .getByLabel("Incoming player 1", { exact: true })
    .selectOption("200");
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("1000");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("1000");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("12 index matches.", { exact: false }),
  ).toBeVisible();
  await search
    .getByLabel("Find outgoing combinations", { exact: true })
    .check();
  await search.getByText(/Tradable pool \(1 selected/).click();
  await search.getByLabel("Tradable Main QB", { exact: true }).check();
  await search
    .getByLabel("Maximum outgoing players", { exact: true })
    .fill("2");
  await search.getByLabel("Create package", { exact: true }).check();
  await search
    .getByLabel("Maximum players to receive", { exact: true })
    .selectOption("2");
  await search
    .getByRole("combobox", { name: "Required incoming player", exact: true })
    .selectOption("200");
  await search
    .getByRole("combobox", { name: "Rank trades by", exact: true })
    .selectOption("balanced");
  await search
    .getByLabel("Show near misses and adjustments", { exact: true })
    .check();
  for (const label of [
    "Gem",
    "Watch",
    "Receive QB",
    "Every offered player must be useful to the other team",
    "Only show positional upgrades for the other team",
    "Only teams with a positional deficit",
    "Filter your weekly gain",
    "Filter their weekly gain",
  ])
    await search.getByLabel(label, { exact: true }).check();
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("");
  await expect(
    search.getByRole("button", { name: "Search", exact: true }),
  ).toBeDisabled();
  await search
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(
    search.getByRole("button", { name: "Search", exact: true }),
  ).toBeEnabled();
  await expect(search.locator("tbody tr")).toHaveCount(0);
  await expect(
    search.getByLabel("Use strict index range", { exact: true }),
  ).not.toBeChecked();
  await search.getByLabel("Use strict index range", { exact: true }).check();
  for (const label of [
    "Below outgoing total (index points)",
    "Above outgoing total (index points)",
  ])
    await expect(search.getByLabel(label, { exact: true })).toHaveValue("5");
  for (const label of [
    "Gem",
    "Watch",
    "Receive QB",
    "Every offered player must be useful to the other team",
    "Only show positional upgrades for the other team",
    "Only teams with a positional deficit",
    "Filter your weekly gain",
    "Filter their weekly gain",
    "Show near misses and adjustments",
  ])
    await expect(search.getByLabel(label, { exact: true })).not.toBeChecked();
  await expect(
    search.getByRole("combobox", {
      name: "Required incoming player",
      exact: true,
    }),
  ).toHaveValue("");
  await expect(
    search.getByRole("combobox", { name: "Rank trades by", exact: true }),
  ).toHaveValue("own");
  // Pool protections, search sizes and the ordinary analyzer selections remain exactly as chosen.
  await expect(
    search.getByLabel("Find outgoing combinations", { exact: true }),
  ).toBeChecked();
  await expect(
    search.getByLabel("Tradable Main QB", { exact: true }),
  ).toBeChecked();
  await expect(
    search.getByLabel("Tradable Bench QB", { exact: true }),
  ).toBeChecked();
  await expect(
    search.getByLabel("Tradable Synthetic 1", { exact: true }),
  ).not.toBeChecked();
  await expect(
    search.getByLabel("Maximum outgoing players", { exact: true }),
  ).toHaveValue("2");
  await expect(
    search.getByLabel("Create package", { exact: true }),
  ).toBeChecked();
  await expect(
    search.getByLabel("Minimum players to receive", { exact: true }),
  ).toHaveValue("1");
  await expect(
    search.getByLabel("Maximum players to receive", { exact: true }),
  ).toHaveValue("2");
  await expect(
    page.getByLabel("Outgoing player 1", { exact: true }),
  ).toHaveValue("101");
  await expect(
    page.getByLabel("Incoming player 1", { exact: true }),
  ).toHaveValue("200");
  await page.setViewportSize({ width: 390, height: 844 });
  await search
    .getByRole("button", { name: "Clear filters", exact: true })
    .screenshot({ path: "test-results/clear-trade-filters-mobile.png" });
  // Clearing during enumeration terminates that search and removes its progress/results without changing package sizes.
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("1000");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("1000");
  await search
    .getByLabel("Maximum players to receive", { exact: true })
    .selectOption("5");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  await search
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(
    search.getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveCount(0);
  await expect(search.locator("tbody tr")).toHaveCount(0);
  await expect(
    search.getByLabel("Maximum players to receive", { exact: true }),
  ).toHaveValue("5");
});
// The worker applies the minimum to the original roster and still checks role eligibility for each complete package.
test("usefulness filters complete packages, explains the replacement and invalidates edited thresholds", async ({
  page,
}) => {
  await seed(page, true);
  const search = panel(page);
  const toggle = search.getByLabel(
    "Every offered player must be useful to the other team",
    { exact: true },
  );
  expect(await toggle.isChecked()).toBe(false);
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("1000");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("1000");
  await search.getByLabel("Receive QB", { exact: true }).check();
  await toggle.check();
  const minimum = search.getByLabel(
    "Minimum usefulness improvement (Expected PPG)",
    { exact: true },
  );
  await expect(minimum).toHaveValue("1");
  await minimum.fill("20");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("2 index matches.", { exact: false }),
  ).toBeVisible();
  const row = search.locator("tbody tr").filter({
    has: page.getByRole("link", { name: "Incoming QB", exact: true }),
  });
  await expect(
    row.getByRole("link", { name: "Incoming QB", exact: true }),
  ).toBeVisible();
  await row.getByText("Trade details", { exact: true }).click();
  await expect(
    row.getByText("1/1 players useful", { exact: true }),
  ).toBeVisible();
  await row.getByText("Usefulness comparisons", { exact: true }).click();
  await expect(row.getByText(/Useful starter:/)).toContainText("Incoming QB");
  await expect(row.getByText(/Useful starter:/)).toContainText(
    "+20.00 Expected PPG",
  );
  await expect(row.getByText(/Useful starter:/)).toContainText(
    "Required improvement: +20.00 Expected PPG per player",
  );
  await expect(row.getByText(/Useful starter:/)).not.toContainText("vacant");
  // Enabled controls and named comparison details stay contained on a phone-sized viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await search.screenshot({ path: "test-results/trade-usefulness-mobile.png" });
  await openExclusions(search);
  await expect(
    search.getByText(
      /Trades excluded because not every offered player is useful: 0/,
    ),
  ).toBeVisible();
  await minimum.fill("20.000001");
  await expect(row.getByRole("button", { name: "Load trade" })).toBeEnabled();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("0 index matches.", { exact: false }),
  ).toBeVisible();
  await minimum.fill("");
  await expect(
    search.getByRole("button", { name: "Search", exact: true }),
  ).toBeDisabled();
  await toggle.uncheck();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("2 index matches.", { exact: false }),
  ).toBeVisible();
});

// A single worker search returns mixed incoming sizes, and saving a one-player result preserves the original search range.
test("incoming range returns singles and packages together and restores saved bounds", async ({
  page,
}) => {
  await seed(page);
  const search = panel(page);
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("1000");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("1000");
  await search.getByLabel("Create package", { exact: true }).check();
  await expect(
    search.getByLabel("Minimum players to receive", { exact: true }),
  ).toHaveValue("1");
  await expect(
    search.getByLabel("Maximum players to receive", { exact: true }),
  ).toHaveValue("3");
  await search
    .getByLabel("Find a target player", { exact: true })
    .fill("Incoming QB");
  await search
    .getByRole("combobox", { name: "Required incoming player", exact: true })
    .selectOption("200");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("67 index matches.", { exact: false }),
  ).toBeVisible();
  await search.getByRole("button", { name: "Show more", exact: true }).click();
  const rows = search.locator("tbody tr");
  await expect(rows).toHaveCount(67);
  const sizes = new Set<number>();
  let single: Locator | undefined;
  for (const row of await rows.all()) {
    const count = await row.locator("td").first().getByRole("link").count();
    sizes.add(count);
    if (count === 1) single = row;
  }
  expect(sizes).toEqual(new Set([1, 2, 3]));
  await single!
    .getByRole("button", { name: "Save trade", exact: true })
    .click();
  const saved = JSON.parse(
    (await storedWorkspace(page)).state.filters.savedTrades,
  ).trades[0];
  expect(saved.draft.get).toEqual(["200"]);
  expect(saved.query.discovery.receive).toEqual({ minimum: 1, maximum: 3 });
  await single!
    .getByRole("button", { name: "Load trade", exact: true })
    .click();
  await expect(
    page.getByLabel("Incoming player 1", { exact: true }),
  ).toHaveValue("200");
  await expect(
    page.getByLabel("Incoming player 2", { exact: true }),
  ).toHaveValue("");
  // Changing the range invalidates old results; loading the saved search restores both endpoints rather than its result's size.
  await search
    .getByLabel("Minimum players to receive", { exact: true })
    .selectOption("2");
  const collection = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Saved trades", exact: true }),
    });
  await collection.locator("summary").click();
  await collection
    .getByRole("button", { name: "Load saved trade", exact: true })
    .click();
  await expect(
    search.getByLabel("Minimum players to receive", { exact: true }),
  ).toHaveValue("1");
  await expect(
    search.getByLabel("Maximum players to receive", { exact: true }),
  ).toHaveValue("3");
  await search
    .getByLabel("Minimum players to receive", { exact: true })
    .selectOption("4");
  await expect(
    search.getByRole("button", { name: "Search", exact: true }),
  ).toBeDisabled();
  await expect(search).toContainText("minimum no greater than maximum");
  await search
    .getByLabel("Minimum players to receive", { exact: true })
    .selectOption("1");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await search
    .getByRole("group", { name: "Value range", exact: true })
    .screenshot({ path: "test-results/incoming-range-mobile.png" });
});
// Flexible discovery preserves protected players and the exact outgoing subset through worker details, saving and loading.
test("flexible targeted discovery ranks packages and saves the actual outgoing players", async ({
  page,
}) => {
  await seed(page);
  const search = panel(page);
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("1000");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("1000");
  await search
    .getByLabel("Find outgoing combinations", { exact: true })
    .check();
  await search.getByText(/Tradable pool \(1 selected/).click();
  await search.getByLabel("Tradable Main QB", { exact: true }).check();
  await expect(
    search.getByLabel("Tradable Synthetic 1", { exact: true }),
  ).not.toBeChecked();
  await search
    .getByLabel("Maximum outgoing players", { exact: true })
    .fill("2");
  await search
    .getByLabel("Find a target player", { exact: true })
    .fill("Incoming QB");
  await search
    .getByRole("combobox", { name: "Required incoming player", exact: true })
    .selectOption("200");
  await search
    .getByRole("combobox", { name: "Rank trades by", exact: true })
    .selectOption("balanced");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("3 index matches.", { exact: false }),
  ).toBeVisible();
  const rows = search.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  const row = rows.filter({
    has: page.locator("small").filter({ hasText: /^Offer: Main QB$/ }),
  });
  await expect(row).toHaveCount(1);
  await row.getByText("Trade details", { exact: true }).click();
  await row
    .getByText("Why the other team might accept", { exact: true })
    .click();
  await expect(row).toContainText(/not an acceptance probability/i);
  // Compact evidence is available with no upgrade/usefulness filters and retains named, numeric role comparisons.
  const incentive = row
    .getByText("Why the other team might accept", { exact: true })
    .locator("..");
  await expect(incentive).toContainText(/QB F →/);
  await expect(incentive).toContainText("Starter:");
  await expect(incentive).toContainText("Incoming QB");
  await expect(incentive).toContainText("Main QB");
  await expect(incentive).toContainText("+10.00 EPPG");
  await expect(incentive).not.toContainText("Their surplus received:");
  await incentive.screenshot({ path: "test-results/compact-trade-upgrades.png" });
  await row.getByRole("button", { name: "Save trade", exact: true }).click();
  const saved = JSON.parse(
    (await storedWorkspace(page)).state.filters.savedTrades,
  ).trades[0];
  expect(saved.draft.give).toEqual(["100"]);
  expect(saved.query.discovery).toMatchObject({
    target: "200",
    ranking: "balanced",
    flexible: { pool: ["101", "100"], minimum: 1, maximum: 2 },
  });
  await search
    .getByRole("group", { name: "Search approach", exact: true })
    .screenshot({ path: "test-results/discovery-controls.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await row.getByRole("button", { name: "Load trade", exact: true }).click();
  await expect(
    page.getByLabel("Outgoing player 1", { exact: true }),
  ).toHaveValue("100");
  await expect(
    page.getByLabel("Outgoing player 2", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByLabel("Incoming player 1", { exact: true }),
  ).toHaveValue("200");
  // Loading the saved entry restores discovery controls as well as the chosen actual trade.
  await search
    .getByLabel("Find outgoing combinations", { exact: true })
    .uncheck();
  await search
    .getByRole("combobox", { name: "Rank trades by", exact: true })
    .selectOption("own");
  await search
    .getByRole("combobox", { name: "Required incoming player", exact: true })
    .selectOption("");
  const collection = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Saved trades", exact: true }),
    });
  await collection.locator("summary").click();
  await collection
    .getByRole("button", { name: "Load saved trade", exact: true })
    .click();
  await expect(
    search.getByLabel("Find outgoing combinations", { exact: true }),
  ).toBeChecked();
  await expect(
    search.getByRole("combobox", {
      name: "Required incoming player",
      exact: true,
    }),
  ).toHaveValue("200");
  await expect(
    search.getByRole("combobox", { name: "Rank trades by", exact: true }),
  ).toHaveValue("balanced");
  await expect(
    search.getByLabel("Maximum outgoing players", { exact: true }),
  ).toHaveValue("2");
});

// A nearby two-player counteroffer can meet the scoring goal without being misrepresented as the requested one-player match.
test("near misses show evaluated package adjustments and explicit failed limits separately", async ({
  page,
}) => {
  await seed(page);
  const search = panel(page);
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("1000");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("1000");
  await search
    .getByRole("combobox", { name: "Required incoming player", exact: true })
    .selectOption("200");
  await search.getByLabel("Filter your weekly gain", { exact: true }).check();
  await search
    .getByLabel("Your minimum weekly gain (points/week)", { exact: true })
    .fill("1");
  await search
    .getByLabel("Show near misses and adjustments", { exact: true })
    .check();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("0 index matches.", { exact: false }),
  ).toBeVisible();
  await search.getByText(/Near misses and possible adjustments/).click();
  const suggestions = search.locator(".search-adjustments");
  await expect(suggestions).toContainText(
    "Adjustment: receive 2 players instead of 1.",
  );
  await expect(
    suggestions.getByRole("link", { name: "Incoming QB", exact: true }).first(),
  ).toBeVisible();
  // Even a stale, zero-exact-match result retains its evaluated alternatives when new filter input is invalid.
  await search.getByLabel("Above outgoing total (index points)", { exact: true }).fill("");
  await expect(suggestions.getByRole("button", { name: "Inspect this alternative", exact: true }).first()).toBeEnabled();
  await suggestions
    .getByRole("button", { name: "Inspect this alternative", exact: true })
    .first()
    .click();
  await expect(
    page.getByLabel("Outgoing player 1", { exact: true }),
  ).toHaveValue("101");
  await expect(
    page.getByLabel("Incoming player 2", { exact: true }),
  ).not.toHaveValue("");
});

// Exclusion counts are intentionally collapsed; opening them never reruns or relaxes a search.
async function openExclusions(search: Locator) {
  const summary = search.getByText("Why trades were excluded", { exact: true });
  if ((await summary.locator("..").getAttribute("open")) === null)
    await summary.click();
}

// Help opens only on hover; focus, typing and touch retain normal input behavior without unwanted popups.
test("filter help is unobtrusive accessible and does not change controls or saved query state", async ({
  page,
  browser,
}) => {
  await seed(page);
  await page.clock.install();
  const search = panel(page);
  for (const name of [
    "Value range",
    "Incoming players",
    "Roster fit",
    "Scoring impact",
  ])
    await expect(
      search.getByRole("group", { name, exact: true }),
    ).toBeVisible();
  const label = "Every offered player must be useful to the other team";
  const toggle = search.getByRole("checkbox", { name: label, exact: true });
  const before = await storedWorkspace(page);
  await expect(page.getByRole("button", { name: /^Help:/ })).toHaveCount(0);
  await expect(page.getByText("ⓘ", { exact: true })).toHaveCount(0);
  expect(
    await toggle.evaluate((element) => getComputedStyle(element).cursor),
  ).not.toBe("help");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await search.getByText(label, { exact: true }).hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(page.getByRole("tooltip")).toContainText(
    "independently of marked starters",
  );
  await expect(toggle).toHaveAttribute(
    "aria-describedby",
    (await page.getByRole("tooltip").getAttribute("id")) as string,
  );
  await page.getByRole("tooltip").hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await toggle.focus();
  await page.clock.runFor(800);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await toggle.check();
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(
    search.locator("p").filter({ hasText: "Every offer must improve" }),
  ).toHaveCount(0);
  await expect(
    search.getByLabel("Minimum usefulness improvement (Expected PPG)", {
      exact: true,
    }),
  ).toHaveValue("1");
  await search
    .getByRole("button", {
      name: "Remove Every offer useful ≥ 1 Expected PPG",
      exact: true,
    })
    .click();
  await expect(toggle).not.toBeChecked();
  // A real touch tap toggles the checkbox exactly once without opening hover help.
  const touchPage = await browser.newPage({
    baseURL: new URL("./", page.url()).href,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  await seed(touchPage);
  const touchToggle = panel(touchPage).getByRole("checkbox", {
    name: label,
    exact: true,
  });
  await touchToggle.tap();
  await expect(touchToggle).toBeChecked();
  await expect(touchPage.getByRole("tooltip")).toHaveCount(0);
  await touchPage.screenshot({
    path: "test-results/filter-help-mobile.png",
  });
  await touchPage
    .getByRole("heading", { name: "Find matching trades", exact: true })
    .tap();
  await expect(touchPage.getByRole("tooltip")).toHaveCount(0);
  await touchPage.close();
  expect((await storedWorkspace(page)).state).toEqual(before.state);
  // Shared screen controls retain the same help behavior outside trade search.
  await page.goto("./#/gems");
  const trendInput = page.getByLabel("Minimum trend PPG", { exact: true });
  // Typing cancels pending hover help, and dismisses an already open tooltip without reopening it.
  await trendInput.focus();
  await trendInput.hover();
  await trendInput.pressSequentially("2");
  await page.clock.runFor(800);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.mouse.move(0, 0);
  await trendInput.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await trendInput.pressSequentially("3");
  await page.clock.runFor(800);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(trendInput).toHaveValue("23");
  await trendInput.fill("");
  await page.mouse.move(0, 0);
  await page
    .getByText("Minimum trend PPG", { exact: true })
    .hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "16 recent minus 12 earlier gives +4",
  );
  await expect(
    page.getByLabel("Minimum trend PPG", { exact: true }),
  ).toHaveValue("");
  await page.keyboard.press("Escape");
  await page.goto("./#/players");
  await page
    .getByText("Ownership", { exact: true })
    .hover();
  await expect(page.getByRole("tooltip")).toContainText("free agents/waivers");
  await page.keyboard.press("Escape");
  await page
    .getByRole("combobox", { name: "Position", exact: true })
    .selectOption("QB");
  await expect(
    page.getByRole("button", { name: "Remove player position", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove player position", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Position", exact: true }),
  ).toHaveValue("All");
});

// Read persisted state only after IndexedDB's write transaction completes, matching the application's reload path.
async function storedWorkspace(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fantasy-football-lab", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise<Workspace>((resolve, reject) => {
      const request = db
        .transaction("current")
        .objectStore("current")
        .get("local");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value;
  });
}

// Change the imported snapshot through the same persisted workspace to check recalculation and automatic ownership cleanup.
async function replaceSnapshot(page: Page, dataset: Dataset) {
  await page.evaluate(async (value) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("fantasy-football-lab", 1);
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction("current", "readwrite"),
      store = tx.objectStore("current");
    const get = store.get("local");
    get.onsuccess = () => store.put({ ...get.result, dataset: value }, "local");
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, dataset);
  await page.reload();
}

// Exercise real model labels and the existing search worker, including OR labels, intersected positions and package counts.
test("incoming Gem/Watch and position filters intersect without changing existing ranking", async ({
  page,
}) => {
  const dataset = await seed(page, false, false, false, true);
  const model = evaluate(dataset, dataset.settings);
  expect(model.byId.get("2")?.gem).toBe("Gem");
  expect(model.byId.get("301")?.gem).toBe("Watch");
  const search = panel(page);
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("1000");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("1000");
  const run = async () => {
    await search.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      search.getByRole("button", { name: "Cancel", exact: true }),
    ).toHaveCount(0);
    await expect(search.locator("tbody tr").first()).toBeVisible();
  };
  await run();
  const original = await search
    .locator("tbody tr td:first-child")
    .allTextContents();
  await search.getByLabel("Gem", { exact: true }).check();
  await search.getByLabel("Receive WR", { exact: true }).check();
  await expect(
    search.getByRole("button", { name: "Load trade" }).first(),
  ).toBeEnabled();
  await run();
  await expect(search.locator("tbody tr")).toHaveCount(1);
  await expect(
    search
      .locator("tbody")
      .getByRole("link", { name: model.byId.get("2")!.name, exact: true }),
  ).toBeVisible();
  await search.getByLabel("Watch", { exact: true }).check();
  await run();
  await expect(search.locator("tbody tr")).toHaveCount(2);
  await search.getByLabel("Create package", { exact: true }).check();
  await search
    .getByLabel("Minimum players to receive", { exact: true })
    .selectOption("2");
  await search
    .getByLabel("Maximum players to receive", { exact: true })
    .selectOption("2");
  await search
    .getByLabel("Minimum incoming Gem/Watch matches", { exact: true })
    .fill("2");
  await search
    .getByLabel("Minimum incoming position matches", { exact: true })
    .fill("2");
  await run();
  await expect(search.locator("tbody tr")).toHaveCount(1);
  await expect(
    search
      .locator("tbody")
      .getByRole("link", { name: "Search WR 1", exact: true }),
  ).toBeVisible();
  // Changing position cannot qualify an unrelated QB just because a Gem WR occurs elsewhere in the package.
  await search.getByLabel("Receive WR", { exact: true }).uncheck();
  await search.getByLabel("Receive QB", { exact: true }).check();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("0 index matches.", { exact: false }),
  ).toBeVisible();
  await search.getByLabel("Gem", { exact: true }).uncheck();
  await search.getByLabel("Watch", { exact: true }).uncheck();
  await search.getByLabel("Receive QB", { exact: true }).uncheck();
  await search.getByLabel("Create package", { exact: true }).uncheck();
  await run();
  expect(
    await search.locator("tbody tr td:first-child").allTextContents(),
  ).toEqual(original);
});

// Persist a result, preserve its original summary, restore the entire query and deduplicate saves from the analyzer.
test("saved trades persist names notes and original results and restore the saved search", async ({
  page,
}) => {
  await seed(page, false, false, false, true);
  const search = panel(page);
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("1000");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("1000");
  await search.getByLabel("Gem", { exact: true }).check();
  await search.getByLabel("Receive WR", { exact: true }).check();
  // The new optional filter survives saved-trade loading through the existing query schema and state store.
  await search
    .getByLabel("Every offered player must be useful to the other team", {
      exact: true,
    })
    .check();
  await search
    .getByLabel("Minimum usefulness improvement (Expected PPG)", {
      exact: true,
    })
    .fill("1.5");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByRole("button", { name: "Save trade", exact: true }),
  ).toBeEnabled();
  await search.getByRole("button", { name: "Save trade", exact: true }).click();
  const saved = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Saved trades", exact: true }),
    });
  await expect(saved.locator("details")).toHaveCount(1);
  await saved.locator("summary").click();
  await expect(
    saved.getByRole("row").filter({
      has: page.getByRole("cell", { name: /^Current/, exact: false }),
    }),
  ).toBeVisible();
  await saved.getByLabel("Saved trade name", { exact: true }).fill("WR target");
  await saved
    .getByLabel("Saved trade notes", { exact: true })
    .fill("Ask about this package next week.");
  await saved
    .getByRole("button", { name: "Save details", exact: true })
    .click();
  await expect
    .poll(async () => (await storedWorkspace(page)).state.filters.savedTrades)
    .toContain("WR target");
  const original = JSON.parse(
    (await storedWorkspace(page)).state.filters.savedTrades,
  ).trades[0].original;
  await page.reload();
  await expect(saved.getByText(/WR target ·/)).toBeVisible();
  await saved.locator("summary").click();
  await expect(
    saved.getByLabel("Saved trade notes", { exact: true }),
  ).toHaveValue("Ask about this package next week.");
  await saved
    .getByRole("button", { name: "Load saved trade", exact: true })
    .click();
  await expect(search.getByLabel("Gem", { exact: true })).toBeChecked();
  await expect(search.getByLabel("Receive WR", { exact: true })).toBeChecked();
  await expect(
    search.getByLabel("Every offered player must be useful to the other team", {
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    search.getByLabel("Minimum usefulness improvement (Expected PPG)", {
      exact: true,
    }),
  ).toHaveValue("1.5");
  await expect(
    search.getByLabel("Below outgoing total (index points)", { exact: true }),
  ).toHaveValue("1000");
  await expect(
    page.getByLabel("Incoming player 1", { exact: true }),
  ).toHaveValue("2");
  await expect(
    page.getByRole("button", { name: "Save current trade", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Save current trade", exact: true })
    .click();
  await expect(saved.locator("details")).toHaveCount(1);
  const updated = JSON.parse(
    (await storedWorkspace(page)).state.filters.savedTrades,
  ).trades;
  expect(updated[0].original).toEqual(original);
  expect(updated[0].notes).toBe("Ask about this package next week.");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await saved.screenshot({ path: "test-results/saved-trades-mobile.png" });
  await saved
    .getByRole("button", { name: "Delete saved trade", exact: true })
    .click();
  await expect(saved.getByText(/No saved trades yet/)).toBeVisible();
});

// New source data recalculates current summaries while ownership changes remove obsolete trades even outside the analyzer.
test("saved trades refresh current points and automatically remove ownership-invalid packages", async ({
  page,
}) => {
  const dataset = await seed(page);
  await page
    .getByLabel("Incoming player 1", { exact: true })
    .selectOption("200");
  await expect(
    page.getByRole("button", { name: "Save current trade", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Save current trade", exact: true })
    .click();
  await expect
    .poll(
      async () => (await storedWorkspace(page)).state.filters.savedTrades ?? "",
    )
    .toContain('"get":["200"]');
  const original = JSON.parse(
    (await storedWorkspace(page)).state.filters.savedTrades,
  ).trades[0].original;
  // A synthetic source refresh raises the received QB's scores without changing player ownership or the saved draft.
  Object.assign(
    dataset.tables.ModelPlayers.find((p) => p.PlayerID === 200)!,
    {
      ActualPoints: 175,
      Actual_PPG: 35,
      Last3_PPG: 35,
      ESPN_Projected_PPG: 35,
      ESPN_Projected_Total: 595,
    },
  );
  dataset.tables.ModelHistory.filter((h) => h.PlayerID === 200).forEach((h) => {
    h.Points = 35;
  });
  dataset.hash = "f".repeat(64);
  await replaceSnapshot(page, dataset);
  const saved = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Saved trades", exact: true }),
    });
  await saved.locator("summary").click();
  const currentRow = saved.getByRole("row").filter({
    has: page.getByRole("cell", { name: /^Current/, exact: false }),
  });
  await expect(currentRow).toBeVisible();
  const expected = evaluateTrade(
    evaluate(dataset, dataset.settings),
    { teamA: "1", teamB: "2", give: ["101"], get: ["200"] },
    true,
  );
  expect(expected.valid).toBe(true);
  if (expected.valid)
    await expect(currentRow.locator("td").nth(1).locator("strong")).toHaveText(
      "+" + expected.potentialA.expectedPerWeek!.toFixed(2),
    );
  expect(
    JSON.parse((await storedWorkspace(page)).state.filters.savedTrades)
      .trades[0].original,
  ).toEqual(original);
  await page.goto("./#/overview");
  dataset.tables.ModelPlayers.find((p) => p.PlayerID === 200)!.OnTeamID = 0;
  dataset.hash = "e".repeat(64);
  await replaceSnapshot(page, dataset);
  await expect
    .poll(
      async () =>
        JSON.parse((await storedWorkspace(page)).state.filters.savedTrades)
          .trades.length,
    )
    .toBe(0);
  expect((await storedWorkspace(page)).pendingState).toBe(true);
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
  await openExclusions(search);
  await expect(
    search.getByText(/Trades excluded by weekly-gain limits: 1/),
  ).toBeVisible();
  await expect(
    search.getByRole("link", { name: "Incoming QB", exact: true }),
  ).toHaveCount(0);
  const first = search.locator("tbody tr").first();
  await first.getByText("Trade details", { exact: true }).click();
  await expect(first.getByText(/Your horizon gain:/)).toContainText("+40.00");
  await expect(first.locator("td").nth(2)).toHaveText("+3.33");
  // Both sides must pass: existing bench replacements hold their gain at +20/week, below this +21/week requirement.
  await otherToggle.check();
  await expect(
    first.getByRole("button", { name: "Load trade" }),
  ).toBeEnabled();
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
  await expect(row.getByRole("button", { name: "Load trade" })).toBeEnabled();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("0 index matches.", { exact: false }),
  ).toBeVisible();
  await openExclusions(search);
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
  const details = search.locator("tbody tr").first().locator("td > details").first();
  await details.getByText("Trade details", { exact: true }).click();
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
  await details.getByText("Trade details", { exact: true }).click();
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
  await details.getByText("Trade details", { exact: true }).click();
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
  await expect(row.locator("td").nth(2)).toHaveText("-10.83");
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
  // Alternate marked-starter figures remain available under an explicit, separately based disclosure.
  await page.getByText("Compare with Marked starters", { exact: true }).click();
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
  ).toBeEnabled();
  // Reverting an edit leaves retained trade actions available without reviving stale pagination.
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("100");
  await expect(
    search.getByRole("button", { name: "Load trade" }).first(),
  ).toBeEnabled();
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
  // Equal incoming bounds retain the exact-size package search and pagination checks.
  await search.getByLabel("Minimum players to receive", { exact: true }).selectOption("2");
  await search.getByLabel("Maximum players to receive", { exact: true }).selectOption("2");
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
      .getByLabel("Minimum players to receive", { exact: true })
      .selectOption(String(count));
    await search
      .getByLabel("Maximum players to receive", { exact: true })
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
    .getByLabel("Minimum players to receive", { exact: true })
    .selectOption("5");
  await search
    .getByLabel("Maximum players to receive", { exact: true })
    .selectOption("5");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  // Real worker progress includes elapsed time while cancellation remains available during exhaustive evaluation.
  await expect(search.locator(".trade-search-progress")).toContainText(
    /Elapsed: \d+[sm]/,
  );
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
  // Navigation remembers the independent finder controls, while results stay transient.
  await expect(
    panel(page).getByLabel("Below outgoing total (index points)", {
      exact: true,
    }),
  ).toHaveValue("100");
  await expect(
    panel(page).getByLabel("Above outgoing total (index points)", {
      exact: true,
    }),
  ).toHaveValue("500");
  await panel(page)
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("5");
  await panel(page)
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("5");
  // Explicitly opt back into the strict single-player case being verified.
  await panel(page)
    .getByLabel("Search goal", { exact: true })
    .selectOption("custom");
  await panel(page)
    .getByLabel("Use strict index range", { exact: true })
    .check();
  await panel(page).getByLabel("Create package", { exact: true }).uncheck();
  await panel(page)
    .getByRole("button", { name: "Search", exact: true })
    .click();
  await expect(
    panel(page).getByText("0 index matches.", { exact: false }),
  ).toBeVisible();
  await expect(
    panel(page).getByText("No trades meet the current search criteria.", {
      exact: true,
    }),
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
  await expect(row.getByRole("button", { name: "Load trade" })).toBeEnabled();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("0 index matches.", { exact: false }),
  ).toBeVisible();
  await openExclusions(search);
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

// Their existing stronger bench QB already contributes before the trade; only the remaining improvement is a trade benefit.
test("opponent search gains use full rosters while details retain both impact measurements", async ({
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
    .getByRole("combobox", { name: "Required incoming player", exact: true })
    .selectOption("2");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("1 index matches.", { exact: false }),
  ).toBeVisible();
  const row = search.locator("tbody tr");
  await expect(row.locator("td").nth(3)).toHaveText("+5.00");
  await row.getByText("Trade details", { exact: true }).click();
  await expect(
    row.getByText("Their scoring lineup", { exact: true }),
  ).toBeVisible();
  await expect(row).toContainText("Optimized roster potential (Expected PPG)");
  await expect(
    row.getByText("Your roster potential", { exact: true }),
  ).toBeVisible();
  await expect(
    row.getByText("Their marked-starter impact", { exact: true }),
  ).toBeVisible();
  await row
    .getByText("Their weekly scoring replacements", { exact: true })
    .click();
  const weekly = row
    .locator("details")
    .filter({
      has: page.locator("summary", {
        hasText: /^Their weekly scoring replacements$/,
      }),
    })
    .last();
  await expect(weekly.getByText(/QB: Depth QB/).first()).toContainText(
    "Bench QB",
  );
  await expect(weekly.getByText(/QB: Depth QB/).first()).toContainText(
    "+5.00 points",
  );
  await row
    .getByText("Their marked-starter weekly replacements", { exact: true })
    .click();
  const marked = row
    .locator("details")
    .filter({
      has: page.locator("summary", {
        hasText: /^Their marked-starter weekly replacements$/,
      }),
    })
    .last();
  await expect(marked.getByText(/QB: Incoming QB/).first()).toContainText(
    "+20.00 points",
  );
  // Opponent weekly filters use the corrected +5 potential, not the +20 marked-starter difference.
  await search.getByLabel("Filter their weekly gain", { exact: true }).check();
  await search
    .getByLabel("Their minimum weekly gain (points/week)", { exact: true })
    .fill("6");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("0 index matches.", { exact: false }),
  ).toBeVisible();
  await search
    .getByLabel("Their minimum weekly gain (points/week)", { exact: true })
    .fill("5");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("1 index matches.", { exact: false }),
  ).toBeVisible();
  await search.getByRole("button", { name: "Load trade", exact: true }).click();
  const potential = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Expected team gain per week",
        exact: true,
      }),
    });
  await expect(
    potential
      .locator(".metric")
      .filter({
        has: page.getByText("Their gain / week", {
          exact: true,
        }),
      })
      .locator("strong"),
  ).toHaveText("+5.00");
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
    row.getByText("Your roster potential", { exact: true }),
  ).toBeVisible();
  await expect(row.getByText(/Bench replacements: Bench QB/)).toBeVisible();
  await expect(row.getByText(/Bench replacements: Search WR 0/)).toBeVisible();
  await row
    .getByText("Your marked-starter weekly replacements", { exact: true })
    .click();
  const own = row
    .locator("details")
    .filter({
      has: page.locator("summary", {
        hasText: "Your marked-starter weekly replacements",
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
    .getByText("Your marked-starter weekly replacements", { exact: true })
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
  await openExclusions(search);
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
  await expect(row.getByRole("button", { name: "Load trade" })).toBeEnabled();
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
  await search
    .getByText("Only show positional upgrades for the other team", {
      exact: true,
    })
    .hover();
  await expect(
    page
      .getByRole("tooltip")
      .getByText(
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
  ).toBeEnabled();
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

// New defaults expose a compact goal-first form; advanced legacy controls remain an explicit choice.
test("guided search defaults to automatic singles and packages and configures transparent goals", async ({
  page,
}) => {
  await seed(page, false, false, false, false, true);
  const search = panel(page);
  await expect(search.getByLabel("Search goal", { exact: true })).toHaveValue(
    "explore",
  );
  await expect(
    search.getByLabel("Use strict index range", { exact: true }),
  ).not.toBeVisible();
  await expect(
    search.getByText("Receive 1–3 players. Automatic index matching", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    search.getByRole("button", {
      name: "Remove Receive 1–3 players",
      exact: true,
    }),
  ).toBeVisible();
  await search.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/trade-goal-search.png" });
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(search.getByText(/\d+ index matches\. Ranked by/)).toBeVisible();
  await expect(search.locator("tbody tr")).not.toHaveCount(0);
  await search
    .getByLabel("Search goal", { exact: true })
    .selectOption("improve");
  await expect(
    search.getByRole("button", { name: /Remove Your weekly gain: 1 to any/ }),
  ).toBeVisible();
  await expect(
    search.getByRole("button", { name: /Remove Their weekly gain: 0 to any/ }),
  ).toBeVisible();
  await search
    .getByLabel("Search goal", { exact: true })
    .selectOption("position");
  await search
    .getByLabel("Position to receive", { exact: true })
    .selectOption("QB");
  await search.getByText("Advanced search controls", { exact: true }).click();
  await expect(search.getByLabel("Receive QB", { exact: true })).toBeChecked();
  await expect(
    search.getByLabel("Use strict index range", { exact: true }),
  ).not.toBeChecked();
});

// Recovery does not change controls until clicked; the resulting completed count must equal its preview.
test("zero-result recovery previews exact combined adjustments and applies only on request", async ({
  page,
}) => {
  await seed(page);
  const search = panel(page);
  await search.getByLabel("Below outgoing total (index points)", { exact: true }).fill("0");
  await search.getByLabel("Above outgoing total (index points)", { exact: true }).fill("0");
  await search.getByLabel("Filter your weekly gain", { exact: true }).check();
  await search.getByLabel("Your minimum weekly gain (points/week)", { exact: true }).fill("1000");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  const recovery = search.getByLabel("Search recovery options", {
    exact: true,
  });
  const option = recovery.getByRole("button").first();
  await expect(option).toBeVisible();
  await expect(
    search.getByLabel("Your minimum weekly gain (points/week)", {
      exact: true,
    }),
  ).toHaveValue("1000");
  await expect(
    search.getByLabel("Use strict index range", { exact: true }),
  ).toBeChecked();
  const count = Number((await option.innerText()).match(/→ (\d+) matches/)![1]);
  await option.click();
  await expect(
    search.getByText(`${count} index matches.`, { exact: false }),
  ).toBeVisible();
  await expect(
    search.getByLabel("Your minimum weekly gain (points/week)", {
      exact: true,
    }),
  ).toHaveValue("1");
});

// Switching one persisted scoring preference changes both filters and analyzer results, and saved trades restore their own basis.
test("shared lineup basis drives filtering ranking analyzer and saved restoration", async ({
  page,
}) => {
  await seed(page, true, false, true);
  const search = panel(page);
  const basis = page.getByRole("combobox", {
    name: "Evaluate lineup impact using",
    exact: true,
  });
  await expect(basis).toHaveValue("best-available");
  await search.getByLabel("Use strict index range", { exact: true }).uncheck();
  await search
    .getByRole("combobox", { name: "Required incoming player", exact: true })
    .selectOption("2");
  await search.getByLabel("Filter their weekly gain", { exact: true }).check();
  await search
    .getByLabel("Their minimum weekly gain (points/week)", { exact: true })
    .fill("6");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("0 index matches.", { exact: false }),
  ).toBeVisible();
  await basis.selectOption("marked-starters");
  await expect(search.getByText(/Search inputs changed/)).toBeVisible();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByText("1 index matches.", { exact: false }),
  ).toBeVisible();
  const row = search.locator("tbody tr");
  await expect(row.locator("td").nth(3)).toHaveText("+20.00");
  const own = await row.locator("td").nth(2).innerText();
  await row.getByRole("button", { name: "Load trade", exact: true }).click();
  const primary = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Expected team gain per week",
      exact: true,
    }),
  });
  await expect(
    primary
      .locator(".metric")
      .filter({ has: page.getByText("Your gain / week", { exact: true }) })
      .locator("strong"),
  ).toHaveText(own);
  await expect(
    primary
      .locator(".metric")
      .filter({ has: page.getByText("Their gain / week", { exact: true }) })
      .locator("strong"),
  ).toHaveText("+20.00");
  await expect(
    primary.getByText(/Your Expected points\/week: Before/),
  ).toContainText("After");
  await row.getByRole("button", { name: "Save trade", exact: true }).click();
  await expect
    .poll(
      async () => (await storedWorkspace(page)).state.filters.tradeLineupBasis,
    )
    .toBe("marked-starters");
  const saved = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Saved trades", exact: true }),
  });
  await saved.locator("summary").click();
  await expect(
    saved
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: /^Current/ }) }),
  ).toContainText("Marked starters");
  await basis.selectOption("best-available");
  await saved
    .getByRole("button", { name: "Load saved trade", exact: true })
    .click();
  await expect(basis).toHaveValue("marked-starters");
  await search
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(basis).toHaveValue("marked-starters");
  await page.reload();
  await expect(basis).toHaveValue("marked-starters");
});

// Use the actual worker and saved-query store to prove opponent selection, stale results, restoration and reset behavior.
test("opponent team checkboxes restrict packages and restore with saved searches", async ({
  page,
}) => {
  await seed(page, false, false, false, false, true, true);
  const search = panel(page);
  // Keep the first multi-owner check on one page, then exercise package matching within the restricted scope.
  await search.getByLabel("Search goal", { exact: true }).selectOption("custom");
  await search.getByLabel("Create package", { exact: true }).uncheck();
  await search
    .getByText("Teams to search: All other teams", { exact: true })
    .click();
  const team = (name: string) =>
    search.getByRole("checkbox", { name: `Search team: ${name}`, exact: true });
  await expect(team("Test A")).toHaveCount(0);
  for (const name of ["Test B", "Test 3", "Test 4"])
    await expect(team(name)).toBeChecked();
  await team("Test 4").uncheck();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  const rows = search.locator("tbody tr");
  await expect(rows.filter({ hasText: "Test B" }).first()).toBeVisible();
  await expect(rows.filter({ hasText: "Test 3" }).first()).toBeVisible();
  await expect(rows.filter({ hasText: "Test 4" })).toHaveCount(0);
  // Editing scope invalidates existing results rather than presenting them as matches under the new checkbox state.
  await team("Test B").uncheck();
  await expect(search.getByText(/Search inputs changed/)).toBeVisible();
  await search.getByLabel("Create package", { exact: true }).check();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(rows.filter({ hasText: "Test 3" }).first()).toBeVisible();
  await expect(rows.filter({ hasText: "Test B" })).toHaveCount(0);
  await rows
    .first()
    .getByRole("button", { name: "Save trade", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        JSON.parse((await storedWorkspace(page)).state.filters.savedTrades)
          .trades[0].query.discovery.teams,
    )
    .toEqual(["3"]);
  await search
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  for (const name of ["Test B", "Test 3", "Test 4"])
    await expect(team(name)).toBeChecked();
  const saved = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Saved trades", exact: true }),
    });
  await saved.locator("summary").click();
  await saved
    .getByRole("button", { name: "Load saved trade", exact: true })
    .click();
  await expect(team("Test 3")).toBeChecked();
  await expect(team("Test B")).not.toBeChecked();
  await expect(team("Test 4")).not.toBeChecked();
  await search
    .getByRole("button", { name: "Clear team selection", exact: true })
    .click();
  await expect(
    search.getByText(/Select at least one valid opposing fantasy team/),
  ).toBeVisible();
  await expect(
    search.getByRole("button", { name: "Search", exact: true }),
  ).toBeDisabled();
  await search
    .getByRole("button", { name: "Select all teams", exact: true })
    .click();
  await expect(
    search.getByRole("button", { name: "Search", exact: true }),
  ).toBeEnabled();
});

// Retained results remain actionable through invalid controls and outgoing edits, while saving the executed package and recalculating loaded trades.
test("stale search results can be saved and loaded despite invalid edited filters", async ({ page }) => {
  await seed(page);
  const search = panel(page);
  await search.getByLabel("Below outgoing total (index points)", {exact: true}).fill("1000");
  await search.getByLabel("Above outgoing total (index points)", {exact: true}).fill("1000");
  await search.getByRole("button", {name: "Search", exact: true}).click();
  const row = search.locator("tbody tr").filter({has: page.getByRole("link", {name: "Incoming QB", exact: true})});
  await expect(row).toBeVisible();
  const displayedGain = await row.locator("td").nth(2).textContent();
  await search.getByLabel("Above outgoing total (index points)", {exact: true}).fill("");
  await page.getByLabel("Outgoing player 1", {exact: true}).selectOption("100");
  await expect(search.getByText(/Search inputs changed/)).toBeVisible();
  await expect(search.getByRole("button", {name: "Search", exact: true})).toBeDisabled();
  await row.getByRole("button", {name: "Save trade", exact: true}).click();
  const saved = JSON.parse((await storedWorkspace(page)).state.filters.savedTrades).trades[0];
  expect(saved.draft).toEqual({teamA: "1", teamB: "2", give: ["101"], get: ["200"]});
  expect(saved.query.above).toBe(1000);
  expect(saved.original.own.toFixed(2)).toBe(displayedGain?.trim());
  await row.getByRole("button", {name: "Load trade", exact: true}).click();
  await expect(page.getByLabel("Outgoing player 1", {exact: true})).toHaveValue("101");
  await expect(page.getByLabel("Incoming player 1", {exact: true})).toHaveValue("200");
  await expect(page.getByRole("button", {name: "Save current trade", exact: true})).toBeEnabled();
});
