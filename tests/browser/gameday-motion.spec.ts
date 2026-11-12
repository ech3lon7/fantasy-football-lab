import { test, expect } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

test("Motion system respects Full, Reduced, and Off animation levels", async ({
  page,
}) => {
  await seedLabelWhy(page);
  await page.goto("./#/data");

  const root = page.locator("html");

  // 1. Set to Full animation
  await page.getByRole("button", { name: "Feel", exact: true }).click();
  const group = page.getByRole("group", { name: "Animation" });
  await group.getByRole("button", { name: "Full" }).click();
  await expect(root).toHaveAttribute("data-animation", "full");
  await page.keyboard.press("Escape");

  // Under Full, verify key animation styles exist
  const fullScreenAnimation = await page
    .locator(".gd-shell > main")
    .evaluate((el) => window.getComputedStyle(el).animationName);
  expect(fullScreenAnimation).toContain("gd-screen-enter");

  // 2. Set to Reduced animation
  await page.getByRole("button", { name: "Feel", exact: true }).click();
  await group.getByRole("button", { name: "Reduced" }).click();
  await expect(root).toHaveAttribute("data-animation", "reduced");
  await page.keyboard.press("Escape");

  // Under Reduced, animations are either none or capped to <= 150ms with no transforms
  const reducedScreenTransform = await page
    .locator(".gd-shell > main")
    .evaluate((el) => window.getComputedStyle(el).transform);
  expect(reducedScreenTransform).toBe("none");

  // 3. Set to Off animation
  await page.getByRole("button", { name: "Feel", exact: true }).click();
  await group.getByRole("button", { name: "Off" }).click();
  await expect(root).toHaveAttribute("data-animation", "off");
  await page.keyboard.press("Escape");

  // Under Off, no element has running animation or non-zero transition duration
  const animatedOrTransitioningCount = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("*"));
    let nonZero = 0;
    for (const el of all) {
      const style = window.getComputedStyle(el);
      if (style.animationName && style.animationName !== "none") {
        nonZero++;
      }
      const dur = parseFloat(style.transitionDuration || "0");
      if (dur > 0) {
        nonZero++;
      }
    }
    return nonZero;
  });

  expect(animatedOrTransitioningCount).toBe(0);
});
