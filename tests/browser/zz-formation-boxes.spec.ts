import { test } from "@playwright/test";
import { seedFormation } from "./formation-seed";

test("formation boxes", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 1000 });
  await seedFormation(page);
  await page.locator(".gd-fm").waitFor();
  await page.waitForTimeout(500);
  const boxes = await page.evaluate(() => {
    const card = document.querySelectorAll(".gd-fc")[0];
    const pick = (sel: string) => {
      const el = card.querySelector(sel)!;
      const r = el.getBoundingClientRect();
      return { sel, top: r.top, bottom: r.bottom, height: r.height };
    };
    return {
      card: card.getBoundingClientRect().height,
      parts: [".gd-fc-ph", ".gd-fc-mu", ".gd-fc-nm", ".gd-fc-bk"].map(pick),
      cardWidth: card.getBoundingClientRect().width,
      panel: document.querySelector(".gd-fm")!.getBoundingClientRect().width,
      font: getComputedStyle(card.querySelector(".gd-fc-mu")!).fontSize,
      line: getComputedStyle(card.querySelector(".gd-fc-mu")!).lineHeight,
      pad: getComputedStyle(card.querySelector(".gd-fc-mu")!).padding,
    };
  });
  console.log(JSON.stringify(boxes, null, 1));
  const card = page.locator(".gd-fc").first();
  await card.screenshot({ path: "test-results/fm-check/card-zoom.png" });
});
