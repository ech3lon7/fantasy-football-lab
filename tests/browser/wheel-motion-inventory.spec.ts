import { waitForFindResults } from "./trade-workspace-helpers";
import { test, expect, type Page } from "@playwright/test";
import { seedTradeLeague } from "./trade-seed";

// The motion inventory of the filter wheel polish (docs/filter-wheel-polish-proposal.md section 2.7, M1 to M26; M24 is a CSS mask and
// is excepted). At Full every interaction starts at least one animation on an element marked data-motion="M<n>". At Reduced every
// such animation is 150 ms or less, and at Off none runs. Animations are recorded as they start, so even the short ones are seen.

const draft = { teamA: "1", teamB: "2", give: ["101"], get: [] };
type Seen = { ids: string | null; dur: number; delay: number; state: string };

const board = (page: Page) => page.getByRole("dialog", { name: "Trade filters" });
const rail = (page: Page) => board(page).locator('[data-zone="rail"]');
const right = (page: Page) => board(page).locator('[data-zone="right"]');
const hub = (page: Page) => board(page).locator(".gd-zb-hub");
const segment = (page: Page, name: RegExp | string) => board(page).getByRole("menuitem", { name }).locator(".gd-seg-hit");

const recorder = () => {
  const original = Element.prototype.animate;
  (window as unknown as { __seen: Seen[] }).__seen = [];
  Element.prototype.animate = function (this: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
    const animation = original.call(this, keyframes, options);
    const host = this.closest("[data-motion]");
    const opts = typeof options === "number" ? { duration: options } : (options ?? {});
    (window as unknown as { __seen: Seen[] }).__seen.push({
      ids: host?.getAttribute("data-motion") ?? null,
      dur: Number(opts.duration ?? 0),
      delay: Number(opts.delay ?? 0),
      state: animation.playState,
    });
    return animation;
  };
};
const clear = (page: Page) => page.evaluate(() => { (window as unknown as { __seen: Seen[] }).__seen = []; });
const seen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: Seen[] }).__seen);
const withId = (list: Seen[], id: string) => list.filter((s) => (s.ids ?? "").split(/\s+/).includes(id));

async function open(page: Page, feel: string, which: "search" | "big" = "search", width = 1320, height = 1000) {
  await page.addInitScript(recorder);
  await page.setViewportSize({ width, height });
  await seedTradeLeague(page, which, draft, { feelAnimation: feel });
  await page.goto("./#/trade");
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await expect(board(page)).toBeVisible();
  // The opening (M1) plays when the tab first shows; let it end so each test measures only its own interaction.
  await page.waitForTimeout(feel === "full" ? 1600 : 300);
  await clear(page);
}

// Do one interaction and require at least one running animation tied to the expected M-id.
async function expectMotion(page: Page, id: string, act: () => Promise<unknown>) {
  await clear(page);
  await act();
  await expect.poll(async () => withId(await seen(page), id).length, { message: `${id} started an animation`, timeout: 3000 }).toBeGreaterThan(0);
  const started = withId(await seen(page), id);
  expect(started.some((s) => s.state === "running" || s.state === "pending"), `${id} is running`).toBe(true);
  for (const s of started) expect(s.dur, `${id} lasts 420 ms or less`).toBeLessThanOrEqual(420);
}

test.describe("Full: every interaction animates", () => {
  test("M1: the tab shows, the board draws in and the rail is written", async ({ page }) => {
    await page.addInitScript(recorder);
    await page.setViewportSize({ width: 1320, height: 1000 });
    await seedTradeLeague(page, "search", draft, { feelAnimation: "full" });
    await page.goto("./#/trade");
    await clear(page);
    await page.getByRole("tab", { name: "Find trades", exact: true }).click();
    await expect.poll(async () => withId(await seen(page), "M1").length).toBeGreaterThan(8);
    await expect(rail(page).locator('[data-motion~="M1"]').first()).toBeVisible();
  });

  test("M2: focusing or hovering a segment sweeps its hatch", async ({ page }) => {
    await open(page, "full");
    await expectMotion(page, "M2", () => board(page).getByRole("menuitem", { name: /^Players/ }).focus());
    await expectMotion(page, "M2", () => board(page).getByRole("menuitem", { name: /^Teams/ }).hover());
  });

  test("M3: choosing a segment pulses it, dims the others, draws the arrow and writes the options", async ({ page }) => {
    await open(page, "full");
    await expectMotion(page, "M3", () => segment(page, /^Gains/).click());
    const kinds = withId(await seen(page), "M3");
    expect(kinds.length).toBeGreaterThanOrEqual(6);
  });

  test("M4: choosing another segment erases the old options first", async ({ page }) => {
    await open(page, "full");
    await segment(page, /^Gains/).click();
    await page.waitForTimeout(900);
    await expectMotion(page, "M4", () => segment(page, /^Positions/).click());
  });

  test("M5: toggling an option scribbles a check and tweens hides", async ({ page }) => {
    await open(page, "full");
    await segment(page, /^Positions/).click();
    await right(page).getByRole("menuitem", { name: "I get" }).click();
    await page.waitForTimeout(900);
    await expectMotion(page, "M5", () => right(page).getByRole("menuitemcheckbox", { name: "WR" }).click());
    await expectMotion(page, "M5", () => right(page).getByRole("menuitemcheckbox", { name: "WR" }).click());
  });

  test("M6: a Gains choice redraws its pill and the slider route", async ({ page }) => {
    await open(page, "full");
    await segment(page, /^Gains/).click();
    await page.waitForTimeout(900);
    await expectMotion(page, "M6", () => right(page).getByRole("menuitem", { name: "Their EPPG", exact: true }).click());
    await expectMotion(page, "M6", () => right(page).getByRole("menuitem", { name: "Your MPPG", exact: true }).click());
  });

  test("M7: a slider step squashes the handle, rolls the value and tweens hides; an end stop thunks", async ({ page }) => {
    await open(page, "full");
    await segment(page, /^Gains/).click();
    await right(page).getByRole("menuitem", { name: "Their EPPG", exact: true }).click();
    await page.waitForTimeout(900);
    const slider = board(page).getByRole("slider", { name: "Their EPPG at least" });
    await slider.focus();
    await expectMotion(page, "M7", () => slider.press("ArrowRight"));
    await expectMotion(page, "M7", () => slider.press("Home"));
    const ends = withId(await seen(page), "M7").map((s) => s.dur);
    expect(ends).toContain(100);
  });

  test("M8: switching MIN and MAX pulses the active handle's ring", async ({ page }) => {
    await open(page, "full");
    await segment(page, /^Gains/).click();
    await right(page).getByRole("menuitem", { name: "Your EPPG", exact: true }).click();
    await page.waitForTimeout(900);
    await expectMotion(page, "M8", () => right(page).locator(".gd-value-card").getByRole("button", { name: "MIN" }).click());
  });

  test("M9: opening a panel draws its border, writes its heading and slides its rows in", async ({ page }) => {
    await open(page, "full");
    await segment(page, /^Players/).click();
    await page.waitForTimeout(900);
    await expectMotion(page, "M9", () => right(page).getByRole("menuitem", { name: "I get", exact: true }).click());
    expect(withId(await seen(page), "M9").length).toBeGreaterThanOrEqual(3);
  });

  test("M10: typing in a panel search moves, drops and adds rows", async ({ page }) => {
    await open(page, "full");
    await segment(page, /^Players/).click();
    await right(page).getByRole("menuitem", { name: "I get", exact: true }).click();
    await page.waitForTimeout(1000);
    await expectMotion(page, "M10", () => right(page).getByRole("searchbox", { name: "Search players" }).fill("Search WR 1"));
  });

  test("M11: focusing or hovering a player row sweeps an underline and lifts the photo", async ({ page }) => {
    await open(page, "full");
    await segment(page, /^Never trade/).click();
    await page.waitForTimeout(1000);
    await expectMotion(page, "M11", () => right(page).locator(".gd-prow").nth(1).hover());
    await expectMotion(page, "M11", () => right(page).locator(".gd-prow").nth(2).focus());
  });

  test("M12: selecting and unselecting a player scribbles a check and sweeps a hatch", async ({ page }) => {
    await open(page, "full");
    await segment(page, /^Never trade/).click();
    await page.waitForTimeout(1000);
    await expectMotion(page, "M12", () => right(page).locator(".gd-prow").first().click());
    await expectMotion(page, "M12", () => right(page).locator(".gd-prow").first().click());
  });

  test("M13: adding, changing and removing a grade goal write, roll and erase", async ({ page }) => {
    await open(page, "full");
    await segment(page, /^Grades/).click();
    await page.waitForTimeout(1000);
    await expectMotion(page, "M13", () => right(page).getByRole("button", { name: "+ Add goal" }).click());
    await page.waitForTimeout(500);
    await expectMotion(page, "M13", () => right(page).getByRole("combobox", { name: "Position" }).first().selectOption("WR"));
    await page.waitForTimeout(500);
    await expectMotion(page, "M13", () => right(page).getByRole("button", { name: "Remove positional goal" }).first().click());
  });

  test("M14: Back from the hub, Esc, Backspace or a click outside erases the right zone and un-dims the ring", async ({ page }) => {
    await open(page, "full");
    for (const how of ["hub", "escape", "backspace", "outside"] as const) {
      await segment(page, /^Gains/).click();
      await page.waitForTimeout(900);
      await expectMotion(page, "M14", async () => {
        if (how === "hub") await hub(page).click();
        else if (how === "escape") await page.keyboard.press("Escape");
        else if (how === "backspace") await page.keyboard.press("Backspace");
        else await page.mouse.click(2, 300);
      });
      await page.waitForTimeout(500);
    }
  });

  test("M15: the team chooser writes the teams in, circles the pick and erases the list", async ({ page }) => {
    await open(page, "full");
    await expectMotion(page, "M15", () => rail(page).getByRole("button", { name: /^for Test A/ }).click());
    await page.waitForTimeout(700);
    await expectMotion(page, "M15", () => rail(page).getByRole("option", { name: "Test B" }).click());
  });

  test("M16 to M18: Search redraws its circle and morphs to CANCEL, the play call runs, then folds into the coverage line", async ({ page }) => {
    // The 12-team search takes over a minute on a two-core CI runner.
    test.setTimeout(420000);
    await open(page, "full", "big");
    await clear(page);
    await rail(page).getByRole("button", { name: "Search", exact: true }).click();
    await expect.poll(async () => withId(await seen(page), "M16").length).toBeGreaterThan(1);
    await expect.poll(async () => withId(await seen(page), "M17").length, { timeout: 60000 }).toBeGreaterThan(2);
    await expect(page.getByText(/^Checked all [\d,]+ possible trades/)).toBeVisible({ timeout: 240000 });
    // Wait for worker completion and the deferred list to match the live wheel counts.
    await waitForFindResults(page);
    await expect.poll(async () => withId(await seen(page), "M18").length, { timeout: 5000 }).toBeGreaterThan(0);
    await expect.poll(async () => withId(await seen(page), "M22").length).toBeGreaterThan(0);
  });

  test("M19: Cancel erases the routes and morphs the label back", async ({ page }) => {
    test.setTimeout(420000);
    await open(page, "full", "big");
    await rail(page).getByRole("button", { name: "Search", exact: true }).click();
    await expect.poll(async () => withId(await seen(page), "M17").length, { timeout: 60000 }).toBeGreaterThan(0);
    await expectMotion(page, "M19", () => rail(page).getByRole("button", { name: "Cancel", exact: true }).click());
  });

  test("M20: Show all and Reset to defaults wipe the board and write the new values", async ({ page }) => {
    await open(page, "full");
    await expectMotion(page, "M20", () => rail(page).getByRole("button", { name: "Show all", exact: true }).click());
    await page.waitForTimeout(900);
    await expectMotion(page, "M20", () => rail(page).getByRole("button", { name: "Reset to defaults", exact: true }).click());
  });

  test("M21 and M22: counts roll, and the results move when a filter changes", async ({ page }) => {
    await open(page, "full");
    await rail(page).getByRole("button", { name: "Search", exact: true }).click();
    // Progress also mentions possible trades; only the final coverage line means filtering and animations have settled.
    await expect(page.getByText(/^Checked all [\d,]+ possible trades/)).toBeVisible({ timeout: 90000 });
    // Wait for worker completion and the deferred list to match the live wheel counts.
    await waitForFindResults(page);
    await page.waitForTimeout(1500);
    await clear(page);
    await rail(page).getByRole("button", { name: "Show all", exact: true }).click();
    await expect.poll(async () => withId(await seen(page), "M21").length).toBeGreaterThan(0);
    await expect.poll(async () => withId(await seen(page), "M22").length).toBeGreaterThan(0);
  });

  test("M23: Shift+Space taps the board and sweeps the focused hatch", async ({ page }) => {
    await open(page, "full");
    await page.locator("body").click({ position: { x: 2, y: 300 } });
    await expectMotion(page, "M23", () => page.keyboard.press("Shift+Space"));
    // The focused segment's hatch sweeps in as well (M2).
    expect(withId(await seen(page), "M2").length).toBeGreaterThan(0);
  });

  test("M25: on a phone the panel rises below the wheel, and drops on close", async ({ page }) => {
    await open(page, "full", "search", 390, 844);
    await expectMotion(page, "M25", () => segment(page, /^Gains/).click());
    await page.waitForTimeout(900);
    await expectMotion(page, "M25", () => page.keyboard.press("Escape"));
  });

  test("M26: a shortcut that is taken shakes its message and draws an underline", async ({ page }) => {
    await open(page, "full");
    await page.goto("./#/lab/keys");
    const row = page.getByText("Filter wheel shortcut", { exact: true }).locator("..");
    await row.getByRole("button", { name: "Change" }).click();
    await expectMotion(page, "M26", () => page.keyboard.press("Shift+ArrowUp"));
  });
});

test.describe("Reduced: every animation is a fade of 150 ms or less", () => {
  test("opening, choosing, toggling, a slider step, back, search and reset", async ({ page }) => {
    await open(page, "reduced", "search");
    await clear(page);
    await segment(page, /^Positions/).click();
    await right(page).getByRole("menuitem", { name: "I get" }).click();
    await right(page).getByRole("menuitemcheckbox", { name: "WR" }).click();
    await hub(page).click();
    await segment(page, /^Gains/).click();
    await right(page).getByRole("menuitem", { name: "Their EPPG", exact: true }).click();
    await board(page).getByRole("slider", { name: "Their EPPG at least" }).press("ArrowLeft");
    await page.mouse.click(2, 300);
    await rail(page).getByRole("button", { name: "Search", exact: true }).click();
    // Progress also mentions possible trades; only the final coverage line means filtering and animations have settled.
    await expect(page.getByText(/^Checked all [\d,]+ possible trades/)).toBeVisible({ timeout: 90000 });
    // Wait for worker completion and the deferred list to match the live wheel counts.
    await waitForFindResults(page);
    await rail(page).getByRole("button", { name: "Reset to defaults", exact: true }).click();
    const list = (await seen(page)).filter((s) => s.ids);
    expect(list.length).toBeGreaterThan(0);
    for (const s of list) {
      expect(s.dur + s.delay, JSON.stringify(s)).toBeLessThanOrEqual(150);
    }
  });
});

test.describe("Off: nothing animates", () => {
  test("the same interactions start no animation at all", async ({ page }) => {
    await open(page, "off", "search");
    await clear(page);
    await segment(page, /^Positions/).click();
    await right(page).getByRole("menuitem", { name: "I get" }).click();
    await right(page).getByRole("menuitemcheckbox", { name: "WR" }).click();
    await hub(page).click();
    await segment(page, /^Gains/).click();
    await right(page).getByRole("menuitem", { name: "Their EPPG", exact: true }).click();
    await board(page).getByRole("slider", { name: "Their EPPG at least" }).press("ArrowLeft");
    await page.mouse.click(2, 300);
    await rail(page).getByRole("button", { name: "Search", exact: true }).click();
    // Progress also mentions possible trades; only the final coverage line means filtering and animations have settled.
    await expect(page.getByText(/^Checked all [\d,]+ possible trades/)).toBeVisible({ timeout: 90000 });
    // Wait for worker completion and the deferred list to match the live wheel counts.
    await waitForFindResults(page);
    await rail(page).getByRole("button", { name: "Reset to defaults", exact: true }).click();
    expect((await seen(page)).filter((s) => s.ids)).toEqual([]);
    expect(await page.evaluate(() => document.getAnimations().filter((a) => a.effect && (a.effect as KeyframeEffect).target?.closest?.("[data-motion]")).length)).toBe(0);
  });
});
