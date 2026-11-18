import { expect, test, type Page } from "@playwright/test";
import { seedTradeLeague } from "./trade-seed";

const wheel = (page: Page) => page.getByRole("dialog", { name: "Trade filters" });
const segment = (page: Page, name: RegExp | string) =>
  wheel(page).getByRole("menuitem", { name });
// Changed selector: Back is the hub of the polished board (there is no done link).
const done = (page: Page) => wheel(page).locator(".gd-zb-hub").click();

// Verify the broad finder at each approved breakpoint against real worker results. Find trades has one filter control, the inline
// wheel, at every width.
for (const width of [1320, 1000, 390]) test(`broad search filters retained results at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => { const Native = window.Worker; (window as any).__tradeStarts = 0; window.Worker = class extends Native { constructor(url: string | URL, options?: WorkerOptions) { super(url, options); if (String(url).includes("trade-search.worker")) (window as any).__tradeStarts++; } }; });
  await seedTradeLeague(page, "search", { teamA: "1", teamB: "2", give: ["101"], get: [] }, { feelAnimation: "off" });
  await page.goto("./#/trade");
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await expect(wheel(page).getByRole("button", { name: "Search", exact: true })).toBeVisible();
  await wheel(page).getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText(/possible trades/)).toBeVisible({ timeout: 30000 });
  await expect(page.locator("[aria-label=\"Trade search results\"] article").first()).toBeVisible();
  // Their EPPG gain starts at +1 wherever the wheel is, and the arc sets it without a new search.
  await segment(page, /^Gains/).click();
  await wheel(page).getByRole("menuitem", { name: "Their EPPG", exact: true }).click();
  const slider = wheel(page).getByRole("slider", { name: "Their EPPG at least" });
  await expect(slider).toHaveAttribute("aria-valuenow", "1");
  await slider.press("ArrowLeft");
  await slider.press("ArrowLeft");
  await expect(slider).toHaveAttribute("aria-valuenow", "0");
  // Reset to defaults restores +1.
  await done(page);
  await done(page);
  await wheel(page).getByRole("button", { name: "Reset to defaults", exact: true }).click();
  await segment(page, /^Gains/).click();
  await wheel(page).getByRole("menuitem", { name: "Their EPPG", exact: true }).click();
  await expect(wheel(page).getByRole("slider", { name: "Their EPPG at least" })).toHaveAttribute("aria-valuenow", "1");
});
