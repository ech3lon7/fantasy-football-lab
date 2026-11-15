import { expect, test } from "@playwright/test";
import { seedFormation } from "./formation-seed";

// Record comparable synthetic-player screenshots before and after the approved changes.
for (const width of [1320, 390]) for (const kind of ["qb", "wr", "fallback"]) {
  test(`${kind} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route("https://a.espncdn.com/i/headshots/nfl/players/full/**", (route) => {
      const url = route.request().url();
      if (url.endsWith("/1.png")) return route.continue({ url: "https://a.espncdn.com/i/headshots/nfl/players/full/3918298.png" });
      if (url.endsWith("/4.png")) return route.continue({ url: "https://a.espncdn.com/i/headshots/nfl/players/full/4362628.png" });
      return route.abort();
    });
    await seedFormation(page, {}, { feelAnimation: "off" });
    const slot = kind === "qb" ? "QB" : kind === "wr" ? "WR1" : "TE";
    await page.locator(`.gd-fs[data-label="${slot}"] .gd-fc-nm`).click();
    const hero = page.locator(".gd-hx");
    await expect(hero).toBeVisible();
    if (kind === "fallback") await expect(hero.locator(".gd-photo-fallback")).toBeVisible();
    else {
      await expect.poll(() => hero.locator("img").evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
      // Confirm that the portrait frame follows the headshot's original aspect ratio.
      const dimensions = await hero.locator("img").evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight]);
      expect(dimensions[0] / dimensions[1]).toBeCloseTo(350 / 254, 2);
    }
    await hero.screenshot({ path: `C:/Users/israe/Documents/Codex/2026-10-08/se/${process.env.CAPTURE_PHASE}-${kind}-${width}.png`, animations: "disabled" });
  });
}
