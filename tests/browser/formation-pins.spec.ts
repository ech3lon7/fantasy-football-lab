import { expect, test } from "@playwright/test";
import { seedFormation } from "./formation-seed";

// Pins are persistent preferences and the optimizer must honor a pinned bench player.
test("pin a backup, optimize, reload and clear pins", async ({ page }) => {
  // Capture the independently pinned and optimized states at the approved reference widths.
  await page.setViewportSize({ width: 1320, height: 1000 });
  await page.route("https://a.espncdn.com/**", (route) => route.abort());
  await seedFormation(page, {}, { feelTheme: "dark" });
  const hiddenNavigation = await page.addStyleTag({ content: ".gd-header,.gd-bottombar { visibility: hidden !important; }" });
  const pin = page.getByRole("button", { name: "Pin Kofi Osei: Optimize will always start him" }).first();
  await pin.click();
  await expect(page.locator(".gd-fm-pins")).toContainText("Osei");
  await expect(page.locator(".gd-fm-pins")).toContainText("Pins cost 3.2 MPPG");
  await expect(page.getByRole("button", { name: "Unpin Kofi Osei" }).first()).toHaveAttribute("aria-pressed", "true");
  await page.locator(".gd-fm").screenshot({ path: test.info().outputPath("pins-before-dark-1320.png"), animations: "disabled" });
  await page.getByRole("button", { name: /Optimize lineup/ }).click();
  await expect(page.locator(".gd-fm-ch").filter({ hasText: "Kofi Osei" })).toContainText("(pinned)");
  await expect(page.locator(".gd-fm-ch").filter({ hasText: "Marquise Dunn" })).toBeVisible();
  await expect(page.locator(".gd-fc-nm").filter({ hasText: "Osei" })).toBeVisible();
  await page.locator(".gd-fm").screenshot({ path: test.info().outputPath("pins-after-dark-1320.png"), animations: "disabled" });
  await hiddenNavigation.evaluate((style) => style.parentNode?.removeChild(style));
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await page.addStyleTag({ content: ".gd-header,.gd-bottombar { visibility: hidden !important; }" });
  await page.locator(".gd-fm").screenshot({ path: test.info().outputPath("pins-after-light-390.png"), animations: "disabled" });
  await page.reload();
  await expect(page.getByRole("button", { name: "Unpin Kofi Osei" }).first()).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Clear pins" }).click();
  await expect(page.locator(".gd-fm-pins")).toHaveCount(0);
});

// A bye player cannot be pinned and the reason is announced without changing the preference.
test("bye pin is rejected with its reason", async ({ page }) => {
  await seedFormation(page, { byeStarter: true });
  await page.getByRole("button", { name: "Pin Tobias Lamb: Optimize will always start him" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Bye week" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pin Tobias Lamb: Optimize will always start him" })).toHaveAttribute("aria-pressed", "false");
});

// More pinned QBs than the lineup permits must disable optimization and identify a conflict.
test("conflicting pins prevent optimization", async ({ page }) => {
  await seedFormation(page);
  await page.getByRole("button", { name: "Pin Jalen Mercer: Optimize will always start him" }).click();
  await page.getByRole("button", { name: "Pin Nico Reyes: Optimize will always start him" }).click();
  await expect(page.locator(".gd-fm-hint")).toContainText("Conflicting pins");
  await expect(page.getByRole("button", { name: /Optimize lineup/ })).toBeDisabled();
});
