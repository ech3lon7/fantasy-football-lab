import type { Page } from "@playwright/test";

// Every screen, tab and popover the theme sweep and the review screenshots must cover.
// A screen only navigates; assertions and reporting live in the specs that use the list.
export interface Screen {
  name: string;
  go: (page: Page) => Promise<void>;
}

const route = (hash: string) => async (page: Page) => {
  await closePopovers(page);
  await page.goto(`./${hash}`);
  await settle(page);
};

// Open a trade room tab by its visible label; the tab row is the only tablist on the screen.
const tradeTab = (label: string) => async (page: Page) => {
  await route("#/trades")(page);
  await page.getByRole("tab", { name: label, exact: true }).click();
  await settle(page);
};

// Open the player card over This week and switch to one of its four tabs.
const cardTab = (label: string) => async (page: Page) => {
  await route("#/player/2")(page);
  const card = page.getByRole("dialog");
  await card.getByRole("tab", { name: label, exact: true }).click();
  await settle(page);
};

// Escape closes the top popover only, so repeated presses clear a stack.
export async function closePopovers(page: Page) {
  for (let i = 0; i < 4; i++) {
    if ((await page.locator(".gd-popover, [role=dialog]").count()) === 0) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(30);
  }
}

// Let the screen finish its first paint and any entrance animation before sampling colours.
export async function settle(page: Page) {
  await page.waitForTimeout(120);
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => done(null))),
  );
}

// Open the header menu and the keyboard reference popover it now holds.
const keyboardPopover = async (page: Page) => {
  await route("#/overview")(page);
  // Narrow widths keep Feel and the keyboard reference inside the header Menu.
  const feel = page.getByRole("button", { name: "Feel", exact: true });
  if (await feel.isVisible()) await feel.click();
  else await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Keyboard reference" }).click();
  await settle(page);
};

// The first grade tile that has a real grade opens the position popover with players.
const leaguePopover = async (page: Page) => {
  await route("#/teams")(page);
  await page.locator('.gd-grade-btn:not([data-tone="na"])').first().click();
  await settle(page);
};

// The Find trades tab after a real search, so the sweep covers result rows, grade chips and status tags in both themes.
const findResults = async (page: Page) => {
  await tradeTab("Find trades")(page);
  await page
    .getByRole("button", { name: "Search trades across the league" })
    .click();
  await page.locator(".gd-res-row").first().waitFor({ timeout: 30000 });
  await settle(page);
};

export const screens: Screen[] = [
  { name: "this-week", go: route("#/overview") },
  { name: "roster", go: route("#/roster") },
  { name: "scouting", go: route("#/players") },
  { name: "scouting-gems", go: route("#/gems") },
  { name: "league", go: route("#/teams") },
  { name: "league-popover", go: leaguePopover },
  { name: "trade-manual", go: tradeTab("Manual analyzer") },
  { name: "trade-find", go: tradeTab("Find trades") },
  { name: "trade-find-results", go: findResults },
  { name: "trade-chains", go: tradeTab("Chain planner") },
  { name: "trade-counters", go: tradeTab("Counter-offers") },
  { name: "journal", go: route("#/journal") },
  { name: "lab-settings", go: route("#/lab/settings") },
  { name: "lab-evidence", go: route("#/lab/evidence") },
  { name: "lab-audits", go: route("#/lab/audits") },
  { name: "lab-data", go: route("#/lab/data") },
  { name: "lab-keys", go: route("#/lab/keys") },
  { name: "lab-feel", go: route("#/lab/feel") },
  { name: "card-story", go: cardTab("Story") },
  { name: "card-numbers", go: cardTab("Numbers") },
  { name: "card-why", go: cardTab("Why the labels") },
  { name: "card-calculation", go: cardTab("Calculation") },
  { name: "keyboard-popover", go: keyboardPopover },
];
