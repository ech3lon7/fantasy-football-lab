import { fairChainFixture } from "./chain-fixture";
import { searchTradeChains, type ChainQuery } from "../src/domain/trade-chains";
import { applyRosterScenario } from "../src/domain/roster-scenarios";
import { expect, it } from "vitest";
import { surfaceFixture } from "./surface-fixture";
import { evaluate } from "../src/domain/valuation";
import { evaluateTrade } from "../src/domain/trades";
import {
  acceptanceBand,
  managerAssessment,
  managerFailures,
  surfaceRanks,
} from "../src/domain/manager-expectations";
import {
  scoreTradeMatch,
  tradeSearchContext,
  type TradeSearchQuery,
} from "../src/domain/trade-search";
import { discoveryFailures } from "../src/domain/trade-discovery";
import {
  saveTrade,
  readSavedTrades,
  summaryFromSearch,
} from "../src/domain/saved-trades";
import { initialState } from "../src/domain/contracts";
import {
  freezeAssessment,
  journalCalibration,
  newJournalOffer,
  sameJournalEntry,
  linkedJournalOffer,
  type JournalEntry,
} from "../src/domain/trade-journal";
import { journalFromTables } from "../src/import/trade-journal";
import { tradeResultGroups } from "../src/domain/trade-result-groups";

// One synthetic roster disagreement exercises the same domain entry points used by direct analysis and workers.
async function sample() {
  const d = await surfaceFixture(),
    m = evaluate(d, d.settings);
  const draft = { teamA: "1", teamB: "2", give: ["1"], get: ["2"] };
  const r = evaluateTrade(m, draft, false);
  return { d, m, draft, r };
}

// Boundary checks distinguish inclusive and exclusive endpoints without rounding display values first.
it("uses the documented five exact margin bands", () => {
  expect(
    [-7, -6, -5.999, -2.001, -2, 0, 1.999, 2, 5.999, 6, 9].map(acceptanceBand),
  ).toEqual([-2, -2, -1, -1, 0, 0, 0, 1, 1, 2, 2]);
});

// Enabling manager assumptions changes neither the original player metrics nor private trade scoring.
it("preserves off-state behavior, private metrics, snapshot identity and explicit saved settings", async () => {
  const { d, m, draft } = await sample();
  const q: TradeSearchQuery = {
    teamA: "1",
    give: ["1"],
    count: 1,
    below: 5,
    above: 5,
    indexMode: "automatic",
  };
  const match = {
    key: "example",
    teamB: "2",
    get: ["2"],
    outgoing: 1,
    incoming: 2,
    difference: 1,
  };
  const before = m.players.map((p) => [
    p.id,
    p.actual,
    p.expected,
    p.value,
    p.index,
    p.gem,
  ]);
  const ordinary = scoreTradeMatch(m, q, match),
    enabled = { ...q, manager: { version: 1 as const, profiles: {} } },
    assessed = scoreTradeMatch(m, enabled, match);
  expect(ordinary.manager).toBeUndefined();
  expect(managerFailures(undefined)).toEqual([]);
  expect(assessed.manager).toBeDefined();
  expect(assessed.own).toBe(ordinary.own);
  expect(assessed.other).toBe(ordinary.other);
  expect(
    m.players.map((p) => [p.id, p.actual, p.expected, p.value, p.index, p.gem]),
  ).toEqual(before);
  expect(tradeSearchContext(m, enabled)).not.toBe(tradeSearchContext(m, q));
  const state = saveTrade(
    initialState(d),
    m,
    draft,
    summaryFromSearch(assessed),
    enabled,
  );
  expect(readSavedTrades(state).trades[0].query?.manager).toEqual(
    enabled.manager,
  );
});

// Actual averages can justify an eligible offer without requiring positive recipient private EPPG or the old positive-surface filter.
it("keeps missing optional projections separate from mandatory actual data", async () => {
  const { m, draft, r } = await sample();
  m.byId.get("2")!.weekly = null;
  const a = managerAssessment(m, draft, r, { version: 1, profiles: {} });
  expect(a.average?.gain).not.toBeNull();
  expect(a.projection?.gain).toBeNull();
  expect(a.caution).toBe(0);
  expect(a.status).not.toBe("unavailable");
  m.byId.get("2")!.actual = null;
  const missing = managerAssessment({ ...m }, draft, r, {
    version: 1,
    profiles: {},
  });
  expect(missing.status).toBe("unavailable");
  expect(missing.range).toBeUndefined();
  expect(
    managerFailures(missing, { version: 1, profiles: {} }).length,
  ).toBeGreaterThan(0);
});

// One incoming player cannot satisfy two distinct departing elite main-return requirements.
it("does not reuse one main return for multiple elite departures", async () => {
  const { m, draft } = await sample();
  m.byId.get("5")!.owner = "2";
  draft.get = ["2", "5"];
  const r = evaluateTrade(m, draft, false),
    a = managerAssessment({ ...m }, draft, r, { version: 1, profiles: {} });
  expect(a.status).toBe("safeguard-failed");
  expect(a.range).toBeUndefined();
});

// Player/position uniqueness makes the named role deltas exactly equal the full average-lineup change.
it("reconciles all outgoing losses and gains and freezes enough evidence for later inspection", async () => {
  const { m, draft, r } = await sample();
  const a = managerAssessment(m, draft, r, { version: 1, profiles: {} });
  const average = a.average!;
  const score = (id: string | null) => (id ? m.byId.get(id)!.actual! : 0);
  expect(
    average.afterIds.reduce(
      (sum, id, i) => sum + score(id) - score(average.beforeIds[i]),
      0,
    ),
  ).toBeCloseTo(average.gain!, 10);
  expect(new Set(average.afterIds.filter(Boolean)).size).toBe(
    average.afterIds.filter(Boolean).length,
  );
  const frozen = freezeAssessment(a);
  expect(frozen.evidence.length).toBeGreaterThanOrEqual(
    draft.get.length + draft.give.length,
  );
  m.byId.get("1")!.actual = 999;
  expect(frozen.evidence.find((e) => e.id === "1")!.actual).not.toBe(999);
});

// More permissive presets cannot reject or lower an assessment that a stricter preset already accepted.
it("maintains eligibility/range monotonicity and ignores real bye-driven projection caution", async () => {
  const { m, draft, r } = await sample();
  m.byId.get("1")!.bye = m.current;
  const all = [0, 1, 2, 3, 4].map((override) =>
    managerAssessment(m, draft, r, { version: 1, override, profiles: {} }),
  );
  for (const a of all) expect(a.caution ?? 0).toBe(0);
  for (let i = 1; i < all.length; i++)
    if (all[i - 1].range) {
      expect(all[i].range).toBeDefined();
      expect(all[i].band!).toBeGreaterThanOrEqual(all[i - 1].band!);
    }
  const rank = surfaceRanks(m).positional.get("1");
  m.byId.get("1")!.owner = "3";
  expect(surfaceRanks(m).positional.get("1")).toBe(rank);
});

// Manager failures participate in normal diagnostics, but never replace the independent legacy surface checks.
it("reports manager reasons independently and groups every exact offer without discarding alternatives", async () => {
  const { m } = await sample();
  const q: TradeSearchQuery = {
    teamA: "1",
    give: ["1"],
    count: 1,
    below: 5,
    above: 5,
    indexMode: "automatic",
    manager: { version: 1, profiles: {} },
  };
  const row = scoreTradeMatch(m, q, {
    key: "one",
    teamB: "2",
    get: ["2"],
    outgoing: 1,
    incoming: 2,
    difference: 1,
  });
  const groups = tradeResultGroups(m, [
    row,
    { ...row, key: "two", give: ["1", "3"] },
  ]);
  expect(
    groups
      .flatMap((t) => t.targets.flatMap((target) => target.alternatives))
      .map((r) => r.key),
  ).toEqual(["one", "two"]);
  const unavailable = {
    ...row,
    manager: {
      ...row.manager!,
      status: "unavailable" as const,
      reasons: ["Missing surface history"],
    },
  };
  expect(discoveryFailures(unavailable, q)).toContain(
    "Missing surface history",
  );
  expect(
    discoveryFailures(unavailable, { ...q, manager: undefined }),
  ).not.toContain("Missing surface history");
});

// The supplied journal structure is directional; a counter remains linked without inferring its outcome from player ordering.
it("imports normalized documented offers with counter direction and unresolved-data protection", () => {
  const source = {
    OfferID: "A",
    NegotiationID: "N",
    ParentOfferID: "",
    Season: 2026,
    NFLWeek: 7,
    ProposerTeamID: 1,
    Proposer: "Manager A",
    RecipientTeamID: 2,
    Recipient: "Manager B",
    Outcome: "Rejected",
  };
  const lines = [
    { OfferID: "A", Side: "Offered", PlayerID: 10, Player: "Synthetic A" },
    { OfferID: "A", Side: "Requested", PlayerID: 20, Player: "Synthetic B" },
  ];
  const imported = journalFromTables(
    [source],
    lines,
    "2026-10-29T00:00:00.000Z",
  );
  expect(imported.entries[0].kind).toBe("offer");
  const e = imported.entries[0];
  if (e.kind !== "offer") throw Error("Wrong kind");
  expect(e.payload.draft).toEqual({
    teamA: "1",
    teamB: "2",
    give: ["10"],
    get: ["20"],
  });
  expect(e.payload.provenance).toBe("documented");
  expect(() => journalFromTables([source], [])).toThrow(/Incomplete/);
});

// Historical journal imports and the user's practice decisions never become prospective opponent-validation successes.
it("tracks one exact prospective version once and excludes documented, simulated and user responses", async () => {
  const { m, draft, r } = await sample(),
    utc = "2026-10-29T00:00:00.000Z",
    payload = newJournalOffer(m, draft, "1", utc);
  payload.outcome = "accepted";
  payload.responses = [
    {
      outcome: "accepted",
      actor: draft.teamB,
      recordedUTC: "2026-10-29T00:01:00.000Z",
    },
  ];
  const a = managerAssessment(m, draft, r, { version: 1, profiles: {} });
  a.band = 0;
  a.status = "eligible";
  a.range = [15, 45];
  const offer: JournalEntry = { id: "offer", kind: "offer", payload };
  const forecast: JournalEntry = {
    id: "forecast",
    kind: "forecast",
    payload: {
      offer: "offer",
      recordedUTC: utc,
      assessment: a,
      draft,
      origin: "prospective",
      context: "synthetic",
      settings: "{}",
      names: {},
      rosters: { before: [], after: [], drops: [] },
    },
  };
  const bins = journalCalibration([
    offer,
    forecast,
    { ...forecast, id: "forecast-two" },
  ]);
  expect(bins[2]).toMatchObject({ tried: 1, accepted: 1, negotiations: 1 });
  for (const origin of ["retrospective", "simulation"] as const)
    expect(
      journalCalibration([
        offer,
        { ...forecast, payload: { ...forecast.payload, origin } },
      ])[2].tried,
    ).toBe(0);
  expect(
    journalCalibration([
      { ...offer, payload: { ...payload, recipientIsUser: true } },
      forecast,
    ])[2].tried,
  ).toBe(0);
});

// Incoming bye players are absent from weekly lineups; their known bye must still suppress a misleading projection penalty.
it("does not penalize a temporary weekly loss caused by an incoming bye", async () => {
  const { m, draft, r } = await sample();
  m.byId.get("1")!.bye = m.current;
  m.byId.get("1")!.weekly = 0;
  const assessment = managerAssessment(m, draft, r, {
    version: 1,
    override: 4,
    profiles: {},
  });
  expect(assessment.projection?.gain).toBeLessThan(0);
  expect(assessment.caution).toBe(0);
});

// JSONB property ordering and a later workbook import time are not edits to a documented negotiation.
it("compares journal content semantically while detecting changed historical facts", async () => {
  const { m, draft } = await sample();
  const payload = newJournalOffer(m, draft, "1", "2026-10-29T00:00:00.000Z");
  payload.provenance = "documented";
  const entry: JournalEntry = { id: "same", kind: "offer", payload };
  const reordered: JournalEntry = {
    kind: "offer",
    payload: {
      ...payload,
      names: Object.fromEntries(Object.entries(payload.names).reverse()),
      recordedUTC: "2026-10-30T00:00:00.000Z",
    },
    id: "same",
  };
  expect(sameJournalEntry(entry, reordered)).toBe(true);
  expect(
    sameJournalEntry(entry, {
      ...reordered,
      payload: { ...reordered.payload, outcome: "accepted" },
    }),
  ).toBe(false);
});

// Preserve self-revisions and the exact responder instead of assuming every edited offer was a counter from the opponent.
it("distinguishes an opponent counter from the proposer improving their own offer", async () => {
  const { m, draft } = await sample();
  const first = newJournalOffer(m, draft, "1", "2026-10-29T00:00:00.000Z");
  const parent: Extract<JournalEntry, { kind: "offer" }> = {
    id: "original",
    kind: "offer",
    payload: first,
  };
  const improved = { ...first, recordedUTC: "2026-10-29T00:05:00.000Z" };
  expect(linkedJournalOffer(parent, improved, "self")).toHaveLength(1);
  const counter = {
    ...improved,
    draft: {
      teamA: draft.teamB,
      teamB: draft.teamA,
      give: draft.get,
      get: draft.give,
    },
  };
  const linked = linkedJournalOffer(parent, counter, "counter");
  expect(linked).toHaveLength(2);
  expect(linked[1].kind === "offer" && linked[1].payload.responseActor).toBe(
    draft.teamB,
  );
  expect(linked[0].kind === "offer" && linked[0].payload.parent).toBe(
    "original",
  );
  expect(() =>
    linkedJournalOffer(parent, {
      ...counter,
      draft: { ...counter.draft, teamA: "unrelated" },
    }),
  ).toThrow(/same two/);
});

// Per-stage filters use the actual staged roster and never change private gains or the other stage's enablement.
it("evaluates independent manager settings on both connected chain stages", async () => {
  const d = await fairChainFixture(),
    m = evaluate(d, d.settings);
  const manager = { version: 1 as const, override: 4, profiles: {} };
  const q: ChainQuery = {
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
  const ordinary = searchTradeChains(m, q),
    filtered = searchTradeChains(m, {
      ...q,
      first: { ...q.first, manager },
      second: { ...q.second, manager },
    });
  expect(filtered.chains.length).toBeGreaterThan(0);
  for (const chain of filtered.chains) {
    expect(chain.first.row.manager?.status).toBe("eligible");
    expect(chain.second.row.manager?.status).toBe("eligible");
    const existing = ordinary.chains.find((c) => c.key === chain.key)!;
    expect(existing.gain).toBe(chain.gain);
    const staged = applyRosterScenario(m, chain.afterFirst),
      trade = evaluateTrade(staged, chain.second.draft, false);
    expect(
      managerAssessment(staged, chain.second.draft, trade, manager).average,
    ).toEqual(chain.second.row.manager?.average);
  }
  const firstOnly = searchTradeChains(m, {
    ...q,
    first: { ...q.first, manager },
  });
  expect(firstOnly.chains.length).toBeGreaterThan(0);
  expect(
    firstOnly.chains.every((c) => c.first.row.manager && !c.second.row.manager),
  ).toBe(true);
  const strictSecond = searchTradeChains(m, {
    ...q,
    first: { ...q.first, manager },
    second: { ...q.second, manager: { ...manager, override: 0 } },
  });
  expect(strictSecond.stats.rejectedManager).toBeGreaterThan(0);
});
