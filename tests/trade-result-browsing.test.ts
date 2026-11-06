import { expect, it } from "vitest";
import { tradeSearchFixture } from "./fixtures";
import { evaluate } from "../src/domain/valuation";
import { scoreTradeMatch, type SearchRow } from "../src/domain/trade-search";
import {
  browseTradeResults,
  emptyTradeBrowse,
  tradeResultPageSize,
} from "../src/domain/trade-result-groups";

// Synthetic ranked offers exercise presentation only; trade valuation remains delegated to the existing evaluator.
async function sample() {
  const d = await tradeSearchFixture(),
    m = evaluate(d, d.settings);
  const q = { teamA: "1", give: ["101"], count: 1, below: 1000, above: 1000 };
  const base = scoreTradeMatch(m, q, {
    key: "base",
    teamB: "2",
    get: ["200"],
    incoming: 1,
    outgoing: 1,
    difference: 0,
  })!;
  const ids = m.players.filter((p) => p.owner === "2").map((p) => p.id);
  const packages = ids.map((id) => [id]);
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) packages.push([ids[i], ids[j]]);
  const rows: SearchRow[] = Array.from({ length: 300 }, (_, i) => ({
    ...base,
    key: `repeat-${i}`,
    give: ["101"],
    own: 500 - i,
  }));
  rows.push(
    ...packages
      .filter((get) => get.join() !== "200")
      .map((get, i) => ({
        ...base,
        key: `package-${i}`,
        get,
        give: ["101"],
        own: 100 - i,
      })),
  );
  const hidden = {
    ...base,
    key: "hidden-exact",
    give: ["100"],
    get: ["308", "309"],
    own: 1,
  };
  rows.push(hidden, {
    ...base,
    key: "other-team",
    teamB: "3",
    give: ["101"],
    own: 0,
  });
  return { m, rows, hidden };
}

// Hundreds of offers for one package cannot consume the page or starve another team of its own first page.
it("pages distinct packages per team and reports complete offer counts", async () => {
  const { m, rows } = await sample();
  const result = browseTradeResults(m, rows);
  const first = result.view.teams.find((group) => group.team === "2")!;
  expect(first.packages).toHaveLength(tradeResultPageSize);
  expect(first.packages[0].totalOffers).toBe(300);
  expect(first.packages[0].rowKeys).toEqual(["repeat-0"]);
  expect(first.totalPackages).toBe(78);
  expect(result.view.totalOffers).toBe(rows.length);
  expect(result.view.totalPackages).toBe(79);
  expect(
    result.view.teams.find((group) => group.team === "3")!.packages,
  ).toHaveLength(1);
  expect(result.rows).toHaveLength(tradeResultPageSize + 1);
});

// Package and outgoing-offer pages are independent, bounded and preserve the chosen ranking without mutating results.
it("loads package and alternative pages independently without losing offers", async () => {
  const { m, rows } = await sample(),
    before = JSON.stringify(rows);
  const initial = browseTradeResults(m, rows),
    key = initial.view.teams[0].packages[0].key;
  const options = {
    ...emptyTradeBrowse(),
    packages: { "2": 100 },
    offers: { [key]: 51 },
  };
  const next = browseTradeResults(m, rows, options);
  expect(next.view.teams[0].packages).toHaveLength(78);
  expect(next.view.teams[0].packages[0].rowKeys).toEqual(
    rows.slice(0, 51).map((row) => row.key),
  );
  expect(next.view.teams[1].packages).toHaveLength(1);
  expect(next.view.totalOffers).toBe(initial.view.totalOffers);
  expect(JSON.stringify(rows)).toBe(before);
});

// All named players are required, even in unloaded packages; exact lists exclude extra players and never change scoring.
it("finds an unloaded exact offer with AND name matching and fixed-offer fallback", async () => {
  const { m, rows, hidden } = await sample();
  expect(browseTradeResults(m, rows).rows).not.toContain(hidden);
  const options = {
    ...emptyTradeBrowse(),
    offered: "Main QB",
    received: "Search WR 8, Search WR 9",
    exact: true,
  };
  const result = browseTradeResults(m, rows, options);
  expect(result.rows).toEqual([hidden]);
  expect(result.view.totalOffers).toBe(1);
  expect(result.view.totalPackages).toBe(1);
  expect(
    browseTradeResults(m, rows, {
      ...options,
      received: "Search WR 8, missing player",
    }).rows,
  ).toEqual([]);
  expect(
    browseTradeResults(m, [hidden], {
      ...options,
      offered: "Main QB, Bench QB",
    }).rows,
  ).toEqual([]);
  const fixed = { ...hidden, give: undefined };
  expect(browseTradeResults(m, [fixed], options, ["100"]).rows).toEqual([
    fixed,
  ]);
});
