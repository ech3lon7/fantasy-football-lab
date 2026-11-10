import { test, expect, type Page } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

// Turn the preview on and open a route.
async function open(page: Page, hash: string) {
  await seedLabelWhy(page);
  await page.goto("./#/data");
  await page.getByLabel("Use the Gameday Plus preview").check();
  await page.goto(`./${hash}`);
}

// A #/player route opens the one card over This week, with the four tabs and EPPG as the lead number.
test("player route opens the card with four tabs and EPPG as the lead metric", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page, "#/player/2");
  const card = page.getByRole("dialog");
  await expect(card).toBeVisible();
  await expect(card.locator(".gd-card-eppg")).toContainText("EXPECTED PPG");
  await expect(card.getByRole("tab")).toHaveText([
    "Story",
    "Numbers",
    "Why the labels",
    "Calculation",
  ]);
  // Story leads with the next-refresh scenarios, then the chart region.
  await expect(card.getByText("Next-refresh EPPG scenarios")).toBeVisible();
  await expect(
    card.getByRole("region", { name: /Moving-average chart/ }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/card-story-light.png" });
  // Closing returns the address to This week.
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(page).toHaveURL(/#\/overview$/);
  expect(errors).toEqual([]);
});

// The last tab used is remembered, including across a reload, and the Why tab mounts the label panel.
test("card remembers the last tab and mounts the Why panel", async ({
  page,
}) => {
  await open(page, "#/player/2");
  const card = page.getByRole("dialog");
  await card.getByRole("tab", { name: "Why the labels" }).click();
  await expect(card.getByText("WHY GEM?", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/card-why-light.png" });
  await card.getByRole("tab", { name: "Numbers" }).click();
  await expect(card.getByText(/Recorded facts/)).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("dialog").getByRole("tab", { name: "Numbers" }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("dialog")
    .getByRole("tab", { name: "Calculation" })
    .click();
  await expect(
    page.getByRole("dialog").getByText("Observed PPG", { exact: true }),
  ).toBeVisible();
});

// Opening from a marked table adds previous and next, and the arrow keys step players on the same tab.
test("card opened from a list steps with arrow keys and keeps the tab", async ({
  page,
}) => {
  await open(page, "#/scouting");
  const links = page.locator("[data-player-row] a.player-link");
  await expect(links.nth(2)).toBeVisible();
  const firstName = await links.first().locator("b").innerText();
  await links.first().click();
  const card = page.getByRole("dialog");
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { level: 2 })).toHaveText(firstName);
  await expect(card.getByText(/^1 of \d+$/)).toBeVisible();
  await card.getByRole("tab", { name: "Calculation" }).click();
  await card.getByRole("tab", { name: "Calculation" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(card.getByText(/^2 of \d+$/)).toBeVisible();
  await expect(card.getByRole("heading", { level: 2 })).not.toHaveText(
    firstName,
  );
  await expect(card.getByRole("tab", { name: "Calculation" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("ArrowLeft");
  await expect(card.getByText(/^1 of \d+$/)).toBeVisible();
  // Focus returns to the row's link that opened the card.
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(links.first()).toBeFocused();
});

// The dark theme keeps the card on theme tokens: no white fills anywhere on the card surface.
test("card has no white fills in dark and team colours stay the same", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page, "#/player/2");
  const card = page.getByRole("dialog");
  await expect(card).toBeVisible();
  const head = await card.locator(".gd-card-head").evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.backgroundColor, s.color];
  });
  await page.screenshot({ path: "test-results/card-story-dark.png" });
  await card.getByRole("tab", { name: "Why the labels" }).click();
  await page.screenshot({ path: "test-results/card-why-dark.png" });
  await card.getByRole("tab", { name: "Numbers" }).click();
  await page.screenshot({ path: "test-results/card-numbers-dark.png" });
  const white = await card.evaluate((root) =>
    [root, ...root.querySelectorAll("*")]
      .filter(
        (el) => getComputedStyle(el).backgroundColor === "rgb(255, 255, 255)",
      )
      .map((el) => `${el.tagName}.${el.getAttribute("class")}`),
  );
  expect(white).toEqual([]);
  expect(head[0]).not.toBe("");
});
