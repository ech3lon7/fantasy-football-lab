import { test, expect, type Page } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

// Open a route.
async function open(page: Page, hash: string) {
  await seedLabelWhy(page);
  await page.goto("./#/data");
  await page.goto(`./${hash}`);
}

// Start or sit odds appear in versus with their caveat, or are replaced by a plain note when a spread is missing.
test("versus shows start or sit odds or says why not", async ({ page }) => {
  await open(page, "#/scouting");
  await expect(page.locator(".gd-pcard-name b").nth(1)).toBeVisible();
  const names = await page
    .locator(".gd-pcard-name b")
    .evaluateAll((els) => els.map((el) => el.textContent ?? ""));
  await page.getByRole("button", { name: `Add ${names[0]} to versus` }).click();
  await page.getByRole("button", { name: `Add ${names[1]} to versus` }).click();
  const dialog = page.getByRole("dialog", { name: "Versus" });
  await expect(dialog).toBeVisible();
  const odds = dialog.getByRole("region", { name: "Start or sit odds" });
  if (await odds.count()) {
    await expect(odds).toContainText(/%/);
    await expect(odds).toContainText(/coin flip|modest edge|clear edge/);
    await expect(odds).toContainText("not a prediction");
  } else {
    await expect(dialog).toContainText(
      "Start or sit odds need an Expected PPG and a spread",
    );
  }
});

// League power ranges rank every team, with the owner's chance against each other team.
test("league power ranges rank every team", async ({ page }) => {
  await open(page, "#/league");
  const table = page
    .getByRole("region", { name: "Power ranges" })
    .getByRole("table");
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(table.locator("thead th")).toHaveText([
    "Rank",
    "Team",
    "Floor",
    "Expected",
    "Ceiling",
    "You outscore",
  ]);
  await expect(table.locator("tr[data-mine]")).toContainText("you");
  await expect(
    page.getByRole("region", { name: "Power ranges" }),
  ).toContainText("not a prediction");
});

// Add and drop pairs only list pickups that help, and an empty list says so.
test("add and drop pairs section lists helpful pickups or says none help", async ({
  page,
}) => {
  await open(page, "#/roster");
  const section = page.getByRole("region", { name: "Add and drop pairs" });
  await expect(section).toBeVisible();
  const rows = section.locator(".gd-pair");
  if ((await rows.count()) === 0)
    await expect(section).toContainText("No pickup would change your lineup.");
  else {
    await section
      .getByRole("button", { name: "Try in a simulation" })
      .first()
      .click();
    await expect(page.locator(".gd-header .gd-chip")).toContainText(
      "Hypothetical:",
    );
  }
  // The depth-only switch is on by default and can be turned off.
  const toggle = section.getByLabel("Show depth-only pickups");
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
});

// Since last import: a stored summary of the previous import produces the digest, and nothing shows without one.
test("since last import shows a digest only when a previous import exists", async ({
  page,
}) => {
  await open(page, "#/week");
  await expect(
    page.getByRole("region", { name: "Since last import" }),
  ).toHaveCount(0);
  // Store a small summary as an earlier import would have, then reload.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fantasy-football-lab", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("current", "readwrite");
      tx.objectStore("current").put(
        {
          version: 1,
          sourceUTC: "2026-11-01T12:00:00Z",
          summarizedAt: "2026-11-01T12:05:00Z",
          players: { "2": { name: "Synthetic 2", labels: [], eppg: 5 } },
        },
        "previous-import:local",
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
  await page.reload();
  const section = page.getByRole("region", { name: "Since last import" });
  await expect(section).toBeVisible();
  await expect(section).toContainText("Synthetic 2");
  await expect(section.locator(".gd-digest-kind").first()).toBeVisible();
  await expect(section).toContainText("not the workbook");
  await expect(page.getByText(/no change/i)).toHaveCount(0);
});

// Counter-offers: a fourth tab that works from the Manual analyzer's offer and can load a counter back into it.
test("counter-offers tab searches from the current offer", async ({ page }) => {
  await open(page, "#/trade");
  await expect(page.getByRole("tab")).toHaveText([
    "Manual analyzer",
    "Find trades",
    "Chain planner",
    "Counter-offers",
  ]);
  await page.getByRole("tab", { name: "Counter-offers" }).click();
  await expect(
    page.getByRole("button", { name: "Find counter-offers" }),
  ).toBeDisabled();
  await page.getByRole("tab", { name: "Manual analyzer" }).click();
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
  await page.getByRole("tab", { name: "Counter-offers" }).click();
  await page.getByRole("button", { name: "Find counter-offers" }).click();
  await expect(
    page.getByRole("button", { name: "Find counter-offers" }),
  ).toBeEnabled();
  const counters = page.locator(".gd-counter");
  if ((await counters.count()) === 0)
    await expect(
      page.getByText(
        /No single swap or added player keeps this trade helping you/,
      ),
    ).toBeVisible();
  else {
    await expect(counters.first()).toContainText("You");
    await counters.first().getByRole("button", { name: "Use this" }).click();
    await expect(
      page.getByRole("tab", { name: "Manual analyzer" }),
    ).toHaveAttribute("aria-selected", "true");
  }
});

// The new sections stay on theme tokens in dark.
test("added sections have no white fills in dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page, "#/league");
  await expect(
    page.getByRole("region", { name: "Power ranges" }),
  ).toBeVisible();
  const white = await page.evaluate(() =>
    [...document.querySelectorAll("[aria-label='Power ranges'] *")]
      .filter(
        (el) => getComputedStyle(el).backgroundColor === "rgb(255, 255, 255)",
      )
      .map((el) => `${el.tagName}.${el.getAttribute("class")}`),
  );
  expect(white).toEqual([]);
});
