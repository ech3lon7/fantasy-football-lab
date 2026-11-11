import { test, expect, type Page } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

const white = "rgb(255, 255, 255)";
const ink = "rgb(20, 23, 31)";

// Sample the root, a surface, a chip-like banner and a selected control; these carry the theme faults found in design.
async function backgrounds(page: Page) {
  return page.evaluate(() => {
    const bg = (el: Element | null) =>
      el ? getComputedStyle(el).backgroundColor : "missing";
    return {
      root: bg(document.documentElement),
      banner: bg(document.querySelector(".gd-banner")),
      selected: bg(document.querySelector(".gd-seg button[aria-pressed=true]")),
      unselected: bg(
        document.querySelector(".gd-seg button[aria-pressed=false]"),
      ),
    };
  });
}

// Dark uses no white fills, light uses no ink fills, and selected is yellow with dark text in both.
test("themes follow tokens: no white fills in dark, no ink fills in light, yellow selection", async ({
  page,
}) => {
  await seedLabelWhy(page);
  await page.goto("./#/data");
  await page.getByRole("button", { name: "Feel", exact: true }).click();
  const group = page.getByRole("group", { name: "Theme" });

  await group.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const dark = await backgrounds(page);
  for (const value of Object.values(dark)) expect(value).not.toBe(white);
  expect(dark.selected).toBe("rgb(255, 214, 10)");

  await group.getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const light = await backgrounds(page);
  for (const value of Object.values(light)) expect(value).not.toBe(ink);
  expect(light.selected).toBe("rgb(255, 214, 10)");
  await expect(group.getByRole("button", { name: "Light" })).toHaveCSS(
    "color",
    ink,
  );
});

// System follows prefers-color-scheme live.
test("System follows the device", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await seedLabelWhy(page);
  await page.goto("./#/data");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
