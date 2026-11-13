import { test, expect, type Page } from "@playwright/test";
import { seedTradeLeague } from "./trade-seed";

// Acceptance tests of the player card hero and tier entrances, on a synthetic two-team league with free agents in every tier
// (tests/tier-fixture.ts). With two teams the cut-offs are ranks 2, 6 and 12.
const draft = { teamA: "1", teamB: "2", give: [], get: [] };
const ids = {
  superstar: "901",
  star: "903",
  good: "907",
  none: "913",
  unranked: "914",
} as const;

async function openCard(
  page: Page,
  id: string,
  filters: Record<string, string> = {},
) {
  await seedTradeLeague(page, "tiers", draft, {
    feelAnimation: "full",
    ...filters,
  });
  await page.goto(`./#/player/${id}`);
  const card = page.getByRole("dialog");
  await expect(card).toBeVisible();
  await expect(card.locator(".gd-hx")).toBeVisible();
  return card;
}

test.describe("hero header", () => {
  test("shows the rank numeral, the name block, the profile panel and the position in full", async ({
    page,
  }) => {
    const card = await openCard(page, ids.superstar);
    const hero = card.locator(".gd-hx");
    await expect(hero.locator(".gd-hx-dots")).toBeAttached();
    await expect(hero.locator(".gd-hx-num")).toHaveText("1");
    await expect(hero.locator(".gd-hx-num")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(hero.locator(".gd-hx-crumb")).toHaveText(
      "Gameday / Player card",
    );
    await expect(card.getByRole("heading", { level: 2 })).toHaveText(
      "Sam Superstar",
    );
    await expect(hero.locator(".gd-hx-first")).toHaveText("Sam");
    await expect(hero.locator(".gd-hx-last")).toHaveText("Superstar");
    const bio = hero.getByRole("complementary", { name: "Profile" });
    await expect(bio).toContainText(/40\.0 · #1 of \d+/);
    await expect(bio).toContainText("Games");
    await expect(bio.locator(".gd-hx-posname")).toHaveText("Running back");
    // Form bar: the word is always shown beside the bar.
    await expect(hero.locator(".gd-hx-form")).toContainText(
      /Hot|Cold|Steady|No recent games/,
    );
  });

  test("a player with 3 games has no rank, no numeral, no badge and no entrance", async ({
    page,
  }) => {
    const card = await openCard(page, ids.unranked);
    await expect(card.locator(".gd-hx-num")).toHaveCount(0);
    await expect(card.locator(".gd-tier")).toHaveCount(0);
    await expect(card.locator(".fx")).toHaveCount(0);
    await expect(card.locator(".gd-hx-bio")).toContainText("unranked");
  });

  test("the portrait falls back to initials when the headshot is missing", async ({
    page,
  }) => {
    const card = await openCard(page, ids.superstar);
    await expect(card.locator(".gd-hx-photo .gd-photo-fallback")).toHaveText(
      "SS",
    );
  });
});

test.describe("tier badge and entrance", () => {
  const cases = [
    {
      tier: "superstar",
      id: ids.superstar,
      badge: /^★ Superstar$/,
      aria: "Superstar, replay the card entrance",
      fx: ".fx-pap",
    },
    {
      tier: "star",
      id: ids.star,
      badge: /^Star$/,
      aria: "Star, replay the card entrance",
      fx: ".fx-shine",
    },
    {
      tier: "good",
      id: ids.good,
      badge: /^Good$/,
      aria: "Good, replay the card entrance",
      fx: ".fx-glint",
    },
  ] as const;

  for (const c of cases)
    test(`${c.tier}: badge and ${c.fx}`, async ({ page }) => {
      const card = await openCard(page, c.id);
      const badge = card.getByRole("button", { name: c.aria });
      await expect(badge).toHaveText(c.badge);
      await expect(badge).toHaveAttribute(
        "title",
        /across every position \(minimum 4 games\)\. Click to replay\.$/,
      );
      await expect(card.locator(`.fx${c.fx}`)).toBeAttached();
      // Overlays never take pointer events and are hidden from assistive technology.
      await expect(card.locator(".fx")).toHaveAttribute("aria-hidden", "true");
      await expect(card.locator(".fx")).toHaveCSS("pointer-events", "none");
    });

  test("superstar has nine flashes", async ({ page }) => {
    const card = await openCard(page, ids.superstar);
    await expect(card.locator(".fx-pap i")).toHaveCount(9);
  });

  test("a ranked player outside every tier has no badge and no entrance", async ({
    page,
  }) => {
    const card = await openCard(page, ids.none);
    await expect(card.locator(".gd-hx-num")).toHaveText(/^\d+$/);
    await expect(card.locator(".gd-tier")).toHaveCount(0);
    await expect(card.locator(".fx")).toHaveCount(0);
  });

  for (const motion of ["reduced", "off"] as const)
    test(`motion ${motion}: no entrance element, the badge still shows the tier`, async ({
      page,
    }) => {
      const card = await openCard(page, ids.superstar, {
        feelAnimation: motion,
      });
      await expect(card.locator(".gd-tier")).toHaveText("★ Superstar");
      await expect(card.locator(".fx")).toHaveCount(0);
    });

  test("the Player card entrances switch turns every entrance off", async ({
    page,
  }) => {
    const card = await openCard(page, ids.superstar, {
      feelCardEntrances: "off",
    });
    await expect(card.locator(".gd-tier")).toBeVisible();
    await expect(card.locator(".fx")).toHaveCount(0);
  });

  test("clicking the badge replays the entrance: the element is re-created", async ({
    page,
  }) => {
    const card = await openCard(page, ids.superstar);
    const fx = card.locator(".fx-pap");
    await expect(fx).toBeAttached();
    await fx.evaluate((el) => el.setAttribute("data-first-run", "yes"));
    await card
      .getByRole("button", { name: "Superstar, replay the card entrance" })
      .click();
    await expect(card.locator(".fx-pap[data-first-run]")).toHaveCount(0);
    await expect(card.locator(".fx-pap")).toHaveCount(1);
  });

  test("opening another player's card plays that player's entrance", async ({
    page,
  }) => {
    await seedTradeLeague(page, "tiers", draft, { feelAnimation: "full" });
    await page.goto(`./#/player/${ids.star}`);
    const card = page.getByRole("dialog");
    await expect(card.locator(".fx-shine")).toBeAttached();
  });
});

test.describe("Feel menu", () => {
  test("has a Player card entrances switch, on by default, that turns every entrance off", async ({
    page,
  }) => {
    await seedTradeLeague(page, "tiers", draft, { feelAnimation: "full" });
    await page.goto("./#/overview");
    await page.getByRole("button", { name: "Feel", exact: true }).click();
    const sw = page.getByRole("checkbox", { name: "Player card entrances" });
    await expect(sw).toBeChecked();
    await sw.uncheck();
    await page.goto(`./#/player/${ids.superstar}`);
    const card = page.getByRole("dialog");
    await expect(card.locator(".gd-tier")).toBeVisible();
    await expect(card.locator(".fx")).toHaveCount(0);
  });
});

test.describe("keyboard", () => {
  test("Tab reaches a control during the entrance and Escape closes the card", async ({
    page,
  }) => {
    const card = await openCard(page, ids.superstar);
    await expect(card.locator(".fx-pap")).toBeAttached();
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(
      () => document.activeElement?.closest('[role="dialog"]') !== null,
    );
    expect(focused).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("screenshots for review", () => {
  for (const [theme, width] of [
    ["light", 1280],
    ["dark", 1280],
    ["light", 390],
    ["dark", 390],
  ] as const)
    for (const [tier, id] of Object.entries({
      superstar: ids.superstar,
      star: ids.star,
      good: ids.good,
    }))
      test(`${tier} ${theme} ${width}px`, async ({ page }) => {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 800,
        });
        const card = await openCard(page, id, { feelTheme: theme });
        // Let the entrance finish so the capture shows the resting header.
        await page.waitForTimeout(1800);
        await card
          .locator(".gd-hx")
          .screenshot({
            path: test.info().outputPath(`hero-${tier}-${theme}-${width}.png`),
          });
        // Nothing is hidden on phones: the profile panel and every stat stay visible.
        await expect(card.locator(".gd-hx-bio")).toBeVisible();
        await expect(card.locator(".gd-card-nums")).toBeVisible();
      });
});
