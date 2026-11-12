import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { seedLabelWhy } from "./label-why-seed";
import { screens } from "./screens";
import { auditTheme, type Finding } from "./theme-audit";

// The theme sweep replaces the old four-element check. It samples every element on every screen,
// tab and popover, in both themes, and reports offenders by selector.
// Run it with GAMEDAY_SWEEP=1. It fails while any offender remains, which is the progress meter
// for sections 2 to 10; SWEEP_ALLOW_KNOWN=1 reports accepted legacy debt without failing on it.
const enabled = process.env.GAMEDAY_SWEEP === "1";
const allowKnown = process.env.SWEEP_ALLOW_KNOWN === "1";
const outDir = "test-results/theme-sweep";

// Accepted offenders, each owned by the section that rebuilds its screen. Section 10 empties this list.
export const knownOffenders: { pattern: RegExp; section: string; why: string }[] =
  [];

const accepted = (finding: Finding) =>
  knownOffenders.find((entry) =>
    entry.pattern.test(`${finding.screen} ${finding.selector}`),
  );

const describe = (finding: Finding) =>
  `${finding.kind} · ${finding.screen} · ${finding.selector} · "${finding.text}" · ${finding.detail}`;

for (const theme of ["light", "dark"] as const) {
  test(`theme sweep: ${theme}`, async ({ page }) => {
    test.skip(!enabled, "Set GAMEDAY_SWEEP=1 to run the theme sweep.");
    test.setTimeout(300000);
    await page.setViewportSize({ width: 1440, height: 900 });
    // Animation off keeps every screen still while colours are sampled.
    await seedLabelWhy(page, false, {
      feelTheme: theme,
      feelAnimation: "off",
    });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    const findings: Finding[] = [];
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const screen of screens) {
      errors.length = 0;
      await screen.go(page);
      expect(errors, `page errors on ${screen.name}`).toEqual([]);
      findings.push(...(await auditTheme(page, theme, screen.name)));
    }

    const unexpected = findings.filter((f) => !accepted(f));
    const expected = findings.filter((f) => accepted(f));

    // Keep the full report on disk so a section's note can quote it and compare later runs.
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, `${theme}.json`),
      JSON.stringify({ theme, findings, unexpected, expected }, null, 2),
    );
    console.log(
      `${theme}: ${findings.length} offenders (${expected.length} accepted, ${unexpected.length} new)`,
    );
    for (const entry of [...expected, ...unexpected])
      console.log(`${accepted(entry) ? "accepted" : "NEW"} ${describe(entry)}`);

    expect(
      unexpected.map(describe),
      `${unexpected.length} theme offenders are not in the accepted list`,
    ).toEqual([]);
    if (!allowKnown)
      expect(
        expected.map((f) => `${accepted(f)!.section} ${describe(f)}`),
        `${expected.length} accepted theme offenders remain, by section: ${[
          ...new Set(expected.map((f) => accepted(f)!.section)),
        ]
          .sort()
          .map(
            (section) =>
              `section ${section} (${expected.filter((f) => accepted(f)!.section === section).length})`,
          )
          .join(", ")}`,
      ).toEqual([]);
  });
}
