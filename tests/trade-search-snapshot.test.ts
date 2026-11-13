import { it, expect } from "vitest";
import { tradeSearchFixture } from "./fixtures";
import { fairChainFixture } from "./chain-fixture";
import { evaluate } from "../src/domain/valuation";
import { findTradeMatches, type TradeSearchQuery } from "../src/domain/trade-search";
import { searchTradeChains, type ChainQuery } from "../src/domain/trade-chains";

// Acceptance test 5.5: the rebuild must not change what the searches find. These snapshots were taken from the domain functions
// before the Find trades and Chain planner screens were rebuilt; only the documented single-search-method changes may alter them.
// The fixtures stamp the current time into the data hash, so the hash is the one field that must not be compared.
const stable = <T,>(value: T): unknown =>
  JSON.parse(
    JSON.stringify(value, (key, v) => (key === "sourceHash" ? "<hash>" : v)),
  );

const standard: TradeSearchQuery = {
  teamA: "1",
  give: ["101"],
  count: 1,
  below: 1000,
  above: 1000,
  indexMode: "automatic",
};

const chain: ChainQuery = {
  team: "1",
  pool: ["3", "8", "9"],
  mode: "both",
  maximumLoss: 3,
  minimumGain: 5,
  basis: "best-available",
  depth: "standard",
  first: {
    offer: { minimum: 1, maximum: 1 },
    receive: { minimum: 1, maximum: 1 },
    teams: ["2"],
  },
  second: {
    offer: { minimum: 2, maximum: 2 },
    receive: { minimum: 1, maximum: 1 },
    teams: ["3"],
  },
};

it("findTradeMatches results are unchanged for the search fixture", async () => {
  const d = await tradeSearchFixture(),
    m = evaluate(d, d.settings);
  const plain = findTradeMatches(m, standard);
  expect(plain.matches.length).toBeGreaterThan(0);
  expect(stable(plain.matches)).toMatchSnapshot("plain");
  const wide = findTradeMatches(m, {
    ...standard,
    count: 1,
    discovery: { receive: { minimum: 1, maximum: 2 }, ranking: "own", nearMisses: true },
  });
  expect(stable(wide.matches)).toMatchSnapshot("two-receive");
  expect(stable(wide.stats)).toMatchSnapshot("two-receive-stats");
});

it("searchTradeChains results are unchanged for the chain fixtures", async () => {
  const d = await fairChainFixture(),
    m = evaluate(d, d.settings);
  const found = searchTradeChains(m, chain);
  expect(found.chains.length).toBeGreaterThanOrEqual(2);
  expect(stable(found.chains)).toMatchSnapshot("fair-chains");
  expect(stable(found.stats)).toMatchSnapshot("fair-chain-stats");
  // The safe-only mode and the marked-starters basis are separate paths through the same search.
  const safeOnly = searchTradeChains(m, { ...chain, mode: "safe", basis: "marked-starters" });
  expect(stable(safeOnly.chains)).toMatchSnapshot("safe-marked-chains");
});
