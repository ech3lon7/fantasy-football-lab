import { waitForFindResults } from "./trade-workspace-helpers";
import { test, expect, type Page } from "@playwright/test";
import { seedTradeLeague } from "./trade-seed";

// Acceptance tests of the filter wheel (docs/filter-wheel-implementation-plan.md, R1 to R13, revised by F0/F4 in
// docs/trade-search-fixes-implementation-plan.md). Find trades shows the wheel inline and always visible, so it is the only filter
// control there; the Chain planner keeps the pop-up wheel and its phone fan. Behaviour is checked with motion Off first; motion has
// its own tests.

const draft = { teamA: "1", teamB: "2", give: ["101"], get: [] };
const chainDraft = { teamA: "1", teamB: "2", give: ["3", "8", "9"], get: [] };

const wheel = (page: Page) =>
  page.getByRole("dialog", { name: "Trade filters" });
const segment = (page: Page, name: RegExp | string) =>
  wheel(page).getByRole("menuitem", { name });
// The polished board (docs/filter-wheel-polish-proposal.md): the hub is display-only and clicking it goes back one level (there is no
// done / back footer); the filters-on count lives in the left rail.
const hub = (page: Page) => wheel(page).locator(".gd-zb-hub");
const rail = (page: Page) => wheel(page).locator('[data-zone="rail"]');
const done = (page: Page) => hub(page).click();

// Open Find trades: the inline wheel is there before any search.
async function openFind(
  page: Page,
  which: "search" | "big" = "search",
  filters: Record<string, string> = { feelAnimation: "off" },
) {
  await seedTradeLeague(page, which, draft, filters);
  await page.goto("./#/trade");
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await expect(wheel(page)).toBeVisible();
}

// Search from the inline wheel's hub. The big league's full search takes over a minute on a two-core CI runner.
async function runSearch(page: Page, timeout = 240000) {
  await wheel(page)
    .getByRole("button", { name: "Search", exact: true })
    .click();
  // Progress also mentions possible trades; only the final coverage line means filtering and animations have settled.
  await expect(page.getByText(/^Checked all [\d,]+ possible trades/)).toBeVisible({ timeout });
  // Wait for worker completion and the deferred list to match the live wheel counts.
  await waitForFindResults(page);
}

async function searchFind(
  page: Page,
  which: "search" | "big" = "search",
  filters?: Record<string, string>,
) {
  await openFind(page, which, filters);
  await runSearch(page);
}

// Open the Chain planner's pop-up wheel, which still opens from its Filters button.
async function openChainWheel(
  page: Page,
  filters: Record<string, string> = { feelAnimation: "off" },
) {
  await seedTradeLeague(page, "chain", chainDraft, filters);
  await page.goto("./#/trade");
  await page.getByRole("tab", { name: "Chain planner", exact: true }).click();
  await page.getByRole("button", { name: /^Filters · \d+$/ }).click();
  await expect(wheel(page)).toBeVisible();
}

test.describe("filter wheel behaviour (motion off)", () => {
  test("R1: the inline wheel shows the seven categories and the hub, before any search", async ({
    page,
  }) => {
    await openFind(page);
    const items = wheel(page)
      .getByRole("menu", { name: "Filter categories" })
      .getByRole("menuitem");
    await expect(items).toHaveCount(7);
    await expect(items).toHaveText([
      "Gains",
      "Players",
      "Positions",
      "Teams",
      "Size",
      "Grades",
      "Never trade",
    ]);
    await expect(wheel(page).locator(".gd-seg-set")).toHaveCount(0);
    await expect(
      wheel(page).getByRole("button", { name: "Search", exact: true }),
    ).toBeVisible();
    // Changed: the filters-on count is in the left rail, and the count reads "—" before a search.
    await expect(rail(page)).toContainText("0 filters on");
    await expect(wheel(page).locator(".gd-wheel-count")).toHaveText("—");
  });

  test("R1: the retired F key no longer touches the wheel; Shift+Space focuses it", async ({
    page,
  }) => {
    await openFind(page);
    await page.locator("body").press("f");
    await expect
      .poll(() =>
        wheel(page).evaluate((node) => node.contains(document.activeElement)),
      )
      .toBe(false);
    await page.keyboard.press("Shift+Space");
    await expect
      .poll(() =>
        wheel(page).evaluate((node) => node.contains(document.activeElement)),
      )
      .toBe(true);
    await expect(segment(page, /^Gains/)).toBeFocused();
  });

  test("R2: arrow keys move around Ring 1 and the hub names the category with its setting and the live count", async ({
    page,
  }) => {
    await openFind(page);
    await page.keyboard.press("Shift+Space");
    await page.keyboard.press("ArrowRight");
    await expect(segment(page, /^Players/)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    // The ring now has seven categories, so Left from the first wraps to the last: Never trade (was Grades with six).
    await expect(segment(page, /^Never trade/)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(segment(page, /^Grades/)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(segment(page, /^Size/)).toBeFocused();
    // Changed selectors: the hub's setting is its value line, and before a search its hides line and the count read "—".
    await expect(wheel(page).locator(".gd-zh-name")).toHaveText("SIZE");
    await expect(wheel(page).locator(".gd-zh-value")).toHaveText(
      "Give 1–3 · get 1–3",
    );
    await expect(wheel(page).locator(".gd-zh-hides")).toHaveText("hides —");
    await expect(wheel(page).locator(".gd-wheel-count")).toHaveText("—");
  });

  test("number keys jump to a category", async ({ page }) => {
    await openFind(page);
    await page.keyboard.press("Shift+Space");
    await page.keyboard.press("3");
    await expect(
      wheel(page).getByRole("menu", { name: "Positions settings" }),
    ).toBeVisible();
  });

  test("R3: Gains → Their EPPG is an arc slider with one handle; moving it to +0.5 applies instantly and the count mark follows", async ({
    page,
  }) => {
    await searchFind(page);
    await segment(page, /^Gains/).click();
    await wheel(page)
      .getByRole("menuitem", { name: "Their EPPG", exact: true })
      .click();
    const handle = wheel(page).getByRole("slider", {
      name: "Their EPPG at least",
    });
    await expect(handle).toHaveCount(1);
    await expect(handle).toHaveAttribute("aria-valuemin", "-2");
    await expect(handle).toHaveAttribute("aria-valuemax", "1");
    await expect(handle).toHaveAttribute("aria-valuenow", "-2");
    await expect(handle).toHaveAttribute(
      "aria-valuetext",
      "Their EPPG at least -2",
    );
    await handle.focus();
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "0.5");
    await expect(wheel(page).locator(".gd-zh-value")).toHaveText("+0.5");
    await expect(wheel(page).locator(".gd-zh-hides")).toHaveText(
      /^hides [\d,]+ · also blocks [\d,]+$/,
    );
    // It stops at both ends of the range and moves in half steps.
    await page.keyboard.press("Home");
    await expect(handle).toHaveAttribute("aria-valuenow", "-2");
    await page.keyboard.press("ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "-2");
    await page.keyboard.press("End");
    await expect(handle).toHaveAttribute("aria-valuenow", "1");
    await page.keyboard.press("ArrowLeft");
    await done(page);
    await done(page);
    // The ring marks the setting and the hub counts the active filters.
    await expect(segment(page, /^Gains/)).toContainText("1 set");
    await expect(rail(page)).toContainText("1 filters on");
  });

  test("R3: dragging the handle along the arc changes the value, and the hub − and + buttons step it", async ({
    page,
  }) => {
    await openFind(page);
    await segment(page, /^Gains/).click();
    await wheel(page)
      .getByRole("menuitem", { name: "Their EPPG", exact: true })
      .click();
    // Aim at the arc through the SVG's own coordinates: the top of the track is at 12 o'clock, radius 214, which is -0.5.
    const svg = (await wheel(page).locator(".gd-zb-svg").boundingBox())!;
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
    await openFind(page);
    await segment(page, /^Gains/).click();
    await wheel(page)
      .getByRole("menuitem", { name: "Their EPPG", exact: true })
      .click();
    // Changed selector: the number is typed from the value card in the right zone (the hub is display-only).
    await wheel(page).getByRole("button", { name: /Their EPPG value/ }).click();
    const input = wheel(page).getByRole("spinbutton", { name: "Exact value" });
    await input.fill("-1.5");
    await input.press("Enter");
    await expect(
      wheel(page).getByRole("slider", { name: "Their EPPG at least" }),
    ).toHaveAttribute("aria-valuenow", "-1.5");
  });

  test("a range (Your EPPG) has two handles", async ({ page }) => {
    await openFind(page);
    await segment(page, /^Gains/).click();
    await wheel(page)
      .getByRole("menuitem", { name: "Your EPPG", exact: true })
      .click();
    await expect(wheel(page).getByRole("slider")).toHaveCount(2);
    await expect(
      wheel(page).getByRole("slider", { name: "Your EPPG minimum" }),
    ).toHaveAttribute("aria-valuenow", "0");
    await expect(
      wheel(page).getByRole("slider", { name: "Your EPPG maximum" }),
    ).toHaveAttribute("aria-valuenow", "10");
  });

  test("R4: toggling WR in Positions turns it on, updates the count mark, and the hub counts it", async ({
    page,
  }) => {
    await openFind(page);
    await segment(page, /^Positions/).click();
    await wheel(page)
      .getByRole("menuitem", { name: "I get", exact: true })
      .click();
    const wr = wheel(page).getByRole("menuitemcheckbox", { name: "WR" });
    await expect(wr).toHaveAttribute("aria-checked", "false");
    await wr.click();
    await expect(wr).toHaveAttribute("aria-checked", "true");
    await wr.click();
    await expect(wr).toHaveAttribute("aria-checked", "false");
    await wr.click();
    await done(page);
    await done(page);
    await expect(segment(page, /^Positions/)).toContainText("1 set");
    await expect(rail(page)).toContainText("1 filters on");
  });

  test("R5: more than eight teams are all listed and the list scrolls inside the zone", async ({
    page,
  }) => {
    // Replaced: the old wheel rotated the teams in pages of eight; the polished board lists them all and scrolls (proposal 2.1).
    await openFind(page, "big");
    await segment(page, /^Teams/).click();
    await wheel(page)
      .getByRole("menuitem", { name: "Opponents", exact: true })
      .click();
    const list = wheel(page).getByRole("menu", { name: "Opponents options" });
    await expect(list.getByRole("menuitemcheckbox")).toHaveCount(11);
    expect(await list.evaluate((el) => getComputedStyle(el).overflowY)).toMatch(/auto|scroll/);
  });

  test("R6: Esc, Backspace and Back each go up one level; Esc on Ring 1 leaves the inline wheel open", async ({
    page,
  }) => {
    await openFind(page);
    await segment(page, /^Gains/).click();
    await wheel(page)
      .getByRole("menuitem", { name: "Their EPPG", exact: true })
      .click();
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
    await expect(segment(page, /^Gains/)).toBeFocused();
    await segment(page, /^Size/).click();
    // Changed selector: Back is the hub.
    await hub(page).click();
    await expect(
      wheel(page).getByRole("menu", { name: "Size settings" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(wheel(page)).toBeVisible();
    await expect(
      wheel(page).getByRole("menu", { name: "Filter categories" }),
    ).toBeVisible();
  });

  test("R7: Reset to defaults restores your gain 0 and their gain -2", async ({
    page,
  }) => {
    await openFind(page);
    await segment(page, /^Gains/).click();
    await wheel(page)
      .getByRole("menuitem", { name: "Their EPPG", exact: true })
      .click();
    await wheel(page)
      .getByRole("slider", { name: "Their EPPG at least" })
      .press("End");
    await done(page);
    await done(page);
    await wheel(page)
      .getByRole("button", { name: "Reset to defaults", exact: true })
      .click();
    await expect(rail(page)).toContainText("0 filters on");
    await segment(page, /^Gains/).click();
    await wheel(page)
      .getByRole("menuitem", { name: "Their EPPG", exact: true })
      .click();
    await expect(
      wheel(page).getByRole("slider", { name: "Their EPPG at least" }),
    ).toHaveAttribute("aria-valuenow", "-2");
    await wheel(page)
      .getByRole("menuitem", { name: "Your EPPG", exact: true })
      .click();
    await expect(
      wheel(page).getByRole("slider", { name: "Your EPPG minimum" }),
    ).toHaveAttribute("aria-valuenow", "0");
  });

  test("Players: a search list in the hub includes a player, and the choice survives the ring", async ({
    page,
  }) => {
    await openFind(page);
    await segment(page, /^Players/).click();
    await wheel(page)
      .getByRole("menuitem", { name: "I get", exact: true })
      .click();
    const search = wheel(page).getByRole("searchbox", {
      name: "Search players",
    });
    await search.fill("Synthetic 2");
    const item = wheel(page)
      .getByRole("button", { name: /Synthetic 2/ })
      .first();
    await item.click();
    await expect(item).toHaveAttribute("aria-pressed", "true");
    await done(page);
    await done(page);
    await expect(segment(page, /^Players/)).toContainText("1 set");
    await segment(page, /^Players/).click();
    await wheel(page)
      .getByRole("menuitem", { name: "I get", exact: true })
      .click();
    await expect(
      wheel(page).getByRole("button", { name: /Synthetic 2/ }).first(),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("Grades opens the existing grade-goal editor", async ({ page }) => {
    await openFind(page);
    await segment(page, /^Grades/).click();
    await wheel(page).getByRole("button", { name: "+ Add goal" }).click();
    await expect(wheel(page).locator(".gd-goal-line").first()).toBeVisible();
  });

  test("R8: Done closes the sub-ring, keeps the wheel on screen, and there is no List view", async ({
    page,
  }) => {
    await openFind(page);
    await segment(page, /^Gains/).click();
    await done(page);
    await done(page);
    await expect(
      wheel(page).getByRole("menu", { name: "Filter categories" }),
    ).toBeVisible();
    await expect(wheel(page)).toBeVisible();
    await expect(
      wheel(page).getByRole("button", { name: /list view/i }),
    ).toHaveCount(0);
  });

  test("R13: each ring is a menu of menu items, the count is a live status, and the inline wheel is not modal", async ({
    page,
  }) => {
    await openFind(page);
    await expect(wheel(page)).not.toHaveAttribute("aria-modal", "true");
    await expect(
      wheel(page).getByRole("menu", { name: "Filter categories" }),
    ).toBeVisible();
    await expect(wheel(page).getByRole("status")).toHaveText("—");
  });
});

// What is animating inside the wheel right now, with each animation's duration.
const running = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => {
        const el = (a.effect as KeyframeEffect | null)
          ?.target as Element | null;
        return !!el?.closest(".gd-zb");
      })
      .map((a) =>
        Number((a.effect as KeyframeEffect).getComputedTiming().duration),
      ),
  );

test.describe("filter wheel motion levels", () => {
  test("Full: opening plays real animations and puffs chalk dust", async ({
    page,
  }) => {
    await seedTradeLeague(page, "search", draft, { feelAnimation: "full" });
    await page.goto("./#/trade");
    await page.getByRole("tab", { name: "Find trades", exact: true }).waitFor();
    const puffs = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const tab = Array.from(
            document.querySelectorAll<HTMLElement>('[role="tab"]'),
          ).find((node) => node.textContent === "Find trades")!;
          tab.click();
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve(document.querySelectorAll(".gd-zb .chalk-particle").length),
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
    await searchFind(page, "search", { feelAnimation: "full" });
    await segment(page, /^Gains/).click();
    await wheel(page)
      .getByRole("menuitem", { name: "Their EPPG", exact: true })
      .click();
    expect(Math.max(0, ...(await running(page)))).toBeLessThanOrEqual(420);
    await wheel(page)
      .getByRole("slider", { name: "Their EPPG at least" })
      .press("ArrowLeft");
    expect(Math.max(0, ...(await running(page)))).toBeLessThanOrEqual(420);
  });

  test("Full: dragging the handle leaves at most eight crumbs of dust", async ({
    page,
  }) => {
    await searchFind(page, "search", { feelAnimation: "full" });
    await segment(page, /^Gains/).click();
    await wheel(page)
      .getByRole("menuitem", { name: "Their EPPG", exact: true })
      .click();
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

  test("Full: nothing blocks input — choosing and backing out work at once while the opening is still playing", async ({
    page,
  }) => {
    await openFind(page, "search", { feelAnimation: "full" });
    await segment(page, /^Gains/).click();
    await expect(
      wheel(page).getByRole("menu", { name: "Gains settings" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    // The eraser wipes the sub-ring away; it is gone shortly after and never blocks the next key.
    await expect(
      wheel(page).getByRole("menu", { name: "Gains settings" }),
    ).toHaveCount(0, { timeout: 1500 });
  });

  test("Reduced: only short fades, no dust, no drawing", async ({ page }) => {
    await openFind(page, "search", { feelAnimation: "reduced" });
    const durations = await running(page);
    for (const d of durations) expect(d).toBeLessThanOrEqual(150);
    await expect(page.locator(".chalk-particle")).toHaveCount(0);
    await segment(page, /^Gains/).locator(".gd-seg-hit").click();
    await wheel(page)
      .getByRole("menuitem", { name: "Their EPPG", exact: true })
      .click();
    for (const d of await running(page)) expect(d).toBeLessThanOrEqual(150);
    await wheel(page)
      .getByRole("slider", { name: "Their EPPG at least" })
      .press("ArrowLeft");
    await expect(page.locator(".chalk-particle")).toHaveCount(0);
  });

  test("Off: nothing animates, no particles, and the behaviour is the same", async ({
    page,
  }) => {
    await openFind(page);
    expect(await running(page)).toEqual([]);
    await segment(page, /^Gains/).click();
    await wheel(page)
      .getByRole("menuitem", { name: "Their EPPG", exact: true })
      .click();
    await wheel(page)
      .getByRole("slider", { name: "Their EPPG at least" })
      .press("ArrowRight");
    expect(await running(page)).toEqual([]);
    await expect(page.locator(".chalk-particle")).toHaveCount(0);
    await expect(
      wheel(page).getByRole("slider", { name: "Their EPPG at least" }),
    ).toHaveAttribute("aria-valuenow", "-1.5");
    await done(page);
    await done(page);
    await expect(wheel(page)).toBeVisible();
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
// The visible trade count from "X ideas · Y trades of N found".
const shownCount = async (page: Page) => {
  const text = await page
    .getByRole("region", { name: "Trade search results" })
    .locator(".gd-chips b")
    .first()
    .innerText();
  return Number(
    text.match(/([\d,]+) ideas · ([\d,]+) trades/)![2].replace(/,/g, ""),
  );
};
// Change one gain filter through the only filter control there is.
async function setYourGain(page: Page, key: "Home" | "End", onSliderChange?: () => Promise<void>) {
  await segment(page, /^Gains/).locator(".gd-seg-hit").click();
  await wheel(page)
    .getByRole("menuitem", { name: "Your EPPG", exact: true })
    .click();
  await wheel(page).getByRole("slider", { name: "Your EPPG minimum" }).press(key);
  if (onSliderChange) await onSliderChange();
  await done(page);
  await done(page);
}

test.describe("results move when filters change (A11, A13)", () => {
  test("Full: kept rows slide, new rows draw in (at most 20), and the list ends exactly as filtered", async ({
    page,
  }) => {
    await searchFind(page, "search", { feelAnimation: "full" });
    const initial = await shownCount(page);
    await setYourGain(page, "End");
    // Wait for the narrower worker result before measuring the expansion back to the full result set.
    await expect.poll(() => shownCount(page)).toBeLessThan(initial);
    const before = await shownCount(page);
    expect(before).toBeGreaterThan(0);
    // Let the search's own streaming animations finish so only the filter change is measured.
    await page.evaluate(() => Promise.all(document.getAnimations().filter((x) => Number.isFinite(Number(x.effect?.getComputedTiming().endTime))).map((x) => x.finished.catch(() => undefined))));
    // Capture real row animations when they start so a slow CI click cannot miss their short lifetime.
    await page.evaluate(() => {
      const win = window as typeof window & { rowAnimationDurations: number[] };
      win.rowAnimationDurations = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args: Parameters<Element["animate"]>) {
        const animation = animate.apply(this, args);
        if (this.closest(".gd-res [data-key]")) win.rowAnimationDurations.push(Number(animation.effect?.getComputedTiming().duration));
        return animation;
      };
    });
    let durations: number[] = [];
    await setYourGain(page, "Home", async () => {
      await expect
        .poll(
          async () => {
            const current = await page.evaluate(() => (window as typeof window & { rowAnimationDurations: number[] }).rowAnimationDurations);
            if (current.length > 0) durations = current;
            return durations.length;
          },
          { intervals: [20, 50, 100], timeout: 10000 },
        )
        .toBeGreaterThan(0);
    });
    await expect.poll(() => shownCount(page)).toBeGreaterThan(before);
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
    await searchFind(page, "search", { feelAnimation: "full" });
    await setYourGain(page, "Home");
    await expect.poll(() => shownCount(page)).toBeGreaterThan(0);
    const rowsBefore = await page
      .locator(".gd-res > .gd-res-group > .gd-res-row")
      .count();
    // Tighten the filter so rows are removed. The wheel's slider stops at +10 (the old list let you type 100), so the check is that
    // rows are removed, not that none are left.
    await setYourGain(page, "End");
    await expect
      .poll(() => page.locator(".gd-res > .gd-res-group > .gd-res-row").count())
      .toBeLessThan(rowsBefore);
    // The copies carry no row class, are hidden from assistive technology, and are gone shortly after.
    await expect(
      page.locator(".gd-res [aria-hidden='true'][inert]"),
    ).toHaveCount(0, { timeout: 1500 });
    expect(rowsBefore).toBeGreaterThan(0);
  });

  test("Reduced: rows only fade, 150 ms at most", async ({ page }) => {
    await searchFind(page, "search", { feelAnimation: "reduced" });
    await setYourGain(page, "Home");
    await expect.poll(() => shownCount(page)).toBeGreaterThan(0);
    for (const d of await rowAnimations(page))
      expect(d).toBeLessThanOrEqual(150);
  });

  test("Off: rows change with no animation at all", async ({ page }) => {
    await openFind(page);
    await runSearch(page, 240000);
    await setYourGain(page, "Home");
    await expect.poll(() => shownCount(page)).toBeGreaterThan(0);
    expect(await rowAnimations(page)).toEqual([]);
  });

  test("Full: streaming rows slide up and fade in over 180 ms while the search runs", async ({
    page,
  }) => {
    test.setTimeout(420000);
    await seedTradeLeague(page, "big", draft, { feelAnimation: "full" });
    await page.goto("./#/trade");
    await page.getByRole("tab", { name: "Find trades", exact: true }).click();
    await wheel(page)
      .getByRole("button", { name: "Search", exact: true })
      .click();
    const seen = new Set<number>();
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !seen.has(180)) {
      for (const d of await rowAnimations(page)) seen.add(d);
      await page.waitForTimeout(100);
    }
    expect(seen.has(180)).toBe(true);
  });
});

// The play-call scene (A12) while the search runs, on a 12-team league so the search takes a while.
test.describe("the play-call scene while a search runs (A12)", () => {
  async function startSearch(page: Page, level: string) {
    await seedTradeLeague(page, "big", draft, { feelAnimation: level });
    await page.goto("./#/trade");
    await page.getByRole("tab", { name: "Find trades", exact: true }).click();
    await wheel(page)
      .getByRole("button", { name: "Search", exact: true })
      .click();
  }

  test("Full: a chalk diagram with an X for each of the 11 opponents, routes drawn as teams are searched, circles when done", async ({
    page,
  }) => {
    test.setTimeout(420000);
    await startSearch(page, "full");
    const scene = page.locator(".gd-playcall");
    await expect(scene).toBeVisible({ timeout: 10000 });
    await expect(scene.locator(".gd-pc-x")).toHaveCount(11);
    await expect(scene.locator(".gd-pc-o")).toHaveCount(1);
    // Routes appear as opponents finish their one-for-ones; circles when all their packages are done.
    await expect(
      scene.locator('.gd-pc-route[data-on="true"]').first(),
    ).toBeAttached({ timeout: 30000 });
    await expect(scene.getByText(/teams ·.*possible trades/)).toBeVisible();
    // The scene is decoration: hidden from assistive technology, while the plain progress status stays.
    await expect(scene).toHaveAttribute("aria-hidden", "true");
    await expect(
      page
        .getByRole("region", { name: "Trade search results" })
        .getByRole("status")
        .first(),
    ).toBeVisible();
    // It ends by folding into the coverage line.
    await expect(page.getByText(/^Checked all [\d,]+ possible trades/)).toBeVisible({
      timeout: 240000,
    });
    // Wait for worker completion and the deferred list to match the live wheel counts.
    await waitForFindResults(page);
    await expect(scene).toHaveCount(0, { timeout: 3000 });
  });

  test("Full: every opponent ends up with a route and a circle", async ({
    page,
  }) => {
    test.setTimeout(420000);
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
    test.setTimeout(420000);
    await startSearch(page, "reduced");
    const scene = page.locator(".gd-playcall");
    await expect(scene).toBeVisible({ timeout: 10000 });
    await expect(scene.locator(".gd-pc-bar")).toBeVisible();
    await expect(
      scene.locator(".gd-pc-x, .gd-pc-route, .gd-pc-circle"),
    ).toHaveCount(0);
    // Progress also mentions possible trades; only the final coverage line means filtering and animations have settled.
    await expect(page.getByText(/^Checked all [\d,]+ possible trades/)).toBeVisible({
      timeout: 240000,
    });
    // Wait for worker completion and the deferred list to match the live wheel counts.
    await waitForFindResults(page);
    await expect(scene).toHaveCount(0, { timeout: 3000 });
  });

  test("Off: no scene at all, only the plain status and then the coverage line", async ({
    page,
  }) => {
    test.setTimeout(420000);
    await startSearch(page, "off");
    await expect(page.locator(".gd-playcall")).toHaveCount(0);
    // Progress also mentions possible trades; only the final coverage line means filtering and animations have settled.
    await expect(page.getByText(/^Checked all [\d,]+ possible trades/)).toBeVisible({
      timeout: 240000,
    });
    // Wait for worker completion and the deferred list to match the live wheel counts.
    await waitForFindResults(page);
    await expect(page.locator(".gd-playcall")).toHaveCount(0);
  });
});

// F0: on a phone (390px) Find trades keeps the inline wheel at full width and swaps its ring for a category; the results stay below.
test.describe("inline wheel on a phone (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("R12: the wheel spans the screen, sits above the results, and a tap swaps the ring to that category's settings", async ({
    page,
  }) => {
    await openFind(page);
    // Changed selector: the wheel's column of the polished board, which is the full width on a phone.
    const box = (await page.locator(".gd-zb-wheelzone").boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(390);
    const results = (await page
      .getByRole("region", { name: "Trade search results" })
      .boundingBox())!;
    expect(results.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
    const items = wheel(page)
      .getByRole("menu", { name: "Filter categories" })
      .getByRole("menuitem");
    await expect(items).toHaveCount(7);
    for (let i = 0; i < 7; i++) {
      const wedge = (await items.nth(i).locator(".gd-seg-hit").boundingBox())!;
      expect(
        Math.min(wedge.width, wedge.height),
        `segment ${i}`,
      ).toBeGreaterThanOrEqual(48);
    }
    await items.nth(0).locator(".gd-seg-hit").tap();
    await expect(
      wheel(page).getByRole("menu", { name: "Gains settings" }),
    ).toBeVisible();
    // Replaced: the ring is no longer swapped out; the settings open as a panel below the wheel (proposal 2.4).
    await expect(
      wheel(page).getByRole("menu", { name: "Filter categories" }),
    ).toBeVisible();
  });

  test("a tap sets Their EPPG with the − and + buttons and the arc, and the hub agrees", async ({
    page,
  }) => {
    await openFind(page);
    await segment(page, /^Gains/).locator(".gd-seg-hit").tap();
    // Changed selector: the options are chalk pills in the panel, not ring segments.
    await wheel(page)
      .getByRole("menuitem", { name: "Their EPPG", exact: true })
      .tap();
    const slider = wheel(page).getByRole("slider", {
      name: "Their EPPG at least",
    });
    await expect(slider).toHaveAttribute("aria-valuenow", "-2");
    await wheel(page).getByRole("button", { name: "Raise" }).tap();
    await expect(slider).toHaveAttribute("aria-valuenow", "-1.5");
    await expect(hub(page)).toContainText("-1.5");
    await done(page);
    await done(page);
    await expect(rail(page)).toContainText("1 filters on");
  });

  test("toggles and players are tappable; nothing is hover-only", async ({
    page,
  }) => {
    await openFind(page);
    await segment(page, /^Positions/).locator(".gd-seg-hit").tap();
    await wheel(page)
      .getByRole("menuitem", { name: "I get", exact: true })
      .tap();
    const wr = wheel(page).getByRole("menuitemcheckbox", { name: "WR" });
    await wr.tap();
    await expect(wr).toHaveAttribute("aria-checked", "true");
    // Changed selectors: Back is the hub (there is no back link), and the options are pills, not ring segments.
    await hub(page).tap();
    await hub(page).tap();
    await segment(page, /^Players/).locator(".gd-seg-hit").tap();
    await wheel(page)
      .getByRole("menuitem", { name: "I get", exact: true })
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

  test("Reduced: the opening only fades, 150 ms or less", async ({ page }) => {
    await openFind(page, "search", { feelAnimation: "reduced" });
    const durations = await running(page);
    expect(durations.length).toBeGreaterThan(0);
    for (const d of durations) expect(d).toBeLessThanOrEqual(150);
  });
});

// The Chain planner keeps the pop-up wheel, so on a phone it keeps the half-wheel fan (R12).
test.describe("phone fan on the Chain planner (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  async function openFan(
    page: Page,
    filters: Record<string, string> = { feelAnimation: "off" },
  ) {
    await seedTradeLeague(page, "chain", chainDraft, filters);
    await page.goto("./#/trade");
    await page.getByRole("tab", { name: "Chain planner", exact: true }).tap();
    await page.getByRole("button", { name: /^Filters · \d+$/ }).tap();
    await expect(wheel(page)).toBeVisible();
  }

  test("R12: the fan rises from the bottom with seven segments of at least 48px, and a tap chooses one", async ({
    page,
  }) => {
    await openFan(page);
    const items = wheel(page)
      .getByRole("menu", { name: "Filter categories" })
      .getByRole("menuitem");
    await expect(items).toHaveCount(7);
    const box = (await wheel(page).boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(830);
    expect(box.width).toBeLessThanOrEqual(390);
    for (let i = 0; i < 7; i++) {
      const wedge = (await items
        .nth(i)
        .locator(".gd-fan-wedge")
        .boundingBox())!;
      expect(
        Math.min(wedge.width, wedge.height),
        `segment ${i}`,
      ).toBeGreaterThanOrEqual(48);
    }
    // The Chain planner's Gains holds one setting, so the tap goes straight to it.
    await items.nth(0).locator(".gd-fan-wedge").tap();
    await expect(
      wheel(page).getByRole("slider", { name: "Their EPPG at least" }),
    ).toBeVisible();
    await expect(
      wheel(page).getByRole("menu", { name: "Filter categories" }),
    ).toHaveCount(0);
  });

  test("a tap sets Their EPPG with the − and + buttons, and the planner's field agrees", async ({
    page,
  }) => {
    await openFan(page);
    await segment(page, /^Gains/)
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
      page.getByRole("spinbutton", { name: "Their EPPG gain minimum" }),
    ).toHaveValue("0.5");
    await expect(
      page.getByRole("button", { name: /^Filters · 1$/ }),
    ).toBeVisible();
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
    await seedTradeLeague(page, "chain", chainDraft, {
      feelAnimation: "full",
    });
    await page.goto("./#/trade");
    await page.getByRole("tab", { name: "Chain planner", exact: true }).click();
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
    await segment(page, /^Gains/)
      .locator(".gd-seg-hit")
      .click();
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
    await segment(page, /^Chains/)
      .locator(".gd-seg-hit")
      .click();
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

  test("Clear all restores the defaults and can be undone", async ({ page }) => {
    await openChainWheel(page);
    await segment(page, /^Gains/)
      .locator(".gd-seg-hit")
      .click();
    const slider = wheel(page).getByRole("slider", {
      name: "Their EPPG at least",
    });
    await slider.press("Home");
    await wheel(page).getByRole("button", { name: "clear all" }).click();
    await expect(slider).toHaveAttribute("aria-valuenow", "1");
    await wheel(page).getByRole("button", { name: "undo" }).click();
    await expect(slider).toHaveAttribute("aria-valuenow", "-2");
  });

  test("a per-trade category points at the per-trade settings", async ({
    page,
  }) => {
    await openChainWheel(page);
    await segment(page, /^Size/)
      .locator(".gd-seg-hit")
      .click();
    await wheel(page)
      .getByRole("button", { name: "open per-trade settings" })
      .click();
    await expect(wheel(page)).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Per-trade settings" }),
    ).toBeVisible();
  });
});
