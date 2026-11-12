import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { seedLabelWhy } from "./label-why-seed";

const dir = "test-results/shots/section-e7";

const overflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

test.describe("phone 17-screen audit (390x844)", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  for (const theme of ["dark", "light"] as const) {
    test(`capture 17 phone screens in ${theme}`, async ({ page }) => {
      test.setTimeout(180000);
      fs.mkdirSync(dir, { recursive: true });

      const setup = async (hash: string) => {
        await seedLabelWhy(page, false, { feelTheme: theme, feelAnimation: "off" });
        await page.goto("./#/data");
        await page.goto(`./${hash}`);
        await page.waitForTimeout(300);
      };

      // 1. This week
      await setup("#/week");
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: path.join(dir, `01-this-week-${theme}.png`), fullPage: true });

      // 2. Scouting rows
      await page.goto("./#/scouting");
      await page.waitForTimeout(300);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: path.join(dir, `02-scouting-${theme}.png`), fullPage: true });

      // 3. Filters sheet
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(dir, `03-filters-sheet-${theme}.png`) });
      await page.getByRole("button", { name: /^Show \d+ players?$/ }).click();

      // 4. Player card sheet
      await page.locator(".gd-pcard a.player-link").first().click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(dir, `04-player-card-${theme}.png`) });

      // 10. Player card · Why the labels
      const whyTab = page.getByRole("tab", { name: /Why/i });
      if (await whyTab.isVisible()) {
        await whyTab.click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(dir, `10-player-card-why-${theme}.png`) });
      }
      await page.keyboard.press("Escape");

      // 5. Roster
      await page.goto("./#/roster");
      await page.waitForTimeout(300);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: path.join(dir, `05-roster-${theme}.png`), fullPage: true });

      // 6. League
      await page.goto("./#/league");
      await page.waitForTimeout(300);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: path.join(dir, `06-league-${theme}.png`), fullPage: true });

      // 11. Versus sheet
      await page.goto("./#/scouting");
      await page.waitForTimeout(300);
      const vsButtons = page.locator(".gd-pcard-vs");
      if ((await vsButtons.count()) >= 2) {
        await vsButtons.nth(0).click();
        await vsButtons.nth(1).click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(dir, `11-versus-${theme}.png`) });
        await page.keyboard.press("Escape");
      }

      // 7. Trade · Manual analyzer
      await page.goto("./#/trade");
      await page.waitForTimeout(300);
      await page.getByRole("combobox", { name: "Trade partner" }).selectOption({ label: "Test B" });
      await page.getByRole("group", { name: "Players you send" }).getByRole("button").first().click();
      await page.getByRole("group", { name: "Players you receive" }).getByRole("button").first().click();
      await page.waitForTimeout(400);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: path.join(dir, `07-trade-manual-${theme}.png`) });

      // 12. Add players to a trade (picker sheet)
      const allOppDetails = page.locator("summary:has-text('All opponent players')");
      if (await allOppDetails.isVisible()) {
        await allOppDetails.click();
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(dir, `12-add-players-trade-${theme}.png`) });
        await allOppDetails.click();
      }

      // 16. Verdict detail sheet
      const cells = page.locator(".gd-verdict");
      if ((await cells.count()) > 0) {
        await cells.nth(0).locator("summary").click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(dir, `16-verdict-detail-${theme}.png`) });
        await page.keyboard.press("Escape");
      }

      // 8. Trade · Find trades
      await page.getByRole("tab", { name: "Find trades" }).click();
      await page.waitForTimeout(300);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: path.join(dir, `08-trade-find-${theme}.png`), fullPage: true });

      // 13. Find trades · full controls & 14. Grade goal picker
      const gradeGoalFold = page.locator(".gd-fold-head:has-text('Positional grade goals')");
      if (await gradeGoalFold.isVisible()) {
        await gradeGoalFold.click();
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(dir, `13-find-trades-controls-${theme}.png`) });
      }

      // 9. Trade · Chain planner
      await page.getByRole("tab", { name: "Chain planner" }).click();
      await page.waitForTimeout(300);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: path.join(dir, `09-trade-chain-${theme}.png`), fullPage: true });

      // 15. Chain planner · per-trade controls
      const chainLimitsFold = page.locator(".gd-fold-head:has-text('Search limits')");
      if (await chainLimitsFold.isVisible()) {
        await chainLimitsFold.click();
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(dir, `15-chain-controls-${theme}.png`) });
      }

      // 17. Menu · Lab and Feel
      await page.goto("./#/week");
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(dir, `17-menu-${theme}.png`) });
      await page.keyboard.press("Escape");
    });
  }
});
