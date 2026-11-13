import { test, expect, type Page } from "@playwright/test";
import { seedTradeLeague } from "./trade-seed";

// Acceptance tests 5.2 and 5.3 of the Find trades and Chain planner rebuild plan. They assert the rebuilt screens' contract:
// gd- classes, one Search button, summaries under titles, a Diagnostics disclosure, one preset radio group, shared limits.
// They never accept a fallback selector or skip a check when an element is missing, and they run on real search results.

const searchDraft = { teamA: "1", teamB: "2", give: ["101"], get: [] };
const chainDraft = { teamA: "1", teamB: "2", give: ["3", "8", "9"], get: [] };

async function openFind(page: Page) {
  await seedTradeLeague(page, "search", searchDraft, { feelAnimation: "off" });
  await page.goto("./#/trade");
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await expect(page.locator(".gd-find")).toBeVisible();
}

async function openChain(page: Page) {
  await seedTradeLeague(page, "chain", chainDraft, { feelAnimation: "off" });
  await page.goto("./#/trade");
  await page.getByRole("tab", { name: "Chain planner", exact: true }).click();
  await expect(page.locator(".gd-chain")).toBeVisible();
}

const groupTitles = [
  "Players & packages",
  "Teams to search",
  "Team needs",
  "Positional grade goals",
  "What you receive",
  "Roster fit",
  "Search limits",
  "Manager profiles & acceptance",
  "Ranking",
];

test.describe("5.2 Find trades", () => {
  test("exactly one Search button and none of the retired texts", async ({ page }) => {
    await openFind(page);
    const panel = page.getByRole("tabpanel", { name: "Find trades" });
    const visible: string[] = [];
    const buttons = panel.getByRole("button", { name: /search/i });
    for (let i = 0; i < (await buttons.count()); i++)
      if (await buttons.nth(i).isVisible())
        visible.push((await buttons.nth(i).innerText()).trim());
    expect(visible).toEqual(["Search trades across the league"]);
    for (const retired of [
      "Every find trades control is below",
      "Independent standard-search controls",
      "Use strict index range",
      "Value range",
      "Find matching trades",
    ])
      await expect(panel.getByText(retired, { exact: false })).toHaveCount(0);
    // The Search limits bar above the tabs and the Filters toggle are gone too.
    await expect(
      page.getByRole("button", { name: "Filters", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".gd-limits-bar")).toHaveCount(0);
  });

  test("nine folding groups, each summary below its title", async ({ page }) => {
    await openFind(page);
    const groups = page.locator(".gd-find aside[aria-label='Search controls'] details.gd-fg");
    await expect(groups).toHaveCount(groupTitles.length);
    await expect(groups.locator("> summary .gd-fg-title")).toHaveText(groupTitles);
    for (let i = 0; i < groupTitles.length; i++) {
      const summary = groups.nth(i).locator("> summary");
      const title = await summary.locator(".gd-fg-title").boundingBox();
      const line = await summary.locator(".gd-fs").boundingBox();
      expect(title, `title of ${groupTitles[i]}`).not.toBeNull();
      expect(line, `summary of ${groupTitles[i]}`).not.toBeNull();
      // Below, never beside: the summary starts at or under the bottom of the title.
      expect(line!.y).toBeGreaterThanOrEqual(title!.y + title!.height - 1);
      expect(
        (await summary.locator(".gd-fs").innerText()).trim().length,
        `summary text of ${groupTitles[i]}`,
      ).toBeGreaterThan(0);
    }
  });

  test("Diagnostics holds the debug buttons and is closed by default", async ({ page }) => {
    await openFind(page);
    const diag = page.locator(".gd-find details.gd-diag");
    await expect(diag).toHaveCount(1);
    await expect(diag.locator("> summary")).toHaveText(/Diagnostics/);
    await expect(diag).not.toHaveAttribute("open", "");
    const download = diag.getByRole("button", { name: "Download search debug" });
    const why = diag.getByRole("button", { name: /Why wasn.t this trade found/ });
    await expect(download).toBeHidden();
    await expect(why).toBeHidden();
    // Nothing diagnostic sits beside the Search button.
    await diag.locator("> summary").click();
    await expect(download).toBeVisible();
    await expect(why).toBeVisible();
    // Every debug button in the screen is inside Diagnostics: none sits beside the Search button.
    await expect(
      page.locator(".gd-find").getByRole("button", { name: /debug|Why wasn/ }),
    ).toHaveCount(2);
    await expect(
      diag.getByRole("button", { name: /debug|Why wasn/ }),
    ).toHaveCount(2);
  });

  test("before a search there are no result rows, chips or invented numbers", async ({ page }) => {
    await openFind(page);
    await expect(page.locator(".gd-res-row")).toHaveCount(0);
    await expect(page.locator(".gd-find .gd-chipg")).toHaveCount(0);
    await expect(page.locator(".gd-find .gd-stag")).toHaveCount(0);
    await expect(page.locator(".gd-find .gd-res")).toContainText(/Run a search/);
  });

  test("an impossible goal lists no trades and says so", async ({ page }) => {
    await openFind(page);
    const goals = page.locator(".gd-find .gd-goals");
    await goals.getByRole("button", { name: "+ Add goal" }).click();
    await goals.getByRole("combobox", { name: "Team" }).selectOption("other");
    await goals.getByRole("combobox", { name: "Position" }).selectOption("WR");
    await goals.getByRole("combobox", { name: "Grade steps" }).selectOption("5");
    await page.getByRole("button", { name: "Search trades across the league" }).click();
    await expect(page.locator(".gd-find .gd-applied")).toContainText(/0 trades meet every goal/, {
      timeout: 30000,
    });
    await expect(page.locator(".gd-res-row")).toHaveCount(0);
    await expect(page.locator(".gd-find .gd-res")).toContainText(/No trades met every goal/);
  });

  test("after a search every result row has a photo or initials, grade chips, a spread and a status tag", async ({
    page,
  }) => {
    await openFind(page);
    await page.getByRole("button", { name: "Search trades across the league" }).click();
    const rows = page.locator(".gd-res-row");
    await expect(rows.first()).toBeVisible({ timeout: 30000 });
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      await expect(row.locator(".gd-photo").first()).toBeVisible();
      await expect(row.locator(".gd-chipg").first()).toBeVisible();
      await expect(row.locator(".gd-gain")).toContainText("±");
      await expect(row.locator(".gd-stag").first()).toHaveText(
        /Passes every price test|Price warning|Widened search/,
      );
      await expect(row.getByRole("button", { name: "Analyze" })).toBeVisible();
    }
    // The summary line states the real total; rows show the first page of it (25 at a time).
    const summary = await page.locator(".gd-find .gd-applied").innerText();
    const total = Number(/^([\d,]+) trades? meet/.exec(summary)?.[1].replace(/,/g, ""));
    expect(total).toBeGreaterThan(0);
    expect(count).toBe(Math.min(total, 25));
    // Near misses live in a collapsed section below the results.
    const nm = page.locator(".gd-find details.gd-nm");
    await expect(nm).toHaveCount(1);
    await expect(nm).not.toHaveAttribute("open", "");
  });
});

test.describe("5.3 Chain planner", () => {
  test("one radio group of ten described presets, one selected", async ({ page }) => {
    await openChain(page);
    const group = page.getByRole("radiogroup", { name: "Chain preset" });
    await expect(group).toBeVisible();
    const options = group.getByRole("radio");
    await expect(options).toHaveCount(10);
    await expect(group.locator(".gd-pre-name")).toHaveText([
      "Balanced opportunities",
      "Mutual benefit",
      "Acquire a star",
      "Turn a star into depth",
      "Acquire coverage, then upgrade",
      "Connected chains",
      "Surface-stat trading",
      "Speculative sequences",
      "Fix my weakest position",
      "Buy low, then flip",
    ]);
    for (let i = 0; i < 10; i++)
      expect(
        (await options.nth(i).locator(".gd-pre-desc").innerText()).trim().length,
      ).toBeGreaterThan(10);
    await expect(group.locator("[aria-checked='true']")).toHaveCount(1);
    // Picking another preset moves the selection and leaves the shared limits alone.
    await options.nth(5).click();
    await expect(options.nth(5)).toHaveAttribute("aria-checked", "true");
    await expect(group.locator("[aria-checked='true']")).toHaveCount(1);
    await expect(page.locator(".gd-chain select").filter({ hasText: /Balanced opportunities/ })).toHaveCount(0);
  });

  test("no strictness or price-test controls", async ({ page }) => {
    await openChain(page);
    const panel = page.getByRole("tabpanel", { name: "Chain planner" });
    for (const retired of [
      "strictness",
      "Price tests required",
      "Chain price tests",
      "Final gain ≥ 5 EPPG",
    ])
      await expect(panel.getByText(retired, { exact: false })).toHaveCount(0);
    await expect(page.getByLabel(/strictness/i)).toHaveCount(0);
  });

  test("a shared limit edited in Chain planner shows in Find trades", async ({ page }) => {
    await openChain(page);
    const limits = page.locator(".gd-chain details.gd-limits");
    await limits.locator("> summary").click();
    for (const name of [
      "Minimum final gain",
      "Maximum temporary loss",
      "Maximum recipient value loss",
      "Index window",
    ])
      await expect(limits.getByRole("slider", { name })).toBeVisible();
    await limits.getByRole("slider", { name: "Minimum final gain" }).fill("6");
    await expect(limits.locator("> summary .gd-edot")).toBeVisible();
    await page.getByRole("tab", { name: "Find trades", exact: true }).click();
    const group = page
      .locator(".gd-find details.gd-fg")
      .filter({ has: page.locator(".gd-fg-title", { hasText: /^Search limits$/ }) });
    await expect(group.locator("> summary .gd-fs")).toContainText("6.0");
    await expect(group.locator("> summary .gd-edot")).toBeVisible();
  });

  test("no step cards before a search; after one, two step cards and one connected result", async ({
    page,
  }) => {
    await openChain(page);
    await expect(page.locator(".gd-leg")).toHaveCount(0);
    await page.getByRole("button", { name: "Run chain trade search" }).click();
    const steps = page.locator(".gd-leg[data-kind='step']");
    await expect(steps.first()).toBeVisible({ timeout: 60000 });
    // Every chain is two step cards and one connected result card.
    const chains = page.locator(".gd-leg[data-kind='chain']");
    const chainCount = await chains.count();
    expect(chainCount).toBeGreaterThan(0);
    await expect(steps).toHaveCount(chainCount * 2);
    await expect(steps.nth(0)).toContainText("Trade 1");
    await expect(steps.nth(1)).toContainText("Trade 2");
    for (let i = 0; i < 2; i++) {
      await expect(steps.nth(i).locator(".gd-chipg").first()).toBeVisible();
      await expect(steps.nth(i).locator(".gd-gain").first()).toContainText("±");
    }
    const chain = chains.first();
    await expect(chain).toContainText("Connected chain result");
    await expect(chain.locator(".gd-gain")).toContainText("±");
    await expect(chain.locator(".gd-stag").first()).toBeVisible();
  });
});
