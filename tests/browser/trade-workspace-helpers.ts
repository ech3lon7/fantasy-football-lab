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

// Filters are closed by default in the redesign; acceptance tests explicitly open the appropriate tool's drawer.
export async function openTradeFilters(page: Page, scope = "Standard") {
  const button = page.getByRole("button", {
    name: `${scope} filters`,
    exact: true,
  });
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
}
