import { defineConfig } from "@playwright/test";
import fs from "node:fs";
const bundled =
  process.env.LOCALAPPDATA +
  "/ms-playwright/chromium-1223/chrome-win64/chrome.exe";
export default defineConfig({
  testDir: "tests/browser",
  workers: process.env.PLAYWRIGHT_WORKERS
    ? Number(process.env.PLAYWRIGHT_WORKERS)
    : process.env.CI
      ? 2
      : 3,
  timeout: 90000,
  expect: { timeout: 20000 },
  // The shared release gate serves the Pages build itself and rejects an occupied port instead of testing an unrelated preview.
  webServer:
    process.env.RELEASE_VERIFY === "true"
      ? {
          command:
            "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort",
          url: "http://127.0.0.1:4173/fantasy-football-lab/",
          reuseExistingServer: false,
          timeout: 30000,
        }
      : undefined,
  use: {
    baseURL: process.env.APP_URL ?? "http://127.0.0.1:5174",
    headless: true,
    // Keep evidence for a failed browser case instead of requiring another run to reproduce it.
    trace: "retain-on-failure",
    launchOptions: fs.existsSync(bundled) ? { executablePath: bundled } : {},
  },
  reporter: "list",
});
