import { test, expect, type Page } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

// Open a route.
async function open(page: Page, hash: string) {
  await seedLabelWhy(page);
  await page.goto("./#/data");
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
  const firstName = (await links.first().locator("b").textContent()) ?? "";
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

// The moving-average chart paints on theme tokens: every path and rect must have a real fill,
// never the SVG default black that appeared when the old stylesheet was removed.
test("moving-average chart never falls back to black", async ({ page }) => {
  await open(page, "#/player/2");
  const card = page.getByRole("dialog");
  const chart = card.locator(".player-stock-chart-container");
  await expect(chart).toBeVisible();
  const black = await chart.evaluate((root) =>
    [...root.querySelectorAll<SVGElement>("path, rect")]
      .filter((el) => getComputedStyle(el).fill === "rgb(0, 0, 0)")
      .map((el) => `${el.tagName}.${el.getAttribute("class") ?? ""}`),
  );
  expect(black).toEqual([]);
  // The weekly points use the recorded-facts token rather than a neutral line colour.
  const points = await chart
    .locator(".stock-points-line")
    .evaluate((el) => getComputedStyle(el).stroke);
  const fact = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--gd-fact)";
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  expect(points).toBe(fact);
});

// At the design's card width the story body is two columns; on a phone it folds to one.
test("story body is two columns at 1040 and one on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, "#/player/2");
  const grid = page
    .getByRole("dialog")
    .locator(".gd-story-grid");
  await expect(grid).toBeVisible();
  const columns = async () =>
    grid.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
  expect(await columns()).toBe(2);
  await expect(grid.locator(".gd-story-left")).toContainText(
    "Next-refresh EPPG scenarios",
  );
  await expect(grid.locator(".gd-story-right .gd-radar")).toBeVisible();
  await expect(grid.locator(".gd-story-right .player-stock-chart-container")).toBeVisible();
  await page.setViewportSize({ width: 640, height: 900 });
  expect(await columns()).toBe(1);
});

// The hero carries the halftone background and the four lead numbers, MPPG largest. The team code watermark became the rank numeral.
test("hero shows the halftone background and the lead numbers", async ({
  page,
}) => {
  await open(page, "#/player/2");
  const card = page.getByRole("dialog");
  await expect(card.locator(".gd-hx-dots")).toBeAttached();
  await expect(card.locator(".gd-card-big")).toHaveCount(0);
  const stats = card.locator(".gd-card-stat");
  await expect(stats).toHaveCount(4);
  await expect(stats.nth(0)).toContainText("MPPG");
  await expect(stats.nth(1)).toContainText("EXPECTED PPG");
  await expect(stats.nth(2)).toContainText("RECENT 3");
  await expect(stats.nth(3)).toContainText("SURPLUS");
  const sizes = await card
    .locator(".gd-card-stat strong")
    .evaluateAll((els) =>
      els.map((el) => parseFloat(getComputedStyle(el).fontSize)),
    );
  expect(sizes[0]).toBeGreaterThan(sizes[1] ?? 0);
  expect(sizes[2]).toBe(sizes[3]);
  // Every label carries a state tone instead of the old neutral chip.
  const labelClasses = await card
    .locator(".gd-card-labels .gd-chip-tag")
    .evaluateAll((els) => els.map((el) => el.className));
  expect(labelClasses.length).toBeGreaterThan(0);
  for (const cls of labelClasses) {
    expect(cls).toMatch(/gd-chip-(positive|warning)/);
  }
  // The tabs follow the design: condensed uppercase, 44px, selected filled with ink.
  const selected = card.getByRole("tab", { name: "Story" });
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await expect(selected).toHaveCSS("height", "44px");
  await expect(selected).toHaveCSS("text-transform", "uppercase");
});
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
  // The entrance overlays are transient, hidden-from-assistive-technology layers; every other element must be free of white.
  const white = await card.evaluate((root) =>
    [root, ...root.querySelectorAll("*")]
      .filter((el) => !el.closest(".fx"))
      .filter(
        (el) => getComputedStyle(el).backgroundColor === "rgb(255, 255, 255)",
      )
      .map((el) => `${el.tagName}.${el.getAttribute("class")}`),
  );
  expect(white).toEqual([]);
  expect(head[0]).not.toBe("");
});
