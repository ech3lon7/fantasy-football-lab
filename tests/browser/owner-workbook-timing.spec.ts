import { test, expect } from "@playwright/test";

test.describe("Owner workbook trade search timing", () => {
  test.beforeEach(() => {
    test.skip(
      !process.env.WORKBOOK_PATH,
      "Private workbook path is supplied only locally.",
    );
  });

  // T8.3: Run 3 times, median must be <= 15 s
  test("owner workbook search timing (3 runs, median <= 15s) @speed", async ({ page }) => {
    test.setTimeout(180000);

    const times: number[] = [];

    // Import the workbook once
    await page.goto("./");
    await page
      .getByLabel("Import Excel workbook")
      .setInputFiles(process.env.WORKBOOK_PATH!);
    await expect(
      page.getByRole("heading", { name: "Review workbook import" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Replace dataset", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Review workbook import" }),
    ).not.toBeVisible({ timeout: 30000 });

    for (let run = 1; run <= 3; run++) {
      await page.goto("./#/trade");
      await page.getByRole("tab", { name: "Find trades", exact: true }).click();
      const searchButton = page
        .getByRole("dialog", { name: "Trade filters" })
        .getByRole("button", { name: "Search", exact: true });
      await expect(searchButton).toBeVisible();
      await searchButton.click();

      const t0 = Date.now();
      const coverage = page.getByText(/Checked all .* possible trades/);
      await expect(coverage).toBeVisible({ timeout: 60000 });
      const elapsed = (Date.now() - t0) / 1000;
      times.push(elapsed);
      const text = (await coverage.textContent()) ?? "";
      console.log(`Run ${run}: ${elapsed.toFixed(2)}s (${text})`);
    }

    const sortedTimes = [...times].sort((a, b) => a - b);
    const median = sortedTimes[1];
    console.log(
      `Median search time: ${median.toFixed(2)}s (runs: ${times.map((t) => t.toFixed(2) + "s").join(", ")})`,
    );
    expect(median).toBeLessThanOrEqual(15);
  });

  // T8.4: Marked starters setting run
  test("owner workbook search with Marked starters lineup basis @speed", async ({ page }) => {
    test.setTimeout(120000);

    await page.goto("./");
    await page
      .getByLabel("Import Excel workbook")
      .setInputFiles(process.env.WORKBOOK_PATH!);
    await expect(
      page.getByRole("heading", { name: "Review workbook import" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Replace dataset", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Review workbook import" }),
    ).not.toBeVisible({ timeout: 30000 });

    await page.goto("./#/trade");
    await page.getByRole("tab", { name: "Find trades", exact: true }).click();

    // Select Marked starters
    await page.getByLabel("Lineup basis").selectOption("marked-starters");

    // Click Search
    await page
      .getByRole("dialog", { name: "Trade filters" })
      .getByRole("button", { name: "Search", exact: true })
      .click();

    const t0 = Date.now();
    const coverage = page.getByText(/Checked all .* possible trades/);
    await expect(coverage).toBeVisible({ timeout: 60000 });
    const elapsed = (Date.now() - t0) / 1000;
    const text = (await coverage.textContent()) ?? "";
    console.log(`Marked starters run: ${elapsed.toFixed(2)}s (${text})`);

    // Verify note is visible
    const note = page.getByText(
      "Find trades uses best-available lineups. Your Marked starters setting applies in the Trade analyzer.",
    );
    await expect(note).toBeVisible();
  });
});
