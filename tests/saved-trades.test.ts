import { expect, it } from "vitest";
import { initialState, type Workspace } from "../src/domain/contracts";
import { evaluate } from "../src/domain/valuation";
import { evaluateTrade } from "../src/domain/trades";
import {
  readSavedTrades,
  reconcileSavedTrades,
  saveTrade,
  savedTradeIdentity,
  savedTradesKey,
  summaryFromSearch,
  summaryFromTrade,
  writeSavedTrades,
} from "../src/domain/saved-trades";
import { scoreTradeMatch } from "../src/domain/trade-search";
import { starterFixture } from "./fixtures";

// Build a valid owned package and original authoritative summary using only synthetic league data.
async function sample() {
  const d = await starterFixture(),
    m = evaluate(d, d.settings),
    state = initialState(d);
  const draft = { teamA: "1", teamB: "2", give: ["101"], get: ["200"] };
  const query = { teamA: "1", give: ["101"], count: 1, below: 500, above: 500 };
  const summary = summaryFromTrade(evaluateTrade(m, draft));
  return { d, m, state, draft, query, summary };
}

// Saving/round-tripping retains the original summary, nulls, both teams, all search controls and unrelated state.
it("stores a compact validated trade and matches the existing search/analyzer summaries", async () => {
  const { m, state, draft, query, summary } = await sample();
  state.filters.playersSearch = "keep";
  const raw = saveTrade(state, m, draft, summary, query);
  const read = readSavedTrades(raw);
  expect(read.issue).toBe("");
  expect(read.trades[0]).toMatchObject({ draft, query, original: summary });
  expect(state.filters).toEqual({ playersSearch: "keep" });
  const row = scoreTradeMatch(m, query, {
    key: "test",
    teamB: "2",
    get: ["200"],
    incoming: 0,
    outgoing: 0,
    difference: 0,
  });
  expect(summaryFromSearch(row)).toEqual(summary);
  const unavailable = summaryFromTrade({
    valid: false,
    errors: ["missing"],
  } as ReturnType<typeof evaluateTrade>);
  expect(unavailable.own).toBeNull();
  expect(unavailable.legal).toBeNull();
});

// Repeated saves update rather than duplicate, keeping the earliest reference and the user's edits.
it("deduplicates unordered packages and preserves names, notes and original results", async () => {
  const { m, state, draft, query, summary } = await sample();
  const raw = saveTrade(
    state,
    m,
    draft,
    summary,
    query,
    "2026-10-22T00:00:00Z",
  );
  const records = readSavedTrades(raw).trades;
  records[0].name = "My target";
  records[0].notes = "Discuss next week";
  state.filters[savedTradesKey] = writeSavedTrades(state, records);
  const updated = readSavedTrades(
    saveTrade(
      state,
      m,
      draft,
      { ...summary, own: 999 },
      { ...query, above: 10 },
      "2026-10-23T00:00:00Z",
    ),
  ).trades;
  expect(updated).toHaveLength(1);
  expect(updated[0]).toMatchObject({
    name: "My target",
    notes: "Discuss next week",
    createdAt: "2026-10-22T00:00:00Z",
    updatedAt: "2026-10-23T00:00:00Z",
    original: summary,
    query: { above: 10 },
  });
  expect(savedTradeIdentity(2026, { ...draft, give: ["3", "1"] })).toBe(
    savedTradeIdentity(2026, { ...draft, give: ["1", "3"] }),
  );
  expect(savedTradeIdentity(2027, draft)).not.toBe(
    savedTradeIdentity(2026, draft),
  );
});

// Ownership cleanup shrinks persistent account state only; source hashes/grades do not delete a valid saved trade.
it("automatically prunes ownership-invalid trades and marks cleanup pending for sync", async () => {
  const { d, m, state, draft, summary } = await sample();
  state.filters[savedTradesKey] = saveTrade(state, m, draft, summary);
  state.filters.other = "keep";
  const w: Workspace = {
    dataset: d,
    state,
    owner: "account-a",
    datasetRevision: 4,
    stateRevision: 5,
    pendingDataset: false,
    pendingState: false,
    requestId: "dataset",
    stateRequestId: "state",
  };
  expect(reconcileSavedTrades(w)).toBe(w);
  d.tables.ModelPlayers.find((p) => p.PlayerID === 200)!.OnTeamID = 0;
  const changed = reconcileSavedTrades(w)!;
  expect(readSavedTrades(changed.state.filters[savedTradesKey]).trades).toEqual(
    [],
  );
  expect(changed.pendingState).toBe(true);
  expect(changed.stateRequestId).not.toBe("state");
  expect(changed.state.filters.other).toBe("keep");
  expect(changed.stateRevision).toBe(5);
  expect(readSavedTrades(state.filters[savedTradesKey]).trades).toHaveLength(1);
});

// Bad/cloud-future formats never blank the app or get silently replaced, and sync-size limits include UTF-8 notes.
it("preserves corrupt state and rejects missing ownership, invalid filters and oversized saves", async () => {
  const { m, state, draft, summary, query } = await sample();
  for (const raw of ["bad", JSON.stringify({ version: 2, trades: [] })]) {
    expect(readSavedTrades(raw).issue).not.toBe("");
    expect(() =>
      saveTrade(
        { ...state, filters: { [savedTradesKey]: raw } },
        m,
        draft,
        summary,
      ),
    ).toThrow("could not be read");
  }
  expect(() =>
    saveTrade(state, m, { ...draft, get: ["missing"] }, summary),
  ).toThrow("currently owned");
  expect(() =>
    saveTrade(state, m, draft, summary, { ...query, above: NaN }),
  ).toThrow("invalid search controls");
  // Saved searches preserve the optional package filter and reject invalid enabled thresholds.
  expect(
    readSavedTrades(
      saveTrade(state, m, draft, summary, {
        ...query,
        usefulness: { minimum: 1.5 },
      }),
    ).trades[0].query?.usefulness,
  ).toEqual({ minimum: 1.5 });
  expect(() =>
    saveTrade(state, m, draft, summary, {
      ...query,
      usefulness: { minimum: -1 },
    }),
  ).toThrow("invalid search controls");
  expect(() =>
    saveTrade(state, m, draft, summary, {
      ...query,
      incoming: { signals: ["Gem"], minimumSignals: 2 },
    }),
  ).toThrow("invalid search controls");
  state.filters.other = "🟣".repeat(20000);
  expect(() => saveTrade(state, m, draft, summary)).toThrow(
    "sync storage is full",
  );
});

// Retiring a legacy source filter preserves all other search choices and never enables the replacement automatically.
it("drops retired surface restrictions without altering unrelated saved-query settings", async () => {
  const { withoutLegacySurface } = await import("../src/domain/surface-appeal");
  const original = {
    surface: { metric: "both", minimum: 9999 },
    goal: "surface",
    teams: ["2"],
    manager: undefined,
  };
  const migrated = withoutLegacySurface(original);
  expect(migrated).toEqual({
    goal: "custom",
    teams: ["2"],
    manager: undefined,
  });
  expect(original.surface.minimum).toBe(9999);
  expect(
    withoutLegacySurface({ manager: { version: 1 }, goal: "explore" }),
  ).toEqual({ manager: { version: 1 }, goal: "explore" });
});
