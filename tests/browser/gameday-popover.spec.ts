import { test, expect } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

// Turn the preview on, then open the page under test.
async function enablePreview(page: import("@playwright/test").Page) {
  await seedLabelWhy(page);
  await page.goto("./#/data");
  await page.getByLabel("Use the Gameday Plus preview").check();
}

// Esc closes only the top popover, focus returns to each opener, and Tab never leaves the open popover.
test("popover stack: Esc closes the top one, focus returns, Tab is trapped", async ({
  page,
}) => {
  await enablePreview(page);
  const keys = page.getByRole("button", { name: "Keys", exact: true });
  await keys.focus();
  await keys.press("Enter");
  const first = page.getByRole("dialog", { name: "Keyboard reference" });
  await expect(first).toBeVisible();
  // Focus moves into the popover on open.
  await expect(first.getByRole("button", { name: "Close" })).toBeFocused();
  // Tab cycles inside the popover and never reaches the page behind it.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest('[role="dialog"]'),
      ),
    ).toBe(true);
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest('[role="dialog"]'),
      ),
    ).toBe(true);
  }
  // Open a second popover on top, then close layers one at a time.
  const nested = first.getByRole("button", { name: "How focus works" });
  await nested.focus();
  await nested.press("Enter");
  const second = page.getByRole("dialog", { name: "How focus works" });
  await expect(second).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(second).toHaveCount(0);
  await expect(first).toBeVisible();
  await expect(nested).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(first).toHaveCount(0);
  await expect(keys).toBeFocused();
});

// Up and Down move between player rows, stop at the ends, and leave fields alone.
test("Up and Down move between marked player rows", async ({ page }) => {
  await enablePreview(page);
  await page.goto("./#/scouting");
  const links = page.locator("[data-player-row] a.player-link");
  await expect(links.nth(2)).toBeVisible();
  await links.first().focus();
  const rowIndex = () =>
    page.evaluate(() => {
      const row = document.activeElement?.closest("[data-player-row]");
      return row ? [...row.parentElement!.children].indexOf(row) : -1;
    });
  expect(await rowIndex()).toBe(0);
  await page.keyboard.press("ArrowDown");
  expect(await rowIndex()).toBe(1);
  await page.keyboard.press("ArrowDown");
  expect(await rowIndex()).toBe(2);
  await page.keyboard.press("ArrowUp");
  expect(await rowIndex()).toBe(1);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  expect(await rowIndex()).toBe(0);
  // Arrow keys inside the header search belong to the search list, not the table.
  const search = page.getByRole("combobox", { name: "Search any player" });
  await search.fill("synthetic");
  await search.press("ArrowDown");
  await expect(page.locator("[data-player-row] a:focus")).toHaveCount(0);
});
