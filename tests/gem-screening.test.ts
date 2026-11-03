import { beforeAll, expect, it } from "vitest";
import { fixture } from "./fixtures";
import { evaluate, type Player } from "../src/domain/valuation";
import { signalAppearance } from "../src/domain/signal-appearance";
import {
  decodeGemFilters,
  defaultGemDraft,
  gemSignals,
  gemQuerySummary,
  encodeGemFilters,
  risingGemDraft,
  screenGems,
  validateGemDraft,
} from "../src/domain/gem-screening";

// Use a genuine model-shaped synthetic player; these tests alter only screen inputs.
let base: Player;
beforeAll(async () => {
  const d = await fixture();
  base = {
    ...evaluate(d, d.settings).players[0],
    gem: "Gem",
    owner: "0",
    trendDelta: 2,
    index: 10,
    recent: 12,
    games: 5,
    gap: 3,
    uncertain: false,
    value: 15,
    baseline: 10,
  };
});
const player = (id: string, patch: Partial<Player> = {}) => ({
  ...base,
  id,
  ...patch,
});
const query = (patch = {}) =>
  validateGemDraft({ ...risingGemDraft("1"), ...patch }, ["1", "2"]).query!;

// Multiple selections are cumulative requirements; extra labels are allowed, but partial matches never qualify.
it("requires every selected signal while permitting additional player labels", () => {
  const rows = [
    player("1", {
      gem: "Watch",
      regression: "NEUTRAL",
      opportunity: { ...base.opportunity, signals: ["Scoring breakout watch"] },
    }),
    player("2", {
      gem: "Watch",
      regression: "NEUTRAL",
      opportunity: { ...base.opportunity, signals: ["Role-growth watch"] },
    }),
    player("3", {
      gem: "Watch",
      regression: "NEUTRAL",
      opportunity: {
        ...base.opportunity,
        signals: ["Role-growth watch", "Scoring breakout watch"],
      },
    }),
    player("4", {
      gem: "Watch",
      regression: "NEUTRAL",
      opportunity: {
        ...base.opportunity,
        signals: ["Role-growth watch", "TD caution"],
      },
    }),
  ];
  const combined = query({
    signals: ["Watch", "Role-growth watch", "Scoring breakout watch"],
    pool: "Available",
    positiveOnly: true,
  });
  expect(screenGems(rows, combined).matches.map((r) => r.player.id)).toEqual([
    "3",
  ]);
  expect(
    screenGems(rows, {
      ...combined,
      signals: ["Role-growth watch"],
    }).matches.map((r) => r.player.id),
  ).toEqual(["2", "3"]);
  expect(
    screenGems(rows, {
      ...combined,
      positiveOnly: false,
      signals: ["Watch"],
    }).matches.map((r) => r.player.id),
  ).toEqual(["1", "2", "3", "4"]);
  const required = {
    ...combined,
    positiveOnly: false,
    signals: ["Watch", "Role-growth watch", "TD caution"],
  };
  expect(screenGems(rows, required).matches.map((r) => r.player.id)).toEqual([
    "4",
  ]);
  expect(gemQuerySummary(required)).toContain(
    "(Watch AND Role-growth watch AND TD caution)",
  );
  expect(
    validateGemDraft(decodeGemFilters(encodeGemFilters(required), "1").draft, [
      "1",
      "2",
    ]).query,
  ).toEqual({
    ...required,
    signals: gemSignals.filter((s) => required.signals.includes(s)),
  });
});

// A strong positive cannot hide any red primary, supporting or regression tag, including in the incomplete section.
it("positive-only screening requires a positive label and excludes every red badge classification", () => {
  const clean = (id: string, patch: Partial<Player> = {}) =>
    player(id, {
      regression: "NEUTRAL",
      opportunity: { ...base.opportunity, signals: [] },
      ...patch,
    });
  const rows = [
    clean("1"),
    clean("2", { gem: "Pre-gem" }),
    clean("3", { gem: "Watch" }),
    clean("4", {
      opportunity: { ...base.opportunity, signals: ["Reduced workload"] },
    }),
    clean("5", {
      gem: "No breakout signal",
      opportunity: { ...base.opportunity, signals: ["Scoring breakout watch"] },
    }),
    clean("6", { regression: "SELL HIGH" }),
    clean("7", { gem: "Insufficient data" }),
    clean("8", { gem: "Not applicable" }),
    clean("9", { gem: "Not applicable", regression: "BUY LOW" }),
    clean("10", {
      gem: "Watch",
      opportunity: { ...base.opportunity, signals: ["TD caution"] },
    }),
    clean("11", { gem: "Watch", trendDelta: null }),
    clean("12", { index: 9 }),
    clean("13", { regression: "NEUTRAL - insufficient data" }),
    clean("14", { arrow: "↓" }),
  ];
  const before = structuredClone(rows);
  const result = screenGems(
    rows,
    query({ signals: [], positiveOnly: true, includeMissing: true }),
  );
  expect(result.matches.map((r) => r.player.id)).toEqual(["1", "2", "3", "9"]);
  expect(result.incomplete.map((r) => r.player.id)).toEqual(["11"]);
  expect(
    screenGems(rows, query({ signals: [], positiveOnly: false })).matches.map(
      (r) => r.player.id,
    ),
  ).toContain("4");
  for (const label of [
    "Reduced workload",
    "No breakout signal",
    "No gem signal",
    "TD caution",
    "SELL HIGH",
    "Insufficient data",
    "Limited history",
    "Projection only",
    "Data issue",
  ])
    expect(signalAppearance(label)).toBe("caution");
  expect(rows).toEqual(before);
});

// Existing searches default off, while applied state round-trips and malformed saved flags require explicit recovery.
it("persists the opt-in positive-label filter without broadening or changing legacy searches", () => {
  expect(defaultGemDraft("1").positiveOnly).toBe(false);
  expect(decodeGemFilters({ gemSignal: "Watch" }, "1").draft.positiveOnly).toBe(
    false,
  );
  const q = query({ positiveOnly: true });
  expect(gemQuerySummary(q)).toContain("Positive labels only (no red labels)");
  const saved = encodeGemFilters(q);
  expect(saved.gemPositiveOnly).toBe("true");
  expect(
    validateGemDraft(decodeGemFilters(saved, "1").draft, ["1", "2"]).query,
  ).toEqual(q);
  expect(encodeGemFilters({ ...q, positiveOnly: false }).gemPositiveOnly).toBe(
    "false",
  );
  expect(
    decodeGemFilters({ ...saved, gemPositiveOnly: "yes" }, "1").issue,
  ).not.toBe("");
});

// With no required signals, all labels remain eligible while numeric thresholds retain inclusive AND behavior.
it("returns exactly the numeric matches without mutating players", () => {
  const players = [
    player("1"),
    player("2", { gem: "Watch", index: 40 }),
    player("3", { gem: "Emerging" }),
    player("4", { trendDelta: 1.99 }),
    player("5", { index: 40.000001 }),
    player("6", { recent: 11.999 }),
    player("7", { games: 4 }),
    player("8", { index: 9.99999 }),
  ];
  const before = structuredClone(players);
  expect(screenGems(players, query()).matches.map((r) => r.player.id)).toEqual([
    "1",
    "2",
    "3",
  ]);
  expect(players).toEqual(before);
});

// A known failure always excludes a row; missing evidence never turns into a match.
it("separates missing active data and ignores missing inactive metrics", () => {
  const rows = [
    player("1", { trendDelta: null }),
    player("2", { trendDelta: null, index: 90 }),
    player("3", { gap: null }),
  ];
  const screened = screenGems(rows, query());
  expect(screened.matches.map((r) => r.player.id)).toEqual(["3"]);
  expect(screened.incomplete.map((r) => r.player.id)).toEqual(["1"]);
  expect(screened.incomplete[0].missing[0]).toContain("Trend PPG unavailable");
  expect(
    screenGems(rows, query({ trendMin: "" })).matches.map((r) => r.player.id),
  ).toEqual(["1", "3"]);
});

// Valid zeros and signed thresholds must not be confused with missing values.
it("handles zero, negative, and nonfinite metrics without rounding", () => {
  const q = query({
    trendMin: "-2",
    indexMin: "0",
    recentMin: "0",
    gamesMin: "",
    gapMin: "-1",
  });
  const rows = [
    player("1", { trendDelta: -2, index: 0, recent: 0, gap: -1 }),
    player("2", { index: NaN }),
    player("3", { trendDelta: -2.00001 }),
  ];
  expect(screenGems(rows, q).matches.map((r) => r.player.id)).toEqual(["1"]);
  expect(screenGems(rows, q).incomplete.map((r) => r.player.id)).toEqual(["2"]);
});

// Above replacement is a PPG condition, not a positive-VORP or availability condition.
it("preserves thin baselines and excludes nonpositive PPG advantages", () => {
  const rows = [
    player("1", {
      vorp: 0,
      baselineStatus: "CONDITIONAL - thin replacement pool",
    }),
    player("2", { value: 10 }),
    player("3", { value: 9 }),
    player("4", { baseline: null }),
  ];
  const screened = screenGems(rows, query({ aboveReplacement: true }));
  expect(screened.matches.map((r) => r.player.id)).toEqual(["1"]);
  expect(screened.matches[0].player.baselineStatus).toContain("CONDITIONAL");
  expect(screened.incomplete.map((r) => r.player.id)).toEqual(["4"]);
});

// Empty signal choices lift only that restriction, preserving other categorical filters.
it("respects ownership, injury and position when no signals are selected", () => {
  const rows = [
    player("1"),
    player("2", { owner: "2" }),
    player("3", { uncertain: true }),
    player("4", { pos: "QB", trendDelta: null }),
  ];
  expect(
    screenGems(
      rows,
      query({ pool: "Available", includeMissing: true }),
    ).matches.map((r) => r.player.id),
  ).toEqual(["1"]);
  expect(
    screenGems(rows, query({ pool: "Selected team", team: "2" })).matches.map(
      (r) => r.player.id,
    ),
  ).toEqual(["2"]);
  expect(
    screenGems(rows, query({ signals: [] })).matches.map((r) => r.player.id),
  ).toEqual(["1", "2"]);
});

// Reject malformed drafts before they can replace the previously applied query.
it("validates finite decimal input, index ranges, and whole-game counts", () => {
  for (const raw of ["Infinity", "NaN", "0x10", "1e2", "two"])
    expect(
      validateGemDraft({ ...defaultGemDraft("1"), trendMin: raw }, ["1"]).query,
    ).toBeNull();
  for (const patch of [
    { indexMin: "-1" },
    { indexMax: "101" },
    { indexMin: "40", indexMax: "10" },
    { gamesMin: "1.5" },
    { gamesMin: "18" },
    { pool: "Selected team", team: "missing" },
  ])
    expect(
      validateGemDraft({ ...defaultGemDraft("1"), ...patch }, ["1"]).query,
    ).toBeNull();
  expect(query({ trendMin: " +2.00 ", indexMax: "" }).trendMin).toBe(2);
  expect(query({ indexMax: "" }).indexMax).toBeNull();
});

// Saved older searches retain their categories while new numeric criteria start blank.
it("migrates legacy signals and round-trips only applied string-valued state", () => {
  const legacy = decodeGemFilters(
    {
      gemSignal: "Opportunity watch",
      gemPool: "Selected team",
      gemTeam: "2",
      gemPos: "WR",
      gemInjured: "true",
    },
    "1",
  );
  expect(legacy.draft).toMatchObject({
    signals: ["Watch"],
    pool: "Selected team",
    team: "2",
    position: "WR",
    injured: true,
    trendMin: "",
  });
  expect(legacy.issue).toBe("");
  const saved = encodeGemFilters(query());
  expect(Object.values(saved).every((v) => typeof v === "string")).toBe(true);
  expect(
    validateGemDraft(decodeGemFilters(saved, "1").draft, ["1", "2"]).query,
  ).toEqual(query());
  expect(encodeGemFilters(query({ trendMin: "" })).gemTrendMin).toBe("");
  expect(
    decodeGemFilters({ gemSignal: "All signals" }, "1").draft.signals,
  ).toEqual([]);
});

// Retiring status choices must not break saved searches or discard unrelated criteria.
it("removes retired status selections while preserving saved screening criteria", () => {
  for (const status of ["Insufficient data", "Not applicable"]) {
    expect(gemSignals).not.toContain(status);
    const restored = decodeGemFilters(
      {
        ...encodeGemFilters(query()),
        gemSignals: JSON.stringify(["Gem", status, "Watch"]),
      },
      "1",
    );
    expect(restored.issue).toBe("");
    expect(restored.draft.signals).toEqual(["Gem", "Watch"]);
    expect(restored.draft.trendMin).toBe("2");
    expect(validateGemDraft(restored.draft, ["1", "2"]).query).not.toBeNull();
    expect(decodeGemFilters({ gemSignal: status }, "1").draft.signals).toEqual(
      [],
    );
  }
  for (const alias of ["Limited history", "Projection only", "Data issue"])
    expect(decodeGemFilters({ gemSignal: alias }, "1").draft.signals).toEqual(
      [],
    );
  const retiredOnly = decodeGemFilters(
    {
      gemFilterVersion: "2",
      gemSignals: '["Insufficient data","Not applicable"]',
      gemTrendMin: "2",
    },
    "1",
  );
  expect(retiredOnly.issue).toBe("");
  expect(retiredOnly.draft.signals).toEqual([]);
  expect(retiredOnly.draft.trendMin).toBe("2");
  // Select all now requires every signal; only clearing signals permits status-only players.
  const rows = [
    player("1", { gem: "Insufficient data" }),
    player("2", { gem: "Not applicable" }),
    player("3", { gem: "Gem" }),
  ];
  const all = query({ signals: [...gemSignals] });
  expect(screenGems(rows, all).matches).toEqual([]);
  expect(
    screenGems(rows, { ...all, signals: [] }).matches.map(
      (row) => row.player.id,
    ),
  ).toEqual(["1", "2", "3"]);
  expect(decodeGemFilters(encodeGemFilters(all), "1").draft.signals).toEqual([
    ...gemSignals,
  ]);
  for (const signals of [
    gemSignals,
    gemSignals.filter((s) => s !== "Pre-gem"),
    [
      "Gem",
      "Pre-gem",
      "Watch",
      "Projection-gap watch",
      "Role-growth watch",
      "Scoring breakout watch",
    ],
  ])
    expect(
      decodeGemFilters(
        {
          ...encodeGemFilters(all),
          gemFilterVersion: "3",
          gemSignals: JSON.stringify(signals),
        },
        "1",
      ).draft.signals,
    ).toEqual([]);
});

// Unsupported or malformed new state must require correction rather than broadening.
it("reports corrupt saved queries and missing selected teams", () => {
  const saved = encodeGemFilters(query());
  expect(
    decodeGemFilters({ ...saved, gemSignals: "not json" }, "1").issue,
  ).not.toBe("");
  expect(
    decodeGemFilters({ ...saved, gemFilterVersion: "999" }, "1").issue,
  ).not.toBe("");
  expect(
    decodeGemFilters({ ...saved, gemAboveReplacement: "maybe" }, "1").issue,
  ).not.toBe("");
  const bad = decodeGemFilters(
    { ...saved, gemIndexMin: "80", gemIndexMax: "10" },
    "1",
  );
  expect(validateGemDraft(bad.draft, ["1"]).query).toBeNull();
});

// Rising rostered RBs remain searchable even without a gem/opportunity classification.
it("screens an owned No gem signal RB with +15.42 trend when pool and signals are unrestricted", () => {
  const rb = player("900", {
    name: "Synthetic rising RB",
    pos: "RB",
    owner: "8",
    gem: "No breakout signal",
    trendDelta: 15.416666666666668,
    index: 8.22,
  });
  const draft = { ...defaultGemDraft("1"), position: "RB", trendMin: "2" };
  expect(
    screenGems([rb], validateGemDraft(draft, ["1", "8"]).query!).matches,
  ).toHaveLength(0);
  const broad = validateGemDraft({ ...draft, pool: "All", signals: [] }, [
    "1",
    "8",
  ]).query!;
  expect(screenGems([rb], broad).matches.map((r) => r.player.id)).toEqual([
    "900",
  ]);
  expect(broad.trendMin).toBe(2);
});

// Reproduce the user's saved empty selection instead of requiring every label to be checked.
it("treats cleared signals as Any signal and round-trips that meaning", () => {
  const draft = {
    ...defaultGemDraft("1"),
    position: "RB",
    trendMin: "2",
    signals: [],
  };
  const q = validateGemDraft(draft, ["1"]).query!;
  const rows = [
    player("1", { gem: "No breakout signal", trendDelta: 15.4166666667 }),
    player("2", { gem: "TD caution", trendDelta: 2 }),
    player("3", { trendDelta: 1.99 }),
    player("4", { owner: "8", gem: "No breakout signal", trendDelta: 15.42 }),
  ];
  expect(screenGems(rows, q).matches.map((r) => r.player.id)).toEqual([
    "1",
    "2",
  ]);
  expect(gemQuerySummary(q)).toContain(
    "Any signal AND Pool: Available AND Position: RB AND Trend PPG ≥ 2",
  );
  const saved = encodeGemFilters(q);
  expect(saved.gemSignal).toBe("All signals");
  const restored = validateGemDraft(decodeGemFilters(saved, "1").draft, [
    "1",
  ]).query!;
  expect(restored.signals).toEqual([]);
  expect(screenGems(rows, restored).matches.map((r) => r.player.id)).toEqual([
    "1",
    "2",
  ]);
});
