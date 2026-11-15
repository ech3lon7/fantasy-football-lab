import { expect, test } from "@playwright/test";
import { seedFormation } from "./formation-seed";

// Temporary PART 0 evidence capture: head-and-shoulders framing at three widths.
const photos: Record<number, number> = { 1: 3918298, 3: 3929630, 4: 4362628 };
for (const width of [1320, 1000, 390]) {
  for (const [kind, label] of [
    ["qb", "QB"],
    ["rb", "RB1"],
    ["wr", "WR1"],
    ["initials", "TE"],
  ] as const) {
    test(`${kind} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1100 });
      await page.route("https://a.espncdn.com/i/headshots/nfl/players/full/**", (route) => {
        const id = Number(new URL(route.request().url()).pathname.split("/").pop()?.replace(".png", ""));
        const mapped = photos[id];
        if (mapped) return route.continue({ url: `https://a.espncdn.com/i/headshots/nfl/players/full/${mapped}.png` });
        return route.abort();
      });
      await seedFormation(page, {}, { feelAnimation: "off" });
      const card = page.locator(`.gd-fs[data-label="${label}"] .gd-fc`);
      await expect(card).toBeVisible();
      const image = card.locator(".gd-fc-photo img");
      if (kind !== "initials") {
        await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
      } else {
        await expect(card.locator(".gd-fc-photo .gd-photo-fallback")).toBeVisible();
      }
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await card.screenshot({ path: `C:/Users/israe/Documents/Codex/2026-10-08/se/roster-photos/${kind}-${width}.png`, animations: "disabled" });
    });
  }
}
