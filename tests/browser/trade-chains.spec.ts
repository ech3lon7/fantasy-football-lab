import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
        "import {fairChainFixture} from './tests/chain-fixture.ts';process.stdout.write(JSON.stringify(await fairChainFixture()));",
      ],
      { encoding: "utf8" },
    ),
  );
  const w: Workspace = {
    owner: "local",
    dataset,
    state: {
      ...initialState(dataset),
      draft: { teamA: "1", teamB: "2", give: ["3", "8", "9"], get: [] },
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
  await page
    .getByRole("button", { name: "Two-trade chain planner", exact: true })
    .click();
  for (const name of ["First trade", "Second trade"]) {
    const group = page.getByRole("group", { name, exact: true });
    await group
      .getByRole("combobox", { name: `${name} offer maximum`, exact: true })
      .selectOption(name === "Second trade" ? "2" : "1");
    if (name === "Second trade")
      await group
        .getByRole("combobox", { name: `${name} offer minimum`, exact: true })
        .selectOption("2");
    await group
      .getByRole("combobox", { name: `${name} receive maximum`, exact: true })
      .selectOption("1");
    await group.locator("summary").click();
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

// Both worker paths retain sequential scoring and contextual saves while requiring each recipient to benefit.
test("finds both chain modes, explains replacements, and saves individual steps without moving real rosters", async ({
  page,
}) => {
  await seed(page);
  const original = await stored(page);
  await page
    .getByRole("button", { name: "Search trade chains", exact: true })
    .click();
  await expect(
    page.getByText(/[1-9][0-9]* qualifying chains found/),
  ).toBeVisible();
  // Search completeness is independent of a display cap and is reported by the real dedicated worker.
  await page.getByText("Chain search exclusions", { exact: true }).click();
  await expect(page.getByText(/Search coverage: complete/)).toBeVisible();
  await expect(page.getByText(/deferred first trades: 0/)).toBeVisible();
  await expect(page.getByText(/connected-chain-plausibility-1/)).toBeVisible();

  const safe = page
    .locator("article")
    .filter({
      has: page.getByRole("heading", { name: /Safe.*\+6.00 EPPG overall/ }),
    })
    .first();
  const speculative = page
    .locator("article")
    .filter({
      has: page.getByRole("heading", {
        name: /Speculative.*\+5.00 EPPG overall/,
      }),
    })
    .first();
  await expect(safe).toHaveCount(1);
  await expect(speculative).toHaveCount(1);
  // Chain team groups use the same animated, reversible 24px hierarchy without changing the underlying plans.
  const teamGroup = page.locator(".trade-chain-group").first();
  const groupToggle = teamGroup.locator(":scope > button");
  const content = teamGroup.locator(":scope > .trade-chain-reveal");
  expect(await content.evaluate((e) => { const style = getComputedStyle(e); return parseFloat(style.marginLeft) + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth); })).toBe(24);
  await groupToggle.click();
  await expect(content).toHaveCount(0);
  await groupToggle.click();
  await expect(safe).toBeVisible();

  // Connected results explain the acquired asset's measured share and provisional minimum directly in the saved worker result.
  await safe.getByText("How trade 1 enables trade 2", { exact: true }).click();
  await expect(safe.getByText(/Acquired contribution:/)).toContainText(
    "25.00%",
  );
  await expect(
    safe.getByText("Connected route: Re-trade acquisition.", { exact: true }),
  ).toBeVisible();

  await expect(
    safe.getByText("Your roster: 61.00 → 62.00 → 67.00 EPPG.", { exact: true }),
  ).toBeVisible();
  await expect(
    speculative.getByText(/step one leaves you at 61.00 EPPG/),
  ).toBeVisible();
  await expect(safe.getByText(/Acceptance concern/)).toHaveCount(0);
  await page
    .getByRole("heading", { name: "Two-trade chain planner", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/trade-chains-controls.png" });
  // Each leg exposes the same compact automatic upgrade evidence, with step two based on the first trade's roster.
  for (const step of [1, 2]) {
    const leg = safe
      .getByRole("heading", { name: new RegExp(`Step ${step} ·`) })
      .locator("..");
    await leg
      .getByText("Why the other team might accept", { exact: true })
      .click();
    const incentive = leg
      .getByText("Why the other team might accept", { exact: true })
      .locator("..");
    await expect(incentive).toContainText(/(?:RB|TE) [A-F][^ ]* →/);
    await expect(incentive).toContainText("Starter:");
    await expect(incentive).toContainText(/\+[0-9]+\.[0-9]{2} EPPG/);
    await expect(incentive).not.toContainText("Their surplus received:");
    if (step === 2)
      await incentive.screenshot({
        path: "test-results/compact-chain-upgrades.png",
      });
  }
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
  expect(trades[1].draft.give).toEqual(["2", "8"]);
  expect(trades[1].original.ownBefore).toBe(62);
  expect(trades[1].original.ownAfter).toBe(67);
  expect(w.dataset).toEqual(original.dataset);
  expect(w.state.filters.rosterScenarios).toBe(
    original.state.filters.rosterScenarios,
  );
  await page
    .getByRole("combobox", { name: "Chain mode", exact: true })
    .selectOption("speculative");
  await expect(page.getByText(/Chain results are stale/)).toBeVisible();
  // Editing chain controls does not disable bookmarking either already evaluated step or alter its captured scoring basis.
  await page.getByRole("combobox", {name: "Chain lineup impact basis", exact: true}).selectOption("marked-starters");
  await expect(
    safe.getByRole("button", { name: "Save step 1", exact: true }),
  ).toBeEnabled();
  await safe.getByRole("button", { name: "Save step 1", exact: true }).click();
  await expect(
    safe.getByRole("button", { name: "Save step 2", exact: true }),
  ).toBeEnabled();
  await safe.getByRole("button", { name: "Save step 2", exact: true }).click();
  const resaved = JSON.parse((await stored(page)).state.filters.savedTrades).trades;
  expect(resaved).toHaveLength(2);
  expect(resaved.every((trade: {lineupBasis: string}) => trade.lineupBasis === "best-available")).toBe(true);
  await page.getByRole("combobox", {name: "Chain lineup impact basis", exact: true}).selectOption("best-available");
  await page
    .getByRole("button", { name: "Search trade chains", exact: true })
    .click();
  await expect(
    page.getByText(/[1-9][0-9]* qualifying chains found/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Safe.*EPPG overall/ }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
});

// Independent panels retain settings across edits and reload; local debug exports show the query actually executed.
test("isolates scopes and presets, retains optional fit settings and remembers both finders", async ({
  page,
}) => {
  await seed(page);
  const chain = page.locator("section.panel").filter({
    has: page.getByRole("heading", {
      name: "Two-trade chain planner",
      exact: true,
    }),
  });
  const standard = page.locator("section.panel").filter({
    has: page.getByRole("heading", {
      name: "Find matching trades",
      exact: true,
    }),
  });
  const downloadReport = async () => {
    const event = page.waitForEvent("download");
    await chain
      .getByRole("button", { name: "Download chain debug", exact: true })
      .click();
    return JSON.parse(readFileSync((await (await event).path())!, "utf8"));
  };
  await expect(
    standard.getByRole("button", { name: "Find matching trades", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    chain.getByRole("checkbox", {
      name: "First trade: Receive from their surplus",
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    chain.getByRole("checkbox", {
      name: "Second trade: Offer into their deficit",
      exact: true,
    }),
  ).not.toBeChecked();
  await chain
    .getByRole("button", { name: "Search trade chains", exact: true })
    .click();
  await expect(
    page.getByText(/[1-9][0-9]* qualifying chains found/),
  ).toBeVisible();
  let report = await downloadReport();
  expect(report.chainSearch.currentQuery.first.teams).toEqual(["2"]);
  expect(report.chainSearch.currentQuery.second.teams).toEqual(["3"]);
  expect(report.chainSearch.status).toBe("complete");
  // Both download routes retain algorithm/build identity and exact remaining work from the dedicated worker.
  expect(report.chainSearch.searchVersion).toBe(
    "connected-chain-plausibility-1",
  );
  expect(Number.isFinite(Date.parse(report.chainSearch.appBuild.builtAt))).toBe(
    true,
  );
  expect(report.chainSearch.stats.coverage.followups.deferred).toBe(0);
  expect(report.chainSearch.stats.coverage.stopReasons).toEqual([]);
  // Switching and editing ordinary filters never makes the completed chain stale.
  await standard
    .getByRole("button", { name: "Find matching trades", exact: true })
    .click();
  await expect(
    chain.getByRole("button", { name: "Two-trade chain planner", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await standard
    .getByRole("combobox", { name: "Search goal", exact: true })
    .selectOption("improve");
  await page
    .getByRole("combobox", {
      name: "Evaluate lineup impact using",
      exact: true,
    })
    .selectOption("marked-starters");
  await standard
    .getByText("Teams to search: All other teams", { exact: true })
    .click();
  await standard
    .getByRole("checkbox", { name: "Search team: Chain C", exact: true })
    .uncheck();
  // Team and fixed outgoing edits are independent too, rather than merely leaving advanced filters isolated.
  await standard.getByText(/^Standard fixed outgoing players/).click();
  await standard
    .getByRole("checkbox", {
      name: "Standard outgoing player: Chain Reserve RB",
      exact: true,
    })
    .uncheck();
  await standard
    .getByRole("combobox", { name: "Standard search team", exact: true })
    .selectOption("2");
  await standard
    .getByRole("combobox", { name: "Standard search team", exact: true })
    .selectOption("1");
  await chain
    .getByRole("button", { name: "Two-trade chain planner", exact: true })
    .click();
  report = await downloadReport();
  expect(report.chainSearch.stale).toBe(false);
  expect(report.chainSearch.currentQuery.team).toBe("1");
  expect(report.chainSearch.currentQuery.pool).toEqual(["3", "8", "9"]);
  expect(report.chainSearch.currentQuery.basis).toBe("best-available");
  expect(report.chainSearch.currentQuery.second.teams).toEqual(["3"]);
  // Presets preserve unrelated selections and leave both optional fit gates disabled.
  const presets = [
    ["very-lenient", "2", "10", "0", "warnings"],
    ["lenient", "3", "10", "0.1", "warnings"],
    ["balanced", "4", "10", "0.25", "warnings"],
    ["strict", "5", "10", "0.5", "required"],
    ["very-strict", "8", "10", "1", "required"],
  ];
  for (const [id, gain, concession, recipient, prices] of presets) {
    await chain
      .getByRole("combobox", { name: "Chain preset", exact: true })
      .selectOption(id);
    await expect(
      chain.getByRole("combobox", { name: "Chain preset", exact: true }),
    ).toHaveValue(id);
    await expect(
      chain.getByRole("spinbutton", {
        name: "Minimum final gain (EPPG)",
        exact: true,
      }),
    ).toHaveValue(gain);
    await expect(
      chain.getByRole("spinbutton", {
        name: "Maximum recipient value loss (%)",
        exact: true,
      }),
    ).toHaveValue(concession);
    await expect(
      chain.getByRole("spinbutton", {
        name: "Minimum recipient gain (EPPG)",
        exact: true,
      }),
    ).toHaveValue(recipient);
    await expect(
      chain.getByRole("combobox", { name: "Chain price tests", exact: true }),
    ).toHaveValue(prices);
    await expect(
      chain.getByRole("checkbox", {
        name: "First trade: Receive from their surplus",
        exact: true,
      }),
    ).not.toBeChecked();
    report = await downloadReport();
    expect(report.chainSearch.currentQuery.first.teams).toEqual(["2"]);
    expect(report.chainSearch.currentQuery.second.teams).toEqual(["3"]);
  }
  await chain
    .getByRole("checkbox", {
      name: "First trade: Receive from their surplus",
      exact: true,
    })
    .check();
  await chain
    .getByRole("combobox", {
      name: "First trade surplus targeting",
      exact: true,
    })
    .selectOption("require");
  await chain
    .getByRole("combobox", {
      name: "First trade surplus positions match",
      exact: true,
    })
    .selectOption("all");
  await chain
    .getByRole("checkbox", {
      name: "First trade surplus position: WR",
      exact: true,
    })
    .check();
  await expect(
    chain.getByRole("combobox", { name: "Chain preset", exact: true }),
  ).toHaveValue("custom");
  await chain
    .getByRole("combobox", { name: "Chain preset", exact: true })
    .selectOption("balanced");
  await expect(
    chain.getByRole("checkbox", {
      name: "First trade: Receive from their surplus",
      exact: true,
    }),
  ).toBeChecked();
  report = await downloadReport();
  expect(report.chainSearch.currentQuery.first.fit.surplus).toMatchObject({
    enabled: true,
    mode: "require",
    match: "all",
    grade: "B+",
    positions: ["WR"],
  });
  expect(report.chainSearch.currentQuery.second.fit).toBeUndefined();
  await expect
    .poll(async () => (await stored(page)).state.filters.tradeSearchSettings)
    .toContain('"preset":"balanced"');
  await page.reload();
  await page
    .getByRole("button", { name: "Two-trade chain planner", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Chain preset", exact: true }),
  ).toHaveValue("balanced");
  await expect(
    page.getByRole("combobox", {
      name: "Chain lineup impact basis",
      exact: true,
    }),
  ).toHaveValue("best-available");
  await expect(
    page.getByRole("checkbox", {
      name: "First trade surplus position: WR",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", {
      name: "Second trade: Offer into their deficit",
      exact: true,
    }),
  ).not.toBeChecked();
  await page
    .getByRole("button", { name: "Find matching trades", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", {
      name: "Evaluate lineup impact using",
      exact: true,
    }),
  ).toHaveValue("marked-starters");
  await expect(
    page.getByRole("combobox", { name: "Search goal", exact: true }),
  ).toHaveValue("improve");
});

// Marked-starter discovery, clear controls, and cancellation remain independent from ordinary single-trade search controls.
test("supports marked starter chains, invalid scopes, clear filters and immediate cancellation", async ({
  page,
}) => {
  await seed(page);
  await page
    .getByRole("combobox", {
      name: "Chain lineup impact basis",
      exact: true,
    })
    .selectOption("marked-starters");
  await page
    .getByRole("button", { name: "Search trade chains", exact: true })
    .click();
  await expect(
    page.getByText(/[1-9][0-9]* qualifying chains found/),
  ).toBeVisible();
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
      name: "Chain lineup impact basis",
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
  await expect(
    page.getByText(/[1-9][0-9]* qualifying chains found/),
  ).toBeVisible();
  const safe = page
    .locator("article")
    .filter({
      has: page.getByRole("heading", { name: /Safe.*\+6.00 EPPG overall/ }),
    })
    .first();
  await safe.getByRole("button", { name: "Save step 2", exact: true }).click();
  const card = page.locator("details").filter({
    has: page.locator("summary", {
      hasText: "Chain Bridge WR + Chain Reserve TE → Chain Target WR",
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
    "Your Expected points/week: Before 62.00 → After 67.00 · Gain +5.00",
  );
  const record = await stored(page);
  expect(
    record.dataset!.tables.ModelPlayers.find((p) => p.PlayerID === 2)!.OnTeamID,
  ).toBe(2);
  expect(record.state.filters.rosterScenarios).toBeUndefined();
});

// New chain-only controls survive reload, preserve explicit larger concessions, and do not leak into the standard finder's settings.
test("persists independent per-leg plausibility and materiality controls with explicit reset defaults", async ({
  page,
}) => {
  await seed(page);
  await page.getByText("Chain dependency", { exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Dependency route", exact: true }),
  ).toHaveValue("either");
  await expect(
    page.getByRole("spinbutton", {
      name: "Minimum acquired contribution (%)",
      exact: true,
    }),
  ).toHaveValue("25");
  await expect(
    page.getByRole("spinbutton", {
      name: "Minimum interaction gain (EPPG)",
      exact: true,
    }),
  ).toHaveValue("2");
  await page
    .getByRole("combobox", { name: "Dependency route", exact: true })
    .selectOption("retain");
  await page
    .getByRole("spinbutton", {
      name: "Minimum interaction gain (EPPG)",
      exact: true,
    })
    .fill("3");
  await page
    .getByRole("checkbox", { name: "First trade index window", exact: true })
    .check();
  await page
    .getByRole("spinbutton", { name: "First trade index below", exact: true })
    .fill("7");
  await page
    .getByRole("spinbutton", { name: "First trade index above", exact: true })
    .fill("4");
  // Each leg retains its own optional redesigned Surface Trading evaluator.
  await page.getByRole("checkbox", { name: "Second trade: Enable Surface Trading", exact: true }).check();
  await page
    .getByRole("spinbutton", {
      name: "Maximum recipient value loss (%)",
      exact: true,
    })
    .fill("30");
  await expect(
    page.getByText(/Custom recipient concession: 30%/),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        JSON.parse((await stored(page)).state.filters.tradeSearchSettings).chain
          .query.dependency.minimumInteractionGain,
    )
    .toBe(3);
  await page.reload();
  await page
    .getByRole("button", { name: "Two-trade chain planner", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Chain preset", exact: true }),
  ).toHaveValue("custom");
  await expect(
    page.getByRole("checkbox", {
      name: "First trade index window",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", {
      name: "Second trade index window",
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("spinbutton", {
      name: "First trade index below",
      exact: true,
    }),
  ).toHaveValue("7");
  await expect(
    page.getByRole("checkbox", {
      name: "Second trade: Enable Surface Trading",
      exact: true,
    }),
  ).toBeChecked();
  await page.getByText("Chain dependency", { exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Dependency route", exact: true }),
  ).toHaveValue("retain");
  await expect(
    page.getByRole("spinbutton", {
      name: "Minimum interaction gain (EPPG)",
      exact: true,
    }),
  ).toHaveValue("3");
  await expect(
    page.getByRole("spinbutton", {
      name: "Maximum recipient value loss (%)",
      exact: true,
    }),
  ).toHaveValue("30");
  // Clearing restores only chain defaults; no hypothetical move or saved trade is applied by this action.
  await page
    .getByRole("button", { name: "Clear chain filters", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: "First trade index window",
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", {
      name: "Second trade: Enable Surface Trading",
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("combobox", { name: "Dependency route", exact: true }),
  ).toHaveValue("either");
  await expect(
    page.getByRole("spinbutton", {
      name: "Minimum interaction gain (EPPG)",
      exact: true,
    }),
  ).toHaveValue("2");
});

// Bulk changes persist in this planner only and never change the standard outgoing draft.
test("selects all chain pool players and preserves the standard finder", async ({ page }) => {
  await seed(page);
  const original = await stored(page);
  const pool = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: /^Chain tradable pool/ }) });
  await pool.locator("summary").click();
  const players = pool.getByRole("checkbox", { name: /^Chain tradable player:/ });
  const count = Math.min(await players.count(), 12);
  await pool.getByRole("button", { name: /^Select all/ }).click();
  await expect(pool.locator('input[type="checkbox"]:checked')).toHaveCount(count);
  await expect.poll(async () => JSON.parse((await stored(page)).state.filters.tradeSearchSettings).chain.query.pool.length).toBe(count);
  expect((await stored(page)).state.draft).toEqual(original.state.draft);
  await page.reload();
  await page.getByRole("button", { name: "Two-trade chain planner", exact: true }).click();
  await pool.locator("summary").click();
  await expect(pool.locator('input[type="checkbox"]:checked')).toHaveCount(count);
  await expect(pool.getByRole("button", { name: /^Select all/ })).toBeDisabled();
});
