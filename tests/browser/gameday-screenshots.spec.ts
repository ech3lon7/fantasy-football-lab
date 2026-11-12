import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { seedLabelWhy } from "./label-why-seed";
import { screens } from "./screens";

// Review screenshots for every screen, tab and popover in both themes at desktop, tablet and phone width.
// Run it with GAMEDAY_SHOTS=1. Pictures go to test-results/review/<theme>-<width>/ and a report of page-level
// horizontal overflow and bottom-bar rules goes to test-results/review/report.json for the section note.
const enabled = process.env.GAMEDAY_SHOTS === "1";
// SHOTS_DIR keeps the pictures out of test-results, which another run may clean at any time.
const outDir = process.env.SHOTS_DIR ?? "test-results/review";

const sizes = [
  { name: "desktop", width: 1440, height: 900, touch: false },
  { name: "tablet", width: 820, height: 1180, touch: true },
  { name: "phone", width: 390, height: 844, touch: true },
] as const;

interface Row {
  theme: string;
  size: string;
  screen: string;
  overflow: number;
  bottomBar: boolean;
  headerRows: number;
}

for (const size of sizes) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`${size.name} ${theme}`, () => {
      test.use({
        viewport: { width: size.width, height: size.height },
        hasTouch: size.touch,
      });

      test(`screens at ${size.width} px in ${theme}`, async ({ page }) => {
        test.skip(!enabled, "Set GAMEDAY_SHOTS=1 to take review screenshots.");
        test.setTimeout(300000);
        await seedLabelWhy(page, false, {
          feelTheme: theme,
          feelAnimation: "off",
        });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const dir = path.join(outDir, `${theme}-${size.width}`);
        fs.mkdirSync(dir, { recursive: true });
        const rows: Row[] = [];
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        for (const screen of screens) {
          await screen.go(page);
          rows.push(
            await page.evaluate(
              ([themeName, sizeName, screenName]) => {
                const bar = document.querySelector(
                  '[aria-label="Phone navigation"]',
                );
                const header = document.querySelector(".gd-header");
                const style = bar ? getComputedStyle(bar) : null;
                const visible =
                  !!style &&
                  style.display !== "none" &&
                  style.visibility !== "hidden" &&
                  (bar as HTMLElement).getBoundingClientRect().height > 0;
                const headerHeight = header
                  ? header.getBoundingClientRect().height
                  : 0;
                return {
                  theme: themeName,
                  size: sizeName,
                  screen: screenName,
                  overflow:
                    document.documentElement.scrollWidth -
                    document.documentElement.clientWidth,
                  bottomBar: visible,
                  // A header taller than about one control row has wrapped.
                  headerRows: Math.round(headerHeight / 56),
                };
              },
              [theme, size.name, screen.name],
            ),
          );
          await page.screenshot({
            path: path.join(dir, `${screen.name}.png`),
            fullPage: false,
          });
        }
        fs.writeFileSync(
          path.join(dir, "report.json"),
          JSON.stringify({ rows, errors }, null, 2),
        );
        console.log(
          `${theme} ${size.width}: ${rows.filter((r) => r.overflow > 1).length} screens overflow sideways, ` +
            `bottom bar ${rows.every((r) => r.bottomBar === (size.width < 720)) ? "follows" : "BREAKS"} the phone rule`,
        );
        expect(errors, "page errors").toEqual([]);
      });
    });
  }
}
