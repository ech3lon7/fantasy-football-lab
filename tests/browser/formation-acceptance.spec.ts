import { expect, test } from "@playwright/test";
import { seedFormation } from "./formation-seed";
import { openRosterTools } from "./roster-workspace-helpers";

// Photo frames fill the matchup panel and remain translucent without covering the text controls.
test("formation portraits fill the card and preserve controls", async ({ page }) => {
  await seedFormation(page);
  const panel = page.locator('.gd-fs[data-slot="QB"] .gd-fc-ph');
  const portrait = panel.locator(".gd-fc-av");
  const dimensions = await portrait.evaluate((el) => {
    const photo = el.getBoundingClientRect();
    const parent = el.closest(".gd-fc-ph")!.getBoundingClientRect();
    return { width: photo.width / parent.width, height: photo.height / parent.height, opacity: Number(getComputedStyle(el).opacity) };
  });
  expect(dimensions.width).toBeCloseTo(1, 1);
  expect(dimensions.height).toBeCloseTo(1, 1);
  expect(dimensions.opacity).toBeGreaterThan(0);
  expect(dimensions.opacity).toBeLessThan(1);
  await expect(panel.locator(".gd-fc-nm")).toBeVisible();
  await expect(panel.getByRole("button", { name: /Pin Jalen Mercer/ })).toBeVisible();
});

// Roster cards reuse the profile gradient and dot texture with the matchup color substituted.
test("roster card uses the player profile background and texture", async ({ page }) => {
  await seedFormation(page);
  const card = page.locator('.gd-fs[data-slot="QB"] .gd-fc-ph');
  await page.locator('.gd-fs[data-slot="QB"] .gd-fc-nm').click();
  await expect(page.locator(".gd-hx")).toBeVisible();
  const backgrounds = await page.evaluate(() => {
    const roster = document.querySelector<HTMLElement>('.gd-fs[data-slot="QB"] .gd-fc-ph')!;
    const profile = document.querySelector<HTMLElement>(".gd-hx")!;
    profile.style.setProperty("--tc", getComputedStyle(roster).getPropertyValue("--tc"));
    profile.style.setProperty("--hx-mid", "8%");
    const dots = (el: HTMLElement) => getComputedStyle(el.querySelector<HTMLElement>(".gd-hx-dots")!).backgroundImage;
    return { roster: getComputedStyle(roster).backgroundImage, profile: getComputedStyle(profile).backgroundImage, rosterDots: dots(roster), profileDots: dots(profile) };
  });
  expect(backgrounds.roster).toBe(backgrounds.profile);
  expect(backgrounds.rosterDots).toBe(backgrounds.profileDots);
  await expect(card.locator(".gd-hx-dots")).toHaveCount(1);
});

// A backup can be dragged into FLEX and the exact slot persists after saving.
test("drag a backup into the selected slot and save it", async ({ page }) => {
  await seedFormation(page);
  const flex = page.locator('.gd-fs[data-slot="FLEX"]');
  await flex.getByRole("button", { name: "Drag Marquise Dunn" }).dragTo(flex.locator(".gd-fc-ph"));
  await expect(flex.locator(".gd-fc-nm")).toContainText("Dunn");
  await page.getByRole("button", { name: "Save lineup", exact: true }).first().click();
  await page.reload();
  await expect(flex.locator(".gd-fc-nm")).toContainText("Dunn");
});

// The touch-friendly Start button performs the same exact-slot move on a phone.
test("start a backup without dragging on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await seedFormation(page);
  const flex = page.locator('.gd-fs[data-slot="FLEX"]');
  await flex.getByRole("button", { name: "Start Marquise Dunn in this slot" }).click();
  await expect(flex.locator(".gd-fc-nm")).toContainText("Dunn");
  await expect(page.getByRole("button", { name: "Save lineup", exact: true }).first()).toBeVisible();
});

// An optimized live lineup is explicitly saved in app settings and survives a reload.
test("save optimized formation to the live lineup", async ({ page }) => {
  await seedFormation(page);
  await page.getByRole("button", { name: /Optimize lineup/ }).click();
  await page.getByRole("button", { name: "Save lineup", exact: true }).first().click();
  await expect(page.locator('.gd-fs[data-label="RB1"] .gd-fc-nm')).toContainText("Dunn");
  await page.reload();
  await expect(page.locator('.gd-fs[data-label="RB1"] .gd-fc-nm')).toContainText("Dunn");
  await expect(page.locator(".gd-fm-tot small")).toHaveText("Your saved lineup · MPPG");
  await expect(page.getByText("Show depth-only pickups")).toHaveCount(0);
});

// Simulations save the optimized assignment and allow the other team's depth chart to be selected.
test("save a simulated lineup and select another team", async ({ page }) => {
  await seedFormation(page);
  await openRosterTools(page);
  await page.getByRole("button", { name: "New simulation", exact: true }).click();
  await page.getByRole("button", { name: /Optimize lineup/ }).click();
  await page.getByRole("button", { name: "Save lineup", exact: true }).first().click();
  await expect(page.locator('.gd-fs[data-label="RB1"] .gd-fc-nm')).toContainText("Dunn");
  await page.reload();
  await expect(page.locator('.gd-fs[data-label="RB1"] .gd-fc-nm')).toContainText("Dunn");
  await openRosterTools(page);
  await page.getByLabel("Simulated team to edit").selectOption("2");
  await expect(page.locator('.gd-fs[data-slot="QB"] .gd-fc-nm')).not.toContainText("Mercer");
});

// The initial ESPN lineup and a subsequently saved app lineup must both drive the formation.
test("formation uses the saved lineup when the starter editor saves one", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 1000 });
  await seedFormation(page);
  await expect(page.locator(".gd-fm-tot small")).toHaveText("Your ESPN lineup · MPPG");
  await expect(page.locator('.gd-fs[data-slot="QB"] .gd-fc-nm')).toContainText("Mercer");
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
  await expect(page.locator('.gd-fs[data-slot="QB"] .gd-fc-nm')).toContainText("Reyes");
  await page.getByRole("button", { name: /Optimize lineup/ }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('.gd-fs[data-slot="QB"] .gd-fc-nm')).toContainText("Reyes");
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
