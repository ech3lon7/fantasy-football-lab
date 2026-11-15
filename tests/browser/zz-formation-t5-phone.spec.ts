import { expect, test } from "@playwright/test";
import { seedFormation } from "./formation-seed";

test("formation optimize phone card", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedFormation(page);
  await page.addStyleTag({
    content: ".gd-header,.gd-bottombar{display:none!important}",
  });
  await page
    .locator(".gd-fm-bar")
    .getByRole("button", { name: /Optimize lineup/ })
    .click();
  const card = page.locator(".gd-fc-new");
  await expect(card).toHaveCount(1);
  console.log("tag text", await card.locator(".gd-fc-newtag").innerText());
  await page.waitForTimeout(1000);
  const boxes2 = await page.evaluate(() => {
    const card = document.querySelector(".gd-fc-new")!;
    const r = (s: string) => card.querySelector(s)!.getBoundingClientRect();
    const tag = r(".gd-fc-newtag"),
      av = r(".gd-fc-av"),
      badge = r(".gd-fc-badge"),
      cardBox = card.getBoundingClientRect();
    return {
      card: [cardBox.left, cardBox.top, cardBox.width, cardBox.height],
      tag: [tag.left, tag.top, tag.right, tag.bottom],
      av: [av.left, av.top, av.right, av.bottom],
      badge: [badge.left, badge.top, badge.right, badge.bottom],
      overlap:
        tag.left < av.right &&
        tag.right > av.left &&
        tag.top < av.bottom &&
        tag.bottom > av.top,
    };
  });
  console.log("phone boxes after", JSON.stringify(boxes2));
  await card.screenshot({ path: "test-results/fm-check/card-after-390.png" });
  await page.locator(".gd-fm").screenshot({
    path: "test-results/fm-check/fm-after-390.png",
  });
});
