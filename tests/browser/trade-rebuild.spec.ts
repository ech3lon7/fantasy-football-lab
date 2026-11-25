import { waitForFindResults } from "./trade-workspace-helpers";
import { test, expect, type Page } from "@playwright/test";
import { seedTradeLeague } from "./trade-seed";

// Acceptance tests of the one-broad-search design (docs/trade-search-one-search-proposal.md) in the browser:
// Find trades is the inline filter wheel (Team, Never trade, the filters, Search) and the results below; Sort and Show hidden act on
// retained results. Nothing here accepts a fallback selector or skips a check when an element is missing.

const searchDraft = { teamA: "1", teamB: "2", give: ["101"], get: [] };
const chainDraft = { teamA: "1", teamB: "2", give: ["3", "8", "9"], get: [] };

const wheel = (page: Page) =>
  page.getByRole("dialog", { name: "Trade filters" });
const segment = (page: Page, name: RegExp | string) =>
  wheel(page).getByRole("menuitem", { name });
// Changed selector: Back is the hub of the polished board (there is no done link).
const done = (page: Page) => wheel(page).locator(".gd-zb-hub").click();
// The two gain options are the frame every other test changes.
async function openTheirGain(page: Page) {
  await segment(page, /^Gains/).click();
  await wheel(page).getByRole("menuitem", { name: "Their EPPG", exact: true }).click();
  return wheel(page).getByRole("slider", { name: "Their EPPG at least" });
}
async function openYourGain(page: Page) {
  await segment(page, /^Gains/).click();
  await wheel(page).getByRole("menuitem", { name: "Your EPPG", exact: true }).click();
  return wheel(page).getByRole("slider", { name: "Your EPPG minimum" });
}

async function openFind(page: Page) {
  await seedTradeLeague(page, "search", searchDraft, { feelAnimation: "off" });
  await page.goto("./#/trade");
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await expect(page.locator(".gd-broad-search")).toBeVisible();
  await expect(wheel(page)).toBeVisible();
}
async function runSearch(page: Page) {
  await wheel(page).getByRole("button", { name: "Search", exact: true }).click();
  // Progress also mentions possible trades; only the final coverage line means filtering and animations have settled.
  await expect(page.getByText(/^Checked all [\d,]+ possible trades/)).toBeVisible({ timeout: 60000 });
  // Wait for worker completion and the deferred list to match the live wheel counts.
  await waitForFindResults(page);
}
// "212 ideas · 188 trades of 221 found" → { shown: 188, total: 221 }
async function counts(page: Page) {
  const text = await page
    .getByRole("region", { name: "Trade search results" })
    .locator(".gd-chips b")
    .first()
    .innerText();
  const [, , trades, found] = text.match(/([\d,]+) ideas · ([\d,]+) trades of ([\d,]+) found/)!;
  return {
    shown: Number(trades.replace(/,/g, "")),
    total: Number(found.replace(/,/g, "")),
  };
}
// "hides N" under the option in the hub.
const hides = async (page: Page) =>
  Number(
    (await wheel(page).locator(".gd-zh-hides").innerText()).match(/hides\s+([\d,]+)/)![1].replace(/,/g, ""),
  );

test.describe("Find trades: one search", () => {
  test("the wheel holds Team, Never trade and one Search button; the retired options are gone", async ({ page }) => {
    await openFind(page);
    const panel = page.getByRole("tabpanel", { name: "Find trades" });
    // Changed selector: the team chooser is a chalk button in the left rail ("for <team>") that opens a list of teams.
    await expect(wheel(page).getByRole("button", { name: /^for / })).toHaveCount(1);
    await expect(segment(page, /^Never trade/)).toBeVisible();
    const visible: string[] = [];
    const buttons = panel.getByRole("button", { name: /search/i });
    for (let i = 0; i < (await buttons.count()); i++)
      if (await buttons.nth(i).isVisible()) visible.push(((await buttons.nth(i).textContent()) ?? "").trim()); // Changed: textContent, because SEARCH is drawn in capitals by the board's CSS.
    expect(visible).toEqual(["Search"]);
    for (const retired of [
      "Search goal", "Rank by", "Manager profiles", "Surface Trading", "Search limits", "Use strict index range",
      "Value range", "Find matching trades", "Every find trades control is below", "near misses",
    ])
      // The Manual analyzer keeps its own surface panel mounted but hidden, so only what is visible counts.
      await expect(panel.getByText(retired, { exact: false }).filter({ visible: true })).toHaveCount(0);
  });

  test("before a search there is a prompt and no results", async ({ page }) => {
    await openFind(page);
    // Changed copy (polish proposal 2.5): the button is "Search", so the prompt says so.
    await expect(page.getByText("Press Search to check every legal trade for your team.")).toBeVisible();
    await expect(page.locator(".gd-res-row")).toHaveCount(0);
  });

  test("a search lists real rows with photos, grade chips, a gain with range and a status, and a coverage line", async ({ page }) => {
    await openFind(page);
    await runSearch(page);
    // Top-level rows only: variants sit inside closed disclosures.
    const rows = page.locator(".gd-res > .gd-res-group > .gd-res-row");
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      await expect(row.locator(".gd-photo").first()).toBeVisible();
      // Both sides carry a signed, one-decimal EPPG gain (F9).
      await expect(row.locator(".gd-gain-you")).toHaveText(/^([+-]?\d+\.\d+|—)$/);
      await expect(row.locator(".gd-gain-them")).toHaveText(/^([+-]?\d+\.\d+|—)$/);
      await expect(row.locator(".gd-stag").first()).toHaveText(/Passes every price test|Price warning|Widened search/);
      await expect(row.getByRole("button", { name: "Analyze" })).toBeVisible();
    }
    expect(await rows.locator(".gd-chipg").count()).toBeGreaterThan(0);
    await expect(page.getByText(/^Checked all [\d,]+ possible trades · [\d,]+ raise your EPPG · \d+ teams?$/)).toBeVisible();
    const { shown, total } = await counts(page);
    expect(shown).toBeLessThanOrEqual(total);
  });

  test("Their EPPG gain defaults to -2, accepts only -2 to +1 in half steps, and Reset to defaults restores it (R6b)", async ({ page }) => {
    await openFind(page);
    await runSearch(page);
    const handle = await openTheirGain(page);
    await expect(handle).toHaveAttribute("aria-valuenow", "-2");
    await expect(handle).toHaveAttribute("aria-valuemin", "-2");
    await expect(handle).toHaveAttribute("aria-valuemax", "1");
    await expect(handle).toHaveAttribute("aria-valuetext", "Their EPPG at least -2");
    // There is no maximum for their gain: one handle only.
    await expect(wheel(page).getByRole("slider")).toHaveCount(1);
    await handle.press("End");
    await handle.press("ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", "1");
    await handle.press("Home");
    await handle.press("ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "-2");
    await handle.press("ArrowRight");
    await handle.press("ArrowRight");
    await done(page);
    await done(page);
    await expect(handle).toHaveCount(0);
    await expect(wheel(page).locator('[data-zone="rail"]')).toContainText("1 filters on");
    // Reset to defaults puts their gain back to -2 and your gain back to 0.
    await wheel(page).getByRole("button", { name: "Reset to defaults", exact: true }).click();
    await expect(wheel(page).locator('[data-zone="rail"]')).toContainText("0 filters on");
    await expect(await openTheirGain(page)).toHaveAttribute("aria-valuenow", "-2");
    await expect(await openYourGain(page)).toHaveAttribute("aria-valuenow", "0");
  });

  test("relaxing a filter updates the list at once and raises the count by exactly its hides N (R6)", async ({ page }) => {
    await openFind(page);
    await runSearch(page);
    const before = await counts(page);
    const handle = await openYourGain(page);
    // Tighten the filter first to hide trades.
    for (let i = 0; i < 4; i++) await handle.press("ArrowRight");
    // "hides N" is counted from the search results after the option opens, so wait for the count to land.
    await expect.poll(async () => hides(page)).toBeGreaterThan(0);
    const n = await hides(page);
    const tightened = await counts(page);
    await handle.press("Home");
    await expect.poll(async () => (await counts(page)).shown).toBe(tightened.shown + n);
    expect((await counts(page)).total).toBe(before.total);
    // No new search ran: there is still one coverage line, from the first search.
    await expect(page.getByText(/possible trades/)).toHaveCount(1);
    // Putting the filter back hides them again.
    for (let i = 0; i < 4; i++) await handle.press("ArrowRight");
    await expect.poll(async () => (await counts(page)).shown).toBe(tightened.shown);
  });

  test("Sort changes the order and never the count; Show hidden lists the removed trades with their reasons (R7, R8)", async ({ page }) => {
    await openFind(page);
    await runSearch(page);
    const before = await counts(page);
    const sort = page.getByRole("combobox", { name: "Sort" });
    for (const value of ["other", "week", "both", "balance", "acceptance"]) {
      await sort.selectOption(value);
      await expect.poll(async () => (await counts(page)).shown).toBe(before.shown);
    }
    // This fixture's trades all improve the opponent; use a restrictive own-gain bound to create genuine hidden rows.
    const handle = await openYourGain(page);
    for (let i = 0; i < 4; i++) await handle.press("ArrowRight");
    await done(page);
    await done(page);
    // Filtering runs in the worker; wait for the new hidden count before reading the settled totals.
    await expect.poll(async () => { const n = await counts(page); return n.total - n.shown; }).toBeGreaterThan(0);
    const filtered = await counts(page);
    expect(filtered.total - filtered.shown).toBeGreaterThan(0);
    await page.getByRole("checkbox", { name: "Show hidden" }).check();
    const hidden = page.getByText(/· Hidden:/);
    await expect(hidden.first()).toBeVisible();
    await expect(hidden.first()).toContainText(/Your EPPG gain|Their EPPG gain/);
    // Hidden rows use the same initial 50-row page limit; the heading must still account for every excluded trade.
    const hiddenTotal = filtered.total - filtered.shown;
    const loaded = Math.min(50, hiddenTotal);
    await expect(hidden).toHaveCount(loaded);
    await expect(page.getByRole("heading", { name: `Showing ${loaded} of ${hiddenTotal.toLocaleString()} hidden trades` })).toBeVisible();
  });

  test("a player on the Never trade list never appears in what you give (R9)", async ({ page }) => {
    await openFind(page);
    await segment(page, /^Never trade/).click();
    await wheel(page).getByRole("searchbox", { name: "Search players" }).fill("Main QB");
    await wheel(page).getByRole("button", { name: /Main QB/ }).first().click();
    await expect(wheel(page).getByRole("button", { name: /Main QB/ }).first()).toHaveAttribute("aria-pressed", "true");
    await done(page);
    await expect(segment(page, /^Never trade/)).toContainText("1 set");
    await runSearch(page);
    await expect(page.locator(".gd-res-row").first()).toBeVisible();
    await expect(page.locator(".gd-res-row", { hasText: "Main QB" })).toHaveCount(0);
  });

  test("filters survive a reload for the same team", async ({ page }) => {
    await openFind(page);
    await runSearch(page);
    const handle = await openTheirGain(page);
    await handle.press("Home");
    await handle.press("ArrowRight");
    await handle.press("ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", "-1");
    await page.reload();
    await page.getByRole("tab", { name: "Find trades", exact: true }).click();
    await runSearch(page);
    await expect(await openTheirGain(page)).toHaveAttribute("aria-valuenow", "-1");
  });

  test("Diagnostics is closed by default and holds the debug download", async ({ page }) => {
    await openFind(page);
    await runSearch(page);
    const diag = page.locator("details.gd-diag");
    await expect(diag).toHaveCount(1);
    await expect(diag).not.toHaveAttribute("open", "");
    await expect(page.getByRole("button", { name: "Download search debug" })).toBeHidden();
    await diag.locator("> summary").click();
    await expect(page.getByRole("button", { name: "Download search debug" })).toBeVisible();
  });
});

test.describe("Chain planner after the simplification", () => {
  async function openChain(page: Page) {
    await seedTradeLeague(page, "chain", chainDraft, { feelAnimation: "off" });
    await page.goto("./#/trade");
    await page.getByRole("tab", { name: "Chain planner", exact: true }).click();
    await expect(page.locator(".gd-chain")).toBeVisible();
  }

  test("no presets, rank mode, Surface Trading, grade-drop limit, strictness or price-test controls (R10)", async ({ page }) => {
    await openChain(page);
    const panel = page.getByRole("tabpanel", { name: "Chain planner" });
    await expect(page.getByRole("radiogroup", { name: "Chain preset" })).toHaveCount(0);
    for (const retired of [
      "Chain preset", "Rank plans by", "Surface Trading", "Limit positional grade drops", "strictness", "Price tests required",
    ])
      // The Manual analyzer keeps its own surface panel mounted but hidden, so only what is visible counts.
      await expect(panel.getByText(retired, { exact: false }).filter({ visible: true })).toHaveCount(0);
  });

  test("Their EPPG gain minimum: default +1, only -2 to +1 in half steps", async ({ page }) => {
    await openChain(page);
    const box = page.getByRole("spinbutton", { name: "Their EPPG gain minimum" });
    await expect(box).toHaveValue("1");
    await box.fill("7");
    await expect(box).toHaveValue("1");
    await box.fill("-4");
    await expect(box).toHaveValue("-2");
  });

  test("the shared limits stay editable and show an edited marker", async ({ page }) => {
    await openChain(page);
    const limits = page.locator(".gd-chain details.gd-limits");
    await limits.locator("> summary").click();
    await limits.getByRole("slider", { name: "Minimum final gain" }).fill("6");
    await expect(limits.locator("> summary .gd-edot")).toBeVisible();
  });

  test("no step cards before a search; after one, every chain is two step cards and one connected result, with Sort in the results header", async ({ page }) => {
    await openChain(page);
    await expect(page.locator(".gd-leg")).toHaveCount(0);
    await page.getByRole("button", { name: "Run chain trade search" }).click();
    const steps = page.locator(".gd-leg[data-kind='step']");
    await expect(steps.first()).toBeVisible({ timeout: 60000 });
    const chains = page.locator(".gd-leg[data-kind='chain']");
    const chainCount = await chains.count();
    expect(chainCount).toBeGreaterThan(0);
    await expect(steps).toHaveCount(chainCount * 2);
    await expect(steps.nth(0)).toContainText("Trade 1");
    await expect(steps.nth(1)).toContainText("Trade 2");
    await expect(chains.first()).toContainText("Connected chain result");
    await expect(chains.first().locator(".gd-gain")).toContainText("±");
    await expect(page.getByRole("combobox", { name: "Sort" })).toBeVisible();
  });
});
