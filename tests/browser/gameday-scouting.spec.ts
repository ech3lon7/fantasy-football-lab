import { test, expect, type Page } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

// Turn the preview on and open Scouting.
async function open(page: Page, hash = "#/scouting") {
  await seedLabelWhy(page);
  await page.goto("./#/data");
  await page.getByLabel("Use the Gameday Plus preview").check();
  await page.goto(`./${hash}`);
}
const count = async (page: Page) =>
  Number(
    (
      await page
        .getByRole("status")
        .filter({ hasText: /player/ })
        .innerText()
    ).split(" ")[0],
  );

// The explorer opens on the Gem screener search, filters live with a count beside each option, and has no Apply button.
test("scouting filters apply live with counts and no Apply button", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  const saved = page.getByRole("group", { name: "Saved searches" });
  await expect(
    saved.getByRole("button", { name: "Gem screener" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^Apply/ })).toHaveCount(0);
  const before = await count(page);
  expect(before).toBeGreaterThan(0);
  // Every option carries the number of players it would leave.
  const gem = page.getByRole("button", { name: /^Watch \d+$/ });
  await expect(gem).toBeVisible();
  const promised = Number((await gem.innerText()).replace(/\D/g, ""));
  await gem.click();
  await expect(gem).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => count(page)).toBe(promised);
  // The saved-search highlight clears once the search is edited.
  await expect(
    saved.getByRole("button", { name: "Gem screener" }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect.poll(() => count(page)).toBe(before);
  // Selections survive a reload.
  await gem.click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: /^Watch \d+$/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

// Any-of widens the selection, and an invalid number shows an inline error without changing the results.
test("any-of matching widens results and invalid numbers block nothing else", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: /^Watch \d+$/ }).click();
  await page.getByRole("button", { name: /^Role-growth watch \d+$/ }).click();
  const all = await count(page);
  await page.getByRole("button", { name: "Any of" }).click();
  await expect.poll(() => count(page)).toBeGreaterThanOrEqual(all);
  const anyCount = await count(page);
  const trend = page.getByRole("textbox", { name: "Minimum trend PPG" });
  await trend.fill("abc");
  await expect(trend).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Enter a finite decimal number")).toBeVisible();
  expect(await count(page)).toBe(anyCount);
  await trend.fill("2.5");
  await expect(trend).toHaveValue("2.5");
  await expect(trend).toHaveAttribute("aria-invalid", "false");
});

// Cards and Table are two views of the same results, sortable, with Expected PPG as the default.
test("cards and table show the same players and sort by Expected PPG by default", async ({
  page,
}) => {
  await open(page, "#/scouting");
  const cards = page.locator(".gd-pcard");
  await expect(cards.first()).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveValue(
    "expected",
  );
  const total = await count(page);
  expect(await cards.count()).toBe(Math.min(total, 48));
  await page
    .getByRole("group", { name: "View" })
    .getByRole("button", { name: "Table" })
    .click();
  await expect(page.locator("table")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(Math.min(total, 50));
  await page.screenshot({ path: "test-results/scouting-table.png" });
  await page
    .getByRole("group", { name: "View" })
    .getByRole("button", { name: "Cards" })
    .click();
  await page.screenshot({ path: "test-results/scouting-cards.png" });
});

// Built-in searches switch the whole filter set, and user searches can be saved, reloaded and deleted.
test("saved searches: built-in presets, save current, restore and delete", async ({
  page,
}) => {
  await open(page);
  const saved = page.getByRole("group", { name: "Saved searches" });
  await saved.getByRole("button", { name: "Weekly streamers" }).click();
  await expect(
    page.getByRole("button", { name: /^K \/ D\/ST \d+$/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await saved.getByRole("button", { name: "All players" }).click();
  await expect(
    page.getByRole("button", { name: /^All \d+$/ }).first(),
  ).toBeVisible();
  const allCount = await count(page);
  await page.getByRole("button", { name: /^Watch \d+$/ }).click();
  await saved.getByRole("button", { name: "Save current as…" }).click();
  await page
    .getByRole("textbox", { name: "Name for this search" })
    .fill("My gems");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    saved.getByRole("button", { name: "My gems", exact: true }),
  ).toBeVisible();
  await saved.getByRole("button", { name: "Gem screener" }).click();
  await saved.getByRole("button", { name: "My gems", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^Watch \d+$/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await count(page)).toBeLessThanOrEqual(allCount);
  await page.reload();
  await expect(
    saved.getByRole("button", { name: "My gems", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete saved search My gems" })
    .click();
  await expect(
    saved.getByRole("button", { name: "My gems", exact: true }),
  ).toHaveCount(0);
});

// Old Players, Gem screener and Weekly routes land on the same explorer.
test("old routes open Scouting and a result opens the player card", async ({
  page,
}) => {
  await open(page, "#/gems");
  await expect(
    page.getByRole("heading", { name: "Filters", exact: true }),
  ).toBeVisible();
  await page.goto("./#/weekly");
  await expect(
    page.getByRole("heading", { name: "Filters", exact: true }),
  ).toBeVisible();
  await page.goto("./#/players");
  await page.locator(".gd-pcard a.player-link").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

// Two players can be compared: add each from its card, read mirrored rows, and swap sides with the arrow keys.
test("versus compares two players and swaps sides with the arrow keys", async ({
  page,
}) => {
  await open(page);
  // Wait for the cards to render before reading their names.
  await expect(page.locator(".gd-pcard-name b").nth(1)).toBeVisible();
  const names = await page
    .locator(".gd-pcard-name b")
    .evaluateAll((els) => els.map((el) => el.textContent ?? ""));
  expect(names.length).toBeGreaterThan(1);
  await expect(
    page.getByRole("button", { name: "Versus", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: `Add ${names[0]} to versus` }).click();
  await page.getByRole("button", { name: `Add ${names[1]} to versus` }).click();
  const dialog = page.getByRole("dialog", { name: "Versus" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".gd-versus-side h2")).toHaveText([
    names[0],
    names[1],
  ]);
  await expect(dialog.locator(".gd-versus-row")).toHaveCount(7);
  await page.screenshot({ path: "test-results/versus.png" });
  await dialog.getByRole("button", { name: "Swap sides" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(dialog.locator(".gd-versus-side h2")).toHaveText([
    names[1],
    names[0],
  ]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // The pair is remembered, so Versus reopens it.
  await page.getByRole("button", { name: "Versus", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Versus" })).toBeVisible();
});

// Gem tracking has its home in Scouting, folded until opened.
test("Prospective Gem tracking lives in Scouting behind a folding group", async ({
  page,
}) => {
  await open(page);
  const head = page.getByRole("button", { name: /Prospective Gem tracking/ });
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByText(/Automatic observation, not automatic retuning/),
  ).toBeVisible();
});
