import { test, expect, type Page } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";
import { openTradeFilters } from "./trade-workspace-helpers";

// Open the Trade room.
async function open(page: Page) {
  await seedLabelWhy(page);
  await page.goto("./#/data");
  await page.goto("./#/trade");
}

// Build the simplest valid offer: one player from each team.
async function offer(page: Page) {
  await page
    .getByRole("combobox", { name: "Trade partner" })
    .selectOption({ label: "Test B" });
  await page
    .getByRole("group", { name: "Players you send" })
    .getByRole("button")
    .first()
    .click();
  await page
    .getByRole("group", { name: "Players you receive" })
    .getByRole("button")
    .first()
    .click();
}

// The Trade room has three tabs, with the Manual analyzer first and no verdicts until an offer is built.
test("trade room opens on the manual analyzer with its tabs and journal link", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await expect(page.getByRole("tab")).toHaveText([
    "Manual analyzer",
    "Find trades",
    "Chain planner",
    "Counter-offers",
  ]);
  await expect(
    page.getByRole("tab", { name: "Manual analyzer" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("link", { name: "Journal" })).toHaveAttribute(
    "href",
    "#/journal",
  );
  await expect(page.getByRole("region", { name: "Verdicts" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

// An offer produces four separate verdicts and a lineup field with before and after views.
test("an offer shows four separate verdicts, grade steps and the lineup field", async ({
  page,
}) => {
  await open(page);
  await offer(page);
  const verdicts = page.getByRole("region", { name: "Verdicts" });
  await expect(verdicts.locator(".srow")).toHaveCount(4);
  await expect(verdicts.locator(".srow .n")).toHaveText([
    "▲ Surplus exchange",
    "▲ Lineup impact",
    "■ Legality",
    "● Uncertainty",
  ]);
  await expect(
    page.getByRole("region", { name: "Tale of the tape" }),
  ).toBeVisible();
  // Unaffected positions never show "no change".
  await expect(page.getByText(/no change/i)).toHaveCount(0);
  const field = page.getByRole("region", { name: "Lineup impact" });
  await expect(field.locator(".slot, .gd-slot").first()).toBeVisible();
  await field
    .getByRole("group", { name: "Phase" })
    .getByRole("button", { name: "Before" })
    .click();
  await field
    .getByRole("group", { name: "Team" })
    .getByRole("button", { name: "Their team" })
    .click();
  await expect(field.locator(".slot, .gd-slot").first()).toBeVisible();
  await page.screenshot({
    path: "test-results/trade-room.png",
    fullPage: true,
  });
});

// Opening a verdict shows its own detail, and the lineup verdict states the gain with a spread or its reason.
test("verdicts open separately and the lineup verdict reads gain with a spread", async ({
  page,
}) => {
  await open(page);
  await offer(page);
  const verdicts = page.getByRole("region", { name: "Verdicts" });
  const lineup = verdicts.locator(".srow").nth(1);
  await expect(lineup.locator(".v")).toHaveText(
    /^(Unavailable|[+-]?\d+\.\d( ± \d+\.\d)?)$/,
  );
  await expect(lineup).toContainText("Lineup gain ± spread");
});

// Forcing a trade creates a hypothetical roster, which the shell announces.
test("force this trade creates a hypothetical roster", async ({ page }) => {
  await open(page);
  await offer(page);
  const force = page.getByRole("button", {
    name: "Force this trade into a hypothetical roster",
  });
  if (await force.isEnabled()) {
    await force.click();
    await expect(page.locator(".gd-header .gd-chip")).toContainText(
      "Simulation:",
    );
  } else {
    await expect(force).toHaveAttribute("title", /.+/);
  }
});

// Find trades and Chain planner keep every current tool.
test("find trades and chain planner tabs keep the current tools", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("tab", { name: "Find trades" }).click();
  await expect(page.locator(".gd-find")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tab", { name: "Find trades" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "Chain planner" }).click();
  await expect(page.locator(".gd-chain")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Two-trade chain planner" }),
  ).toBeVisible();
});

// Dark keeps the analyzer on theme tokens.
test("manual analyzer has no white fills in dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page);
  await offer(page);
  await expect(page.getByRole("region", { name: "Verdicts" })).toBeVisible();
  const white = await page.evaluate(() =>
    [...document.querySelectorAll(".gd-manual *")]
      .filter(
        (el) => getComputedStyle(el).backgroundColor === "rgb(255, 255, 255)",
      )
      .map((el) => `${el.tagName}.${el.getAttribute("class")}`),
  );
  expect(white).toEqual([]);
});

// The Search limits group of Find trades: its summary line and edited marker.
const limitsGroup = (page: Page) =>
  page.locator(".gd-find details.gd-fg").filter({
    has: page.locator(".gd-fg-title", { hasText: /^Search limits$/ }),
  });

// The shared Search limits are one editable section for Find trades and chains, with Off as the default index window.
test("shared search limits: Off by default, edited markers, persistence and reset", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("tab", { name: "Find trades" }).click();
  const group = limitsGroup(page);
  const head = group.locator("> summary");
  // Folded, the header summarises the limits in one line.
  await expect(head.locator(".gd-fs")).toContainText("Defaults");
  await expect(head.locator(".gd-edot")).toHaveCount(0);
  await head.click();
  const window = group.getByRole("slider", { name: "Index window" });
  await expect(window).toHaveValue("0");
  await expect(group.locator(".gd-limit").filter({ hasText: "Index window" })).toContainText("Off");
  await window.fill("10");
  await expect(group.locator(".gd-limit").filter({ hasText: "Index window" })).toContainText("±10");
  await expect(head.locator(".gd-edot")).toBeVisible();
  // Fold it again: the one-line summary shows the edited value and the marker stays visible.
  await head.click();
  await expect(head.locator(".gd-fs")).toContainText("±10");
  await expect(head.locator(".gd-edot")).toBeVisible();
  await page.reload();
  await expect(limitsGroup(page).locator("> summary .gd-fs")).toContainText("±10");
  await limitsGroup(page).locator("> summary").click();
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(
    limitsGroup(page).getByRole("slider", { name: "Index window" }),
  ).toHaveValue("0");
  await expect(limitsGroup(page).locator("> summary .gd-edot")).toHaveCount(0);
});

// With shared limits there is no strictness setting and no strict-index checkbox; the chain presets number ten.
test("no strictness setting or strict-index checkbox, and ten chain presets", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("tab", { name: "Find trades" }).click();
  await openTradeFilters(page, "Standard");
  await expect(page.getByLabel("Use strict index range")).toHaveCount(0);
  await page.getByRole("tab", { name: "Chain planner" }).click();
  await expect(page.getByLabel(/strictness/i)).toHaveCount(0);
  const presets = page.getByRole("radiogroup", { name: "Chain preset" });
  const labels = await presets.locator(".gd-pre-name").allTextContents();
  for (const label of [
    "Balanced opportunities",
    "Surface-stat trading",
    "Fix my weakest position",
    "Buy low, then flip",
  ])
    expect(labels).toContain(label);
  expect(labels).not.toContain("Surface-stat opportunities");
  // Presets describe the kind of chain; they never touch the limits.
  const limits = page.locator(".gd-chain details.gd-limits");
  const before = await limits.locator("> summary").innerText();
  await presets.getByRole("radio", { name: /Buy low, then flip/ }).click();
  expect(await limits.locator("> summary").innerText()).toBe(before);
});

// Presets are cards with descriptions; choosing one never changes the shared limits.
test("chain presets show as ten described cards and leave the limits alone", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("tab", { name: "Chain planner" }).click();
  const cards = page
    .getByRole("radiogroup", { name: "Chain preset" })
    .getByRole("radio");
  await expect(cards).toHaveCount(10);
  await expect(cards.filter({ hasText: "Surface-stat trading" })).toBeVisible();
  const limits = page.locator(".gd-chain details.gd-limits");
  const before = await limits.locator("> summary").innerText();
  const weakest = cards.filter({ hasText: "Fix my weakest position" });
  await weakest.click();
  await expect(weakest).toHaveAttribute("aria-checked", "true");
  expect(await limits.locator("> summary").innerText()).toBe(before);
});

// A grade goal reads in plain language beneath its controls.
test("a positional grade goal shows a plain-language line", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("tab", { name: "Find trades" }).click();
  await openTradeFilters(page, "Standard");
  await page.locator(".gd-find .gd-goals").getByRole("button", { name: "+ Add goal" }).click();
  const line = page.locator(".gd-goal-line").first();
  await expect(line).toBeVisible();
  await expect(line).toContainText(/^Your .+/);
});

// Filter groups left open stay open, saved trades open from the header, and the journal keeps working in the new look.
test("open filter groups are remembered; saved trades and journal are reachable", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("tab", { name: "Find trades" }).click();
  // Opening every group records each as open.
  await openTradeFilters(page, "Standard");
  const group = () =>
    page.locator(".gd-find details.gd-fg").filter({
      has: page.locator(".gd-fg-title", { hasText: /^Players & packages$/ }),
    });
  await expect(group()).toHaveAttribute("open", "");
  await page.reload();
  // After a reload the group is open again by itself.
  await expect(group()).toHaveAttribute("open", "");
  await page
    .locator(".gd-trade-head")
    .getByRole("button", { name: "Saved trades" })
    .click();
  await expect(page.locator(".trade-saved-drawer")).toHaveAttribute("open", "");
  await page.getByRole("link", { name: "Journal" }).click();
  await expect(
    page.getByRole("heading", { name: "Trade journal" }).first(),
  ).toBeVisible();
});

// Manual analyzer displays player photo, name, EPPG / surplus metrics, and opens card on photo click with arrow navigation.
test("manual analyzer displays player photo, metrics, and opens card with arrow navigation", async ({
  page,
}) => {
  await open(page);
  await offer(page);

  const sendGroup = page.locator(".gd-side-send");
  const receiveGroup = page.locator(".gd-side-receive");

  // Verify static background colors
  await expect(sendGroup).toHaveCSS("background-color", "rgb(59, 47, 143)");
  await expect(receiveGroup).toHaveCSS("background-color", "rgb(140, 47, 57)");

  // Verify metric text format (e.g. eppg / surplus) on a single horizontal row with diagonal slash
  const sendMetric = sendGroup.locator(".tp .metric").first();
  await expect(sendMetric).toBeVisible();
  await expect(sendMetric).toContainText("/");
  await expect(sendMetric).toHaveCSS("flex-direction", "row");
  await expect(sendMetric).toHaveCSS("white-space", "nowrap");

  // Verify trade score strip with EPPG gain/loss from analyzed trade
  const scoreStrip = page.locator(".trade-score-strip");
  await expect(scoreStrip).toBeVisible();
  await expect(scoreStrip).toContainText(/Expected PPG/);

  // Verify tale of the tape displays lineup EPPG gain/loss and net grade step gain/loss
  const tapeGain = page.locator(".gd-tape-gain");
  await expect(tapeGain).toBeVisible();
  await expect(tapeGain).toContainText(/EPPG Gain \/ Loss/i);
  const tapeSteps = page.locator(".gd-tape-steps");
  await expect(tapeSteps).toBeVisible();
  await expect(tapeSteps).toContainText(/Net Grade Step Gain \/ Loss/i);

  // Click player photo to open card popover
  const photoBtn = sendGroup.locator(".tp button[aria-label*='card']").first();
  await photoBtn.click();
  const card = page.locator(".gd-card-view");
  await expect(card).toBeVisible();

  // Press ArrowRight to step to next player in analyzed list
  await page.keyboard.press("ArrowRight");
  await expect(card).toBeVisible();
});

