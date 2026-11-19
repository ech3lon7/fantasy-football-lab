import { test, expect } from "@playwright/test";
import { seedTradeLeague } from "./trade-seed";

// T0 in the browser: the broad search on a 12-team league through the real worker and its helper pool.
test("broad search timing on a 12-team league", async ({ page }) => {
  test.setTimeout(600000);
  await seedTradeLeague(page, "big", { teamA: "1", teamB: "2", give: [], get: [] }, { feelAnimation: "off" });
  await page.goto("./#/trade");
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await page.getByRole("dialog", { name: "Trade filters" }).getByRole("button", { name: "Search", exact: true }).click();
  const t0 = Date.now();
  await expect(page.getByRole("region", { name: "Trade search results" }).locator("article").first()).toBeVisible({ timeout: 120000 });
  const firstRows = (Date.now() - t0) / 1000;
  const coverage = page.getByText(/possible trades/);
  await expect(coverage).toBeVisible({ timeout: 540000 });
  const full = (Date.now() - t0) / 1000;
  const text = await coverage.innerText();
  const summary = `first rows ${firstRows.toFixed(1)} s; full search ${full.toFixed(1)} s; ${text}`;
  console.log("TIMING " + summary);
  test.info().annotations.push({ type: "timing", description: summary });
  // The limit matches the approved 15 s search budget: first results appear only after a whole opponent is searched with details.
  expect(firstRows).toBeLessThan(15);
});
