import { test, expect, type Page } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

// Open a route.
async function open(page: Page, hash: string) {
  await seedLabelWhy(page);
  await page.goto("./#/data");
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
  // The formation replaces position tiles; its slots retain grades and backup rows.
  await expect(depth.locator(".gd-fs").first()).toBeVisible();
  await expect(depth.locator(".gd-fs-lab .gd-grade").first()).toBeVisible();
  await expect(depth.locator(".gd-fc-bk").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your roster", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/shots/section-6/roster-light.png",
    fullPage: true,
  });
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
  // This fixture has no imported starters, so inspect one of the formation's backup links.
  const link = page.locator("a.gd-fc-bkn").first();
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
  await page.screenshot({
    path: "test-results/shots/section-7/league-light.png",
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

// Choosing a team name opens the full team roster in a popover.
test("league opens the full team roster from the team name", async ({
  page,
}) => {
  await open(page, "#/league");
  await page.getByRole("button", { name: "Test B full roster" }).click();
  const rosterDialog = page.getByRole("dialog", { name: /Test B/ });
  await expect(rosterDialog).toBeVisible();
  await expect(
    rosterDialog.getByRole("heading", { name: "Test B" }),
  ).toBeVisible();
  await expect(rosterDialog.getByText("Full roster")).toBeVisible();
  await expect(rosterDialog.locator(".player-link").first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({
    path: "test-results/shots/section-7/league-full-roster-popover.png",
  });
  await page.keyboard.press("Escape");
  await expect(rosterDialog).toHaveCount(0);
});

// Dark mode keeps the grid and tiles on theme tokens: no white fills.
test("roster and league have no white fills in dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page, "#/league");
  await page.screenshot({
    path: "test-results/league-dark.png",
    fullPage: true,
  });
  await page.screenshot({
    path: "test-results/shots/section-7/league-dark.png",
    fullPage: true,
  });
  const rbCell = page.getByRole("button", { name: /^Test A RB grade/ });
  await rbCell.click();
  await expect(page.getByRole("dialog", { name: "Test A RB" })).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({
    path: "test-results/shots/section-7/league-pos-popover-dark.png",
  });
  await page.keyboard.press("Escape");
  const whiteLeague = await page.evaluate(() =>
    [...document.querySelectorAll(".gd-league *")]
      .filter(
        (el) => getComputedStyle(el).backgroundColor === "rgb(255, 255, 255)",
      )
      .map((el) => `${el.tagName}.${el.getAttribute("class")}`),
  );
  expect(whiteLeague).toEqual([]);
  await page.goto("./#/roster");
  await expect(page.locator(".gd-fc").first()).toBeVisible();
  const whiteRoster = await page.evaluate(() =>
    [...document.querySelectorAll(".gd-depth *")]
      .filter(
        (el) => getComputedStyle(el).backgroundColor === "rgb(255, 255, 255)",
      )
      .map((el) => `${el.tagName}.${el.getAttribute("class")}`),
  );
  await page.screenshot({
    path: "test-results/shots/section-6/roster-dark.png",
    fullPage: true,
  });
  expect(whiteRoster).toEqual([]);
});
