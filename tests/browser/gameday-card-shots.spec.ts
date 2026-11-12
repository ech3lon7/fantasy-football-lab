import { test } from "@playwright/test";
import fs from "node:fs";
import { seedLabelWhy } from "./label-why-seed";

// Section B evidence for the owner: the rebuilt player card in both themes and at three widths.
// Not assertions; gameday-card.spec.ts proves the behaviour. Stills use Animation Off so every
// chart and radar is settled in the frame.
const enabled = process.env.GAMEDAY_SECTION_B_SHOTS === "1";
const dir = "test-results/shots/section-b";
const themes = ["light", "dark"] as const;
const tabs = [
  { name: "story", label: "Story" },
  { name: "numbers", label: "Numbers" },
  { name: "why", label: "Why the labels" },
  { name: "calc", label: "Calculation" },
] as const;

test.skip(!enabled, "Set GAMEDAY_SECTION_B_SHOTS=1 to capture player-card screenshots.");

for (const theme of themes) {
  test(`player card in the ${theme} theme`, async ({ page }) => {
    test.setTimeout(240000);
    fs.mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedLabelWhy(page, false, {
      feelTheme: theme,
      feelAnimation: "off",
    });
    await page.goto("./#/player/2");
    const card = page.getByRole("dialog");
    await card.waitFor({ state: "visible" });

    for (const tab of tabs) {
      await card.getByRole("tab", { name: tab.label, exact: true }).click();
      await page.waitForTimeout(80);
      await card.screenshot({ path: `${dir}/card-${tab.name}-${theme}.png` });
    }

    await card.getByRole("tab", { name: "Story", exact: true }).click();
    await card.locator(".gd-card-head").screenshot({
      path: `${dir}/hero-${theme}.png`,
    });
    await card.locator(".gd-story-grid").screenshot({
      path: `${dir}/story-body-${theme}.png`,
    });
    await card.locator(".player-stock-chart-container").screenshot({
      path: `${dir}/chart-${theme}.png`,
    });
    await card.locator(".gd-radar").screenshot({
      path: `${dir}/radar-${theme}.png`,
    });
    await page.keyboard.press("Escape");
    await card.waitFor({ state: "detached" });
  });
}

test("player card at 1040x800 and on a phone", async ({ page }) => {
  test.setTimeout(180000);
  fs.mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 1040, height: 800 });
  await seedLabelWhy(page, false, { feelAnimation: "off" });
  await page.goto("./#/player/2");
  const card = page.getByRole("dialog");
  await card.waitFor({ state: "visible" });
  await page.screenshot({ path: `${dir}/card-1040x800-light.png` });
  const metrics = await card.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    chartTop: el
      .querySelector(".player-stock-chart-container")
      ?.getBoundingClientRect().top,
  }));
  fs.writeFileSync(
    `${dir}/card-1040x800-metrics.json`,
    JSON.stringify(metrics, null, 2),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(120);
  await card.screenshot({ path: `${dir}/card-phone-light.png` });
  await card.getByRole("tab", { name: "Story", exact: true }).click();
  await card.screenshot({ path: `${dir}/card-phone-story-light.png` });
});
