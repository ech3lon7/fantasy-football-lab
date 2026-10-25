import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  initialState,
  type Dataset,
  type Workspace,
} from "../../src/domain/contracts";

// Use public synthetic data and an isolated browser database; no real account or source workbook is needed.
async function seed(page: Page) {
  const dataset: Dataset = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
    import {fixture} from './tests/fixtures.ts';
    import {fromTables} from './src/import/workbook.ts';
    const d=await fixture([0,-2,12,10,30]);
    d.tables.ModelPlayers.find(p=>p.PlayerID===1).Current_Week_Projection=null;
    d.tables.ModelPlayers.find(p=>p.PlayerID===2).Current_Week_Projection=0;
    process.stdout.write(JSON.stringify(await fromTables(d.tables,d.settings)));
  `,
      ],
      { encoding: "utf8" },
    ),
  );
  const workspace: Workspace = {
    owner: "local",
    dataset,
    state: initialState(dataset),
    datasetRevision: 0,
    stateRevision: 0,
    pendingDataset: false,
    pendingState: false,
    requestId: crypto.randomUUID(),
    stateRequestId: crypto.randomUUID(),
  };
  await page.goto("./");
  await page.evaluate(async (w) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fantasy-football-lab", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("current");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("current", "readwrite");
      tx.objectStore("current").put(w, "local");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, workspace);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your roster", exact: true }),
  ).toBeVisible();
}

// A trade inspection must leave the draft, route and computed result intact and distinguish zero from missing.
test("trade names inspect both players without changing the draft", async ({
  page,
}) => {
  await seed(page);
  await page.goto("./#/trades");
  const outgoing = page.getByRole("combobox", {
    name: "Outgoing player 1",
    exact: true,
  });
  const incoming = page.getByRole("combobox", {
    name: "Incoming player 1",
    exact: true,
  });
  await outgoing.selectOption("1");
  await incoming.selectOption("2");
  await expect(
    page.getByRole("heading", { name: "Surplus exchange", exact: true }),
  ).toBeVisible();
  const trigger = page
    .locator(".trade-selected-player")
    .getByRole("link", { name: "Synthetic 1", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  let dialog = page.getByRole("dialog", { name: "Synthetic 1", exact: true });
  await expect(dialog).toHaveAttribute("data-layout", "popover");
  await expect(page).toHaveURL(/#\/trades$/);
  await expect(dialog.locator(".player-popover-owner")).toContainText("Test A");
  const missing = dialog
    .locator(".player-popover-metrics > div")
    .filter({ has: page.getByText("ESPN Week 6", { exact: true }) });
  await expect(missing).toHaveClass("muted");
  await expect(missing.locator("dd")).toHaveText("n.a.");
  await dialog.getByText("Completed-game scores", { exact: true }).click();
  await expect(
    dialog.getByRole("cell", { name: "-2.00", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("cell", { name: "0.00", exact: true }),
  ).toBeVisible();
  await dialog.getByText("All evaluation stats", { exact: true }).click();
  await expect(
    dialog.getByText("Replacement PPG", { exact: true }),
  ).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(outgoing).toHaveValue("1");
  await expect(incoming).toHaveValue("2");
  await page
    .locator(".trade-selected-player")
    .getByRole("link", { name: "Synthetic 2", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Synthetic 2", exact: true });
  const zero = dialog
    .locator(".player-popover-metrics > div")
    .filter({ has: page.getByText("ESPN Week 6", { exact: true }) });
  await expect(zero).toHaveClass("projection");
  await expect(zero.locator("dd")).toHaveText("0.00");
  await page.screenshot({
    path: "test-results/player-popover-trade-desktop.png",
  });
  // The larger card covers the page heading; click the viewport margin to exercise the same outside-dismiss behavior.
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
  await expect(incoming).toHaveValue("2");
  // Scrolling the original name out of view dismisses the detached card without altering the draft.
  await trigger.click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(outgoing).toHaveValue("1");
});

// Shared links work across roster/discovery tables, while the full profile remains an explicit navigation action.
test("roster and discovery popovers preserve the page and retain full profile navigation", async ({
  page,
}) => {
  await seed(page);
  for (const route of [
    "overview",
    "teams",
    "players",
    "gems",
    "model",
    "weekly",
  ]) {
    await page.goto(`./#/${route}`);
    if (route === "gems") {
      await page
        .getByRole("button", { name: "Clear signals", exact: true })
        .click();
      await page
        .getByRole("combobox", { name: "Player pool", exact: true })
        .selectOption("All");
      await page
        .getByRole("button", { name: "Apply filters", exact: true })
        .click();
    }
    const trigger = page.locator('a[aria-haspopup="dialog"]').first();
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#/${route}$`));
    await dialog.getByRole("button", { name: "Close player details" }).click();
    await expect(trigger).toBeFocused();
  }
  await page.goto("./#/overview");
  await page.locator('a[href="#/player/1"]').first().click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Open full player page" })
    .click();
  await expect(page).toHaveURL(/#\/player\/1$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Synthetic 1", exact: true }),
  ).toBeVisible();
});

// Typed comparison choices resolve the existing saved IDs independently of the league-pool search, without retaining stale stats.
test("player comparisons accept typed names and suggestions and preserve selections on reload", async ({
  page,
}) => {
  await seed(page);
  await page.goto("./#/players");
  const comparison = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Player comparison", exact: true }),
  });
  const first = comparison.getByRole("combobox", {
      name: "Player 1",
      exact: true,
    }),
    second = comparison.getByRole("combobox", {
      name: "Player 2",
      exact: true,
    }),
    third = comparison.getByRole("combobox", { name: "Player 3", exact: true });
  await first.fill("synthetic 1");
  await second.fill("Synthetic 2 · WR · 2");
  await page
    .getByRole("textbox", { name: "Search players", exact: true })
    .fill("Synthetic 1");
  await third.fill("Synthetic 100");
  await expect(comparison.locator("tbody tr")).toHaveCount(3);
  await expect(comparison.locator('a[href="#/player/2"]')).toBeVisible();
  await first.fill("");
  await second.fill("No matching player");
  await expect(comparison.locator("tbody tr")).toHaveCount(1);
  await expect(comparison.locator('a[href="#/player/100"]')).toBeVisible();
  // Wait for the normal persisted comparison rather than racing a browser reload against its IndexedDB transaction.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("fantasy-football-lab", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const workspace = await new Promise<Workspace>((resolve, reject) => {
          const request = db
            .transaction("current")
            .objectStore("current")
            .get("local");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        db.close();
        return workspace.state.filters.compareIds;
      }),
    )
    .toBe(",,100");
  await page.reload();
  await expect(third).toHaveValue("Synthetic 100 · QB · 100");
  await expect(first).toHaveValue("");
  await expect(second).toHaveValue("");
  await expect(comparison.locator("tbody tr")).toHaveCount(1);
});

// The mobile sheet traps focus, scrolls its own details and restores the page on dismissal or navigation.
test("mobile player details use an accessible bottom sheet", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  const trigger = page.locator('a[href="#/player/1"]').first();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Synthetic 1", exact: true });
  await expect(dialog).toHaveAttribute("data-layout", "sheet");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(page.locator(".app-shell")).toHaveAttribute("inert", "");
  await expect(
    dialog.getByRole("button", { name: "Close player details" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("link", { name: "Open full player page" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close player details" }),
  ).toBeFocused();
  await dialog
    .getByText("Workload and advanced evidence", { exact: true })
    .click();
  await expect(
    dialog.getByText("Recent route participation", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog
      .getByText("Recent route participation", { exact: true })
      .locator(".."),
  ).toHaveClass("muted");
  await expect(
    dialog.getByRole("link", { name: "Open full player page" }),
  ).toBeVisible();
  await dialog.evaluate((node) => (node.scrollTop = 0));
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBe(0);
  expect(Math.round(bounds!.y + bounds!.height)).toBe(844);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/player-popover-mobile.png" });
  await page
    .locator(".player-popover-backdrop")
    .click({ position: { x: 15, y: 15 } });
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".app-shell")).not.toHaveAttribute("inert", "");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.goto("./#/players");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".app-shell")).not.toHaveAttribute("inert", "");
});
