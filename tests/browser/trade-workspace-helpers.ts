import { expect, type Page } from "@playwright/test";

// Legacy calculation assertions use the same details now deliberately tucked below the compact workspace.
export async function openTradeDetails(page: Page) {
  for (const selector of [".trade-full-analysis", ".trade-saved-drawer"]) {
    const details = page.locator(selector);
    await details.locator(":scope > summary").waitFor({ state: "visible" });
    if ((await details.getAttribute("open")) === null)
      await details.locator(":scope > summary").click();
    await expect(details).toHaveAttribute("open", "");
  }
}

// Existing calculation workflows expand the active finder's new categories explicitly; each tool retains its own state.
export async function openTradeFilters(page: Page, scope = "Standard") {
  const button = page.getByRole("button", {
    name: `${scope} filters`,
    exact: true,
  });
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
  // Legacy workflow assertions exercise all controls rather than the default compact presentation.
  const groups = page.locator(`#${scope.toLowerCase()}-trade-filters .trade-filter-category, #${scope.toLowerCase()}-trade-filters .trade-chain-leg`);
  for (let i = 0; i < await groups.count(); i++) {
    if (await groups.nth(i).getAttribute("open") === null)
      await groups.nth(i).locator(":scope > summary").click();
  }
}
