import { test, expect, type Page } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

// Open a route.
async function open(page: Page, hash: string) {
  await seedLabelWhy(page);
  await page.goto("./#/data");
  await page.goto(`./${hash}`);
}

// The Lab has six short pages, each keeping the functions the long Model and audit page and the account page had.
test("lab pages keep every model, evidence, audit and account function", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page, "#/lab");
  const tabs = page
    .getByRole("navigation", { name: "Lab pages" })
    .getByRole("tab");
  await expect(tabs).toHaveText([
    "Settings",
    "Evidence sources",
    "Audits",
    "Data and account",
    "Keyboard",
    "Feel",
  ]);
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  // The tabs sit on one row, not stacked like the old sidebar.
  const tops = await tabs.evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().top)),
  );
  expect(new Set(tops).size).toBe(1);
  // Settings: model settings and the app version.
  await expect(
    page.getByRole("heading", { name: "Model settings" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "App version" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Replacement baseline audit" }),
  ).toHaveCount(0);
  // Evidence sources: opportunity data, injury return scenarios, role forecast calibration.
  await tabs.nth(1).click();
  await expect(
    page.getByRole("heading", { name: "Opportunity and market data" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Injury return scenarios" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Role forecast calibration" }),
  ).toBeVisible();
  // Audits: label evidence, baseline audit and source audit.
  await tabs.nth(2).click();
  await expect(
    page.getByRole("heading", { name: "Player-label evidence" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Replacement baseline audit" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Source data audit" }),
  ).toBeVisible();
  // Verify the matchup audit remains available from the Audits page.
  await expect(
    page.getByRole("heading", { name: "MPPG matchup check" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Model settings" }),
  ).toHaveCount(0);
  // Data and account: import, sync, local removal and cloud deletion.
  await tabs.nth(3).click();
  await expect(
    page.getByRole("heading", { name: "Current dataset" }),
  ).toBeVisible();
  for (const name of [
    "Import / replace",
    "Sync now",
    "Remove from this device",
    "Delete cloud workspace",
  ])
    await expect(page.getByRole("button", { name })).toBeVisible();
  expect(errors).toEqual([]);
});

// The earlier Model and audit and Data and account addresses open the matching Lab page.
test("old model and data addresses open the Lab pages", async ({ page }) => {
  await open(page, "#/model");
  await expect(page.getByRole("tab", { name: "Settings" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("heading", { name: "Model settings" }),
  ).toBeVisible();
  await page.goto("./#/data");
  await expect(
    page.getByRole("tab", { name: "Data and account" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("link", { name: "Lab", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

// The keyboard reference and Feel settings each have a page; Feel changes the theme like the header menu does.
test("keyboard and feel pages", async ({ page }) => {
  await open(page, "#/lab/keys");
  await expect(
    page.getByRole("heading", { name: "Keyboard reference" }),
  ).toBeVisible();
  await expect(page.locator(".gd-keys kbd")).toHaveCount(5);
  await page.getByRole("tab", { name: "Feel" }).click();
  const feel = page.getByRole("group", { name: "Feel settings" });
  await feel
    .getByRole("group", { name: "Theme" })
    .getByRole("button", { name: "Dark" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await feel
    .getByRole("group", { name: "Animation" })
    .getByRole("button", { name: "Off" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-animation", "off");
  await expect(feel.getByLabel("Sound")).not.toBeChecked();
  await expect(feel.getByLabel(/Haptics/)).not.toBeChecked();
});

// Dark keeps the Lab pages on theme tokens.
test("lab has no white fills in dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page, "#/lab/audits");
  await expect(
    page.getByRole("heading", { name: "Source data audit" }),
  ).toBeVisible();
  const white = await page.evaluate(() =>
    [...document.querySelectorAll(".gd-lab *")]
      .filter(
        (el) => getComputedStyle(el).backgroundColor === "rgb(255, 255, 255)",
      )
      .map((el) => `${el.tagName}.${el.getAttribute("class")}`),
  );
  expect(white).toEqual([]);
  await page.screenshot({ path: "test-results/lab-dark.png", fullPage: true });
});
