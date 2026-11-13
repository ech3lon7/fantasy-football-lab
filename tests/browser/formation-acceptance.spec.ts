import { expect, test } from "@playwright/test";
import { seedFormation } from "./formation-seed";

// The initial ESPN lineup and a subsequently saved app lineup must both drive the formation.
test("formation uses the saved lineup when the starter editor saves one", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 1000 });
  await seedFormation(page);
  await expect(page.locator(".gd-fm-tot small")).toHaveText("Your ESPN lineup · MPPG");
  await expect(page.locator('.gd-fs[data-slot="QB"] .gd-fc-nm')).toContainText("J.MERCER");
  // The starter name itself remains a keyboard-accessible player-card trigger.
  const starter = page.locator('.gd-fs[data-slot="QB"] a.gd-fc-nm');
  await starter.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(starter).toBeFocused();
  await page.getByRole("combobox", { name: "Lineup status: Jalen Mercer" }).selectOption("Bench");
  await page.getByRole("combobox", { name: "Lineup status: Nico Reyes" }).selectOption("Starter");
  await page.getByRole("button", { name: "Save lineup", exact: true }).click();
  await expect(page.locator(".gd-fm-tot small")).toHaveText("Your saved lineup · MPPG");
  await expect(page.locator('.gd-fs[data-slot="QB"] .gd-fc-nm')).toContainText("N.REYES");
  await page.getByRole("button", { name: /Optimize lineup/ }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('.gd-fs[data-slot="QB"] .gd-fc-nm')).toContainText("N.REYES");
});

// Matchup colors, text, two backups, and the approved desktop height are all visible on real cards.
test("formation cards show matchup, backups and approved desktop dimensions", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 1000 });
  await seedFormation(page, { byeStarter: true });
  const cards = page.locator(".gd-fc");
  await expect(cards).toHaveCount(9);
  for (const card of await cards.all()) {
    await expect(card.locator(".gd-fc-badge")).toBeVisible();
    await expect(card.locator(".gd-fc-bk")).toHaveCount(2);
    await expect(card.locator(".gd-fc-mu")).toContainText(/good matchup|bad matchup|neutral|Bye week|out/);
  }
  await expect(cards.locator(".gd-fc-good").or(page.locator(".gd-fc.gd-fc-good")).first()).toBeVisible();
  await expect(page.locator(".gd-fc.gd-fc-bad").first()).toBeVisible();
  await expect(page.locator('.gd-fs[data-slot="TE"] .gd-fc-badge')).toContainText("BYE");
  // White text remains legible against the same dark field in either page theme.
  for (const selector of [".gd-fc-badge b", ".gd-fc-mu", ".gd-fs-lab > b"])
    expect(await page.locator(selector).first().evaluate((el) => getComputedStyle(el).color)).toBe("rgb(255, 255, 255)");
  const size = await page.locator(".gd-fm").evaluate((el) => {
    const panel = el.getBoundingClientRect();
    const line = el.querySelector(".gd-fm-line")!.getBoundingClientRect();
    return { panel: panel.height, field: panel.bottom - line.top };
  });
  expect(size.field).toBeLessThanOrEqual(640);
  expect(size.panel).toBeLessThanOrEqual(760);
});

// Every supported width keeps the full formation on screen in either theme.
for (const width of [1320, 1000, 390]) {
  for (const theme of ["light", "dark"]) {
    test(`formation fits ${width}px in ${theme} theme`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.route("https://a.espncdn.com/**", (route) => route.abort());
      await seedFormation(page, {}, { feelTheme: theme });
      await expect(page.locator(".gd-fc")).toHaveCount(9);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // Hide fixed navigation and finish transitions so screenshots show the field without overlays.
      await page.addStyleTag({ content: ".gd-header,.gd-bottombar { visibility: hidden !important; }" });
      await page.locator(".gd-fm").screenshot({ path: test.info().outputPath(`formation-${theme}-${width}.png`), animations: "disabled" });
    });
  }
}

// Both page themes use exactly the same turf while the page itself changes color.
test("formation turf is identical in light and dark themes", async ({ page }) => {
  await seedFormation(page, {}, { feelTheme: "light" });
  await expect(page.locator(".gd-fm")).toBeVisible();
  const colors = async () => page.evaluate(() => ({
    turf: getComputedStyle(document.querySelector(".gd-fm")!).backgroundImage,
    page: getComputedStyle(document.documentElement).backgroundColor,
  }));
  const light = await colors();
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  const dark = await colors();
  expect(dark.turf).toBe(light.turf);
  expect(dark.page).not.toBe(light.page);
});

// Reduced motion fades changes; off does not animate changed cards.
for (const mode of ["reduced", "off"]) {
  test(`formation respects ${mode} motion`, async ({ page }) => {
    await seedFormation(page, {}, { feelAnimation: mode });
    await page.getByRole("button", { name: /Optimize lineup/ }).click();
    const animation = await page.locator(".gd-fc-new").evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).not.toContain("gd-fcswap");
    if (mode === "off") expect(animation).toBe("none");
  });
}
