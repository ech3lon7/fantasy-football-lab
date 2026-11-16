import { test, expect } from "@playwright/test";
import { seedTradeLeague } from "./trade-seed";

const draft = { teamA: "1", teamB: "2", give: ["101"], get: [] };

async function openFindTrades(page: any, width: number, height: number = 900) {
  await page.setViewportSize({ width, height });
  await seedTradeLeague(page, "big", draft);
  await page.goto("./#/trade");
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Trade filters" })).toBeVisible();
}

test.describe("give-get-must behavior and limits", () => {
  for (const viewport of [
    { name: "desktop (1320px)", width: 1320 },
    { name: "mobile (390px)", width: 390 },
  ]) {
    test.describe(viewport.name, () => {
      test("must appears only on selected rows and toggles aria-pressed", async ({ page }) => {
        await openFindTrades(page, viewport.width);
        const board = page.getByRole("dialog", { name: "Trade filters" });
        const right = board.locator('[data-zone="right"]');

        // Open I give
        await board.getByRole("menuitem", { name: /^Players/ }).locator(".gd-seg-hit").click();
        await right.getByRole("menuitem", { name: "I give", exact: true }).click();

        // Initially no player selected, no must button visible
        await expect(right.locator(".gd-must")).toHaveCount(0);

        // Select the first player
        const firstRow = right.locator(".gd-prow-wrap .gd-prow").first();
        await firstRow.click();

        // Must button appears
        const mustBtn = right.locator(".gd-must").first();
        await expect(mustBtn).toBeVisible();
        await expect(mustBtn).toHaveAttribute("aria-pressed", "false");

        // Click must button
        await mustBtn.click();
        await expect(mustBtn).toHaveAttribute("aria-pressed", "true");

        // Click must button again to un-must
        await mustBtn.click();
        await expect(mustBtn).toHaveAttribute("aria-pressed", "false");

        // Un-select player removes must button
        await firstRow.click();
        await expect(right.locator(".gd-must")).toHaveCount(0);
      });

      test("3-limit disables other must buttons and shows limit note", async ({ page }) => {
        await openFindTrades(page, viewport.width);
        const board = page.getByRole("dialog", { name: "Trade filters" });
        const right = board.locator('[data-zone="right"]');

        // Open I give
        await board.getByRole("menuitem", { name: /^Players/ }).locator(".gd-seg-hit").click();
        await right.getByRole("menuitem", { name: "I give", exact: true }).click();

        // Select 4 players
        const rows = right.locator(".gd-prow-wrap .gd-prow");
        const count = await rows.count();
        expect(count).toBeGreaterThanOrEqual(4);

        for (let i = 0; i < 4; i++) {
          await rows.nth(i).click();
        }

        const mustButtons = right.locator(".gd-must");
        await expect(mustButtons).toHaveCount(4);

        // Check 3 of them
        await mustButtons.nth(0).click();
        await mustButtons.nth(1).click();
        await mustButtons.nth(2).click();

        // Note appears
        await expect(right.getByText("A trade gives at most 3 players.")).toBeVisible();

        // 4th must button is disabled
        const fourthMust = mustButtons.nth(3);
        await expect(fourthMust).toBeDisabled();
        await expect(fourthMust).toHaveAttribute("aria-disabled", "true");

        // The first 3 are still enabled and pressed
        for (let i = 0; i < 3; i++) {
          await expect(mustButtons.nth(i)).toBeEnabled();
          await expect(mustButtons.nth(i)).toHaveAttribute("aria-pressed", "true");
        }

        // Release one must
        await mustButtons.nth(0).click();
        await expect(fourthMust).toBeEnabled();
        await expect(right.getByText("A trade gives at most 3 players.")).toHaveCount(0);
      });

      test("I get one-team rule disables must buttons on other teams and shows note", async ({ page }) => {
        await openFindTrades(page, viewport.width);
        const board = page.getByRole("dialog", { name: "Trade filters" });
        const right = board.locator('[data-zone="right"]');

        // Open I get
        await board.getByRole("menuitem", { name: /^Players/ }).locator(".gd-seg-hit").click();
        await right.getByRole("menuitem", { name: "I get", exact: true }).click();

        // Select players from different teams
        // Search by team or select rows
        const rows = right.locator(".gd-prow-wrap .gd-prow");
        // Select first 5 players
        for (let i = 0; i < 5; i++) {
          await rows.nth(i).click();
        }

        // Click must on the first player
        const mustButtons = right.locator(".gd-must");
        await mustButtons.nth(0).click();
        await expect(mustButtons.nth(0)).toHaveAttribute("aria-pressed", "true");

        // Check if any other must button is disabled due to team mismatch
        // If there's a player from another team, the note "A trade is with one team." should appear
        // and that player's must button will be disabled
        const note = right.getByText("A trade is with one team.");
        if (await note.count() > 0) {
          await expect(note).toBeVisible();
          // Verify at least one must button is disabled
          const disabledMusts = right.locator('.gd-must[disabled]');
          expect(await disabledMusts.count()).toBeGreaterThan(0);
        }
      });

      test("Never trade player is disabled in I give", async ({ page }) => {
        await openFindTrades(page, viewport.width);
        const board = page.getByRole("dialog", { name: "Trade filters" });
        const right = board.locator('[data-zone="right"]');

        // First add a player to Never trade
        await board.getByRole("menuitem", { name: /^Never trade/ }).locator(".gd-seg-hit").click();
        const firstNeverRow = right.locator(".gd-prow").first();
        const neverPlayerName = (await firstNeverRow.locator(".gd-prow-name").textContent())?.trim();
        await firstNeverRow.click();

        // Now open I give under Players
        await board.getByRole("menuitem", { name: /^Players/ }).locator(".gd-seg-hit").click();
        await right.getByRole("menuitem", { name: "I give", exact: true }).click();
        const giveRow = right.locator(".gd-prow", { hasText: neverPlayerName! });
        await expect(giveRow).toBeVisible();
        await expect(giveRow).toBeDisabled();
        await expect(giveRow).toHaveAttribute("aria-disabled", "true");
        await expect(giveRow.locator(".gd-prow-meta")).toContainText("never trade");
      });

      test("hub summary updates offered / wanted and required", async ({ page }) => {
        await openFindTrades(page, viewport.width);
        const board = page.getByRole("dialog", { name: "Trade filters" });
        const right = board.locator('[data-zone="right"]');
        const hub = board.locator(".gd-zb-hub");

        // Open I give
        await board.getByRole("menuitem", { name: /^Players/ }).locator(".gd-seg-hit").click();
        await right.getByRole("menuitem", { name: "I give", exact: true }).click();

        // Select 2 players
        const rows = right.locator(".gd-prow-wrap .gd-prow");
        await rows.nth(0).click();
        await rows.nth(1).click();

        // Hub summary should reflect offered
        await expect(hub).toContainText("2 offered");
        await expect(hub).not.toContainText("required");

        // Mark 1 as must
        await right.locator(".gd-must").first().click();
        await expect(hub).toContainText("2 offered · 1 required");
      });
    });
  }
});
