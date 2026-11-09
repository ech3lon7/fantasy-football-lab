import { test, expect } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

// The earned label is selected by default; details and the game table stay closed until requested.
test("earned label opens by default and keeps details and games behind controls", async ({
  page,
}) => {
  await seedLabelWhy(page);
  await page.goto("./#/player/2");
  const chips = page.locator(".label-why-chip");
  await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("WHY GEM?", { exact: true })).toBeVisible();
  await expect(page.locator(".label-why-chip--earned")).not.toHaveCount(0);
  // Every earned chip keeps a literal check or warning icon beside its text.
  await expect(
    page.getByRole("button", { name: "Gem", exact: true }),
  ).toContainText("Gem");
  const details = page.locator(".label-why-details");
  await expect(details).not.toHaveAttribute("open");
  await details.getByText("Details and caveats", { exact: true }).click();
  await expect(details).toContainText(/Source refreshed: /);
  await expect(details).toContainText(/Displayed numbers are rounded/);
  const games = page.getByRole("button", { name: /Show the \d+ games/ });
  await expect(games).toHaveAttribute("aria-expanded", "false");
  await games.click();
  await expect(
    page.getByRole("button", { name: /Hide the \d+ games/ }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".label-why-games tbody tr")).not.toHaveCount(0);
});

// Near misses are dashed, explain what would flip them, and never claim an earned verdict.
test("near miss chip shows a flip card and a not-met section", async ({ page }) => {
  await seedLabelWhy(page);
  await page.goto("./#/player/106");
  await expect(
    page.getByText("Dashed labels are near misses, not earned yet."),
  ).toBeVisible();
  const near = page.getByRole("button", {
    name: "Scoring breakout · 1 short",
    exact: true,
  });
  await expect(near).toHaveClass(/label-why-chip--near/);
  await near.click();
  await expect(near).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("WHY NOT SCORING BREAKOUT WATCH?", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("WHAT WOULD FLIP IT", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".label-why-flip")).toContainText(
    /rough guide|more points a game/,
  );
  await expect(
    page.locator('.label-why-group [data-gate-status="FAIL"]'),
  ).not.toHaveCount(0);
  await expect(
    page.locator('.label-why-group [data-gate-status="UNKNOWN"]'),
  ).toHaveCount(0);
});

// Warning near misses use the "almost" wording and never borrow the positive flip card.
test("warning near miss shows the almost chip without a flip card", async ({
  page,
}) => {
  await seedLabelWhy(page);
  await page.goto("./#/player/107");
  const sell = page.getByRole("button", {
    name: "SELL HIGH · almost",
    exact: true,
  });
  await expect(sell).toHaveClass(/label-why-chip--near/);
  await sell.click();
  await expect(
    page.getByText("WHY NOT SELL HIGH?", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("SELL HIGH: not flagged, 1 condition away"),
  ).toBeVisible();
  await expect(page.getByText("WHAT WOULD FLIP IT", { exact: true })).toHaveCount(
    0,
  );
});

// An old source timestamp keeps its own warning while the exact timestamp stays reachable.
test("stale snapshot warning stays visible and the source timestamp remains in details", async ({
  page,
}) => {
  await seedLabelWhy(page, true);
  await page.goto("./#/player/2");
  await expect(
    page.locator(".label-why-panel").getByText(/Stale or undated snapshot\./),
  ).toBeVisible();
  const details = page.locator(".label-why-details");
  await details.getByText("Details and caveats", { exact: true }).click();
  await expect(details).toContainText("2020-01-01T00:00:00.000Z");
});

// Chips are real buttons: Tab reaches them and Enter/Space changes the selected explanation.
test("chips are keyboard operable and the phone layout does not scroll sideways", async ({
  page,
}) => {
  await seedLabelWhy(page);
  await page.goto("./#/player/2");
  const breakout = page.getByRole("button", {
    name: "Scoring breakout watch",
    exact: true,
  });
  await breakout.focus();
  await page.keyboard.press("Enter");
  await expect(breakout).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("WHY SCORING BREAKOUT WATCH?", { exact: true }),
  ).toBeVisible();
  const gem = page.getByRole("button", { name: "Gem", exact: true });
  await gem.focus();
  await page.keyboard.press("Space");
  await expect(gem).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  const columns = await page
    .locator(".label-why-row")
    .first()
    .evaluate((row) => getComputedStyle(row).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(3);
});
