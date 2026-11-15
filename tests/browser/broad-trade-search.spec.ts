import { expect, test } from "@playwright/test";
import { seedTradeLeague } from "./trade-seed";

// Verify the broad finder at each approved breakpoint against real worker results.
for (const width of [1320, 1000, 390]) test(`broad search filters retained results at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => { const Native = window.Worker; (window as any).__tradeStarts = 0; window.Worker = class extends Native { constructor(url: string | URL, options?: WorkerOptions) { super(url, options); if (String(url).includes("trade-search.worker")) (window as any).__tradeStarts++; } }; });
  await seedTradeLeague(page, "search", { teamA: "1", teamB: "2", give: ["101"], get: [] }, { feelAnimation: "off" });
  await page.goto("./#/trade");
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await expect(page.getByRole("button", { name: "Search all trades" })).toBeVisible();
  await page.getByRole("button", { name: "Search all trades" }).click();
  await expect(page.getByText(/one-for-ones checked/)).toBeVisible({ timeout: 30000 });
  await expect(page.locator("[aria-label=\"Trade search results\"] article").first()).toBeVisible();
  if (width <= 1100) await page.getByRole("button", { name: /Filters ·/ }).click();
  await expect(page.getByLabel(/Their EPPG gain minimum/)).toHaveValue("1");
  await page.getByLabel(/Their EPPG gain minimum/).fill("0");
  await expect(page.getByLabel(/Their EPPG gain minimum/)).toHaveValue("0");
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(page.getByLabel(/Their EPPG gain minimum/)).toHaveValue("1");
});

