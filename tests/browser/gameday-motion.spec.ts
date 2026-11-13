import { test, expect } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

// Section A proves that Full starts the design's entrances on every screen, that Reduced
// keeps short fades only, and that Off leaves no animation running anywhere.
const routes = [
  { hash: "#/overview", screen: "gd-week", card: "gd-move" },
  { hash: "#/roster", screen: "gd-roster", card: "gd-fc" },
  { hash: "#/players", screen: "gd-scout", card: "gd-pcard" },
  { hash: "#/teams", screen: "gd-league", card: "gd-grade-btn" },
  { hash: "#/trades", screen: "gd-trade", card: "gd-side" },
  { hash: "#/lab/settings", screen: "gd-lab", card: "gd-card" },
] as const;

interface Started {
  name: string;
  cls: string;
}

test("Full wipes every screen in and animates its cards or charts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedLabelWhy(page, false, { feelAnimation: "full" });

  // Record animationstart in the page so nothing depends on sampling at exactly the right moment.
  await page.evaluate(() => {
    const log: Started[] = [];
    (window as unknown as { __gdStarted: Started[] }).__gdStarted = log;
    document.addEventListener(
      "animationstart",
      (event) => {
        const e = event as AnimationEvent;
        const target = event.target as Element;
        log.push({ name: e.animationName, cls: target.getAttribute("class") ?? "" });
      },
      true,
    );
  });

  for (const route of routes) {
    await page.evaluate(() => {
      (window as unknown as { __gdStarted: Started[] }).__gdStarted.length = 0;
    });
    await page.goto(`./${route.hash}`);
    // Long enough for the delayed entrances (up to 360ms) to start.
    await page.waitForTimeout(450);
    const started = await page.evaluate(
      () => (window as unknown as { __gdStarted: Started[] }).__gdStarted,
    );

    expect(
      started.some((a) => a.name === "gd-wipe" && a.cls.includes(route.screen)),
      `${route.hash} should wipe its screen container in`,
    ).toBe(true);
    expect(
      started.some((a) => (a.name === "gd-cardin" || (route.hash === "#/roster" && a.name === "gd-fc-rise")) && a.cls.includes(route.card)),
      `${route.hash} should rise its ${route.card} cards in`,
    ).toBe(true);
  }
});

test("Reduced fades and Off removes every animation", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedLabelWhy(page, false, { feelAnimation: "reduced" });
  await page.goto("./#/roster");
  await page.waitForTimeout(300);

  const reduced = await page.evaluate(() => {
    const screen = document.querySelector(".gd-roster")!;
    const style = getComputedStyle(screen);
    return {
      animation: style.animationName,
      transform: style.transform,
    };
  });
  expect(reduced.animation).toBe("gd-fade");
  expect(reduced.transform).toBe("none");

  // Choose Off from the Feel menu; the ticker stops too because it is gated on Full.
  await page.getByRole("button", { name: "Feel", exact: true }).click();
  await page
    .getByRole("group", { name: "Animation" })
    .getByRole("button", { name: "Off" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-animation", "off");
  await page.keyboard.press("Escape");

  await page.goto("./#/overview");
  await page.waitForTimeout(300);
  const running = await page.evaluate(() => document.getAnimations().length);
  expect(running).toBe(0);
});
