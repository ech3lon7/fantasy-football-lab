import { test, expect } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

// The four-element colour sample that used to live here is replaced by the full theme sweep
// (gameday-theme-sweep.spec.ts, run with GAMEDAY_SWEEP=1). This spec keeps the switch itself honest.

// One tap in the header flips light and dark, and the choice survives a reload.
test("the header switch changes the theme in one tap", async ({ page }) => {
  await seedLabelWhy(page);
  await page.goto("./#/overview");
  const root = page.locator("html");
  const toggle = page.getByRole("button", {
    name: /^Switch to (light|dark) theme$/,
  });
  const before = await root.getAttribute("data-theme");
  const after = before === "dark" ? "light" : "dark";
  // The label names the theme the next tap moves to.
  await expect(toggle).toHaveAttribute("aria-label", `Switch to ${after} theme`);
  await toggle.click();
  await expect(root).toHaveAttribute("data-theme", after);
  await expect(toggle).toHaveAttribute(
    "aria-label",
    `Switch to ${before} theme`,
  );
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", after);
});

// System follows prefers-color-scheme live.
test("System follows the device", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await seedLabelWhy(page);
  await page.goto("./#/data");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});


// Before the first import there is no workspace, so the theme choice is kept on this device and survives a reload.
test("the theme switch works before the first import", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("./");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
