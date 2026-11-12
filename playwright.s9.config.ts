import base from "./playwright.config";
import { defineConfig } from "@playwright/test";
// Temporary: a private port and output folder so this run cannot collide with other sessions.
export default defineConfig({
  ...base,
  outputDir: "s9-review/artifacts",
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4174 --strictPort",
    url: "http://127.0.0.1:4174/fantasy-football-lab/",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
