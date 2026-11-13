import { expect, type Page } from "@playwright/test";

// Open the current manual disclosures and saved drawer through their visible controls.
export async function openTradeDetails(page: Page) {
  const groups = page.locator(".gd-manual > div > details.gd-disclosure");
  for (let i = 0; i < await groups.count(); i++) {
    if (await groups.nth(i).getAttribute("open") === null)
      await groups.nth(i).locator(":scope > summary").click();
  }
  await openSavedTrades(page);
}

// Saved trades now open from the toolbar; the hidden summary is intentionally not interactive.
export async function openSavedTrades(page: Page) {
  const drawer = page.locator(".trade-saved-drawer");
  if (await drawer.getAttribute("open") === null)
    await page.getByRole("button", { name: "Saved trades", exact: true }).click();
  await expect(drawer).toBeVisible();
}

// Expand both full-roster pickers before choosing named players instead of relying on quick-pick order.
export async function openManualPlayers(page: Page) {
  await expect(page.locator(".gd-manual")).toBeVisible();
  const groups = page.locator(".gd-side details");
  for (let i = 0; i < await groups.count(); i++) {
    if (await groups.nth(i).getAttribute("open") === null)
      await groups.nth(i).locator(":scope > summary").click();
  }
}

// Existing calculation workflows expand the active finder's new categories explicitly; each tool retains its own state.
export async function openTradeFilters(page: Page, scope = "Standard") {
  // Manual assessment controls live inside their own disclosure after the redesign.
  if (scope === "Manual") {
    const section = page.locator(".gd-manual details.gd-disclosure").filter({
      has: page.locator(":scope > summary", { hasText: "Surface assessment & manager expectations" }),
    });
    if (await section.getAttribute("open") === null)
      await section.locator(":scope > summary").click();
    return;
  }
  // The rebuilt screens have no Filters toggle: every folding group of the active tab opens from its own summary.
  const root = page.locator(scope === "Chain" ? ".gd-chain" : ".gd-find");
  await expect(root).toBeVisible();
  for (const selector of ["details.gd-fg", "details.gd-limits"]) {
    const groups = root.locator(selector);
    for (let i = 0; i < (await groups.count()); i++)
      if ((await groups.nth(i).getAttribute("open")) === null)
        await groups.nth(i).locator(":scope > summary").click();
  }
}

// The earlier trade finder and chain planner open under their Trade room tabs.
export async function openLegacyTrades(
  page: Page,
  tab: "Find trades" | "Chain planner" | "Manual analyzer" = "Find trades",
) {
  await page.goto("./#/trades");
  await page.getByRole("tab", { name: tab }).click();
}

// Build the simplest valid offer in the Manual analyzer: one player from each team. Navigates by hash so unsaved state survives.
export async function buildManualOffer(page: Page, partner = "Test B") {
  await page.evaluate(() => {
    location.hash = "#/trade";
  });
  await page
    .getByRole("combobox", { name: "Trade partner" })
    .selectOption({ label: partner });
  await openManualPlayers(page);
  await page
    .locator('.gd-picker[aria-label="Players you send"]')
    .getByRole("button")
    .first()
    .click();
  await page
    .locator('.gd-picker[aria-label="Players you receive"]')
    .getByRole("button")
    .first()
    .click();
}
