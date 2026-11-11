import { test, expect, type Page } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

// Turn the preview on and open a route.
async function open(page: Page, hash: string) {
  await seedLabelWhy(page);
  await page.goto("./#/data");
  await page.getByLabel("Use the Gameday Plus preview").check();
  await page.goto(`./${hash}`);
}

// The Roster screen keeps the simulator and marked starters and adds a depth chart with starter and bench styling.
test("roster shows the simulator, a depth chart with graded groups and the starters editor", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page, "#/roster");
  await expect(
    page.getByRole("heading", { name: "Hypothetical roster simulator" }),
  ).toBeVisible();
  const depth = page.getByRole("region", { name: "Depth chart" });
  await expect(
    depth.getByRole("heading", { name: "Depth chart" }),
  ).toBeVisible();
  // Each position group is headed by its grade; the letter is always shown.
  const groups = depth.locator(".gd-depth-group");
  expect(await groups.count()).toBeGreaterThan(0);
  for (const group of await groups.all())
    await expect(group.locator("h3 .gd-grade")).toHaveText(
      /^(N\/A|[A-F][+−]?)$/,
    );
  // Starters and bench use different tile treatments.
  await expect(
    depth.locator('.gd-tile[data-role="Starter"]').first(),
  ).toBeVisible();
  const starterBorder = await depth
    .locator('.gd-tile[data-role="Starter"]')
    .first()
    .evaluate((el) => getComputedStyle(el).borderLeftWidth);
  expect(starterBorder).toBe("8px");
  await expect(
    page.getByRole("heading", { name: "Your roster", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/roster-light.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

// A tile opens the player card, and closing it returns focus to that tile.
test("roster tile opens the card and focus returns to the tile", async ({
  page,
}) => {
  await open(page, "#/roster");
  const link = page.locator(".gd-tile a.player-link").first();
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(link).toBeFocused();
});

// The league grid lists every team by position; a grade opens its players and each player opens the card on top.
test("league grid opens position popovers with the player card stacked above", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page, "#/league");
  const grid = page.getByRole("table").first();
  await expect(grid.locator("tbody tr")).toHaveCount(2);
  await expect(grid.locator("thead th")).toHaveText([
    "Team",
    "QB",
    "RB",
    "WR",
    "TE",
    "FLEX",
    "K",
    "D/ST",
  ]);
  for (const cell of await grid.locator("tbody .gd-grade").all())
    await expect(cell).toHaveText(/^(N\/A|[A-F][+−]?)$/);
  await page.screenshot({
    path: "test-results/league-light.png",
    fullPage: true,
  });
  const rb = page.getByRole("button", { name: /^Test A RB grade/ });
  await rb.click();
  const list = page.getByRole("dialog", { name: "Test A RB" });
  await expect(list).toBeVisible();
  await list.locator("a.player-link").first().click();
  const card = page.getByRole("dialog").last();
  await expect(card.locator(".gd-card-eppg")).toBeVisible();
  // Escape peels one layer at a time and returns focus to the opener.
  await page.keyboard.press("Escape");
  await expect(list).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  // The card opened over the popover without changing the address.
  await expect(page).toHaveURL(/#\/league$/);
  await expect(rb).toBeFocused();
  expect(errors).toEqual([]);
});

// Choosing a team name keeps the full team detail reachable under the grid.
test("league keeps the team detail reachable from the team name", async ({
  page,
}) => {
  await open(page, "#/league");
  await page.getByRole("button", { name: "Test B", exact: true }).click();
  const detail = page.getByRole("region", { name: "Team detail" });
  await expect(
    detail.getByRole("heading", { name: "Position grades and roster advice" }),
  ).toBeVisible();
  await expect(detail.getByRole("combobox", { name: "Team" })).toHaveValue("2");
});

// Dark mode keeps the grid and tiles on theme tokens: no white fills.
test("roster and league have no white fills in dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page, "#/league");
  await page.screenshot({
    path: "test-results/league-dark.png",
    fullPage: true,
  });
  const whiteLeague = await page.evaluate(() =>
    [...document.querySelectorAll(".gd-league *")]
      .filter(
        (el) => getComputedStyle(el).backgroundColor === "rgb(255, 255, 255)",
      )
      .map((el) => `${el.tagName}.${el.getAttribute("class")}`),
  );
  expect(whiteLeague).toEqual([]);
  await page.goto("./#/roster");
  await expect(page.locator(".gd-tile").first()).toBeVisible();
  const whiteRoster = await page.evaluate(() =>
    [...document.querySelectorAll(".gd-depth *")]
      .filter(
        (el) => getComputedStyle(el).backgroundColor === "rgb(255, 255, 255)",
      )
      .map((el) => `${el.tagName}.${el.getAttribute("class")}`),
  );
  expect(whiteRoster).toEqual([]);
});
