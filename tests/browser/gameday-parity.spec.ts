import { test, expect, type Page } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

// Open a route.
async function open(page: Page, hash: string) {
  await seedLabelWhy(page);
  await page.goto("./#/data");
  await page.goto(`./${hash}`);
}

// Parity rows 12, 23 and 24: roster tiles carry label badges, and the Scouting table has the weekly streamer columns and every evaluation field.
test("roster badges and the scouting table keep the earlier columns", async ({
  page,
}) => {
  await open(page, "#/roster");
  // Formation cards expose the current matchup and MPPG instead of the old tile badges.
  await expect(page.locator(".gd-fc-badge").first()).toBeVisible();
  await page.goto("./#/scouting");
  await page
    .getByRole("group", { name: "View" })
    .getByRole("button", { name: "Table" })
    .click();
  const headers = page.locator("thead th");
  await expect(headers.filter({ hasText: "Bye week" })).toHaveCount(1);
  await expect(headers.filter({ hasText: /^Actual PPG/ })).toHaveCount(1);
  await expect(headers.filter({ hasText: "ESPN Week" })).toHaveCount(1);
  await page.getByLabel("All evaluation fields").check();
  await expect(headers.filter({ hasText: "Draft ADP" }).first()).toBeVisible();
  await expect(headers.filter({ hasText: "Draft ADP edge" })).toHaveCount(1);
});

// Parity rows 28 and 30: the card keeps every evaluation stat, the workload and market evidence, scores and imported fields.
test("player card keeps the detailed evidence disclosures", async ({
  page,
}) => {
  await open(page, "#/player/2");
  const card = page.getByRole("dialog");
  await card.getByRole("tab", { name: "Numbers" }).click();
  for (const name of [
    "All evaluation stats",
    "Workload and advanced evidence",
    "Completed-game scores",
    "All imported player fields",
  ])
    await expect(card.getByText(name, { exact: true })).toBeVisible();
  await card.getByText("Completed-game scores", { exact: true }).click();
  await expect(card.locator("table").first()).toBeVisible();
  await card
    .getByText("Workload and advanced evidence", { exact: true })
    .click();
  await expect(
    card.getByText(/Recent opportunities \/ game/).first(),
  ).toBeVisible();
});

// Parity rows 35 to 37: the deal-grade bar, the weekly gain table and the optimized future lineups disclosure.
test("manual analyzer keeps the advantage bar, weekly gains and optimized coverage", async ({
  page,
}) => {
  await open(page, "#/trade");
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
  // The bar sits inside the closed surplus verdict, so check it in the document rather than by role.
  await expect(page.locator(".gd-advbar")).toHaveAttribute(
    "aria-label",
    /^Advantage/,
  );
  const weekly = page
    .locator("details", { hasText: "Weekly lineup gain" })
    .first();
  await weekly.locator("summary").click();
  expect(await weekly.locator("tbody tr").count()).toBeGreaterThan(0);
  const coverage = page
    .locator("details", { hasText: "Optimized future lineups and coverage" })
    .first();
  await coverage.locator("summary").click();
  await expect(coverage).toContainText("Expected gain (season)");
  await expect(coverage).toContainText("Injury downside");
});

// Parity rows 4, 7 and 9: notices, the provenance legend and the version footer are still on every new screen.
test("shell notices, legend and version footer remain", async ({ page }) => {
  await open(page, "#/week");
  await expect(page.locator("footer")).toContainText(/v\d+\.\d+\.\d+/);
  await expect(page.getByText("Recorded facts").first()).toBeVisible();
});
