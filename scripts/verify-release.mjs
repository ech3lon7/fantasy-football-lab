import { spawnSync } from "node:child_process";

// Run the full deployment gate with the GitHub Pages path on either Windows or Linux.
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run this check with npm run verify:release.");
const env = {
  ...process.env,
  CI: "true",
  GITHUB_ACTIONS: "true",
  RELEASE_VERIFY: "true",
  APP_URL: "http://127.0.0.1:4173/fantasy-football-lab/",
};

// Stop at the first failure; Playwright owns and cleans up its preview server.
for (const step of ["check", "build", "test:browser"]) {
  console.log(`\nRelease verification: ${step}`);
  const result = spawnSync(process.execPath, [npm, "run", step], {
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(
  "\nRelease verification passed: checks, Pages build and all browser tests.",
);
