import { test, expect, type Page } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

// Open a route.
async function open(page: Page, hash: string) {
  await seedLabelWhy(page);
  await page.goto("./#/data");
  await page.goto(`./${hash}`);
}

// Page-level horizontal overflow: content wider than the window.
const overflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

// Fire a swipe on an element with real touch events, since the test driver has no swipe call.
async function swipe(page: Page, selector: string, dx: number, dy: number) {
  await page.evaluate(
    ([sel, x, y]) => {
      const el = document.querySelector(sel as string)!;
      const r = el.getBoundingClientRect();
      const start = { x: r.left + r.width / 2, y: r.top + 40 };
      const touch = (p: { x: number; y: number }) =>
        new Touch({ identifier: 1, target: el, clientX: p.x, clientY: p.y });
      const fire = (type: string, p: { x: number; y: number }) =>
        el.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: type === "touchend" ? [] : [touch(p)],
            changedTouches: [touch(p)],
          }),
        );
      fire("touchstart", start);
      fire("touchend", {
        x: start.x + (x as number),
        y: start.y + (y as number),
      });
    },
    [selector, dx, dy],
  );
}

test.describe("phone (390 wide)", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  // Every section fits the window width, and the bottom bar replaces the top tabs.
  test("no horizontal page scroll anywhere and the bottom bar replaces the tabs", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await open(page, "#/week");
    const bar = page.getByRole("navigation", { name: "Phone navigation" });
    await expect(bar.getByRole("link")).toHaveText([
      "Week",
      "Roster",
      "Scout",
      "League",
      "Trades",
    ]);
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeHidden();
    const failures: string[] = [];
    for (const hash of [
      "#/week",
      "#/roster",
      "#/scouting",
      "#/league",
      "#/trade",
      "#/lab/settings",
      "#/lab/audits",
      "#/lab/data",
      "#/lab/feel",
      "#/journal",
    ]) {
      await page.goto(`./${hash}`);
      await page.waitForTimeout(400);
      const extra = await overflow(page);
      if (extra > 1) failures.push(`${hash} overflows by ${extra}px`);
    }
    expect(failures).toEqual([]);
    await page.goto("./#/week");
    await page.screenshot({
      path: "test-results/phone-week.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });

  // The header menu holds Lab, the journal, import and the Feel settings.
  test("header menu holds the secondary items", async ({ page }) => {
    await open(page, "#/week");
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    const menu = page.getByRole("group", { name: "Menu", exact: true });
    await expect(
      menu.getByRole("button", { name: "Import workbook" }),
    ).toBeVisible();
    await expect(menu.getByRole("link", { name: "Lab" })).toBeVisible();
    await expect(
      menu.getByRole("link", { name: "Trade journal" }),
    ).toBeVisible();
    await expect(menu.getByRole("group", { name: "Theme" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  // Touch controls are at least 44px tall.
  test("controls are at least 44px", async ({ page }) => {
    await open(page, "#/scouting");
    const small: string[] = [];
    const check = async (label: string, selector: string) => {
      const box = await page.locator(selector).first().boundingBox();
      if (!box || box.height < 43.5) small.push(`${label}: ${box?.height}`);
    };
    await check("bottom bar", ".gd-bottombar a");
    await check("menu", ".gd-header .gd-narrow-only button");
    await check("filters button", ".gd-results-tools .gd-phone-only");
    await check("saved search", ".gd-scout-saved .gd-opt");
    await check("view toggle", ".gd-results-tools .gd-seg button");
    await check("search input", ".gd-search input");
    await check("name search", ".gd-results-tools input");
    expect(small).toEqual([]);
  });

  // Filters open as a sheet whose main button states how many players will show.
  test("scouting filters open as a sheet with a Show N players button", async ({
    page,
  }) => {
    await open(page, "#/scouting");
    const filters = page.getByRole("complementary", { name: "Filters" });
    await expect(filters).toBeHidden();
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await expect(filters).toBeVisible();
    const done = page.getByRole("button", { name: /^Show \d+ players?$/ });
    await expect(done).toBeVisible();
    const n = Number((await done.innerText()).replace(/\D/g, ""));
    await filters.getByRole("button", { name: /^Watch \d+$/ }).click();
    const after = Number(
      (
        await page
          .getByRole("button", { name: /^Show \d+ players?$/ })
          .innerText()
      ).replace(/\D/g, ""),
    );
    expect(after).toBeLessThanOrEqual(n);
    await page.getByRole("button", { name: /^Show \d+ players?$/ }).click();
    await expect(filters).toBeHidden();
    await page.screenshot({ path: "test-results/phone-scouting.png" });
  });

  // The player card is a full-height sheet: swipe sideways for the next player, down to close.
  test("player card is a full-height sheet with swipe gestures", async ({
    page,
  }) => {
    await open(page, "#/scouting");
    await page.locator(".gd-pcard a.player-link").first().click();
    const sheet = page.locator(".gd-popover.flush");
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(800);
    expect(box!.width).toBeLessThanOrEqual(390);
    await expect(page.getByText(/^1 of \d+$/)).toBeVisible();
    await swipe(page, ".gd-card-view", -120, 0);
    await expect(page.getByText(/^2 of \d+$/)).toBeVisible();
    await swipe(page, ".gd-card-view", 120, 0);
    await expect(page.getByText(/^1 of \d+$/)).toBeVisible();
    // Tapping a week on the chart pins its values under the chart.
    const hit = page.locator(".stock-hit-area").first();
    if ((await hit.count()) > 0) {
      await hit.dispatchEvent("touchstart");
      const tooltip = page.locator(".stock-tooltip-popover");
      await expect(tooltip).toBeVisible();
      expect(
        await tooltip.evaluate((el) => getComputedStyle(el).position),
      ).toBe("static");
    }
    await swipe(page, ".gd-card-view", 0, 200);
    await expect(sheet).toHaveCount(0);
  });

  // The analyzer stacks; its four verdicts stay pinned above the bottom bar and each opens its own sheet.
  test("trade analyzer pins four separate verdict cells above the bottom bar", async ({
    page,
  }) => {
    await open(page, "#/trade");
    await page
      .getByRole("combobox", { name: "Trade partner" })
      .selectOption({ label: "Test B" });
    await page
      .getByRole("group", { name: "Players you send" })
      .getByRole("button")
      .first()
      .click();
    await page
      .getByRole("group", { name: "Players you receive" })
      .getByRole("button")
      .first()
      .click();
    const cells = page.locator(".gd-verdict");
    await expect(cells).toHaveCount(4);
    // The four rows rise in one after another; measure once they have settled.
    await page.waitForTimeout(700);
    const bar = await page.locator(".gd-bottombar").boundingBox();
    for (let i = 0; i < 4; i++) {
      const box = await cells.nth(i).boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y + 1);
      expect(box!.y).toBeGreaterThan(600);
    }
    await cells.nth(2).locator("summary").click();
    const dialog = page.getByRole("dialog", { name: "Legality" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.screenshot({ path: "test-results/phone-trade.png" });
  });

  // League keeps the grade grid as small squares and raises a sheet for a tapped grade.
  test("league grade squares raise a sheet", async ({ page }) => {
    await open(page, "#/league");
    await page.getByRole("button", { name: /^Test A RB grade/ }).click();
    const sheet = page.getByRole("dialog", { name: "Test A RB" });
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
    expect(box!.y + box!.height).toBeGreaterThan(800);
  });
});

test.describe("tablet (820 wide)", () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true });

  // Tablets keep the desktop layout: the header stays on one row and no phone bottom bar appears.
  test("header stays on one row and the desktop layout applies", async ({
    page,
  }) => {
    await open(page, "#/scouting");
    const header = await page.locator(".gd-header").boundingBox();
    expect(header!.height).toBeLessThan(80);
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Phone navigation" }),
    ).toBeHidden();
    await expect(
      page.getByRole("complementary", { name: "Filters" }),
    ).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    for (const hash of [
      "#/week",
      "#/roster",
      "#/league",
      "#/trade",
      "#/lab/settings",
    ]) {
      await page.goto(`./${hash}`);
      await page.waitForTimeout(300);
      expect(await overflow(page), hash).toBeLessThanOrEqual(1);
    }
    await page.screenshot({ path: "test-results/tablet-scouting.png" });
  });

  // The player card and the Trade room are usable at tablet width.
  test("player card and trade room are usable at tablet width", async ({
    page,
  }) => {
    await open(page, "#/player/2");
    const card = page.getByRole("dialog");
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(820);
    await page.keyboard.press("Escape");
    await page.goto("./#/trade");
    await expect(
      page.getByRole("tab", { name: "Manual analyzer" }),
    ).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });
});
