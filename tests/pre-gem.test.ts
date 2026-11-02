import { expect, it } from "vitest";
import { fixture } from "./fixtures";
import { evaluate, playerSignals } from "../src/domain/valuation";
import { defaultGemRules, gemVersion } from "../src/domain/label-rules";
import { activeTagExplanations } from "../src/domain/tag-evidence";
import {
  defaultGemDraft,
  decodeGemFilters,
  encodeGemFilters,
  gemSignals,
  screenGems,
  validateGemDraft,
} from "../src/domain/gem-screening";
import { matchesIncoming } from "../src/domain/trade-search";
import { initialState } from "../src/domain/contracts";
import {
  readSavedTrades,
  saveTrade,
  summaryFromTrade,
} from "../src/domain/saved-trades";
import { evaluateTrade } from "../src/domain/trades";
import {
  advanceGemJournal,
  emptyGemJournal,
  gemJournalSchema,
  preGemTrackingReport,
} from "../src/domain/gem-tracking";

// Build complete synthetic counts without borrowing real league data or overriding the classifier's answer.
async function sample(
  pos: "RB" | "WR" | "TE",
  scores: number[],
  counts?: number[],
) {
  const d = await fixture(scores),
    rule = defaultGemRules.positions[pos];
  d.tables.ModelPlayers[0].Position = pos;
  d.tables.ModelHistory.filter((r) => r.PlayerID === 1).forEach((r, i) => {
    r.Targets = pos === "RB" ? 2 : (counts?.[i] ?? rule.mean);
    r.RushAttempts = pos === "RB" ? (counts?.[i] ?? rule.mean) - 2 : 0;
  });
  return d;
}

// A genuine one-window scoring emergence qualifies at every position and becomes full Gem only after confirmation.
it.each(["RB", "WR", "TE"] as const)(
  "automatically stages %s through Pre-gem to Gem without changing value formulas",
  async (pos) => {
    const floor = defaultGemRules.positions[pos].points;
    const d = await sample(pos, [0, floor, floor + 1, floor + 2]);
    const m = evaluate(d, d.settings),
      p = m.byId.get("1")!;
    expect(p.gem).toBe("Pre-gem");
    expect(
      playerSignals(p).filter((s) => ["Gem", "Pre-gem", "Watch"].includes(s)),
    ).toEqual(["Pre-gem"]);
    expect(p.breakout!.preGemChecks.every((c) => c.status === "PASS")).toBe(
      true,
    );
    expect(p.breakout!.evaluatedThrough).toBe(4);
    expect(p.breakout!.checks.some((c) => c.status === "FAIL")).toBe(true);
    const evidence = activeTagExplanations(p, m).find(
      (e) => e.tag === "Pre-gem",
    )!;
    expect(
      evidence.rows.find((r) => r.check === "Recent window scoring support")!
        .actual,
    ).toContain(`2026 W2: ${floor.toFixed(2)}`);
    expect(
      evidence.rows.find((r) => r.check === "Scoring improvement")!.actual,
    ).toContain("weeks 2, 3, 4 versus 1");
    const prior = evaluate(d, d.settings, { workbookMode: true }).byId.get(
      "1",
    )!;
    for (const key of [
      "actual",
      "recent",
      "expected",
      "penalty",
      "value",
      "baseline",
      "vorp",
      "index",
    ] as const)
      expect(p[key]).toEqual(prior[key]);
    const confirmed = await sample(pos, [
      0,
      floor,
      floor + 1,
      floor + 2,
      floor + 2,
    ]);
    const full = evaluate(confirmed, confirmed.settings).byId.get("1")!;
    expect(full.gem).toBe("Gem");
    expect(
      activeTagExplanations(full, evaluate(confirmed, confirmed.settings)).some(
        (e) => e.tag === "Pre-gem",
      ),
    ).toBe(false);
    expect(gemVersion).toBe("automatic-breakout-3");
  },
);

// The three-game exception has explicit smaller trend windows; flat scoring, declining workload and weaker points do not qualify.
it("requires actual scoring, a positive trend, workload support and at least three games", async () => {
  const early = await sample("WR", [14, 18, 18]);
  const earlyPlayer = evaluate(early, early.settings).byId.get("1")!;
  expect(earlyPlayer.gem).toBe("Pre-gem");
  expect(earlyPlayer.breakout!.preGemChecks[0].actual).toContain(
    "early sample: latest two versus first game",
  );
  for (const [scores, work] of [
    [
      [16, 16, 16],
      [7, 7, 7],
    ],
    [
      [0, 16, 17, 18],
      [10, 7, 7, 7],
    ],
    [
      [0, 12, 13, 14],
      [7, 7, 7, 7],
    ],
    [
      [0, 16, 17, 18],
      [5, 6, 6, 6],
    ],
    [
      [18, 20],
      [7, 7],
    ],
  ]) {
    const d = await sample("WR", scores, work);
    expect(evaluate(d, d.settings).byId.get("1")!.gem).not.toBe("Pre-gem");
  }
  const zero = await sample("WR", [-1, 16, 17, 18]);
  expect(evaluate(zero, zero.settings).byId.get("1")!.gem).toBe("Pre-gem");
});

// Missing evidence and uncertain availability never become a positive label or silently change existing primary Gem policy.
it("rejects missing counts, duplicates, uncertain injuries and non-applicable positions", async () => {
  for (const mode of ["missing", "duplicate", "injury", "QB"] as const) {
    const d = await sample("WR", [0, 16, 17, 18]);
    if (mode === "missing")
      delete d.tables.ModelHistory.find(
        (r) => r.PlayerID === 1 && r.Week === 1,
      )!.Targets;
    if (mode === "duplicate")
      d.tables.ModelHistory.push({ ...d.tables.ModelHistory[0] });
    if (mode === "injury")
      d.tables.ModelPlayers[0].InjuryStatus = "QUESTIONABLE";
    if (mode === "QB") d.tables.ModelPlayers[0].Position = "QB";
    expect(evaluate(d, d.settings).byId.get("1")!.gem).not.toBe("Pre-gem");
  }
});

// Saved screener searches and incoming package filters share the same label; migrations preserve Any and narrow choices.
it("supports filters, combinations, saved trades and automatic saved-filter migration", async () => {
  const d = await sample("WR", [0, 16, 17, 18]),
    m = evaluate(d, d.settings),
    p = m.byId.get("1")!;
  const draft = {
    ...defaultGemDraft("1"),
    pool: "All",
    position: "WR",
    signals: ["Pre-gem"],
    classification: "Pre-gem only",
  };
  const q = validateGemDraft(draft, ["1", "2"]).query!;
  expect(decodeGemFilters(encodeGemFilters(q), "1").draft).toEqual(draft);
  expect(screenGems([p], q).matches).toHaveLength(1);
  expect(
    matchesIncoming([p], {
      signals: ["Pre-gem"],
      positions: ["WR"],
      minimumSignals: 1,
    }),
  ).toBe(true);
  expect(matchesIncoming([p], { signals: ["Gem", "Watch"] })).toBe(false);
  expect(matchesIncoming([p], { signals: ["Gem", "Pre-gem", "Watch"] })).toBe(
    true,
  );
  const oldAll = gemSignals.filter((s) => s !== "Pre-gem");
  expect(
    decodeGemFilters(
      { gemFilterVersion: "2", gemSignals: JSON.stringify(oldAll) },
      "1",
    ).draft.signals,
  ).toContain("Pre-gem");
  expect(
    decodeGemFilters({ gemFilterVersion: "2", gemSignals: '["Watch"]' }, "1")
      .draft.signals,
  ).toEqual(["Watch"]);
  expect(
    decodeGemFilters({ gemFilterVersion: "2", gemSignals: "[]" }, "1").draft
      .signals,
  ).toEqual([]);
  const trade = { teamA: "1", teamB: "2", give: ["1"], get: ["2"] };
  const query = {
    teamA: "1",
    give: ["1"],
    count: 1,
    below: 500,
    above: 500,
    incoming: {
      signals: ["Gem", "Pre-gem", "Watch"] as ("Gem" | "Pre-gem" | "Watch")[],
    },
  };
  const saved = readSavedTrades(
    saveTrade(
      initialState(d),
      m,
      trade,
      summaryFromTrade(evaluateTrade(m, trade)),
      query,
    ),
  );
  expect(saved.issue).toBe("");
  expect(saved.trades[0].query!.incoming!.signals).toEqual([
    "Gem",
    "Pre-gem",
    "Watch",
  ]);
});

// Track only prospective observations; a later import reconstructs three actual played games and freezes complete outcomes.
it("records first Pre-gems, skips byes, preserves pending outcomes and freezes three-game confirmation", async () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  const snap = async (scores: number[], date: number, missing = false) => {
    const d = await sample("WR", scores);
    d.sourceUTC = new Date(date - 60000).toISOString();
    d.importedAt = new Date(date).toISOString();
    d.hash = `pre-gem-${scores.length}-${date}-${missing}`;
    d.tables.ModelContext[0].CurrentWeek = scores.length + 1;
    // Future appearances skip one bye week; conversion and PPG still use three played games, not three calendar weeks.
    if (scores.length > 4) {
      d.tables.ModelHistory.filter(
        (r) => r.PlayerID === 1 && Number(r.Week) > 4,
      ).forEach((r) => {
        r.Week = Number(r.Week) + 1;
      });
      d.tables.ModelContext[0].CurrentWeek = scores.length + 2;
    }
    if (missing)
      delete d.tables.ModelHistory.find(
        (r) => r.PlayerID === 1 && r.Week === 6,
      )!.Targets;
    return evaluate(d, d.settings);
  };
  const origin = await snap([0, 16, 17, 18], now);
  const first = advanceGemJournal(emptyGemJournal(), origin, now);
  expect(
    first.journal.cohorts[0].checkpoints[0].cases.find((c) => c.id === "1")!
      .primary,
  ).toBe("Pre-gem");
  const early = advanceGemJournal(
    first.journal,
    await snap([0, 16, 17, 18, 20], now + 86400000),
    now + 86400000,
  );
  expect(
    preGemTrackingReport(early.journal, early.journal.cohorts[0].key).find(
      (r) => r.pos === "WR",
    ),
  ).toMatchObject({ labels: 1, scored: 0, pending: 1 });
  const end = advanceGemJournal(
    early.journal,
    await snap([0, 16, 17, 18, 20, 18, 16], now + 3 * 86400000),
    now + 3 * 86400000,
  );
  expect(
    preGemTrackingReport(end.journal, end.journal.cohorts[0].key).find(
      (r) => r.pos === "WR",
    ),
  ).toMatchObject({ labels: 1, scored: 1, hits: 1, futurePPG: 18 });
  const again = advanceGemJournal(
    end.journal,
    await snap([0, 16, 17, 18, 0, 0, 0], now + 4 * 86400000),
    now + 4 * 86400000,
  );
  expect(again.journal.cohorts[0].checkpoints[0].outcomes.preGem).toEqual(
    end.journal.cohorts[0].checkpoints[0].outcomes.preGem,
  );
  expect(gemJournalSchema.parse(end.journal)).toEqual(end.journal);
  const incomplete = advanceGemJournal(
    first.journal,
    await snap([0, 16, 17, 18, 0, 0, 0], now + 3 * 86400000, true),
    now + 3 * 86400000,
  );
  expect(
    preGemTrackingReport(
      incomplete.journal,
      incomplete.journal.cohorts[0].key,
    ).find((r) => r.pos === "WR"),
  ).toMatchObject({ labels: 1, scored: 0, pending: 1 });
});
