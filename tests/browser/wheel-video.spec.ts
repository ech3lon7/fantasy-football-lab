import { test, expect, type CDPSession, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { seedTradeLeague } from "./trade-seed";

// T8 of the filter wheel polish: a recording of every interaction M1 to M26 at Full motion. Nothing is downloaded: Chrome's own
// screencast (Page.startScreencast, through Playwright's CDP session) hands over every frame it paints, and the ffmpeg that is
// already installed on this machine encodes them at 30 fps. The recordings go to test-results/ and are never committed.
// Run it with VIDEO=1 npx playwright test wheel-video. Set FFMPEG to use another ffmpeg.

const FFMPEG =
  process.env.FFMPEG ??
  "C:\\Users\\israe\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-full_build\\bin\\ffmpeg.exe";
const OUT = path.resolve("test-results", "wheel-video");
const draft = { teamA: "1", teamB: "2", give: ["101"], get: [] };

test.skip(!process.env.VIDEO, "set VIDEO=1 to record");

const board = (page: Page) => page.getByRole("dialog", { name: "Trade filters" });
const rail = (page: Page) => board(page).locator('[data-zone="rail"]');
const right = (page: Page) => board(page).locator('[data-zone="right"]');
const hub = (page: Page) => board(page).locator(".gd-zb-hub");
const seg = (page: Page, name: RegExp | string) => board(page).getByRole("menuitem", { name }).locator(".gd-seg-hit");

// Collect every screencast frame with its timestamp, then encode them with ffmpeg at a constant 30 fps.
class Recorder {
  private frames: { file: string; t: number }[] = [];
  private dir: string;
  private n = 0;
  constructor(private cdp: CDPSession, private name: string) {
    this.dir = path.join(OUT, name + "-frames");
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    cdp.on("Page.screencastFrame", (frame: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      const file = path.join(this.dir, `f${String(this.n++).padStart(6, "0")}.jpg`);
      fs.writeFileSync(file, Buffer.from(frame.data, "base64"));
      this.frames.push({ file, t: frame.metadata.timestamp ?? Date.now() / 1000 });
      void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
    });
  }
  async start(width: number, height: number) {
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
  }
  async stop() {
    await this.cdp.send("Page.stopScreencast").catch(() => undefined);
    return this.encode();
  }
  private encode() {
    if (this.frames.length < 2) throw new Error("the screencast delivered no frames");
    const list: string[] = [];
    for (let i = 0; i < this.frames.length; i++) {
      const next = this.frames[i + 1];
      const duration = next ? Math.max(0.001, next.t - this.frames[i].t) : 0.05;
      list.push(`file '${this.frames[i].file.replace(/\\/g, "/")}'`, `duration ${duration.toFixed(4)}`);
    }
    list.push(`file '${this.frames[this.frames.length - 1].file.replace(/\\/g, "/")}'`);
    const listFile = path.join(this.dir, "list.txt");
    fs.writeFileSync(listFile, list.join("\n"));
    const out = path.join(OUT, `${this.name}.mp4`);
    execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", out]);
    const seconds = this.frames[this.frames.length - 1].t - this.frames[0].t;
    // Chrome paints a frame only when something changes, so a still board sends none: the rate that matters is the peak while it moves.
    let peak = 0;
    for (let i = 0, j = 0; i < this.frames.length; i++) {
      while (this.frames[i].t - this.frames[j].t > 1) j++;
      peak = Math.max(peak, i - j + 1);
    }
    return { out, frames: this.frames.length, seconds: Math.round(seconds), peakFps: peak };
  }
}

async function session(page: Page, name: string, width: number, height: number, which: "search" | "big" = "search") {
  fs.mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width, height });
  await seedTradeLeague(page, which, draft, { feelAnimation: "full" });
  await page.goto("./#/trade");
  const cdp = await page.context().newCDPSession(page);
  const recorder = new Recorder(cdp, name);
  await recorder.start(width, height);
  return recorder;
}
const pause = (page: Page, ms = 700) => page.waitForTimeout(ms);

test("desktop: M1 to M23 and M26", async ({ page }) => {
  test.setTimeout(420000);
  const recorder = await session(page, "wheel-full-desktop", 1320, 900);
  await pause(page, 500);
  await page.getByRole("tab", { name: "Find trades", exact: true }).click(); // M1
  await pause(page, 1900);
  await board(page).getByRole("menuitem", { name: /^Players/ }).focus(); // M2 (focus)
  await pause(page, 400);
  await board(page).getByRole("menuitem", { name: /^Teams/ }).hover(); // M2 (hover)
  await pause(page);
  await seg(page, /^Gains/).click(); // M3
  await pause(page, 1100);
  await right(page).getByRole("menuitem", { name: "Their EPPG", exact: true }).click(); // M6
  await pause(page, 900);
  const slider = board(page).getByRole("slider", { name: "Their EPPG at least" });
  await slider.focus();
  for (const key of ["ArrowLeft", "ArrowLeft", "ArrowRight", "Home", "End"]) { await page.keyboard.press(key); await pause(page, 250); } // M7
  await right(page).getByRole("menuitem", { name: "Your EPPG", exact: true }).click(); // M6
  await pause(page, 800);
  await right(page).locator(".gd-value-card").getByRole("button", { name: "MAX" }).click(); // M8
  await pause(page, 600);
  await right(page).locator(".gd-value-card").getByRole("button", { name: "MIN" }).click(); // M8
  await pause(page, 600);
  await hub(page).click(); // M14 (hub)
  await pause(page, 600);
  await seg(page, /^Positions/).click(); // M4 / M3
  await pause(page, 900);
  await right(page).getByRole("menuitem", { name: "I get", exact: true }).click();
  await pause(page, 700);
  await right(page).getByRole("menuitemcheckbox", { name: "WR" }).click(); // M5
  await pause(page, 500);
  await right(page).getByRole("menuitemcheckbox", { name: "WR" }).click(); // M5 (off)
  await pause(page, 600);
  await seg(page, /^Players/).click(); // M4
  await pause(page, 900);
  await right(page).getByRole("menuitem", { name: "I get", exact: true }).click(); // M9
  await pause(page, 1100);
  await right(page).locator(".gd-prow").nth(1).hover(); // M11
  await pause(page, 500);
  await right(page).locator(".gd-prow").first().click(); // M12
  await pause(page, 600);
  await right(page).getByRole("searchbox", { name: "Search players" }).fill("Search WR 1"); // M10
  await pause(page, 800);
  await right(page).getByRole("searchbox", { name: "Search players" }).fill("");
  await pause(page, 800);
  await seg(page, /^Grades/).click(); // M4 / M9
  await pause(page, 1100);
  await right(page).getByRole("button", { name: "+ Add goal" }).click(); // M13
  await pause(page, 600);
  await right(page).getByRole("combobox", { name: "Position" }).first().selectOption("WR"); // M13
  await pause(page, 600);
  await right(page).getByRole("button", { name: "Remove positional goal" }).first().click(); // M13
  await pause(page, 600);
  await page.mouse.click(4, 300); // M14 (click outside)
  await pause(page, 800);
  await rail(page).getByRole("button", { name: /^for Test A/ }).click(); // M15
  await pause(page, 900);
  await rail(page).getByRole("option", { name: "Test B" }).click(); // M15
  await pause(page, 1200);
  await rail(page).getByRole("button", { name: "Search", exact: true }).click(); // M16 to M18
  await expect(page.getByText(/possible trades/)).toBeVisible({ timeout: 90000 });
  await pause(page, 1500);
  await rail(page).getByRole("button", { name: "Show all", exact: true }).click(); // M20 to M22
  await pause(page, 1400);
  await rail(page).getByRole("button", { name: "Reset to defaults", exact: true }).click(); // M20 to M22
  await pause(page, 1400);
  await page.keyboard.press("Shift+Space"); // M23
  await pause(page, 900);
  await page.goto("./#/lab/keys"); // M26
  await page.getByText("Filter wheel shortcut", { exact: true }).locator("..").getByRole("button", { name: "Change" }).click();
  await pause(page, 500);
  await page.keyboard.press("Shift+ArrowUp");
  await pause(page, 1200);
  const result = await recorder.stop();
  console.log("VIDEO", JSON.stringify(result));
  expect(result.peakFps).toBeGreaterThanOrEqual(30);
});

test("desktop: M17 to M19 on the 12-team league, with Cancel", async ({ page }) => {
  test.setTimeout(420000);
  const recorder = await session(page, "wheel-full-search-and-cancel", 1320, 900, "big");
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await pause(page, 1900);
  await rail(page).getByRole("button", { name: "Search", exact: true }).click(); // M16, M17
  await pause(page, 5000);
  await rail(page).getByRole("button", { name: "Cancel", exact: true }).click(); // M19
  await pause(page, 1800);
  await rail(page).getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText(/possible trades/)).toBeVisible({ timeout: 240000 }); // M18
  await pause(page, 2000);
  const result = await recorder.stop();
  console.log("VIDEO", JSON.stringify(result));
  expect(result.peakFps).toBeGreaterThanOrEqual(30);
});

test("phone: M25 the panel rises and drops", async ({ page }) => {
  test.setTimeout(120000);
  const recorder = await session(page, "wheel-full-phone", 390, 844);
  await page.getByRole("tab", { name: "Find trades", exact: true }).click();
  await pause(page, 1900);
  await seg(page, /^Gains/).click(); // M25 up
  await pause(page, 1500);
  await page.keyboard.press("Escape"); // M25 down
  await pause(page, 1000);
  const result = await recorder.stop();
  console.log("VIDEO", JSON.stringify(result));
  expect(result.peakFps).toBeGreaterThanOrEqual(30);
});
