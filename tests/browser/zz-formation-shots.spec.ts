import { test } from "@playwright/test";
import { seedFormation } from "./formation-seed";

const sizes = [
  { width: 1320, height: 1000, name: "1320" },
  { width: 1000, height: 1000, name: "1000" },
  { width: 390, height: 844, name: "390" },
] as const;

for (const size of sizes) {
  for (const scheme of ["light", "dark"] as const) {
    test(`formation ${size.name} ${scheme}`, async ({ page }) => {
      await page.setViewportSize(size);
      if (scheme === "dark") await page.emulateMedia({ colorScheme: "dark" });
      await seedFormation(page);
      await page.locator(".gd-fm").waitFor();
      await page.waitForTimeout(800);
      const box = await page.locator(".gd-fm").boundingBox();
      const cards = await page.locator(".gd-fc").count();
      const width = await page.evaluate(() => document.documentElement.clientWidth);
      console.log(
        `${size.name} ${scheme}: fm height ${box?.height} width ${box?.width}, viewport ${width}, cards ${cards}`,
      );
      await page
        .locator(".gd-fm")
        .screenshot({
          path: `test-results/fm-check/fm-${scheme}-${size.name}.png`,
        });
    });
  }
}
