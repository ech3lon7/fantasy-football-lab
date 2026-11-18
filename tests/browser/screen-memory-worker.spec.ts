import { expect, test } from "@playwright/test";
import { seedTradeLeague } from "./trade-seed";

// Hold a synthetic search worker open while the real Trade room is hidden by Activity.
test("a running search receives progress while Trade room is hidden", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    class SearchWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      request: { id: string; context: string } | null = null;
      terminated = false;
      constructor() { Object.assign(window, { screenMemoryWorker: this }); }
      postMessage(message: { type: string; id: string; context: string }) { if (message.type === "start") this.request = message; }
      terminate() { this.terminated = true; }
      emit() { this.onmessage?.({ data: { ...this.request, type: "progress", progress: { phase: "Evaluating trades", stats: { scored: 2, matched: 10 } } } }); }
    }
    Object.defineProperty(window, "Worker", { value: class {
      constructor(url: string | URL, options?: WorkerOptions) {
        return String(url).includes("trade-search.worker") ? new SearchWorker() : new NativeWorker(url, options);
      }
    } });
  });
  await seedTradeLeague(page, "search", { teamA: "1", teamB: "2", give: ["101"], get: [] }, { feelAnimation: "off" });
  await page.goto("./#/trade");
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await page.getByRole("dialog", { name: "Trade filters" }).getByRole("button", { name: "Search", exact: true }).click();
  await page.goto("./#/teams");
  // The visible navigation announces a running background search.
  await expect(page.locator(".gd-nav .gd-search-running")).toBeVisible();
  await expect(page.locator(".gd-nav .gd-search-running")).toContainText("Search running");
  const retained = await page.evaluate(() => {
    const w = (window as unknown as { screenMemoryWorker: { terminated: boolean; emit(): void } }).screenMemoryWorker;
    w.emit(); return !w.terminated;
  });
  expect(retained).toBe(true);
  await page.goto("./#/trade");
  await expect(page.locator(".gd-search-running")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Trade search results" }).getByRole("status").first()).toContainText("2 of 10 evaluated");
  // An inner-tab change also keeps the same running worker and its progress.
  await page.getByRole("tab", { name: "Chain planner", exact: true }).click();
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await expect(page.getByRole("region", { name: "Trade search results" }).getByRole("status").first()).toContainText("2 of 10 evaluated");
  expect(await page.evaluate(() => !(window as unknown as { screenMemoryWorker: { terminated: boolean } }).screenMemoryWorker.terminated)).toBe(true);
});

// Completed results survive inner-tab navigation at desktop and phone widths.
for (const width of [1320, 390]) test(`find results survive inner tabs at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await seedTradeLeague(page, "search", { teamA: "1", teamB: "2", give: ["101"], get: [] }, { feelAnimation: "off" });
  await page.goto("./#/trade");
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await page.getByRole("dialog", { name: "Trade filters" }).getByRole("button", { name: "Search", exact: true }).click();
  const rows = page.locator(".gd-find .gd-res-row");
  await expect(rows.first()).toBeVisible({ timeout: 30000 });
  // Results stream in; count them once the search has finished.
  await expect(page.getByText(/possible trades/)).toBeVisible({ timeout: 60000 });
  const count = await rows.count();
  await page.getByRole("tab", { name: "Chain planner", exact: true }).click();
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await expect(rows).toHaveCount(count);
  await expect(rows.first()).toBeVisible();
});

// Completed chain plans stay intact when the Find trades tab is visited.
for (const width of [1320, 390]) test(`chain results survive inner tabs at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await seedTradeLeague(page, "chain", { teamA: "1", teamB: "2", give: ["3", "8", "9"], get: [] }, { feelAnimation: "off" });
  await page.goto("./#/trade");
  await page.getByRole("tab", { name: "Chain planner", exact: true }).click();
  await page.getByRole("button", { name: "Run chain trade search" }).click();
  const plans = page.locator(".gd-leg[data-kind='chain']");
  await expect(plans.first()).toBeVisible({ timeout: 60000 });
  const count = await plans.count();
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await page.getByRole("tab", { name: "Chain planner", exact: true }).click();
  await expect(plans).toHaveCount(count);
  await expect(plans.first()).toBeVisible();
});

// Hash navigation returns a player card to its originating screen; direct loads use This week.
test("player links return to their origin and direct loads return to This week", async ({ page }) => {
  await seedTradeLeague(page, "search", { teamA: "1", teamB: "2", give: ["101"], get: [] }, { feelAnimation: "off" });
  await page.goto("./#/trade");
  await page.goto("./#/player/101");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/trade$/);
  await page.goto("./#/player/101");
  await page.reload();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/overview$/);
});

// Previously visited screens retain their scroll position and leave the accessibility tree while hidden.
test("section navigation restores scroll and hides inactive controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await seedTradeLeague(page, "search", { teamA: "1", teamB: "2", give: ["101"], get: [] }, { feelAnimation: "off" });
  await page.goto("./#/trade");
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  const before = await page.evaluate(() => window.scrollY);
  await page.goto("./#/teams");
  await expect(page.locator(".gd-find")).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Trade filters" }).getByRole("button", { name: "Search", exact: true })).toHaveCount(0);
  await page.goto("./#/trade");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before - 2);
});
