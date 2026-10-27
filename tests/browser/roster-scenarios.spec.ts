import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  initialState,
  type Dataset,
  type Workspace,
} from "../../src/domain/contracts";

// Exercise the built app and real workers using synthetic league data and the normal IndexedDB workspace.
async function seed(page: Page, flexBye = false, temporary = false) {
  const dataset: Dataset = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        // Optional synthetic RBs reproduce a FLEX selection during a bye without importing private data.
        `import {starterFixture} from './tests/fixtures.ts';
         import {fromTables} from './src/import/workbook.ts';
         const d=await starterFixture();
         if(${flexBye}) {
           d.tables.ModelContext[0].BenchSlots=8;
           for(const [id,name,score,pro] of [[400,'Reserve RB',10,1],[401,'Bye RB',35,2]]) {
             d.tables.ModelPlayers.push({...d.tables.ModelPlayers.find(p=>p.PlayerID===1),PlayerID:id,Player:name,OnTeamID:1,ProTeamID:pro,ActualPoints:score*5,Actual_PPG:score,Last3_PPG:score,ScoreSD:0,ESPN_Projected_PPG:score,ESPN_Projected_Total:score*17});
             d.tables.ModelHistory.push(...d.tables.ModelHistory.filter(h=>h.PlayerID===1).map(h=>({...h,PlayerID:id,Points:score})));
             d.tables.ModelRosters.push({PlayerID:id,TeamID:1,LineupSlotID:20});
           }
         }
         // Temporary OUT players remain ordinary bench/starter candidates; the high-scoring actual IR player must stay excluded.
         if(${temporary}) {
           for(const id of [101,200]) d.tables.ModelPlayers.find(p=>p.PlayerID===id).InjuryStatus='OUT';
           const base=d.tables.ModelPlayers.find(p=>p.PlayerID===101);
           d.tables.ModelPlayers.push({...base,PlayerID:402,Player:'Actual IR QB',ActualPoints:500,Actual_PPG:100,Last3_PPG:100,ScoreSD:0,ESPN_Projected_PPG:100,ESPN_Projected_Total:1700});
           d.tables.ModelHistory.push(...d.tables.ModelHistory.filter(h=>h.PlayerID===101).map(h=>({...h,PlayerID:402,Points:100})));
           d.tables.ModelRosters.push({PlayerID:402,TeamID:1,LineupSlotID:21});
         }
         process.stdout.write(JSON.stringify(${flexBye}||${temporary}?await fromTables(d.tables,d.settings):d));`,
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
  await expect(
    page.getByRole("heading", {
      name: "Hypothetical roster simulator",
      exact: true,
    }),
  ).toBeVisible();
  return dataset;
}

// Wait on durable account state rather than using fixed sleeps before a reload or navigation.
async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("fantasy-football-lab", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<Workspace>((resolve, reject) => {
        const r = db.transaction("current").objectStore("current").get("local");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });
}

// Visual slot assignment moves a league player into the simulation, retains displaced depth, and supports bench/cut/undo without touching live data.
test("before and after boards replace players, show changed roles and switch cleanly on mobile", async ({
  page,
}) => {
  const dataset = await seed(page);
  await page
    .getByRole("button", { name: "New simulation", exact: true })
    .click();
  const before = page.getByRole("region", { name: "Live roster", exact: true });
  const after = page.getByRole("region", {
    name: "Hypothetical roster",
    exact: true,
  });
  await expect(
    before.getByRole("link", { name: "Bench QB", exact: true }),
  ).toBeVisible();
  await after
    .getByRole("button", { name: "Replace QB 1", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Choose QB starter",
    exact: true,
  });
  await picker
    .getByRole("searchbox", { name: "Search league players", exact: true })
    .fill("Incoming QB");
  await picker
    .getByRole("button", { name: "Choose Incoming QB", exact: true })
    .click();
  await expect(picker).not.toBeVisible();
  await expect(
    after.getByRole("link", { name: "Incoming QB", exact: true }),
  ).toBeVisible();
  await expect(
    after.getByText("Added to roster", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Lineup view", exact: true }),
  ).toHaveValue("marked");
  await after
    .getByRole("button", { name: "Bench Incoming QB", exact: true })
    .click();
  await after.getByText(/^Bench & IR/).click();
  await expect(
    after.getByRole("link", { name: "Bench QB", exact: true }),
  ).toBeVisible();
  await after
    .getByRole("button", { name: "Cut Incoming QB", exact: true })
    .click();
  await expect(
    after.getByRole("button", { name: "Cut Incoming QB", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Undo move", exact: true }).click();
  await expect(
    after.getByRole("button", { name: "Cut Incoming QB", exact: true }),
  ).toBeVisible();
  expect((await stored(page)).dataset).toEqual(dataset);
  await page
    .locator(".sim-lineup-comparison")
    .screenshot({ path: "test-results/scenario-boards-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(after).toBeVisible();
  await expect(before).not.toBeVisible();
  await page.getByRole("tab", { name: "Live roster", exact: true }).click();
  await expect(before).toBeVisible();
  await expect(after).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await before.screenshot({ path: "test-results/scenario-board-mobile.png" });
});

// Browsing an opponent must not reset My Team; scenario ownership changes survive reload while live ownership remains intact.
test("My team stays selected and hypothetical moves are independent, durable and undoable", async ({
  page,
}) => {
  const dataset = await seed(page);
  await page.goto("./#/teams");
  await page
    .getByRole("combobox", { name: "Team", exact: true })
    .selectOption("2");
  await expect(page.getByLabel("My team", { exact: true })).toHaveValue("1");
  await page.goto("./#/overview");
  const simulator = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Hypothetical roster simulator",
      exact: true,
    }),
  });
  await simulator
    .getByRole("textbox", { name: "Simulation name", exact: true })
    .fill("Plan A");
  await simulator
    .getByRole("button", { name: "New simulation", exact: true })
    .click();
  await simulator.getByText("Advanced roster moves", { exact: true }).click();
  await simulator
    .getByRole("combobox", { name: "League player", exact: true })
    .selectOption("200");
  await simulator
    .getByRole("button", { name: "Move player to selected team", exact: true })
    .click();
  await expect(
    simulator.getByText("1 / 1 moves applied", { exact: true }),
  ).toBeVisible();
  await simulator
    .getByRole("button", { name: "Undo move", exact: true })
    .click();
  await expect(
    simulator.getByText("0 / 1 moves applied", { exact: true }),
  ).toBeVisible();
  await simulator
    .getByRole("button", { name: "Redo move", exact: true })
    .click();
  await simulator.getByRole("button", { name: "Save to slot 1", exact: true }).click();
  await expect
    .poll(
      async () =>
        JSON.parse((await stored(page)).state.filters.rosterScenarios)
          .scenarios[0].cursor,
    )
    .toBe(1);
  expect((await stored(page)).dataset).toEqual(dataset);
  await page.reload();
  await expect(
    page.getByText("Hypothetical: Plan A", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("My team", { exact: true })).toHaveValue("1");
  await page.goto("./#/trades");
  await expect(
    page
      .getByLabel("Outgoing player 1", { exact: true })
      .locator('option[value="200"]'),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Return to live roster", exact: true })
    .click();
  await expect(
    page
      .getByLabel("Outgoing player 1", { exact: true })
      .locator('option[value="200"]'),
  ).toHaveCount(0);
  // Explicit My team changes survive reload and keep the analyzer's outgoing team aligned.
  await page.getByLabel("My team", { exact: true }).selectOption("2");
  await expect
    .poll(async () => (await stored(page)).state.preferredTeam)
    .toBe("2");
  await page.reload();
  await expect(page.getByLabel("My team", { exact: true })).toHaveValue("2");
  expect((await stored(page)).state.draft.teamA).toBe("2");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

// Simulation starter edits and reset use the projected import while preserving the live starter setting.
test("simulation optimize and reset restore imported starters without modifying live plans", async ({
  page,
}) => {
  await seed(page);
  await page
    .getByRole("button", { name: "New simulation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Optimize current lineup", exact: true })
    .click();
  await page.getByText("Detailed starter controls", { exact: true }).click();
  await expect(
    page.getByRole("combobox", {
      name: "Lineup status: Bench QB",
      exact: true,
    }),
  ).toHaveValue("Starter");
  await page
    .getByRole("button", { name: "Reset to imported lineup", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Lineup status: Main QB", exact: true }),
  ).toHaveValue("Starter");
  await expect(
    page.getByRole("combobox", {
      name: "Lineup status: Bench QB",
      exact: true,
    }),
  ).toHaveValue("Bench");
  await page.getByRole("button", { name: "Save to slot 1", exact: true }).click();
  await expect
    .poll(
      async () =>
        JSON.parse((await stored(page)).state.filters.rosterScenarios)
          .scenarios[0].cursor,
    )
    .toBe(2);
  expect((await stored(page)).state.filters.startingLineups).toBeUndefined();
  await page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Hypothetical roster simulator",
        exact: true,
      }),
    })
    .screenshot({ path: "test-results/roster-simulator-desktop.png" });
});

// Saved trades retain a scenario snapshot after the named recipe is edited; debug export captures applied and current settings separately.
test("saved hypothetical trades restore their own recipe and debug exports contain analysis only", async ({
  page,
}) => {
  await seed(page);
  await page
    .getByRole("button", { name: "New simulation", exact: true })
    .click();
  await page.getByText("Advanced roster moves", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "League player", exact: true })
    .selectOption("102");
  await page
    .getByRole("button", { name: "Move player to selected team", exact: true })
    .click();
  await page.goto("./#/trades");
  await page
    .getByLabel("Outgoing player 1", { exact: true })
    .selectOption("102");
  const save = page.getByRole("button", {
    name: "Save current trade",
    exact: true,
  });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(save).toContainText("Saved");
  await expect
    .poll(
      async () =>
        JSON.parse((await stored(page)).state.filters.savedTrades).trades
          .length,
    )
    .toBe(1);
  await page.goto("./#/overview");
  await page.getByRole("button", { name: "Undo move", exact: true }).click();
  await page.goto("./#/trades");
  const savedPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Saved trades", exact: true }),
  });
  await savedPanel.locator("summary").click();
  await savedPanel
    .getByRole("button", { name: "Load saved trade", exact: true })
    .click();
  await expect(
    page.getByLabel("Outgoing player 1", { exact: true }),
  ).toHaveValue("102");
  const search = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Find matching trades",
      exact: true,
    }),
  });
  await search.getByLabel("Search goal", { exact: true }).selectOption("custom");
  await search.getByLabel("Use strict index range", { exact: true }).check();
  await search
    .getByLabel("Below outgoing total (index points)", { exact: true })
    .fill("500");
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("500");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    search.getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveCount(0);
  await search
    .getByLabel("Above outgoing total (index points)", { exact: true })
    .fill("499");
  const downloading = page.waitForEvent("download");
  await search
    .getByRole("button", { name: "Download search debug", exact: true })
    .click();
  const download = await downloading;
  const stream = await download.createReadStream();
  let contents = "";
  for await (const chunk of stream!) contents += chunk.toString();
  const report = JSON.parse(contents);
  expect(report.currentQuery.above).toBe(499);
  expect(report.lastAppliedSearch.query.above).toBe(500);
  expect(report.simulation.moves).toHaveLength(1);
  expect(contents).not.toMatch(
    /access_token|refresh_token|ModelHistory|localStorage|workspace.owner/,
  );
  await search
    .getByRole("button", { name: "Why wasn’t this trade found?", exact: true })
    .click();
  await expect(
    search.getByRole("status").filter({
      hasText: /This candidate passes the current search filters/,
    }),
  ).toBeVisible();
});

// A bye changes scoring availability, not the user's saved starter/bench designation or another card edit.
test("manual FLEX placement overrides scoring order and survives bye, edits and reload", async ({ page }) => {
  await seed(page, true);
  await page.getByRole("button", { name: "New simulation", exact: true }).click();
  await page.getByRole("combobox", { name: "Board week", exact: true }).selectOption("8");
  const after = page.getByRole("region", { name: "Hypothetical roster", exact: true });
  const flex = after.locator(".sim-slot").filter({ has: page.getByRole("button", { name: "Replace FLEX 1", exact: true }) });
  const rb = after.locator(".sim-slot").filter({ has: page.getByRole("button", { name: "Replace RB 1", exact: true }) });
  // Bye-free optimization starts the strongest RB; create a deliberately different manual plan before testing exact FLEX placement.
  await expect(rb.getByRole("link", { name: "Bye RB", exact: true })).toBeVisible();
  await rb.getByRole("button", { name: "Replace RB 1", exact: true }).click();
  await page.getByRole("dialog").getByRole("searchbox").fill("Synthetic 1");
  await page.getByRole("button", { name: "Choose Synthetic 1", exact: true }).click();
  await flex.getByRole("button", { name: "Replace FLEX 1", exact: true }).click();
  await page.getByRole("dialog").getByRole("searchbox").fill("Reserve RB");
  await page.getByRole("button", { name: "Choose Reserve RB", exact: true }).click();
  await expect(rb.getByRole("link", { name: "Synthetic 1", exact: true })).toBeVisible();
  await expect(flex.getByRole("link", { name: "Reserve RB", exact: true })).toBeVisible();
  await flex.getByRole("button", { name: "Replace FLEX 1", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Choose FLEX starter", exact: true });
  await picker.getByRole("searchbox", { name: "Search league players", exact: true }).fill("Bye RB");
  await picker.getByRole("button", { name: "Choose Bye RB", exact: true }).click();
  await expect(flex.getByRole("link", { name: "Bye RB", exact: true })).toBeVisible();
  await expect(flex.getByText("Bye · Week 8 · ignored in simulation", { exact: true })).toBeVisible();
  await expect(rb.getByRole("link", { name: "Synthetic 1", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Board week", exact: true }).selectOption("9");
  await expect(flex.getByRole("link", { name: "Bye RB", exact: true })).toBeVisible();
  await expect(rb.getByRole("link", { name: "Synthetic 1", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Board week", exact: true }).selectOption("8");
  await expect(after.locator(".sim-reserves").getByRole("link", { name: "Bye RB", exact: true })).toHaveCount(0);
  // Editing an unrelated card must retain the selected bye player in FLEX.
  await after.getByRole("button", { name: "Replace QB 1", exact: true }).click();
  await page.getByRole("dialog").getByRole("searchbox").fill("Main QB");
  await page.getByRole("button", { name: "Choose Main QB", exact: true }).click();
  await expect(flex.getByRole("link", { name: "Bye RB", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save to slot 1", exact: true }).click();
  await expect.poll(async () => JSON.parse((await stored(page)).state.filters.rosterScenarios).scenarios[0].cursor).toBe(4);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Lineup view", exact: true })).toHaveValue("marked");
  await page.getByRole("combobox", { name: "Board week", exact: true }).selectOption("8");
  await expect(flex.getByRole("link", { name: "Bye RB", exact: true })).toBeVisible();
  // Clearing RB leaves a deliberate vacancy; the saved FLEX cannot slide back into RB.
  await rb.getByRole("button", { name: "Bench Synthetic 1", exact: true }).click();
  await expect(rb.getByText("No available starter", { exact: true })).toBeVisible();
  await expect(flex.getByRole("link", { name: "Bye RB", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo move", exact: true }).click();
  await expect(rb.getByRole("link", { name: "Synthetic 1", exact: true })).toBeVisible();
  await expect(flex.getByRole("link", { name: "Bye RB", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Lineup view", exact: true }).selectOption("optimized");
  await expect(rb.getByRole("link", { name: "Bye RB", exact: true })).toBeVisible();
  await expect(flex.getByRole("link", { name: "Synthetic 1", exact: true })).toBeVisible();
});

// Exercise the actual trade-search worker: scenario scoring ignores the known bye, while switching back to live restores it.
test("hypothetical search ignores byes and returning to live restores scheduled gains", async ({ page }) => {
  await seed(page, true);
  await page.getByRole("button", { name: "New simulation", exact: true }).click();
  await page.goto("./#/trades");
  await page.getByLabel("Outgoing player 1", { exact: true }).selectOption("401");
  const search = page.locator("section").filter({ has: page.getByRole("heading", { name: "Find matching trades", exact: true }) });
  async function run() {
    await search.getByLabel("Search goal", { exact: true }).selectOption("custom");
    await search.getByLabel("Create package", { exact: true }).uncheck();
    await search.getByRole("button", { name: "Search", exact: true }).click();
    const row = search.locator("tbody tr").filter({ has: page.getByRole("link", { name: "Synthetic 2", exact: true }) });
    await expect(row).toBeVisible();
    return row;
  }
  const hypothetical = await run();
  await expect(search.getByText(/Hypothetical: byes ignored/)).toBeVisible();
  await expect(hypothetical.locator("td").nth(2)).toHaveText(/[-−]10\.00/);
  await expect(hypothetical.locator("td").nth(3)).toHaveText(/\+20\.00/);
  await page.goto("./#/overview");
  await page.getByLabel("Roster simulation", { exact: true }).selectOption("");
  await page.goto("./#/trades");
  const live = await run();
  await expect(live.locator("td").nth(2)).toHaveText(/[-−]7\.92/);
  await expect(search.getByText(/Hypothetical: byes ignored/)).toHaveCount(0);
});

// Force a deliberately unfavorable exchange without an acceptance gate, then search with both sides' new ownership through real workers.
test("forced trades update both simulated rosters and later searches and undo together", async ({ page }) => {
  const dataset = await seed(page);
  await page.goto("./#/trades");
  const apply = page.getByRole("button", { name: "Apply trade to hypothetical roster", exact: true });
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByRole("status").filter({ hasText: "Applied hypothetical trade: Bench QB ↔ Incoming QB" })).toBeVisible();
  await expect(page.getByLabel("Outgoing player 1", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Outgoing player 1", { exact: true }).locator('option[value="200"]')).toHaveCount(1);
  await expect(page.getByLabel("Outgoing player 1", { exact: true }).locator('option[value="101"]')).toHaveCount(0);
  await expect(page.getByLabel("Incoming player 1", { exact: true }).locator('option[value="101"]')).toHaveCount(1);
  await page.goto("./#/overview");
  await page.getByRole("button", { name: "Save to slot 1", exact: true }).click();
  await page.goto("./#/trades");
  await expect.poll(async () => {
    const w = await stored(page);
    const collection = JSON.parse(w.state.filters.rosterScenarios);
    return collection.scenarios.find((s: { id: string }) => s.id === collection.active)?.moves[0]?.kind;
  }).toBe("trade");
  expect((await stored(page)).dataset).toEqual(dataset);
  await page.reload();
  await expect(page.getByLabel("Outgoing player 1", { exact: true }).locator('option[value="200"]')).toHaveCount(1);
  await page.getByLabel("Outgoing player 1", { exact: true }).selectOption("200");
  const search = page.locator("section").filter({ has: page.getByRole("heading", { name: "Find matching trades", exact: true }) });
  await search.getByLabel("Search goal", { exact: true }).selectOption("custom");
  await search.getByLabel("Create package", { exact: true }).uncheck();
  await search.getByRole("combobox", { name: "Required incoming player", exact: true }).selectOption("101");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  const row = search.locator("tbody tr").filter({ has: page.getByRole("link", { name: "Bench QB", exact: true }) });
  await expect(row).toBeVisible();
  await expect(row.locator("td").nth(2)).toHaveText(/\+10\.00/);
  await page.goto("./#/overview");
  await expect(page.getByLabel("Roster simulation", { exact: true })).not.toHaveValue("");
  await page.getByRole("button", { name: "Undo move", exact: true }).click();
  await expect(page.getByText("0 / 1 moves applied", { exact: true })).toBeVisible();
  expect(JSON.parse((await stored(page)).state.filters.rosterScenarios).scenarios[0].cursor).toBe(1);
  await page.goto("./#/trades");
  await expect(page.getByLabel("Outgoing player 1", { exact: true }).locator('option[value="101"]')).toHaveCount(1);
  await expect(page.getByLabel("Incoming player 1", { exact: true }).locator('option[value="200"]')).toHaveCount(1);
  await page.goto("./#/overview");
  await page.getByRole("button", { name: "Redo move", exact: true }).click();
  await expect.poll(async () => JSON.parse((await stored(page)).state.filters.rosterScenarios).scenarios[0].cursor).toBe(1);
  expect((await stored(page)).dataset).toEqual(dataset);
});

// Compare the actual built screens and worker under one potential-scoring policy; temporary injury labels remain factual.
test("hypothetical cards, overview, analyzer and search share temporary-injury totals and exclude actual IR", async ({
  page,
}) => {
  await seed(page, false, true);
  await page
    .getByRole("button", { name: "New simulation", exact: true })
    .click();
  const after = page.getByRole("region", {
    name: "Hypothetical roster",
    exact: true,
  });
  const qb = after
    .locator(".sim-slot")
    .filter({ has: page.getByText("QB 1", { exact: true }) });
  await expect(
    qb.getByRole("link", { name: "Bench QB", exact: true }),
  ).toBeVisible();
  await expect(qb.getByText("OUT", { exact: true })).toBeVisible();
  await expect(
    after
      .locator(".sim-slot-grid")
      .getByRole("link", { name: "Actual IR QB", exact: true }),
  ).toHaveCount(0);
  const own = (await after.locator(".sim-score strong").innerText()).trim();
  await expect(page.locator(".hero-stat strong")).toContainText(own);
  await expect(
    page
      .locator(".metric")
      .filter({
        has: page.getByText("Simulated expected points / week", {
          exact: true,
        }),
      })
      .locator("strong"),
  ).toHaveText(own);
  await page.getByRole("combobox", { name: "Board week", exact: true }).selectOption("8");
  await expect(after.locator(".sim-score strong")).toHaveText(own);
  await page
    .getByRole("combobox", { name: "Simulated team to edit", exact: true })
    .selectOption("2");
  await expect(
    qb.getByRole("link", { name: "Incoming QB", exact: true }),
  ).toBeVisible();
  const other = (await after.locator(".sim-score strong").innerText()).trim();
  await page.goto("./#/trades");
  await page
    .getByRole("combobox", { name: "Evaluate lineup impact using", exact: true })
    .selectOption("best-available");
  const primary = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Expected team gain per week",
        exact: true,
      }),
    });
  await expect(
    primary
      .locator("p.model")
      .filter({ hasText: "Your Expected points/week:" }),
  ).toContainText(`Before ${own}`);
  await expect(
    primary
      .locator("p.model")
      .filter({ hasText: "Their Expected points/week:" }),
  ).toContainText(`Before ${other}`);
  const search = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Find matching trades",
        exact: true,
      }),
    });
  await search
    .getByLabel("Search goal", { exact: true })
    .selectOption("custom");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  const row = search
    .locator("tbody tr")
    .filter({
      has: page.getByRole("link", { name: "Incoming QB", exact: true }),
    })
    .first();
  await expect(row).toBeVisible();
  await row.getByText("Trade details", { exact: true }).click();
  await expect(
    row.getByText(new RegExp(`Your Before ${own.replace(".", "\\.")} →`)),
  ).toBeVisible();
  await expect(
    row.getByText(new RegExp(`Their Before ${other.replace(".", "\\.")} →`)),
  ).toBeVisible();
});


// Working changes survive in-app navigation but never replace stored recipes or any of the three slots without Save.
test("three roster slots restore exact working points and require explicit saves", async ({ page }) => {
  const dataset = await seed(page);
  await page.getByRole("button", { name: "New simulation", exact: true }).click();
  const slots = page.getByRole("region", { name: "Roster save slots", exact: true });
  await expect(slots.getByRole("button", { name: /^Load slot/ })).toHaveCount(3);
  for (const slot of [1, 2, 3]) await expect(slots.getByRole("button", { name: `Load slot ${slot}`, exact: true })).toBeDisabled();
  expect((await stored(page)).state.filters.rosterScenarios).toBeUndefined();
  await slots.getByRole("button", { name: "Save to slot 1", exact: true }).click();
  await expect(slots.getByText("Current roster is saved.", { exact: true })).toBeVisible();
  await page.getByText("Advanced roster moves", { exact: true }).click();
  await page.getByRole("combobox", { name: "League player", exact: true }).selectOption("200");
  await page.getByRole("button", { name: "Move player to selected team", exact: true }).click();
  await expect(slots.getByText(/^Unsaved changes/)).toBeVisible();
  expect(JSON.parse((await stored(page)).state.filters.rosterScenarios).scenarios[0].cursor).toBe(0);
  await page.goto("./#/trades");
  await expect(page.getByLabel("Outgoing player 1", { exact: true }).locator('option[value="200"]')).toHaveCount(1);
  // An unrelated persisted setting cannot accidentally save the roster draft.
  await page.getByRole("combobox", { name: "Evaluate lineup impact using", exact: true }).selectOption("marked-starters");
  await expect.poll(async () => (await stored(page)).state.filters.tradeLineupBasis).toBe("marked-starters");
  expect(JSON.parse((await stored(page)).state.filters.rosterScenarios).scenarios[0].cursor).toBe(0);
  await page.goto("./#/overview");
  await slots.getByRole("button", { name: "Save to slot 2", exact: true }).click();
  await page.getByText("Advanced roster moves", { exact: true }).click();
  await page.getByRole("combobox", { name: "League player", exact: true }).selectOption("200");
  await page.getByRole("button", { name: "Cut player to available pool", exact: true }).click();
  await slots.getByRole("button", { name: "Save to slot 3", exact: true }).click();
  await expect.poll(async () => JSON.parse((await stored(page)).state.filters.rosterScenarios).scenarios[0].cursor).toBe(2);
  await slots.getByRole("button", { name: "Load slot 1", exact: true }).click();
  await expect(page.getByText("0 / 0 moves applied", { exact: true })).toBeVisible();
  expect(JSON.parse((await stored(page)).state.filters.rosterScenarios).scenarios[0].cursor).toBe(2);
  await slots.getByRole("button", { name: "Load slot 2", exact: true }).click();
  await expect(page.getByText("1 / 1 moves applied", { exact: true })).toBeVisible();
  await slots.getByRole("button", { name: "Save to slot 3", exact: true }).click();
  await expect(slots.getByText("Current roster is saved.", { exact: true })).toBeVisible();
  await expect.poll(async () => JSON.parse((await stored(page)).state.filters.rosterScenarios).snapshots.map((snapshot: { slot: number; scenario: { cursor: number } }) => [snapshot.slot, snapshot.scenario.cursor])).toEqual([[1, 0], [2, 1], [3, 1]]);
  await page.reload();
  await expect(page.getByText("1 / 1 moves applied", { exact: true })).toBeVisible();
  expect((await stored(page)).dataset).toEqual(dataset);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await slots.screenshot({ path: "test-results/roster-save-slots-mobile.png" });
});

// Refresh requires an explicit discard of unsaved roster edits and returns to the most recently saved point.
test("refresh warns about unsaved roster edits and preserves saved slots", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "New simulation", exact: true }).click();
  await page.getByRole("button", { name: "Save to slot 1", exact: true }).click();
  await page.getByText("Advanced roster moves", { exact: true }).click();
  await page.getByRole("combobox", { name: "League player", exact: true }).selectOption("200");
  await page.getByRole("button", { name: "Move player to selected team", exact: true }).click();
  await expect(page.getByText("1 / 1 moves applied", { exact: true })).toBeVisible();
  const dialogPromise = page.waitForEvent("dialog");
  const reload = page.reload();
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.accept();
  await reload;
  await expect(page.getByText("0 / 0 moves applied", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load slot 1", exact: true })).toBeEnabled();
  expect(JSON.parse((await stored(page)).state.filters.rosterScenarios).snapshots).toHaveLength(1);
});
