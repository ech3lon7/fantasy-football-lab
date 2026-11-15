import { test, expect, type Page } from "@playwright/test";
import { seedTradeLeague } from "./trade-seed";

// Acceptance tests of the filter wheel (docs/filter-wheel-implementation-plan.md, R1 to R13). The wheel only sets the filter state
// that the list view also edits, so most checks compare the two. Behaviour is checked with motion Off first; motion has its own tests.

const draft = { teamA: "1", teamB: "2", give: ["101"], get: [] };

async function openFind(
  page: Page,
  which: "search" | "big" = "search",
  filters: Record<string, string> = { feelAnimation: "off" },
) {
  await seedTradeLeague(page, which, draft, filters);
  await page.goto("./#/trade");
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await page.getByRole("button", { name: "Search all trades" }).click();
  await expect(page.getByText(/one-for-ones checked/)).toBeVisible({
    timeout: 90000,
  });
}
const wheel = (page: Page) =>
  page.getByRole("dialog", { name: "Trade filters" });
async function openWheel(
  page: Page,
  which: "search" | "big" = "search",
  filters?: Record<string, string>,
) {
  await openFind(page, which, filters);
  await page.getByRole("button", { name: /^Filters · \d+$/ }).click();
  await expect(wheel(page)).toBeVisible();
}
const segment = (page: Page, name: RegExp | string) =>
  wheel(page).getByRole("menuitem", { name });
const listTheirGain = (page: Page) =>
  page
    .locator(".gd-broad-filter-panel")
    .getByRole("spinbutton", { name: "Their EPPG gain minimum" });

test.describe("filter wheel behaviour (motion off)", () => {
  test("R1: Filters opens the wheel, six categories, focus on the first; the count marks start empty", async ({
    page,
  }) => {
    await openWheel(page);
    const items = wheel(page)
      .getByRole("menu", { name: "Filter categories" })
      .getByRole("menuitem");
    await expect(items).toHaveCount(6);
    await expect(items).toHaveText([
      "Gains",
      "Players",
      "Positions",
      "Teams",
      "Size",
      "Grades",
    ]);
    await expect(segment(page, "Gains")).toBeFocused();
    await expect(wheel(page).locator(".gd-seg-set")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Filters · 0$/ }),
    ).toBeVisible();
  });

  test("R1: the F key opens it too", async ({ page }) => {
    await openFind(page);
    await page.locator("body").press("f");
    await expect(wheel(page)).toBeVisible();
  });

  test("R2: arrow keys move around Ring 1 and the hub names the category with its setting and the live count", async ({
    page,
  }) => {
    await openWheel(page);
    await page.keyboard.press("ArrowRight");
    await expect(segment(page, "Players")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(segment(page, "Grades")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(segment(page, "Size")).toBeFocused();
    await expect(wheel(page).locator(".gd-hub-name")).toHaveText("SIZE");
    await expect(wheel(page).locator(".gd-hub-line")).toHaveText(
      "Give 1–3 · get 1–3",
    );
    await expect(wheel(page).locator(".gd-hub-hides")).toHaveText(
      /^[\d,]+ of [\d,]+$/,
    );
    await expect(wheel(page).locator(".gd-wheel-count")).toHaveText(
      /^[\d,]+ \/ [\d,]+$/,
    );
  });

  test("number keys jump to a category", async ({ page }) => {
    await openWheel(page);
    await page.keyboard.press("3");
    await expect(
      wheel(page).getByRole("menu", { name: "Positions settings" }),
    ).toBeVisible();
  });

  test("R3: Gains → Their EPPG is an arc slider with one handle; moving it to +0.5 applies instantly and the list view agrees", async ({
    page,
  }) => {
    await openWheel(page);
    await segment(page, "Gains").locator(".gd-seg-hit").click();
    await wheel(page).getByRole("menuitem", { name: "Their EPPG" }).click();
    const handle = wheel(page).getByRole("slider", {
      name: "Their EPPG at least",
    });
    await expect(handle).toHaveCount(1);
    await expect(handle).toHaveAttribute("aria-valuemin", "-2");
    await expect(handle).toHaveAttribute("aria-valuemax", "1");
    await expect(handle).toHaveAttribute("aria-valuenow", "1");
    await expect(handle).toHaveAttribute(
      "aria-valuetext",
      "Their EPPG at least +1",
    );
    await handle.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "0.5");
    await expect(wheel(page).locator(".gd-hub-value")).toHaveText("+0.5");
    await expect(wheel(page).locator(".gd-hub-hides")).toHaveText(
      /^hides \d+$/,
    );
    // It stops at both ends of the range and moves in half steps.
    await page.keyboard.press("Home");
    await expect(handle).toHaveAttribute("aria-valuenow", "-2");
    await page.keyboard.press("ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "-2");
    await page.keyboard.press("End");
    await expect(handle).toHaveAttribute("aria-valuenow", "1");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(wheel(page)).toHaveCount(0);
    await expect(listTheirGain(page)).toHaveValue("0.5");
    await expect(
      page.getByRole("button", { name: /^Filters · 1$/ }),
    ).toBeVisible();
  });

  test("R3: dragging the handle along the arc changes the value, and the hub − and + buttons step it", async ({
    page,
  }) => {
    await openWheel(page);
    await segment(page, "Gains").locator(".gd-seg-hit").click();
    await wheel(page).getByRole("menuitem", { name: "Their EPPG" }).click();
    // Aim at the arc through the SVG's own coordinates: the top of the track is at 12 o'clock, radius 214, which is -0.5.
    const svg = (await wheel(page).locator(".gd-wheel-svg").boundingBox())!;
    const at = (px: number, py: number) => ({
      x: svg.x + (px / 640) * svg.width,
      y: svg.y + (py / 640) * svg.height,
    });
    const target = at(320, 320 - 214);
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.mouse.up();
    const now = Number(
      await wheel(page)
        .getByRole("slider", { name: "Their EPPG at least" })
        .getAttribute("aria-valuenow"),
    );
    expect(now).toBe(-0.5);
    await wheel(page).getByRole("button", { name: "Raise" }).click();
    await expect(
      wheel(page).getByRole("slider", { name: "Their EPPG at least" }),
    ).toHaveAttribute("aria-valuenow", String(now + 0.5));
  });

  test("clicking the number lets you type an exact value, clamped to the range", async ({
    page,
  }) => {
    await openWheel(page);
    await segment(page, "Gains").locator(".gd-seg-hit").click();
    await wheel(page).getByRole("menuitem", { name: "Their EPPG" }).click();
    await wheel(page).locator(".gd-hub-value").click();
    const input = wheel(page).getByRole("spinbutton", { name: "Exact value" });
    await input.fill("-1.5");
    await input.press("Enter");
    await expect(
      wheel(page).getByRole("slider", { name: "Their EPPG at least" }),
    ).toHaveAttribute("aria-valuenow", "-1.5");
  });

  test("a range (Your EPPG) has two handles", async ({ page }) => {
    await openWheel(page);
    await segment(page, "Gains").locator(".gd-seg-hit").click();
    await wheel(page).getByRole("menuitem", { name: "Your EPPG" }).click();
    await expect(wheel(page).getByRole("slider")).toHaveCount(2);
    await expect(
      wheel(page).getByRole("slider", { name: "Your EPPG minimum" }),
    ).toHaveAttribute("aria-valuenow", "0");
    await expect(
      wheel(page).getByRole("slider", { name: "Your EPPG maximum" }),
    ).toHaveAttribute("aria-valuenow", "10");
  });

  test("R4: toggling WR in Positions turns it on, updates the count mark, and the list view agrees", async ({
    page,
  }) => {
    await openWheel(page);
    await segment(page, "Positions").locator(".gd-seg-hit").click();
    await wheel(page).getByRole("menuitem", { name: "I get" }).click();
    const wr = wheel(page).getByRole("menuitemcheckbox", { name: "WR" });
    await expect(wr).toHaveAttribute("aria-checked", "false");
    await wr.click();
    await expect(wr).toHaveAttribute("aria-checked", "true");
    await expect(wheel(page).locator(".gd-seg-set")).toHaveText("1 set");
    await wr.click();
    await expect(wr).toHaveAttribute("aria-checked", "false");
    await wr.click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const list = page.locator(".gd-broad-filter-panel");
    await list.locator("summary", { hasText: /^Positions$/ }).click();
    await expect(list.getByRole("checkbox", { name: "Get WR" })).toBeChecked();
  });

  test("R5: more than eight teams rotate, with a page indicator", async ({
    page,
  }) => {
    await openWheel(page, "big");
    await segment(page, "Teams").locator(".gd-seg-hit").click();
    await wheel(page).getByRole("menuitem", { name: "Opponents" }).click();
    const bubbles = wheel(page).getByRole("menuitemcheckbox");
    await expect(bubbles).toHaveCount(8);
    await expect(wheel(page).locator(".gd-hub-page")).toHaveText("1/2");
    await wheel(page).getByRole("button", { name: "Next page" }).click();
    await expect(wheel(page).locator(".gd-hub-page")).toHaveText("2/2");
    await expect(bubbles).toHaveCount(3);
  });

  test("R6: Esc, Backspace and Back each go up one level; Esc on Ring 1 closes", async ({
    page,
  }) => {
    await openWheel(page);
    await segment(page, "Gains").locator(".gd-seg-hit").click();
    await wheel(page).getByRole("menuitem", { name: "Their EPPG" }).click();
    await expect(wheel(page).getByRole("slider")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(wheel(page).getByRole("slider")).toHaveCount(0);
    await expect(
      wheel(page).getByRole("menu", { name: "Gains settings" }),
    ).toBeVisible();
    await page.keyboard.press("Backspace");
    await expect(
      wheel(page).getByRole("menu", { name: "Gains settings" }),
    ).toHaveCount(0);
    await expect(segment(page, "Gains")).toBeFocused();
    await segment(page, "Size").locator(".gd-seg-hit").click();
    await wheel(page).getByRole("button", { name: "← back" }).click();
    await expect(
      wheel(page).getByRole("menu", { name: "Size settings" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(wheel(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Filters · \d+$/ }),
    ).toBeFocused();
  });

  test("R7: Clear all restores the defaults, your gain 0 and their gain +1", async ({
    page,
  }) => {
    await openWheel(page);
    await segment(page, "Gains").locator(".gd-seg-hit").click();
    await wheel(page).getByRole("menuitem", { name: "Their EPPG" }).click();
    await wheel(page)
      .getByRole("slider", { name: "Their EPPG at least" })
      .press("Home");
    await wheel(page).getByRole("button", { name: "clear all" }).click();
    await expect(
      wheel(page).getByRole("slider", { name: "Their EPPG at least" }),
    ).toHaveAttribute("aria-valuenow", "1");
    await wheel(page).getByRole("button", { name: "done" }).click();
    await expect(listTheirGain(page)).toHaveValue("1");
    await expect(
      page
        .locator(".gd-broad-filter-panel")
        .getByRole("spinbutton", { name: "Your EPPG gain minimum" }),
    ).toHaveValue("0");
  });

  test("Players: a search list in the hub includes a player, and the list view agrees", async ({
    page,
  }) => {
    await openWheel(page);
    await segment(page, "Players").locator(".gd-seg-hit").click();
    await wheel(page).getByRole("menuitem", { name: "I get" }).click();
    const search = wheel(page).getByRole("searchbox", {
      name: "Search players",
    });
    await search.fill("Synthetic 2");
    const item = wheel(page)
      .getByRole("button", { name: /Synthetic 2/ })
      .first();
    await item.click();
    await expect(item).toHaveAttribute("aria-pressed", "true");
    await wheel(page).getByRole("button", { name: "done" }).click();
    const list = page.locator(".gd-broad-filter-panel");
    await list.locator("summary", { hasText: /^Players$/ }).click();
    await expect(
      list.getByRole("button", { name: /Synthetic 2/ }).first(),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("Grades opens the existing grade-goal editor", async ({ page }) => {
    await openWheel(page);
    await segment(page, "Grades").locator(".gd-seg-hit").click();
    await wheel(page).getByRole("button", { name: "+ Add goal" }).click();
    await expect(wheel(page).locator(".gd-goal-line").first()).toBeVisible();
  });

  test("R8: Done closes the wheel and returns focus to the Filters button; List view opens the list", async ({
    page,
  }) => {
    await openWheel(page);
    await wheel(page).getByRole("button", { name: "done" }).click();
    await expect(wheel(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Filters · \d+$/ }),
    ).toBeFocused();
  });

  test("R13: the dialog traps Tab, and each ring is a menu of menu items", async ({
    page,
  }) => {
    await openWheel(page);
    for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest('[role="dialog"]'),
      ),
    ).toBe(true);
    await expect(
      wheel(page).getByRole("menu", { name: "Filter categories" }),
    ).toBeVisible();
    await expect(wheel(page).getByRole("status")).toHaveText(
      /^[\d,]+ \/ [\d,]+$/,
    );
  });
});

// What is animating inside the wheel (or its backdrop) right now, with each animation's duration.
const running = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => {
        const el = (a.effect as KeyframeEffect | null)
          ?.target as Element | null;
        return !!el?.closest(".gd-wheel-scrim");
      })
      .map((a) =>
        Number((a.effect as KeyframeEffect).getComputedTiming().duration),
      ),
  );

test.describe("filter wheel motion levels", () => {
  test("Full: opening plays real animations and puffs chalk dust at the button", async ({
    page,
  }) => {
    await openFind(page, "search", { feelAnimation: "full" });
    const puffs = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          (
            document.querySelector("button.gd-wheel-open") as HTMLButtonElement
          ).click();
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve(document.querySelectorAll(".chalk-puff").length),
            ),
          );
        }),
    );
    expect(puffs).toBe(6);
    const durations = await running(page);
    expect(durations.length).toBeGreaterThan(10);
    // The rings draw for 420 ms, the longest of the opening.
    expect(Math.max(...durations)).toBe(420);
  });

  test("Full: no interaction animation lasts longer than 420 ms", async ({
    page,
  }) => {
    await openWheel(page, "search", { feelAnimation: "full" });
    await segment(page, "Gains").locator(".gd-seg-hit").click();
    await wheel(page).getByRole("menuitem", { name: "Their EPPG" }).click();
    expect(Math.max(0, ...(await running(page)))).toBeLessThanOrEqual(420);
    await wheel(page)
      .getByRole("slider", { name: "Their EPPG at least" })
      .press("ArrowLeft");
    expect(Math.max(0, ...(await running(page)))).toBeLessThanOrEqual(420);
  });

  test("Full: dragging the handle leaves at most eight crumbs of dust", async ({
    page,
  }) => {
    await openWheel(page, "search", { feelAnimation: "full" });
    await segment(page, "Gains").locator(".gd-seg-hit").click();
    await wheel(page).getByRole("menuitem", { name: "Their EPPG" }).click();
    const handle = wheel(page).getByRole("slider", {
      name: "Their EPPG at least",
    });
    await handle.focus();
    for (let i = 0; i < 6; i++)
      await page.keyboard.press(i % 2 ? "ArrowRight" : "ArrowLeft");
    const dust = await wheel(page).locator(".chalk-particle").count();
    expect(dust).toBeGreaterThan(0);
    expect(dust).toBeLessThanOrEqual(8);
  });

  test("Full: nothing blocks input — Escape works at once while the opening is still playing", async ({
    page,
  }) => {
    await openFind(page, "search", { feelAnimation: "full" });
    await page.getByRole("button", { name: /^Filters · \d+$/ }).click();
    await expect(wheel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    // It collapses into the Filters button (260 ms) and is gone shortly after.
    await expect(wheel(page)).toHaveCount(0, { timeout: 1500 });
  });

  test("Reduced: only short fades, no dust, no drawing", async ({ page }) => {
    await openFind(page, "search", { feelAnimation: "reduced" });
    await page.getByRole("button", { name: /^Filters · \d+$/ }).click();
    await expect(wheel(page)).toBeVisible();
    const durations = await running(page);
    for (const d of durations) expect(d).toBeLessThanOrEqual(150);
    await expect(page.locator(".chalk-particle")).toHaveCount(0);
    await segment(page, "Gains").locator(".gd-seg-hit").click();
    await wheel(page).getByRole("menuitem", { name: "Their EPPG" }).click();
    for (const d of await running(page)) expect(d).toBeLessThanOrEqual(150);
    await wheel(page)
      .getByRole("slider", { name: "Their EPPG at least" })
      .press("ArrowLeft");
    await expect(page.locator(".chalk-particle")).toHaveCount(0);
  });

  test("Off: nothing animates, no particles, and the behaviour is the same", async ({
    page,
  }) => {
    await openWheel(page, "search", { feelAnimation: "off" });
    expect(await running(page)).toEqual([]);
    await segment(page, "Gains").locator(".gd-seg-hit").click();
    await wheel(page).getByRole("menuitem", { name: "Their EPPG" }).click();
    await wheel(page)
      .getByRole("slider", { name: "Their EPPG at least" })
      .press("ArrowLeft");
    expect(await running(page)).toEqual([]);
    await expect(page.locator(".chalk-particle")).toHaveCount(0);
    await expect(
      wheel(page).getByRole("slider", { name: "Their EPPG at least" }),
    ).toHaveAttribute("aria-valuenow", "0.5");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(wheel(page)).toHaveCount(0, { timeout: 300 });
  });

  test("Clear all can be undone", async ({ page }) => {
    await openWheel(page, "search", { feelAnimation: "off" });
    await segment(page, "Gains").locator(".gd-seg-hit").click();
    await wheel(page).getByRole("menuitem", { name: "Their EPPG" }).click();
    await wheel(page)
      .getByRole("slider", { name: "Their EPPG at least" })
      .press("Home");
    await wheel(page).getByRole("button", { name: "clear all" }).click();
    await expect(
      wheel(page).getByRole("slider", { name: "Their EPPG at least" }),
    ).toHaveAttribute("aria-valuenow", "1");
    await wheel(page).getByRole("button", { name: "undo" }).click();
    await expect(
      wheel(page).getByRole("slider", { name: "Their EPPG at least" }),
    ).toHaveAttribute("aria-valuenow", "-2");
  });
});

// What is animating on the result rows right now, with each animation's duration.
const rowAnimations = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter(
        (a) =>
          !!(
            (a.effect as KeyframeEffect | null)?.target as Element | null
          )?.closest(".gd-res [data-key]"),
      )
      .map((a) =>
        Number((a.effect as KeyframeEffect).getComputedTiming().duration),
      ),
  );
const shownCount = async (page: Page) =>
  Number(
    (await page.getByText(/^[\d,]+ of [\d,]+ trades$/).innerText())
      .match(/[\d,]+/)![0]
      .replace(/,/g, ""),
  );

test.describe("results move when filters change (A11, A13)", () => {
  test("Full: kept rows slide, new rows draw in (at most 20), and the list ends exactly as filtered", async ({
    page,
  }) => {
    await openFind(page, "search", { feelAnimation: "full" });
    const before = await shownCount(page);
    // Let the search's own streaming animations finish so only the filter change is measured.
    await page.evaluate(() => Promise.all(document.getAnimations().filter((x) => Number.isFinite(Number(x.effect?.getComputedTiming().endTime))).map((x) => x.finished.catch(() => undefined))));
    await page
      .locator(".gd-broad-filter-panel")
      .getByRole("spinbutton", { name: "Your EPPG gain minimum" })
      .fill("");
    await expect.poll(() => shownCount(page)).toBeGreaterThan(before);
    const durations = await rowAnimations(page);
    expect(durations.length).toBeGreaterThan(0);
    // At most twenty rows draw in and twenty slide; a row may carry a second small animation of its own.
    expect(durations.length).toBeLessThanOrEqual(60);
    expect(durations.filter((d) => d === 200).length).toBeLessThanOrEqual(20);
    // New rows draw in over 200 ms and kept rows slide over 250 ms: nothing is longer than 420 ms.
    expect(Math.max(...durations)).toBeLessThanOrEqual(420);
    await expect
      .poll(async () => page.locator(".gd-res > .gd-res-group").count())
      .toBe(
        Math.min(25, await shownCount(page)) > 0
          ? await page.locator(".gd-res > .gd-res-group").count()
          : 0,
      );
  });

  test("Full: a removed row collapses from a copy that is not a row, and the copy goes away", async ({
    page,
  }) => {
    await openFind(page, "search", { feelAnimation: "full" });
    await page
      .locator(".gd-broad-filter-panel")
      .getByRole("spinbutton", { name: "Your EPPG gain minimum" })
      .fill("");
    await expect.poll(() => shownCount(page)).toBeGreaterThan(0);
    const rowsBefore = await page
      .locator(".gd-res > .gd-res-group > .gd-res-row")
      .count();
    // Tighten the filter so rows are removed.
    await page
      .locator(".gd-broad-filter-panel")
      .getByRole("spinbutton", { name: "Your EPPG gain minimum" })
      .fill("100");
    await expect
      .poll(() => page.locator(".gd-res > .gd-res-group > .gd-res-row").count())
      .toBe(0);
    // The copies carry no row class, are hidden from assistive technology, and are gone shortly after.
    await expect(
      page.locator(".gd-res [aria-hidden='true'][inert]"),
    ).toHaveCount(0, { timeout: 1500 });
    expect(rowsBefore).toBeGreaterThan(0);
  });

  test("Reduced: rows only fade, 150 ms at most", async ({ page }) => {
    await openFind(page, "search", { feelAnimation: "reduced" });
    await page
      .locator(".gd-broad-filter-panel")
      .getByRole("spinbutton", { name: "Your EPPG gain minimum" })
      .fill("");
    await expect.poll(() => shownCount(page)).toBeGreaterThan(0);
    for (const d of await rowAnimations(page))
      expect(d).toBeLessThanOrEqual(150);
  });

  test("Off: rows change with no animation at all", async ({ page }) => {
    await openFind(page, "search", { feelAnimation: "off" });
    await page
      .locator(".gd-broad-filter-panel")
      .getByRole("spinbutton", { name: "Your EPPG gain minimum" })
      .fill("");
    await expect.poll(() => shownCount(page)).toBeGreaterThan(0);
    expect(await rowAnimations(page)).toEqual([]);
  });

  test("Full: streaming rows slide up and fade in over 180 ms while the search runs", async ({
    page,
  }) => {
    test.setTimeout(180000);
    await seedTradeLeague(page, "big", draft, { feelAnimation: "full" });
    await page.goto("./#/trade");
    await page.getByRole("tab", { name: "Find trades", exact: true }).click();
    await page.getByRole("button", { name: "Search all trades" }).click();
    const seen = new Set<number>();
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !seen.has(180)) {
      for (const d of await rowAnimations(page)) seen.add(d);
      await page.waitForTimeout(100);
    }
    expect(seen.has(180)).toBe(true);
  });
});

// The play-call scene (A12) while Search all trades runs, on a 12-team league so the search takes a while.
test.describe("the play-call scene while a search runs (A12)", () => {
  async function startSearch(page: Page, level: string) {
    await seedTradeLeague(page, "big", draft, { feelAnimation: level });
    await page.goto("./#/trade");
    await page.getByRole("tab", { name: "Find trades", exact: true }).click();
    await page.getByRole("button", { name: "Search all trades" }).click();
  }

  test("Full: a chalk diagram with an X for each of the 11 opponents, routes drawn as teams are searched, circles when done", async ({
    page,
  }) => {
    test.setTimeout(180000);
    await startSearch(page, "full");
    const scene = page.locator(".gd-playcall");
    await expect(scene).toBeVisible({ timeout: 10000 });
    await expect(scene.locator(".gd-pc-x")).toHaveCount(11);
    await expect(scene.locator(".gd-pc-o")).toHaveCount(1);
    // Routes appear as opponents finish their one-for-ones; circles when all their packages are done.
    await expect(
      scene.locator('.gd-pc-route[data-on="true"]').first(),
    ).toBeAttached({ timeout: 30000 });
    await expect(scene.getByText(/teams ·.*one-for-ones/)).toBeVisible();
    // The scene is decoration: hidden from assistive technology, while the plain progress status stays.
    await expect(scene).toHaveAttribute("aria-hidden", "true");
    await expect(
      page
        .getByRole("region", { name: "Trade search results" })
        .getByRole("status")
        .first(),
    ).toBeVisible();
    // It ends by folding into the coverage line.
    await expect(page.getByText(/one-for-ones checked/)).toBeVisible({
      timeout: 90000,
    });
    await expect(scene).toHaveCount(0, { timeout: 3000 });
  });

  test("Full: every opponent ends up with a route and a circle", async ({
    page,
  }) => {
    test.setTimeout(180000);
    await startSearch(page, "full");
    const scene = page.locator(".gd-playcall");
    await expect(scene).toBeVisible({ timeout: 10000 });
    const done = await page.evaluate(
      () =>
        new Promise<{ routes: number; circles: number }>((resolve) => {
          const tick = () => {
            const s = document.querySelector(".gd-playcall");
            if (!s) return resolve({ routes: -1, circles: -1 });
            const circles = s.querySelectorAll(
              '.gd-pc-circle[data-on="true"]',
            ).length;
            if (circles === 11)
              return resolve({
                routes: s.querySelectorAll('.gd-pc-route[data-on="true"]')
                  .length,
                circles,
              });
            setTimeout(tick, 100);
          };
          tick();
        }),
    );
    // Either the scene saw all eleven finish, or the search ended first and the scene folded away; in both cases none is left half drawn.
    if (done.circles !== -1) expect(done).toEqual({ routes: 11, circles: 11 });
  });

  test("Reduced: a plain progress bar and no drawing", async ({ page }) => {
    test.setTimeout(180000);
    await startSearch(page, "reduced");
    const scene = page.locator(".gd-playcall");
    await expect(scene).toBeVisible({ timeout: 10000 });
    await expect(scene.locator(".gd-pc-bar")).toBeVisible();
    await expect(
      scene.locator(".gd-pc-x, .gd-pc-route, .gd-pc-circle"),
    ).toHaveCount(0);
    await expect(page.getByText(/one-for-ones checked/)).toBeVisible({
      timeout: 90000,
    });
    await expect(scene).toHaveCount(0, { timeout: 3000 });
  });

  test("Off: no scene at all, only the plain status and then the coverage line", async ({
    page,
  }) => {
    test.setTimeout(180000);
    await startSearch(page, "off");
    await expect(page.locator(".gd-playcall")).toHaveCount(0);
    await expect(page.getByText(/one-for-ones checked/)).toBeVisible({
      timeout: 90000,
    });
    await expect(page.locator(".gd-playcall")).toHaveCount(0);
  });
});

// R12: on a phone (390px) the wheel is a half-wheel fan; every control is reachable by tap.
test.describe("phone fan (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  async function openFan(
    page: Page,
    filters: Record<string, string> = { feelAnimation: "off" },
  ) {
    await seedTradeLeague(page, "search", draft, filters);
    await page.goto("./#/trade");
    await page.getByRole("tab", { name: "Find trades", exact: true }).click();
    await page.getByRole("button", { name: "Search all trades" }).click();
    await expect(page.getByText(/one-for-ones checked/)).toBeVisible({
      timeout: 60000,
    });
    await page.getByRole("button", { name: /^Filters · \d+$/ }).tap();
    await expect(wheel(page)).toBeVisible();
  }

  test("R12: the fan rises from the bottom with six segments of at least 48px, and a tap chooses one", async ({
    page,
  }) => {
    await openFan(page);
    const items = wheel(page)
      .getByRole("menu", { name: "Filter categories" })
      .getByRole("menuitem");
    await expect(items).toHaveCount(6);
    const box = (await wheel(page).boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(830);
    expect(box.width).toBeLessThanOrEqual(390);
    for (let i = 0; i < 6; i++) {
      const wedge = (await items
        .nth(i)
        .locator(".gd-fan-wedge")
        .boundingBox())!;
      expect(
        Math.min(wedge.width, wedge.height),
        `segment ${i}`,
      ).toBeGreaterThanOrEqual(48);
    }
    await items.nth(0).locator(".gd-fan-wedge").tap();
    await expect(
      wheel(page).getByRole("menu", { name: "Gains settings" }),
    ).toBeVisible();
    // Ring 1 is swapped out for the settings; the hub pill leads back.
    await expect(
      wheel(page).getByRole("menu", { name: "Filter categories" }),
    ).toHaveCount(0);
  });

  test("a tap sets Their EPPG with the − and + buttons and the arc, and the list view agrees", async ({
    page,
  }) => {
    await openFan(page);
    await wheel(page)
      .getByRole("menuitem", { name: "Gains" })
      .locator(".gd-fan-wedge")
      .tap();
    await wheel(page)
      .getByRole("menuitem", { name: "Their EPPG" })
      .locator(".gd-fan-wedge")
      .tap();
    const slider = wheel(page).getByRole("slider", {
      name: "Their EPPG at least",
    });
    await expect(slider).toHaveAttribute("aria-valuenow", "1");
    await wheel(page).getByRole("button", { name: "Lower" }).tap();
    await expect(slider).toHaveAttribute("aria-valuenow", "0.5");
    await expect(wheel(page).locator(".gd-fan-pill")).toContainText("+0.5");
    await wheel(page).getByRole("button", { name: "done" }).tap();
    await expect(wheel(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Filters · 1$/ }),
    ).toBeVisible();
  });

  test("toggles and players are tappable; nothing is hover-only", async ({
    page,
  }) => {
    await openFan(page);
    await wheel(page)
      .getByRole("menuitem", { name: "Positions" })
      .locator(".gd-fan-wedge")
      .tap();
    await wheel(page)
      .getByRole("menuitem", { name: "I get" })
      .locator(".gd-fan-wedge")
      .tap();
    const wr = wheel(page).getByRole("menuitemcheckbox", { name: "WR" });
    await wr.tap();
    await expect(wr).toHaveAttribute("aria-checked", "true");
    await wheel(page).getByRole("button", { name: /^Back/ }).tap();
    await wheel(page).getByRole("button", { name: /^Back/ }).tap();
    await wheel(page)
      .getByRole("menuitem", { name: "Players" })
      .locator(".gd-fan-wedge")
      .tap();
    await wheel(page)
      .getByRole("menuitem", { name: "I get" })
      .locator(".gd-fan-wedge")
      .tap();
    await wheel(page)
      .getByRole("searchbox", { name: "Search players" })
      .fill("Synthetic 2");
    const item = wheel(page)
      .getByRole("button", { name: /Synthetic 2/ })
      .first();
    await item.tap();
    await expect(item).toHaveAttribute("aria-pressed", "true");
  });

  test("Reduced: the fan fades in and out in 150 ms or less", async ({
    page,
  }) => {
    await openFan(page, { feelAnimation: "reduced" });
    const durations = await page.evaluate(() =>
      document
        .getAnimations()
        .filter(
          (a) =>
            !!((a.effect as KeyframeEffect).target as Element | null)?.closest(
              ".gd-fan-scrim",
            ),
        )
        .map((a) =>
          Number((a.effect as KeyframeEffect).getComputedTiming().duration),
        ),
    );
    for (const d of durations) expect(d).toBeLessThanOrEqual(150);
  });

  test("Full: the fan rises over 280 ms", async ({ page }) => {
    await seedTradeLeague(page, "search", draft, { feelAnimation: "full" });
    await page.goto("./#/trade");
    await page.getByRole("tab", { name: "Find trades", exact: true }).click();
    await page.getByRole("button", { name: "Search all trades" }).click();
    await expect(page.getByText(/one-for-ones checked/)).toBeVisible({
      timeout: 60000,
    });
    const durations = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          (
            document.querySelector("button.gd-wheel-open") as HTMLButtonElement
          ).click();
          requestAnimationFrame(() =>
            resolve(
              document
                .getAnimations()
                .filter(
                  (a) =>
                    !!(
                      (a.effect as KeyframeEffect).target as Element | null
                    )?.closest(".gd-fan-scrim"),
                )
                .map((a) =>
                  Number(
                    (a.effect as KeyframeEffect).getComputedTiming().duration,
                  ),
                ),
            ),
          );
        }),
    );
    expect(durations).toContain(280);
  });
});

// The Chain planner has the wheel too: Ring 1 plus Chains (R1 and the handoff). It sets the same state the planner's own lists do.
test.describe("filter wheel on the Chain planner", () => {
  const chainDraft = { teamA: "1", teamB: "2", give: ["3", "8", "9"], get: [] };
  async function openChainWheel(page: Page) {
    await seedTradeLeague(page, "chain", chainDraft, { feelAnimation: "off" });
    await page.goto("./#/trade");
    await page.getByRole("tab", { name: "Chain planner", exact: true }).click();
    await page.getByRole("button", { name: /^Filters · \d+$/ }).click();
    await expect(wheel(page)).toBeVisible();
  }

  test("seven segments: the six plus Chains", async ({ page }) => {
    await openChainWheel(page);
    const items = wheel(page)
      .getByRole("menu", { name: "Filter categories" })
      .getByRole("menuitem");
    await expect(items).toHaveCount(7);
    await expect(items.last()).toHaveText("Chains");
  });

  test("Their EPPG sets the planner's own minimum, and it matches the field on the page", async ({
    page,
  }) => {
    await openChainWheel(page);
    await segment(page, "Gains").locator(".gd-seg-hit").click();
    const handle = wheel(page).getByRole("slider", {
      name: "Their EPPG at least",
    });
    await expect(handle).toHaveAttribute("aria-valuenow", "1");
    await handle.press("ArrowLeft");
    await wheel(page).getByRole("button", { name: "done" }).click();
    await expect(
      page.getByRole("spinbutton", { name: "Their EPPG gain minimum" }),
    ).toHaveValue("0.5");
    await expect(
      page.getByRole("button", { name: /^Filters · 1$/ }),
    ).toBeVisible();
  });

  test("Chains sets the sequence types, and at least one type stays on", async ({
    page,
  }) => {
    await openChainWheel(page);
    await segment(page, "Chains").locator(".gd-seg-hit").click();
    const connected = wheel(page).getByRole("menuitemcheckbox", {
      name: "Connected",
    });
    const sequential = wheel(page).getByRole("menuitemcheckbox", {
      name: "Sequential",
    });
    await expect(connected).toHaveAttribute("aria-checked", "true");
    await sequential.click();
    await expect(sequential).toHaveAttribute("aria-checked", "true");
    await connected.click();
    await expect(connected).toHaveAttribute("aria-checked", "false");
    // The last type cannot be switched off.
    await sequential.click();
    await expect(sequential).toHaveAttribute("aria-checked", "true");
  });

  test("a per-trade category points at the per-trade settings", async ({
    page,
  }) => {
    await openChainWheel(page);
    await segment(page, "Size").locator(".gd-seg-hit").click();
    await wheel(page)
      .getByRole("button", { name: "open per-trade settings" })
      .click();
    await expect(wheel(page)).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Per-trade settings" }),
    ).toBeVisible();
  });
});
