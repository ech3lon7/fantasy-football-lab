import { test, expect, type Page } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

// Turn the preview on and open a route.
async function open(page: Page, hash = "#/week") {
  await seedLabelWhy(page);
  await page.goto("./#/data");
  await page.getByLabel("Use the Gameday Plus preview").check();
  await page.goto(`./${hash}`);
}

// The home screen is built from model results: a headline, the outlook against the league median, and a seven-row scoreboard.
test("this week shows the headline, outlook and scoreboard from model results", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  const week = page.locator(".gd-week");
  await expect(week.locator(".gd-hero h2")).toHaveText(
    /weak spot|below the league median|Not enough data/,
  );
  const outlook = page.getByRole("region", { name: "Starting score outlook" });
  await expect(outlook).toContainText("vs league median");
  await expect(outlook.locator("svg")).toHaveAttribute(
    "aria-label",
    /Modeled starting score by week/,
  );
  const rows = page
    .getByRole("table", { name: "Starter value by position" })
    .getByRole("row");
  // One header row plus one per graded position.
  await expect(rows).toHaveCount(8);
  // An ungraded position shows a dash and its reason in the note, never a zero bar.
  const note = await page.locator(".gd-score > p").innerText();
  for (const row of await page.locator(".gd-score-row").all()) {
    const grade = await row.locator(".gd-grade").innerText();
    if (grade === "N/A") {
      await expect(row.locator(".gd-bar").first().locator("i")).toHaveCount(0);
      await expect(row.locator(".gd-bar").first()).toContainText("—");
      expect(note).toContain("unavailable");
    }
  }
  // Nothing says "no change", and at most three moves are shown.
  await expect(page.getByText(/no change/i)).toHaveCount(0);
  expect(await page.locator(".gd-move").count()).toBeLessThanOrEqual(3);
  await page.screenshot({
    path: "test-results/week-light.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

// Move cards link to where the work happens, and the waiver card opens the player.
test("move cards link to the trade room, the player or the roster", async ({
  page,
}) => {
  await open(page);
  for (const move of await page.locator(".gd-move").all()) {
    const href = await move.getAttribute("href");
    expect(href).toMatch(/^#\/(trades|roster|player\/\d+)$/);
  }
});

// The ticker lists active signals; it loops only at Full animation and is a scrollable row otherwise.
test("signals ticker scrolls only at Full animation and opens the player card", async ({
  page,
}) => {
  await open(page);
  const ticker = page.getByRole("region", { name: "Signals" });
  await expect(ticker).toBeVisible();
  const links = ticker.locator("a.gd-tick:not([aria-hidden])");
  expect(await links.count()).toBeGreaterThan(0);
  const animation = () =>
    ticker
      .locator(".gd-ticker-run")
      .evaluate((el) => getComputedStyle(el).animationName);
  await page.getByRole("button", { name: "Feel", exact: true }).click();
  const group = page.getByRole("group", { name: "Animation" });
  await group.getByRole("button", { name: "Off" }).click();
  expect(await animation()).toBe("none");
  await expect(
    ticker.locator('a.gd-tick[aria-hidden="true"]').first(),
  ).toBeHidden();
  await group.getByRole("button", { name: "Reduced" }).click();
  expect(await animation()).toBe("none");
  await group.getByRole("button", { name: "Full" }).click();
  expect(await animation()).toBe("gd-scroll");
  // A moving ticker is hard to click, so switch animation off before opening a player from it.
  await group.getByRole("button", { name: "Off" }).click();
  await page.keyboard.press("Escape");
  await links.first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

// Dark keeps the home screen on theme tokens.
test("this week has no white fills in dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page);
  await expect(page.locator(".gd-hero")).toBeVisible();
  await page.screenshot({ path: "test-results/week-dark.png", fullPage: true });
  const white = await page.evaluate(() =>
    [...document.querySelectorAll(".gd-week *, .gd-ticker *")]
      .filter(
        (el) => getComputedStyle(el).backgroundColor === "rgb(255, 255, 255)",
      )
      .map((el) => `${el.tagName}.${el.getAttribute("class")}`),
  );
  expect(white).toEqual([]);
});
