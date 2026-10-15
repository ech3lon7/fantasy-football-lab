import { test, expect } from "@playwright/test";
test("onboarding, file boundary and responsive navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Your roster, in focus." }),
  ).toBeVisible();
  await expect(page.getByText("Turn your workbook")).toBeVisible();
  await page.screenshot({
    path: "test-results/onboarding-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("link", { name: "Data & account" }).click();
  await expect(
    page.getByRole("heading", { name: "Current dataset" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/account-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("public configuration rejects administrative credentials", async ({
  page,
}) => {
  await page.goto("./#/data");
  const configuration = page.locator("details").filter({
    has: page.getByText("Project configuration", { exact: true }),
  });
  if ((await configuration.getAttribute("open")) === null) {
    await page.getByText("Project configuration", { exact: true }).click();
  }
  await page
    .getByLabel("Project URL", { exact: true })
    .fill("https://exampleproject.supabase.co");
  await page
    .getByLabel("Publishable key", { exact: true })
    .fill("sb_secret_example");
  await page.getByRole("button", { name: "Save public configuration" }).click();
  await expect(page.getByRole("alert")).toContainText("never a secret key");
});
test("real workbook import, screens, roster and trade flow", async ({
  page,
}) => {
  test.skip(
    !process.env.WORKBOOK_PATH,
    "Private workbook path is supplied only locally.",
  );
  const errors: string[] = [];
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
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
    page.getByRole("heading", { name: "Los Chilones", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your roster", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/overview-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Los Chilones", exact: true }),
  ).toBeVisible();
  for (const name of [
    "League teams",
    "Players",
    "Gem screener",
    "Weekly streamers",
    "Model & audit",
  ]) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page.locator("main h1")).toHaveText(name);
    await expect(
      page.getByText("Calculating the current snapshot…"),
    ).toHaveCount(0);
  }
  await page.getByRole("link", { name: "Trade analyzer", exact: true }).click();
  await page
    .getByLabel("Outgoing player 1", { exact: true })
    .selectOption({ index: 1 });
  await page
    .getByLabel("Incoming player 1", { exact: true })
    .selectOption({ index: 1 });
  await expect(
    page.getByRole("heading", { name: "Surplus exchange", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/trade-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".sidebar")).toBeHidden();
  await page.screenshot({
    path: "test-results/trade-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(posts).toEqual([]);
  if (process.env.OFFLINE_TEST === "true") {
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.context().setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Surplus exchange", exact: true }),
    ).toBeVisible();
    await page.context().setOffline(false);
  }
});
