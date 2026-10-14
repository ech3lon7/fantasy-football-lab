import { defineConfig } from "@playwright/test";
import fs from "node:fs";
const bundled =
  process.env.LOCALAPPDATA +
  "/ms-playwright/chromium-1223/chrome-win64/chrome.exe";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 90000,
  expect: { timeout: 20000 },
  use: {
    baseURL: process.env.APP_URL ?? "http://127.0.0.1:5174",
    headless: true,
    launchOptions: fs.existsSync(bundled) ? { executablePath: bundled } : {},
  },
  reporter: "list",
});
