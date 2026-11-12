import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { seedLabelWhy } from "./label-why-seed";

// Section A motion evidence for the owner. Not assertions: the spec in gameday-motion.spec.ts
// proves the rules. These frames show the wipe, staggered cards and popup part-way through.
const enabled = process.env.GAMEDAY_MOTION_SHOTS === "1";
const dir = "test-results/shots/section-a";
const themes = ["light", "dark"] as const;
const routes = [
  { name: "this-week", hash: "#/overview", screen: ".gd-week" },
  { name: "roster", hash: "#/roster", screen: ".gd-roster" },
  { name: "scouting", hash: "#/players", screen: ".gd-scout" },
  { name: "league", hash: "#/teams", screen: ".gd-league" },
  { name: "trade-manual", hash: "#/trades", screen: ".gd-trade" },
  { name: "lab", hash: "#/lab/settings", screen: ".gd-lab" },
] as const;

test.skip(!enabled, "Set GAMEDAY_MOTION_SHOTS=1 to capture motion screenshots.");
// Motion is easier to judge in a clip than in a still frame.
test.use({
  video: { mode: "on", size: { width: 1440, height: 1000 } },
});

for (const theme of themes) {
  test(`motion frames in the ${theme} theme`, async ({ page }) => {
    test.setTimeout(300000);
    fs.mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedLabelWhy(page, false, {
      feelTheme: theme,
      feelAnimation: "full",
    });

    for (const route of routes) {
      await page.evaluate((hash) => {
        location.hash = hash;
      }, route.hash);
      await page.locator(route.screen).waitFor({ state: "visible" });
      // Part-way through the wipe and the staggered card entrance.
      await page.waitForTimeout(260);
      await page.screenshot({
        path: `${dir}/${route.name}-${theme}-entering.png`,
        animations: "allow",
      });
      // Settled: the frame the owner compares with the design.
      await page.waitForTimeout(700);
      await page.screenshot({
        path: `${dir}/${route.name}-${theme}-settled.png`,
        animations: "allow",
      });
    }

    // The player card's popup and the Feel menu's drop.
    await page.evaluate(() => {
      location.hash = "#/players";
    });
    await page.locator(".gd-pcard .gd-pcard-name").first().click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
    await page.waitForTimeout(120);
    await page.screenshot({
      path: `${dir}/player-card-${theme}-entering.png`,
      animations: "allow",
    });
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Feel", exact: true }).click();
    await page.waitForTimeout(80);
    await page.screenshot({
      path: `${dir}/feel-menu-${theme}-entering.png`,
      clip: { x: 900, y: 0, width: 540, height: 520 },
      animations: "allow",
    });
    await page.keyboard.press("Escape");

    // A built offer so the four verdict rows can be seen arriving in sequence. Switching tabs
    // remounts the analyzer, which replays the row entrance without the screen wipe.
    await page.evaluate(() => {
      location.hash = "#/trades";
    });
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
    await expect(
      page.getByRole("region", { name: "Verdicts" }).locator("details"),
    ).toHaveCount(4);
    await page.getByRole("tab", { name: "Find trades", exact: true }).click();
    await page.getByRole("tab", { name: "Manual analyzer", exact: true }).click();
    const verdicts = page.getByRole("region", { name: "Verdicts" });
    await verdicts.waitFor({ state: "visible" });
    await page.waitForTimeout(300);
    await verdicts.screenshot({
      path: `${dir}/trade-verdict-${theme}-entering.png`,
      animations: "allow",
    });
    await page.waitForTimeout(800);
    await verdicts.screenshot({
      path: `${dir}/trade-verdict-${theme}-settled.png`,
      animations: "allow",
    });
  });
}
