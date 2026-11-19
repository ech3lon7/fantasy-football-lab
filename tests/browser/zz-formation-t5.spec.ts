import { expect, test } from "@playwright/test";
import { seedFormation } from "./formation-seed";

test("formation optimize, copy and undo", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 1000 });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await seedFormation(page);
  const bar = page.locator(".gd-fm-bar");
  await expect(bar).toBeVisible();
  await expect(bar.locator(".gd-fm-tot small")).toHaveText(
    "Your ESPN lineup · MPPG",
  );
  await expect(bar.locator(".gd-fm-hint")).toHaveText(
    "Optimizing gains +2.6 MPPG with 1 change.",
  );
  const optimize = bar.getByRole("button", { name: /Optimize lineup/ });
  await expect(optimize).toBeEnabled();
  await page.screenshot({
    path: "test-results/fm-check/before-1320.png",
    fullPage: true,
  });
  await optimize.click();
  await expect(bar.locator(".gd-fm-tot small")).toHaveText(
    "Optimized lineup · MPPG",
  );
  console.log("result:", await bar.locator(".gd-fm-res").innerText());
  await expect(bar.locator(".gd-fm-res b")).toContainText(
    "+2.6 MPPG this week · 115.9 → 118.5",
  );
  // The displayed gain must equal the difference between the displayed rounded totals.
  const line = await bar.locator(".gd-fm-res b").innerText();
  const values = line.match(/([+−-][\d.]+) MPPG this week · ([\d.]+) → ([\d.]+)/)!;
  expect(Number(values[1].replace("−", "-"))).toBeCloseTo(Number(values[3]) - Number(values[2]), 1);
  await expect(page.locator(".gd-fc-new")).toHaveCount(1);
  await expect(page.locator(".gd-fm-ch")).toHaveCount(1);
  await expect(page.locator(".gd-fc-new .gd-fc-newtag")).toHaveText("▲ In");
  await page.waitForTimeout(900);
  await page.screenshot({
    path: "test-results/fm-check/after-1320.png",
    fullPage: true,
  });
  await bar.getByRole("button", { name: "Copy changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Change lines copied.");
  await bar.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".gd-fc-new")).toHaveCount(0);
  await expect(bar.locator(".gd-fm-tot small")).toHaveText(
    "Your ESPN lineup · MPPG",
  );
  // Escape with focus in the bar undoes too.
  await bar.getByRole("button", { name: /Optimize lineup/ }).click();
  await expect(page.locator(".gd-fc-new")).toHaveCount(1);
  await bar.getByRole("button", { name: "Copy changes" }).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".gd-fc-new")).toHaveCount(0);
});

test("formation optimize phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedFormation(page);
  await page.addStyleTag({
    content: ".gd-header,.gd-bottombar{display:none!important}",
  });
  await page.locator(".gd-fm-bar").getByRole("button", { name: /Optimize lineup/ }).click();
  await expect(page.locator(".gd-fc-new")).toHaveCount(1);
  const tag = page.locator(".gd-fc-new .gd-fc-newtag");
  await expect(tag).toBeVisible();
  await page.waitForTimeout(900);
  const boxes = await page.evaluate(() => {
    const card = document.querySelector(".gd-fc-new")!;
    const r = (s: string) => card.querySelector(s)!.getBoundingClientRect();
    const tag = r(".gd-fc-newtag"),
      av = r(".gd-fc-av"),
      badge = r(".gd-fc-badge");
    // The full-card photo sits behind the tag; protect its central face area and the badge.
    const face = { left: av.left + av.width * 0.35, right: av.left + av.width * 0.65, top: av.top + av.height * 0.2, bottom: av.top + av.height * 0.65 };
    const overlaps = (target: { left: number; right: number; top: number; bottom: number }) => tag.left < target.right && tag.right > target.left && tag.top < target.bottom && tag.bottom > target.top;
    return {
      tag: [tag.left, tag.top, tag.right, tag.bottom],
      av: [av.left, av.top, av.right, av.bottom],
      overlap: overlaps(face) || overlaps(badge),
    };
  });
  console.log("phone tag", JSON.stringify(boxes));
  expect(boxes.overlap).toBe(false);
  // The new matchup forecast leaves Whitfield as the backup after optimization.
  const backup = page.locator(".gd-fc-bkn-last").filter({ hasText: "BOYD" }).first();
  await expect(backup).toBeVisible();
  await expect(backup).toHaveText("BOYD");
  expect(await backup.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.locator(".gd-fm").screenshot({
    path: "test-results/fm-check/after-390.png",
  });
});

test("formation optimize dark desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 1000 });
  await page.emulateMedia({ colorScheme: "dark" });
  await seedFormation(page);
  await page.locator(".gd-fm-bar").getByRole("button", { name: /Optimize lineup/ }).click();
  await page.screenshot({
    path: "test-results/fm-check/after-dark-1320.png",
    fullPage: true,
  });
});

test("formation already optimal", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 1000 });
  await seedFormation(page, { optimal: true });
  const bar = page.locator(".gd-fm-bar");
  await expect(bar.getByRole("button", { name: /Lineup is optimal/ })).toBeDisabled();
  await expect(bar.locator(".gd-fm-hint")).toHaveText(
    "Already your highest-MPPG lineup.",
  );
});
