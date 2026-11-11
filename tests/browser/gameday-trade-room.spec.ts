import { test, expect, type Page } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

// Turn the preview on and open the Trade room.
async function open(page: Page) {
  await seedLabelWhy(page);
  await page.goto("./#/data");
  await page.getByLabel("Use the Gameday Plus preview").check();
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
  await expect(verdicts.locator("details")).toHaveCount(4);
  await expect(verdicts.locator("summary span")).toHaveText([
    "Surplus exchange",
    "Lineup impact (EPPG)",
    "Legality",
    "Uncertainty",
  ]);
  await expect(
    page.getByRole("region", { name: "Tale of the tape" }),
  ).toBeVisible();
  // Unaffected positions never show "no change".
  await expect(page.getByText(/no change/i)).toHaveCount(0);
  const field = page.getByRole("region", { name: "Lineup impact" });
  await expect(field.locator(".gd-slot").first()).toBeVisible();
  await field
    .getByRole("group", { name: "Phase" })
    .getByRole("button", { name: "Before" })
    .click();
  await field
    .getByRole("group", { name: "Team" })
    .getByRole("button", { name: "Their team" })
    .click();
  await expect(field.locator(".gd-slot").first()).toBeVisible();
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
  const lineup = page.locator(".gd-verdict").nth(1);
  await expect(lineup.locator("summary strong")).toHaveText(
    /^(Unavailable|[+-]?\d+\.\d( ± \d+\.\d)?)$/,
  );
  await lineup.locator("summary").click();
  await expect(lineup).toContainText("Lineup gain ± spread");
  await expect(page.locator(".gd-verdict").nth(0)).not.toHaveAttribute(
    "open",
    "",
  );
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
      "Hypothetical:",
    );
  } else {
    await expect(force).toHaveAttribute("title", /.+/);
  }
});

// Find trades and Chain planner keep every current control until their rebuilt versions land.
test("find trades and chain planner tabs keep the current tools", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("tab", { name: "Find trades" }).click();
  await expect(page.getByText(/opens here with every control/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Find matching trades" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tab", { name: "Find trades" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "Chain planner" }).click();
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
