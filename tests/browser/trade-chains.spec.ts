import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  initialState,
  type Dataset,
  type Workspace,
} from "../../src/domain/contracts";

// Seed only synthetic players, preserving the same IndexedDB and worker path used by a normal imported workspace.
async function seed(page: Page) {
  const dataset: Dataset = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "import {chainFixture} from './tests/chain-fixture.ts';process.stdout.write(JSON.stringify(await chainFixture()));",
      ],
      { encoding: "utf8" },
    ),
  );
  const w: Workspace = {
    owner: "local",
    dataset,
    state: {
      ...initialState(dataset),
      draft: { teamA: "1", teamB: "2", give: ["1", "3"], get: [] },
    },
    datasetRevision: 0,
    stateRevision: 0,
    pendingDataset: false,
    pendingState: false,
    requestId: crypto.randomUUID(),
    stateRequestId: crypto.randomUUID(),
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
  }, w);
  await page.reload();
  await page.getByRole("link", { name: "Trade analyzer", exact: true }).click();
  await page.getByText("Plan two trades", { exact: true }).click();
  for (const name of ["First trade", "Second trade"]) {
    const group = page.getByRole("group", { name, exact: true });
    await group
      .getByRole("combobox", { name: `${name} offer maximum`, exact: true })
      .selectOption("1");
    await group
      .getByRole("combobox", { name: `${name} receive maximum`, exact: true })
      .selectOption("1");
    await group.locator("summary").click();
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
}

// Read durable saved records without relying on optimistic button text or changing the current roster recipe.
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

// Both worker paths, sequential scoring, opponent-loss warnings, and contextual individual saves must work in the built application.
test("finds both chain modes, explains replacements, and saves individual steps without moving real rosters", async ({
  page,
}) => {
  await seed(page);
  const original = await stored(page);
  await page
    .getByRole("button", { name: "Search trade chains", exact: true })
    .click();
  await expect(page.getByText(/2 qualifying chains found/)).toBeVisible();
  const safe = page.locator("article").filter({
    has: page.getByRole("heading", { name: /Safe.*\+10.00 EPPG overall/ }),
  });
  const speculative = page.locator("article").filter({
    has: page.getByRole("heading", {
      name: /Speculative.*\+8.00 EPPG overall/,
    }),
  });
  await expect(safe).toHaveCount(1);
  await expect(speculative).toHaveCount(1);
  await expect(
    safe.getByText("Your roster: 40.00 → 41.00 → 50.00 EPPG.", { exact: true }),
  ).toBeVisible();
  await expect(
    speculative.getByText(/step one leaves you at 39.00 EPPG/),
  ).toBeVisible();
  await expect(safe.getByText(/Acceptance concern/)).toHaveCount(2);
  await page
    .getByRole("heading", { name: "Two-trade chain planner", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/trade-chains-controls.png" });
  await safe
    .getByText("Step 2 lineup replacements and warnings", { exact: true })
    .click();
  await expect(
    safe.getByRole("cell", { name: "6 · WR", exact: true }),
  ).toHaveCount(2);
  await safe.getByRole("button", { name: "Save step 1", exact: true }).click();
  await safe.getByRole("button", { name: "Save step 2", exact: true }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(
          (await stored(page)).state.filters.savedTrades ?? '{"trades":[]}',
        ).trades.length,
    )
    .toBe(2);
  const w = await stored(page),
    trades = JSON.parse(w.state.filters.savedTrades).trades;
  expect(trades[0].scenario).toBeUndefined();
  expect(trades[1].scenario.retainLiveAvailability).toBe(true);
  expect(trades[1].draft.give).toEqual(["2"]);
  expect(trades[1].original.ownBefore).toBe(41);
  expect(trades[1].original.ownAfter).toBe(50);
  expect(w.dataset).toEqual(original.dataset);
  expect(w.state.filters.rosterScenarios).toBe(
    original.state.filters.rosterScenarios,
  );
  await page
    .getByRole("combobox", { name: "Chain mode", exact: true })
    .selectOption("speculative");
  await expect(page.getByText(/Chain results are stale/)).toBeVisible();
  await page
    .getByRole("button", { name: "Search trade chains", exact: true })
    .click();
  await expect(page.getByText(/1 qualifying chains found/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Safe.*EPPG overall/ }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
});

// Marked-starter discovery, clear controls, and cancellation remain independent from ordinary single-trade search controls.
test("supports marked starter chains, invalid scopes, clear filters and immediate cancellation", async ({
  page,
}) => {
  await seed(page);
  await page
    .getByRole("combobox", {
      name: "Evaluate lineup impact using",
      exact: true,
    })
    .selectOption("marked-starters");
  await page
    .getByRole("button", { name: "Search trade chains", exact: true })
    .click();
  await expect(page.getByText(/2 qualifying chains found/)).toBeVisible();
  const first = page.getByRole("group", { name: "First trade", exact: true });
  await first
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Search trade chains", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("First trade needs at least one valid opponent.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear chain filters", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", {
      name: "Evaluate lineup impact using",
      exact: true,
    }),
  ).toHaveValue("marked-starters");
  await expect(
    page.getByRole("spinbutton", {
      name: "Minimum final gain (EPPG)",
      exact: true,
    }),
  ).toHaveValue("5");
  // Hold only the chain worker so Cancel is deterministic even on fast machines; all other app workers remain real.
  await page.evaluate(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (String(url).includes("trade-chains.worker"))
          this.postMessage = () => {};
      }
    };
  });
  await page
    .getByRole("button", { name: "Search trade chains", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel chain search", exact: true })
    .click();
  await expect(
    page.getByText("Chain search cancelled. No roster changes were applied.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Search trade chains", exact: true }),
  ).toBeEnabled();
});

// Loading a separately saved follow-up explicitly restores its prerequisite rather than evaluating it against the live pre-chain roster.
test("loads a saved second leg with the correct prerequisite baseline", async ({
  page,
}) => {
  await seed(page);
  await page
    .getByRole("button", { name: "Search trade chains", exact: true })
    .click();
  await expect(page.getByText(/2 qualifying chains found/)).toBeVisible();
  const safe = page.locator("article").filter({
    has: page.getByRole("heading", { name: /Safe.*\+10.00 EPPG overall/ }),
  });
  await safe.getByRole("button", { name: "Save step 2", exact: true }).click();
  const card = page.locator("details").filter({
    has: page.locator("summary", {
      hasText: "Chain Bridge WR → Chain Target WR",
    }),
  });
  await card.locator(":scope > summary").click();
  await card
    .getByRole("button", { name: "Load saved trade", exact: true })
    .click();
  // Roster adoption intentionally clears transient save messages; assert the durable evaluated baseline instead.
  const impact = page.locator("section.panel").filter({
    has: page.getByRole("heading", {
      name: "Expected team gain per week",
      exact: true,
    }),
  });
  await expect(impact).toContainText(
    "Your Expected points/week: Before 41.00 → After 50.00 · Gain +9.00",
  );
  const record = await stored(page);
  expect(
    record.dataset!.tables.ModelPlayers.find((p) => p.PlayerID === 2)!.OnTeamID,
  ).toBe(2);
  expect(record.state.filters.rosterScenarios).toBeUndefined();
});
