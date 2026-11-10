import { test, expect } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

// The preview switch is opt-in, persists across reloads, and leaves the current interface working either way.
test("Gameday Plus preview is off by default, toggles on and off, and keeps the current interface", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await seedLabelWhy(page);
  await page.goto("./#/data");
  const toggle = page.getByLabel("Use the Gameday Plus preview");
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId("ui-preview-on")).toHaveCount(0);
  await toggle.check();
  await expect(page.getByTestId("ui-preview-on")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Use the Gameday Plus preview")).toBeChecked();
  // With the preview on, a player address opens the single player card instead of the old page.
  await page.goto("./#/player/2");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("./#/data");
  await page.getByLabel("Use the Gameday Plus preview").uncheck();
  await expect(page.getByTestId("ui-preview-on")).toHaveCount(0);
  await page.goto("./#/player/2");
  await expect(page.getByText("WHY GEM?", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
