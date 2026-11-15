import { test } from "@playwright/test";
import { seedFormation } from "./formation-seed";

test("measure", async ({ page }) => {
  await page.route("https://a.espncdn.com/i/headshots/nfl/players/full/**", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="436"><rect width="600" height="436" fill="#14342b"/></svg>' }),
  );
  await seedFormation(page);
  const info = await page.locator('.gd-fs[data-slot="QB"] .gd-fc-ph').evaluate((area) => {
    const panel = area.getBoundingClientRect();
    const frame = area.querySelector(".gd-fc-av")!.getBoundingClientRect();
    const span = area.querySelector(".gd-fc-photo")!.getBoundingClientRect();
    const img = area.querySelector("img") as HTMLImageElement;
    const rect = img.getBoundingClientRect();
    const style = getComputedStyle(img);
    return { panel: [panel.width, panel.height], frame: [frame.width, frame.height], span: [span.width, span.height], img: [rect.width, rect.height, rect.top - panel.top, rect.bottom - panel.bottom], natural: [img.naturalWidth, img.naturalHeight], fit: style.objectFit, pos: style.objectPosition, h: style.height, align: style.alignSelf, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio };
  });
  console.log("MEASURE", JSON.stringify(info));
});
