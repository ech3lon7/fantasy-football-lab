import { test } from "@playwright/test";
import fs from "node:fs";
import { seedLabelWhy } from "./label-why-seed";
import { screens } from "./screens";

// Section screenshots for the owner's review. They are evidence, not assertions.
// Run with GAMEDAY_SHOTS=1 and SHOT_SECTION=<section number>; files land in test-results/shots.
const enabled = process.env.GAMEDAY_SHOTS === "1";
const dir = `test-results/shots/section-${process.env.SHOT_SECTION ?? "1"}`;
const themes = ["light", "dark"] as const;
// The header must hold one row at the design width, a common laptop width and tablet width.
const headerWidths = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 820, height: 1180 },
];

test.skip(!enabled, "Set GAMEDAY_SHOTS=1 to capture review screenshots.");

for (const theme of themes) {
  test(`screens in the ${theme} theme`, async ({ page }) => {
    test.setTimeout(300000);
    fs.mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedLabelWhy(page, false, { feelTheme: theme, feelAnimation: "off" });
    for (const screen of screens) {
      await screen.go(page);
      await page.screenshot({
        path: `${dir}/${screen.name}-${theme}.png`,
        fullPage: true,
      });
    }
  });

  test(`header widths in the ${theme} theme`, async ({ page }) => {
    fs.mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedLabelWhy(page, false, { feelTheme: theme, feelAnimation: "off" });
    await page.goto("./#/overview");
    for (const size of headerWidths) {
      await page.setViewportSize(size);
      await page.waitForTimeout(120);
      await page.screenshot({
        path: `${dir}/header-${size.width}-${theme}.png`,
        clip: { x: 0, y: 0, width: size.width, height: 120 },
      });
    }
    // The open menu and the one-tap switch are part of the header review.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Feel", exact: true }).click();
    await page.screenshot({
      path: `${dir}/header-menu-${theme}.png`,
      clip: { x: 900, y: 0, width: 540, height: 520 },
    });
  });
}
