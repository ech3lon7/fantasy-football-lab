import { expect, type Page } from "@playwright/test";

// Keep the compact default intact; open advanced tools explicitly after creation, navigation or reload.
export async function openRosterTools(page: Page) {
  if (!page.url().includes("#/roster")) return;
  await expect(page.getByRole("heading", { name: "Hypothetical roster simulator", exact: true })).toBeVisible();
  const tools = page.locator(".gd-sim-details");
  if ((await tools.count()) > 0 && (await tools.getAttribute("open")) === null) {
    await tools.locator(":scope > summary").click();
  }
}
