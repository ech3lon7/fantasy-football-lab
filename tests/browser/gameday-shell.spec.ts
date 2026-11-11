import { test, expect } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

// Turn the preview on from Data & account, then return to the page under test.
async function enablePreview(page: import("@playwright/test").Page) {
  await seedLabelWhy(page);
  await page.goto("./#/data");
  await page.getByLabel("Use the Gameday Plus preview").check();
}

// The preview shell replaces the sidebar with six sections, and old routes light the right tab.
test("six-section header replaces the sidebar and old routes keep working", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await enablePreview(page);
  await expect(page.locator("aside.sidebar")).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link")).toHaveText([
    "This week",
    "Roster",
    "Scouting",
    "League",
    "Trade room",
    "Lab",
  ]);
  // The tabs sit on one row beside each other, not stacked like the old sidebar.
  const tops = await nav
    .getByRole("link")
    .evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().top)),
    );
  expect(new Set(tops).size).toBe(1);
  // Data & account sits under Lab.
  await expect(nav.getByRole("link", { name: "Lab" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  for (const [hash, label, heading] of [
    ["#/gems", "Scouting", "Filters"],
    ["#/teams", "League", "League grades"],
    ["#/trades", "Trade room", "Trade room"],
    ["#/overview", "This week", ""],
  ] as const) {
    await page.goto(`./${hash}`);
    await expect(nav.getByRole("link", { name: label })).toHaveAttribute(
      "aria-current",
      "page",
    );
    if (heading)
      await expect(
        page.getByRole("heading", { name: heading }).first(),
      ).toBeVisible();
  }
  // The new section routes render the screens that exist today.
  await nav.getByRole("link", { name: "Scouting" }).click();
  await expect(
    page.getByRole("heading", { name: "Filters" }).first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

// The header keeps source freshness visible and live player search opens the player's evaluation.
test("header shows source freshness and searches players with the keyboard", async ({
  page,
}) => {
  await enablePreview(page);
  await page.goto("./#/overview");
  await expect(page.locator(".gd-fresh")).toContainText(/Source|unavailable/);
  const search = page.getByRole("combobox", { name: "Search any player" });
  await search.fill("zzzz-no-such-player");
  await expect(page.getByText("No players match.")).toBeVisible();
  await search.fill("synthetic");
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options.first()).toBeVisible();
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page).toHaveURL(/#\/player\/\d+/);
});

// Feel settings are independent and animation publishes one effective level on the root.
test("Feel menu sets the animation level and closes with Escape", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enablePreview(page);
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-animation", "reduced");
  await page.getByRole("button", { name: "Feel", exact: true }).click();
  const group = page.getByRole("group", { name: "Animation" });
  await group.getByRole("button", { name: "Full" }).click();
  await expect(root).toHaveAttribute("data-animation", "full");
  await group.getByRole("button", { name: "Off" }).click();
  await expect(root).toHaveAttribute("data-animation", "off");
  await page.reload();
  await expect(root).toHaveAttribute("data-animation", "off");
  await page.getByRole("button", { name: "Feel", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Feel settings" })).toHaveCount(
    0,
  );
  // Turning the preview off restores the current sidebar interface.
  await page.goto("./#/data");
  await page.getByLabel("Use the Gameday Plus preview").uncheck();
  await expect(page.locator("aside.sidebar")).toHaveCount(1);
  await expect(root).not.toHaveAttribute("data-animation", /.*/);
});
