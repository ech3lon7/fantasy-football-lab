import { test, expect, type Page } from "@playwright/test";
import { seedTradeLeague } from "./trade-seed";

// Acceptance tests of the filter wheel polish (docs/filter-wheel-polish-implementation-plan.md, R1 to R8): the board has a left rail,
// a display-only hub and a right zone. They are written against the new board's contract and must fail on 1.9.2.

const draft = { teamA: "1", teamB: "2", give: ["101"], get: [] };

const board = (page: Page) => page.getByRole("dialog", { name: "Trade filters" });
const rail = (page: Page) => board(page).locator('[data-zone="rail"]');
const ringZone = (page: Page) => board(page).locator('[data-zone="wheel"]');
const right = (page: Page) => board(page).locator('[data-zone="right"]');
const segment = (page: Page, name: RegExp | string) => board(page).getByRole("menuitem", { name }).locator(".gd-seg-hit");

async function open(page: Page, width = 1320, height = 1000, feel: Record<string, string> = { feelAnimation: "off" }, which: "search" | "big" = "search") {
  await page.setViewportSize({ width, height });
  await seedTradeLeague(page, which, draft, feel);
  await page.goto("./#/trade");
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await expect(board(page)).toBeVisible();
}
const search = async (page: Page) => {
  await rail(page).getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText(/possible trades/)).toBeVisible({ timeout: 90000 });
};
const boxOf = async (page: Page, selector: string) =>
  page.evaluate((s) => [...document.querySelectorAll(s)].map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }), selector);
const intersects = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test.describe("R1: the left rail", () => {
  test("holds the team chooser, SEARCH, the filters-on count, show all and reset, and none of them is in the wheel", async ({ page }) => {
    await open(page);
    await expect(rail(page).getByRole("button", { name: /^for Test A/ })).toBeVisible();
    await expect(rail(page).getByRole("button", { name: "Search", exact: true })).toBeVisible();
    await expect(rail(page).getByText(/^\d+ filters on$/)).toBeVisible();
    await expect(rail(page).getByRole("button", { name: "Show all", exact: true })).toBeVisible();
    await expect(rail(page).getByRole("button", { name: "Reset to defaults", exact: true })).toBeVisible();
    for (const name of ["Search", "Show all", "Reset to defaults"])
      await expect(ringZone(page).getByRole("button", { name, exact: true })).toHaveCount(0);
    await expect(ringZone(page).getByText(/filters on/)).toHaveCount(0);
    await expect(ringZone(page).locator("select")).toHaveCount(0);
  });

  test("the team chooser opens a chalk list in the rail and picking a team closes it", async ({ page }) => {
    await open(page);
    await rail(page).getByRole("button", { name: /^for Test A/ }).click();
    const list = rail(page).getByRole("listbox", { name: "Teams" });
    await expect(list).toBeVisible();
    await list.getByRole("option", { name: "Test B" }).click();
    await expect(list).toHaveCount(0);
    await expect(rail(page).getByRole("button", { name: /^for Test B/ })).toBeVisible();
  });

  test("SEARCH is at least 56px tall, reads CANCEL with a progress line while it runs, and returns to SEARCH", async ({ page }) => {
    // The 12-team search takes over a minute on a two-core CI runner.
    test.setTimeout(420000);
    await open(page, 1320, 1000, { feelAnimation: "off" }, "big");
    const button = rail(page).getByRole("button", { name: "Search", exact: true });
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(56);
    await button.click();
    await expect(rail(page).getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    await expect(rail(page).getByText(/searching… \d+ \/ \d+ teams/)).toBeVisible();
    await expect(page.getByText(/possible trades/)).toBeVisible({ timeout: 240000 });
    await expect(rail(page).getByRole("button", { name: "Search", exact: true })).toBeVisible();
  });

  test("show all and reset to defaults act on the filters from the rail", async ({ page }) => {
    await open(page);
    await rail(page).getByRole("button", { name: "Show all", exact: true }).click();
    await expect(rail(page).getByText(/^\d+ filters on$/)).toBeVisible();
    await rail(page).getByRole("button", { name: "Reset to defaults", exact: true }).click();
    await expect(rail(page).getByText("0 filters on")).toBeVisible();
  });
});

test.describe("R2: the hub is display-only", () => {
  test("it has no controls while idle, says 'pick a category', and names the category, its value and one hides line when one is open", async ({ page }) => {
    await open(page);
    const hub = ringZone(page).locator(".gd-zb-hub");
    await expect(hub).toContainText("pick a category");
    await expect(hub.locator("button, input, select, a")).toHaveCount(0);
    await segment(page, /^Gains/).click();
    await expect(hub.locator(".gd-zh-name")).toHaveText("GAINS");
    await expect(hub.locator(".gd-zh-value")).toBeVisible();
    await expect(hub.locator(".gd-zh-hides")).toHaveCount(1);
    await expect(hub.locator(".gd-zh-hides")).toContainText(/hides (\d+|—)/);
  });

  test("clicking the hub goes back one level", async ({ page }) => {
    await open(page);
    await segment(page, /^Gains/).click();
    await expect(right(page).getByRole("menu", { name: "Gains settings" })).toBeVisible();
    await ringZone(page).locator(".gd-zb-hub").click();
    await expect(right(page).getByRole("menu", { name: "Gains settings" })).toHaveCount(0);
  });

  for (const width of [1320, 390])
    test(`hub text never overlaps a segment label at ${width}px, and shrinks between 48px and 28px to fit`, async ({ page }) => {
      await open(page, width, width > 500 ? 1000 : 844);
      for (const category of [/^Gains/, /^Positions/, /^Teams/, /^Size/]) {
        await segment(page, category).click();
        const texts = await boxOf(page, '.gd-zb-hub .gd-zh-name, .gd-zb-hub .gd-zh-value, .gd-zb-hub .gd-zh-hides');
        const labels = await boxOf(page, ".gd-seg-label");
        for (const t of texts) for (const l of labels) expect(intersects(t, l), `${category}`).toBe(false);
        // The value's size is set in design pixels (--zb-fs) and scales with the wheel, so it is checked there.
        const size = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".gd-zb-hub")!).getPropertyValue("--zb-fs")));
        expect(size).toBeLessThanOrEqual(48);
        expect(size).toBeGreaterThanOrEqual(28);
        await ringZone(page).locator(".gd-zb-hub").click();
      }
    });
});

test.describe("R3 and R4: the right zone and the chalk look", () => {
  test("options are written in the right zone with a chalk arrow, and a check marks an option that is on", async ({ page }) => {
    await open(page);
    await segment(page, /^Positions/).click();
    const menu = right(page).getByRole("menu", { name: "Positions settings" });
    await expect(menu.getByRole("menuitem")).toHaveText(["I get", "I give", "Labels"]);
    await expect(board(page).locator(".gd-zb-arrow")).toHaveCount(1);
    await menu.getByRole("menuitem", { name: "I get" }).click();
    const toggles = right(page).getByRole("menu", { name: "I get options" });
    await toggles.getByRole("menuitemcheckbox", { name: "WR" }).click();
    await expect(toggles.getByRole("menuitemcheckbox", { name: "WR" })).toHaveAttribute("aria-checked", "true");
    await expect(toggles.getByRole("menuitemcheckbox", { name: "WR" }).locator(".gd-ctick")).toHaveCount(1);
  });

  test("a long list (teams) scrolls inside the zone and the board does not grow", async ({ page }) => {
    await open(page, 1320, 1000, { feelAnimation: "off" }, "big");
    const before = (await board(page).boundingBox())!.height;
    await segment(page, /^Teams/).click();
    await right(page).getByRole("menuitem", { name: "Opponents" }).click();
    const list = right(page).getByRole("menu", { name: "Opponents options" });
    await expect(list.getByRole("menuitemcheckbox")).toHaveCount(11);
    expect((await board(page).boundingBox())!.height).toBe(before);
    expect(await list.evaluate((el) => getComputedStyle(el).overflowY)).toMatch(/auto|scroll/);
  });

  test("panels are chalk: a dashed chalk border, a heading, and no navy app card anywhere on the board", async ({ page }) => {
    await open(page);
    await segment(page, /^Grades/).click();
    const panel = right(page).locator(".gd-chalk-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".gd-chalk-border")).toHaveCount(1);
    await expect(panel.getByRole("heading")).toBeVisible();
    await expect(board(page).locator(".gd-card")).toHaveCount(0);
    await panel.getByRole("button", { name: "+ Add goal" }).click();
    await expect(board(page).locator(".gd-card")).toHaveCount(0);
    for (const control of await panel.locator("select, input").all()) {
      const border = await control.evaluate((el) => { const s = getComputedStyle(el); return [s.borderTopWidth, s.borderBottomWidth]; });
      expect(border[0]).toBe("0px");
    }
  });

  test("the Gains slider's end labels sit outside the ring and never on a segment label", async ({ page }) => {
    await open(page);
    await segment(page, /^Gains/).click();
    await right(page).getByRole("menuitem", { name: "Your EPPG", exact: true }).click();
    const ends = await boxOf(page, ".gd-arc-end");
    const labels = await boxOf(page, ".gd-seg-label");
    expect(ends.length).toBeGreaterThanOrEqual(2);
    for (const e of ends) for (const l of labels) expect(intersects(e, l)).toBe(false);
    const ring = (await boxOf(page, ".gd-ring-outer"))[0];
    const centre = { x: ring.x + ring.w / 2, y: ring.y + ring.h / 2 };
    for (const e of ends)
      expect(Math.hypot(e.x + e.w / 2 - centre.x, e.y + e.h / 2 - centre.y)).toBeGreaterThan(ring.w / 2);
  });

  test("a number filter shows a value card in the right zone: click the value to type, − and + buttons at least 44px, and MIN/MAX for a range", async ({ page }) => {
    await open(page);
    await segment(page, /^Gains/).click();
    await right(page).getByRole("menuitem", { name: "Their EPPG", exact: true }).click();
    const card = right(page).locator(".gd-value-card");
    const lower = card.getByRole("button", { name: "Lower" });
    const raise = card.getByRole("button", { name: "Raise" });
    for (const b of [lower, raise]) {
      const box = (await b.boundingBox())!;
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    }
    await expect(card.getByRole("button", { name: /^MIN$|^MAX$/ })).toHaveCount(0);
    await lower.click();
    await expect(board(page).getByRole("slider", { name: "Their EPPG at least" })).toHaveAttribute("aria-valuenow", "0.5");
    await card.getByRole("button", { name: /Their EPPG value/ }).click();
    const input = card.getByRole("spinbutton", { name: "Exact value" });
    await input.fill("-1");
    await input.press("Enter");
    await expect(board(page).getByRole("slider", { name: "Their EPPG at least" })).toHaveAttribute("aria-valuenow", "-1");
    await card.getByRole("button", { name: /Their EPPG value/ }).click();
    await card.getByRole("spinbutton", { name: "Exact value" }).fill("5");
    await card.getByRole("spinbutton", { name: "Exact value" }).press("Enter");
    await expect(board(page).getByRole("slider", { name: "Their EPPG at least" })).toHaveAttribute("aria-valuenow", "1");
    await card.getByRole("button", { name: /Their EPPG value/ }).click();
    await card.getByRole("spinbutton", { name: "Exact value" }).fill("0");
    await card.getByRole("spinbutton", { name: "Exact value" }).press("Escape");
    await expect(board(page).getByRole("slider", { name: "Their EPPG at least" })).toHaveAttribute("aria-valuenow", "1");
    await right(page).getByRole("menuitem", { name: "Your EPPG", exact: true }).click();
    await expect(right(page).locator(".gd-value-card").getByRole("button", { name: "MIN" })).toBeVisible();
  });
});

test.describe("R5: player rows", () => {
  test("Never trade lists 52px rows with a 40px round photo, name, POS · NFL, EPPG and Surplus, best EPPG first", async ({ page }) => {
    await open(page);
    await segment(page, /^Never trade/).click();
    const rows = right(page).locator(".gd-prow");
    await expect(rows.first()).toBeVisible();
    const first = (await rows.first().boundingBox())!;
    expect(Math.round(first.height)).toBe(52);
    const photo = (await rows.first().locator(".gd-prow-photo").boundingBox())!;
    expect(Math.round(photo.width)).toBe(40);
    expect(Math.round(photo.height)).toBe(40);
    expect(await rows.first().locator(".gd-prow-photo").evaluate((el) => getComputedStyle(el).borderRadius)).toMatch(/50%|20px/);
    await expect(rows.first().locator(".gd-prow-name")).not.toBeEmpty();
    await expect(rows.first().locator(".gd-prow-meta")).toHaveText(/^[A-Z]{1,3} · [A-Z]{2,4}$|^[A-Z]{1,3} · —$/);
    const texts = await rows.evaluateAll((els) => els.map((el) => ({
      eppg: el.querySelector(".gd-prow-eppg")?.textContent ?? "",
      surplus: el.querySelector(".gd-prow-surplus")?.textContent ?? "",
    })));
    expect(texts.length).toBeGreaterThan(1);
    const numbers = texts.map((t) => { expect(t.eppg).toMatch(/^EPPG (—|-?\d+\.\d)$/); expect(t.surplus).toMatch(/^Surplus (—|-?\d+)$/); return t.eppg === "EPPG —" ? -Infinity : Number(t.eppg.slice(5)); });
    for (let i = 1; i < numbers.length; i++) expect(numbers[i]).toBeLessThanOrEqual(numbers[i - 1]);
    expect(await rows.first().locator(".gd-prow-eppg b, .gd-prow-surplus b").count()).toBeGreaterThanOrEqual(1);
  });

  test("a selected row gets a check and a hatch, and typing filters by name, position or team", async ({ page }) => {
    await open(page);
    await segment(page, /^Players/).click();
    await right(page).getByRole("menuitem", { name: "I get", exact: true }).click();
    const rows = right(page).locator(".gd-prow");
    const before = await rows.count();
    await rows.first().click();
    await expect(rows.first()).toHaveAttribute("aria-pressed", "true");
    await expect(rows.first().locator(".gd-ctick")).toHaveCount(1);
    await expect(rows.first().locator(".gd-prow-hatch")).toHaveCount(1);
    await right(page).getByRole("searchbox", { name: "Search players" }).fill("zzzz");
    // Only the selected row is kept: nothing else matches the typing.
    await expect(right(page).locator('.gd-prow[aria-pressed="false"]')).toHaveCount(0);
    await right(page).getByRole("searchbox", { name: "Search players" }).fill("");
    await expect(rows).toHaveCount(before);
  });
});

test.describe("R6: click outside closes the open category", () => {
  test("a click on empty chalk, or outside the board, closes it; Esc does too; the rail never does; nothing open means nothing happens", async ({ page }) => {
    await open(page);
    await expect(board(page)).toBeVisible();
    // Nothing is open: an outside click does nothing and the wheel stays.
    await page.mouse.click(2, 300);
    await expect(board(page)).toBeVisible();
    await expect(right(page).getByRole("menu")).toHaveCount(0);
    await segment(page, /^Gains/).click();
    await expect(right(page).getByRole("menu", { name: "Gains settings" })).toBeVisible();
    // The rail never closes it.
    await rail(page).getByText(/filters on/).click();
    await rail(page).getByRole("button", { name: /^for Test A/ }).click();
    await rail(page).getByRole("button", { name: /^for Test A/ }).click();
    await expect(right(page).getByRole("menu", { name: "Gains settings" })).toBeVisible();
    // Empty chalk inside the board.
    const frame = (await board(page).boundingBox())!;
    await page.mouse.click(frame.x + frame.width / 2, frame.y + 30);
    await expect(right(page).getByRole("menu", { name: "Gains settings" })).toHaveCount(0);
    // Outside the board.
    await segment(page, /^Gains/).click();
    await expect(right(page).getByRole("menu", { name: "Gains settings" })).toBeVisible();
    await page.mouse.click(2, 300);
    await expect(right(page).getByRole("menu", { name: "Gains settings" })).toHaveCount(0);
    // Esc.
    await segment(page, /^Gains/).click();
    await page.keyboard.press("Escape");
    await expect(right(page).getByRole("menu", { name: "Gains settings" })).toHaveCount(0);
  });

  test("clicks inside the right zone and the wheel's own segments do not close it", async ({ page }) => {
    await open(page);
    await segment(page, /^Positions/).click();
    await right(page).getByRole("menuitem", { name: "I get" }).click();
    await right(page).getByRole("menuitemcheckbox", { name: "WR" }).click();
    await expect(right(page).getByRole("menu", { name: "I get options" })).toBeVisible();
    await segment(page, /^Teams/).click();
    await expect(right(page).getByRole("menu", { name: "Teams settings" })).toBeVisible();
  });
});

test.describe("R7: phones", () => {
  test("rail rows sit above and below the wheel, and the right zone is a panel below it that the page scrolls to", async ({ page }) => {
    await open(page, 390, 844);
    const top = (await rail(page).locator('[data-rail="top"]').boundingBox())!;
    let wheel = (await ringZone(page).boundingBox())!;
    const bottom = (await rail(page).locator('[data-rail="bottom"]').boundingBox())!;
    expect(top.y + top.height).toBeLessThanOrEqual(wheel.y + 1);
    expect(bottom.y).toBeGreaterThanOrEqual(wheel.y + wheel.height - 1);
    await expect(rail(page).locator('[data-rail="top"]').getByRole("button", { name: "Search", exact: true })).toBeVisible();
    await expect(rail(page).locator('[data-rail="bottom"]').getByText(/filters on/)).toBeVisible();
    await segment(page, /^Gains/).click();
    const panel = right(page);
    await expect(panel.getByRole("menu", { name: "Gains settings" })).toBeVisible();
    // The page has scrolled to the panel, so both are measured again in the same scroll position.
    wheel = (await ringZone(page).boundingBox())!;
    const box = (await panel.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(wheel.y + wheel.height - 1);
    await expect.poll(async () => page.evaluate(() => { const r = document.querySelector('[data-zone="right"]')!.getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight; })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  });
});

test.describe("board width: three columns only when the board is at least 1248px wide, no horizontal overflow at any width", () => {
  for (const width of [1180, 1248, 1320, 1440])
    test(`${width}px`, async ({ page }) => {
      await open(page, width, 1000);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const frame = (await board(page).boundingBox())!;
      expect(frame.width).toBeLessThanOrEqual(1320);
      const w = (await ringZone(page).boundingBox())!;
      const z = await right(page).boundingBox();
      // Stacked, the rail has no box of its own (its rows are laid out around the wheel); in three columns it is the left column.
      const r = (frame.width >= 1248 ? await rail(page).boundingBox() : await rail(page).locator('[data-rail="top"]').boundingBox())!;
      if (frame.width >= 1248) {
        expect(Math.round(frame.height)).toBe(720);
        expect(Math.round(r.width)).toBe(240);
        expect(r.x + r.width).toBeLessThanOrEqual(w.x);
        expect(w.x + w.width).toBeLessThanOrEqual(z!.x + 1);
        expect(Math.round(z!.width)).toBe(360);
      } else {
        expect(r.y + r.height).toBeLessThanOrEqual(w.y + 1);
        expect(Math.round(w.width)).toBeLessThanOrEqual(560);
      }
      await segment(page, /^Gains/).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });
});

test.describe("R8: labels, count and empty text", () => {
  test("Your MPPG and Their MPPG replace Your week and Their week, with the hub explainer", async ({ page }) => {
    await open(page);
    await segment(page, /^Gains/).click();
    const menu = right(page).getByRole("menu", { name: "Gains settings" });
    await expect(menu.getByRole("menuitem")).toHaveText(["Your EPPG", "Their EPPG", "Your MPPG", "Their MPPG"]);
    await menu.getByRole("menuitem", { name: "Your MPPG" }).click();
    await expect(ringZone(page).locator(".gd-zb-hub")).toContainText("your lineup's MPPG change this week");
    await expect(board(page).getByText(/Your week|Their week/)).toHaveCount(0);
  });

  test("the count reads — before a search and shown / found after one", async ({ page }) => {
    await open(page);
    await expect(board(page).locator(".gd-wheel-count")).toHaveText("—");
    await search(page);
    await expect(board(page).locator(".gd-wheel-count")).toHaveText(/^[\d,]+ \/ [\d,]+$/);
  });

  test("the empty results text says Press Search", async ({ page }) => {
    await open(page);
    await expect(page.getByText("Press Search to check every legal trade for your team.")).toBeVisible();
    await expect(page.getByText(/Search all trades/)).toHaveCount(0);
  });
});
