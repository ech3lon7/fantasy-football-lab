import { test, expect } from "@playwright/test";
import { seedLabelWhy } from "./label-why-seed";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__audioStarts = 0;
    class MockAudioContext {
      createOscillator() {
        return {
          type: "sine",
          frequency: { value: 0, setValueAtTime: () => {} },
          connect: (target: any) => target,
          start: () => {
            (window as any).__audioStarts++;
          },
          stop: () => {},
        };
      }
      createGain() {
        return {
          gain: {
            setValueAtTime: () => {},
            exponentialRampToValueAtTime: () => {},
          },
          connect: (target: any) => target,
        };
      }
      get destination() {
        return {};
      }
      get currentTime() {
        return 0;
      }
      close() {
        return Promise.resolve();
      }
    }
    (window as any).AudioContext = MockAudioContext;
    (window as any).webkitAudioContext = MockAudioContext;
  });
});

test("Sound off produces no audio calls; Sound on produces oscillator starts on interactions", async ({
  page,
}) => {
  await seedLabelWhy(page);
  await page.goto("./#/data");

  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("link", { name: "Scouting" }).click();
  await expect(page.getByRole("heading", { name: "Filters" }).first()).toBeVisible();

  // With Sound off (default), clicking navigation should not produce any audio calls
  const startsBefore = await page.evaluate(() => (window as any).__audioStarts);
  expect(startsBefore).toBe(0);

  // Open Feel menu and enable Sound
  await page.getByRole("button", { name: "Feel", exact: true }).click();
  const soundCheckbox = page.getByLabel("Sound");
  await expect(soundCheckbox).not.toBeChecked();
  await soundCheckbox.check();
  await expect(soundCheckbox).toBeChecked();

  // Enabling sound triggers a confirmation tone
  const startsAfterEnable = await page.evaluate(
    () => (window as any).__audioStarts,
  );
  expect(startsAfterEnable).toBeGreaterThan(0);

  // Close Feel menu
  await page.keyboard.press("Escape");

  // Navigate to Roster and click tabs
  const prevCount = startsAfterEnable;
  await nav.getByRole("link", { name: "Roster" }).click();
  const startsAfterNav = await page.evaluate(
    () => (window as any).__audioStarts,
  );
  expect(startsAfterNav).toBeGreaterThan(prevCount);

  // Turn Sound back off
  await page.getByRole("button", { name: "Feel", exact: true }).click();
  await soundCheckbox.uncheck();
  await expect(soundCheckbox).not.toBeChecked();
  await page.keyboard.press("Escape");

  const countAfterDisable = await page.evaluate(
    () => (window as any).__audioStarts,
  );
  // Navigate again with sound off
  await nav.getByRole("link", { name: "League" }).click();
  const countAfterMutedNav = await page.evaluate(
    () => (window as any).__audioStarts,
  );
  expect(countAfterMutedNav).toBe(countAfterDisable);
});
