import { waitForFindResults } from "./trade-workspace-helpers";
import { expect, test, type Page } from "@playwright/test";
import { seedTradeLeague } from "./trade-seed";

const draft = { teamA: "1", teamB: "2", give: [], get: [] };

// Start from the existing synthetic 12-team league, never from real league data.
async function openFind(page: Page, filters: Record<string, string> = {}) {
  await seedTradeLeague(page, "big", draft, { feelAnimation: "off", ...filters });
  await page.goto("./#/trade");
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await expect(page.locator(".gd-find")).toBeVisible();
}
// Changed selector: the polished board (it is the wheel board, with its rail and right zone).
const wheel = (page: Page) => page.locator(".gd-find .gd-zb:visible");
const results = (page: Page) => page.getByRole("region", { name: "Trade search results" });

// Read the filtered and retained totals, including the grouping prefix in the revised header.
async function counts(page: Page) {
  const text = await results(page).locator(".gd-chips").first().innerText();
  const match = text.match(/([\d,]+)\s+(?:trades\s+)?of\s+([\d,]+)(?:\s+found|\s+trades)/);
  expect(match).not.toBeNull();
  return { shown: Number(match![1].replace(/,/g, "")), total: Number(match![2].replace(/,/g, "")) };
}

// Collect every rendered trade key while search progress is visible.
async function recordStream(page: Page) {
  await page.evaluate(() => {
    const win = window as typeof window & { streamedTradeKeys: string[]; tradeObserver: MutationObserver };
    win.streamedTradeKeys = [];
    win.tradeObserver = new MutationObserver(() => {
      if (!Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Cancel")) return;
      for (const row of document.querySelectorAll<HTMLElement>(".gd-res-group[data-key]")) {
        const key = row.dataset.key;
        if (key && !win.streamedTradeKeys.includes(key)) win.streamedTradeKeys.push(key);
      }
    });
    win.tradeObserver.observe(document.body, { childList: true, subtree: true });
  });
}

// Show every retained filtered page and expand each grouped trade for a complete key comparison.
async function allVisibleKeys(page: Page) {
  const more = results(page).getByRole("button", { name: "Show more" });
  while (await more.isVisible()) {
    const before = await page.locator(".gd-res-group[data-key]").count();
    await more.click();
    await expect.poll(() => page.locator(".gd-res-group[data-key]").count(), { timeout: 30000 }).toBeGreaterThan(before);
  }
  // Open only package groups in one batch: expanding lazy children must not invalidate indexed summary locators.
  await results(page).locator("details.gd-variants").evaluateAll((groups) => {
    groups.forEach((group) => { (group as HTMLDetailsElement).open = true; });
  });
  // Toggle events mount the lazy children asynchronously; verify every counted trade is present before comparing keys.
  const expected = (await counts(page)).shown;
  await expect.poll(() => results(page).locator(".gd-res-group[data-key]").count(), { timeout: 30000 }).toBe(expected);
  return page.locator(".gd-res-group[data-key]").evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.key!));
}

// The inline wheel is the sole filter entry point, before search on desktop and phone.
for (const width of [1320, 390]) {
  test(`inline wheel and results only at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openFind(page);
    const panel = page.locator(".gd-find");
    await expect(wheel(page)).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Filters(?:\s|$)/ })).toHaveCount(0);
    await expect(page.locator(".gd-broad-filter-panel:visible, .gd-broad-filter-toggle:visible")).toHaveCount(0);
    await expect(page.getByText("List view", { exact: true }).filter({ visible: true })).toHaveCount(0);
    await expect(panel.locator(":scope > *:visible")).toHaveCount(2);
    await page.keyboard.press("Shift+Space");
    await expect.poll(() => wheel(page).evaluate((node) => node.contains(document.activeElement))).toBe(true);
  });
}

// Exercise the full-size search, the complete filtered set, both reset actions and incremental hide counts.
test("full league keeps streamed trades and explains filter totals", async ({ page }) => {
  test.setTimeout(600000);
  await page.setViewportSize({ width: 1320, height: 900 });
  await openFind(page);
  await recordStream(page);
  await page.getByRole("button", { name: /^(Search|Search all trades)$/ }).click();
  // Progress also mentions possible trades; only the final coverage line means filtering and animations have settled.
  await expect(page.getByText(/^Checked all [\d,]+ possible trades/)).toBeVisible({ timeout: 360000 });
  // Wait for worker completion and the deferred list to match the live wheel counts.
  await waitForFindResults(page);
  const before = await counts(page);
  expect(before.total).toBeGreaterThan(0);
  if (before.shown === 0) {
    await expect(results(page).getByText(/filters hide all/i)).toBeVisible();
    await results(page).getByRole("button", { name: "Show all" }).click();
    await expect(page.locator(".gd-res-row:visible").first()).toBeVisible();
  } else {
    await expect(page.locator(".gd-res-row:visible").first()).toBeVisible();
    const streamed = await page.evaluate(() => (window as typeof window & { streamedTradeKeys: string[] }).streamedTradeKeys);
    expect(streamed.length).toBeGreaterThan(0);
    const finalKeys = new Set(await allVisibleKeys(page));
    expect(streamed.filter((key) => !finalKeys.has(key))).toEqual([]);
  }
  expect(await results(page).evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThanOrEqual(900);
  await wheel(page).getByRole("button", { name: "Show all" }).click();
  await expect.poll(async () => { const n = await counts(page); return n.shown === n.total; }).toBe(true);
  await wheel(page).getByRole("button", { name: "Reset to defaults" }).click();
  await expect.poll(async () => (await counts(page)).shown).toBe(before.shown);
  await wheel(page).getByRole("menuitem", { name: /^Gains/ }).click();
  await wheel(page).getByRole("menuitem", { name: /^Their EPPG/ }).click();
  const hides = Number((await wheel(page).locator(".gd-zh-hides").innerText()).match(/hides\s+([\d,]+)/)![1].replace(/,/g, ""));
  const slider = wheel(page).getByRole("slider", { name: /Their EPPG/i });
  await slider.focus(); await page.keyboard.press("Home");
  await expect.poll(async () => (await counts(page)).shown).toBe(before.shown + hides);
});

// Legacy offered players must not silently become required outgoing filters.
test("old offered-player settings start at defaults", async ({ page }) => {
  test.setTimeout(420000);
  const old = JSON.stringify({ version: 1, standard: { query: { teamA: "1", give: ["1000"] } } });
  await openFind(page, { tradeSearchSettings: old });
  await expect(page.getByText("Your old Find trades settings don't apply to the new search, so filters start at the defaults.")).toBeVisible();
  await page.getByRole("button", { name: /^(Search|Search all trades)$/ }).click();
  // Progress also mentions possible trades; only the final coverage line means filtering and animations have settled.
  await expect(page.getByText(/^Checked all [\d,]+ possible trades/)).toBeVisible({ timeout: 360000 });
  // Wait for worker completion and the deferred list to match the live wheel counts.
  await waitForFindResults(page);
  expect((await counts(page)).shown).toBeGreaterThan(0);
  await wheel(page).getByRole("menuitem", { name: /^Gains/ }).click();
  await wheel(page).getByRole("menuitem", { name: /^Their EPPG/ }).click();
  await expect(wheel(page).getByRole("slider", { name: /Their EPPG/i })).toHaveAttribute("aria-valuenow", "-2");
});

// The saved workspace, read through the app's own IndexedDB store so the reload checks persistence, not a race with the save queue.
async function savedShortcut(page: Page) {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open("fantasy-football-lab", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<string | undefined>((resolve, reject) => {
        const r = db.transaction("current").objectStore("current").get("local");
        r.onsuccess = () =>
          resolve(
            (r.result as { state?: { filters?: Record<string, string> } } | undefined)
              ?.state?.filters?.filterWheelShortcut,
          );
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });
}

// The configured shortcut survives reload and never takes focus while the user types.
test("wheel shortcut is configurable and leaves typing alone", async ({ page }) => {
  await openFind(page);
  await page.keyboard.press("Shift+Space");
  await expect.poll(() => wheel(page).evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.goto("./#/lab");
  await page.getByRole("tab", { name: "Keyboard" }).click();
  const row = page.getByText("Filter wheel shortcut", { exact: true }).locator("..");
  await row.getByRole("button", { name: "Change" }).click();
  await page.keyboard.press("Shift+G");
  await expect(row).toContainText(/Shift\s*\+\s*G/i);
  await expect.poll(() => savedShortcut(page)).toBe("Shift+G");
  await page.reload();
  await page.goto("./#/trade");
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await page.keyboard.press("Shift+G");
  await expect.poll(() => wheel(page).evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await wheel(page).getByRole("menuitem", { name: /^Players/ }).click();
  await wheel(page).getByRole("menuitem", { name: "I get", exact: true }).click();
  const input = wheel(page).getByRole("searchbox", { name: /Search players/ });
  await input.fill("P 1"); await expect(input).toBeFocused();
  await expect(input).toHaveValue("P 1");
});
