import { expect, it } from "vitest";
import { fairChainFixture } from "./chain-fixture";
import { fromTables } from "../src/import/workbook";
import { evaluate } from "../src/domain/valuation";
import { evaluateTrade } from "../src/domain/trades";
import {
  advanceChainRoster,
  chainErrors,
  searchTradeChains,
  type ChainQuery,
} from "../src/domain/trade-chains";
import {
  applyChainPreset,
  chainSearchRounds,
} from "../src/domain/chain-discovery";
import {
  chainPositionImpact,
  chainGradeFailures,
} from "../src/domain/chain-position-impact";

// A synthetic spare TE acquires RB coverage, enabling the original RB to fund a WR upgrade with positive gains for all teams.
async function sample() {
  const d = await fairChainFixture();
  d.tables.ModelContext[0].BenchSlots = 20;
  for (const [id, points] of [
    [3, 18],
    [6, 22],
  ] as const) {
    Object.assign(
      d.tables.ModelPlayers.find((p) => p.PlayerID === id)!,
      {
        ActualPoints: points * 5,
        Actual_PPG: points,
        Last3_PPG: points,
        ESPN_Projected_PPG: points,
        ESPN_Projected_Total: points * 17,
        Current_Week_Projection: points,
      },
    );
    d.tables.ModelHistory.filter((h) => h.PlayerID === id).forEach((h) => {
      h.Points = points;
    });
  }
  const reserve = {
    ...d.tables.ModelPlayers.find((p) => p.PlayerID === 6)!,
    PlayerID: 14,
    Player: "Synthetic RB reserve",
    ActualPoints: 105,
    Actual_PPG: 21,
    Last3_PPG: 21,
    ESPN_Projected_PPG: 21,
    ESPN_Projected_Total: 357,
    Current_Week_Projection: 21,
  };
  d.tables.ModelPlayers.push(reserve);
  d.tables.ModelRosters.push({ PlayerID: 14, TeamID: 2, LineupSlotID: 20 });
  d.tables.ModelHistory.push(
    ...d.tables.ModelHistory.filter((h) => h.PlayerID === 6).map((h) => ({
      ...h,
      PlayerID: 14,
      Points: 21,
    })),
  );
  const data = await fromTables(d.tables, d.settings),
    m = evaluate(data, data.settings);
  const q: ChainQuery = {
    team: "1",
    pool: ["8", "1"],
    mode: "safe",
    maximumLoss: 0,
    minimumGain: 1,
    basis: "best-available",
    depth: "standard",
    pricePolicy: "warnings",
    recipient: { maximumValueLossPct: 1, minimumGain: 0 },
    dependency: {
      route: "retain",
      minimumAcquiredShare: 0.25,
      minimumInteractionGain: 2,
    },
    discovery: { sequences: "connected", ranking: "own" },
    first: {
      teams: ["2"],
      offer: { minimum: 1, maximum: 1 },
      receive: { minimum: 1, maximum: 1 },
      requiredGive: ["8"],
      requiredGet: ["6"],
      receivePosition: "RB",
    },
    second: {
      teams: ["3"],
      offer: { minimum: 1, maximum: 1 },
      receive: { minimum: 1, maximum: 1 },
      requiredGive: ["1"],
      requiredGet: ["5"],
    },
  };
  return { m, q };
}

// Exact anchors reserve the original second-leg player and reproduce both exchanges with a continuous scoring baseline.
it("finds an exact coverage chain and displays both teams' grade tradeoffs without mutating source players", async () => {
  const { m, q } = await sample(),
    original = JSON.stringify(m.players);
  expect(chainErrors(m, q)).toEqual([]);
  const result = searchTradeChains(m, q),
    chain = result.chains[0];
  expect(result.stats.limited).toBe(false);
  expect(result.chains).toHaveLength(1);
  expect(chain.first.draft.give).toEqual(["8"]);
  expect(chain.second.draft.give).toEqual(["1"]);
  expect(chain.kind).toBe("connected");
  expect(chain.dependency?.route).toBe("retain");
  expect(chain.first.row.ownAfter).toBe(chain.second.row.ownBefore);
  expect(chain.gain).toBeGreaterThan(0);
  expect(chain.first.positionImpact?.own.length).toBeGreaterThan(0);
  expect(
    chain.second.positionImpact?.other.some((row) => (row.drop ?? 0) > 0),
  ).toBe(true);
  expect(JSON.stringify(m.players)).toBe(original);
});

// Limits apply separately to each actual intermediate roster; a positive final team total does not cancel an excessive positional sacrifice.
it("excludes a scoring-positive chain at an inclusive recipient grade-drop boundary and reports the reason", async () => {
  const { m, q } = await sample();
  const chain = searchTradeChains(m, q).chains[0];
  const maximum = Math.max(
    ...chain.second.positionImpact!.other.map((row) => row.drop ?? 0),
  );
  const accepted = searchTradeChains(m, {
    ...q,
    second: {
      ...q.second,
      gradeLimit: { side: "other", maximumDrop: maximum },
    },
  });
  expect(accepted.chains).toHaveLength(1);
  const rejected = searchTradeChains(m, {
    ...q,
    second: {
      ...q.second,
      gradeLimit: { side: "other", maximumDrop: maximum - 1 },
    },
  });
  expect(rejected.chains).toHaveLength(0);
  expect(rejected.stats.rejectedGrades).toBe(1);
  expect(rejected.plausibilityRejections[0].step).toBe(2);
  expect(rejected.plausibilityRejections[0].failures.join()).toContain(
    "grade steps",
  );
  const next = advanceChainRoster(m, chain.first.draft);
  expect(chain.second.positionImpact).toEqual(
    chainPositionImpact(
      next,
      chain.second.draft,
      evaluateTrade(next, chain.second.draft, false),
    ),
  );
});

// Side selection, unavailable evidence and disabled parity preserve the distinction between grades and EPPG.
it("keeps own, recipient, both and unavailable grade limits separate", () => {
  const value = {
    own: [{ position: "WR", before: "B", after: "C", drop: 3 }],
    other: [{ position: "RB", before: "A", after: "B+", drop: 2 }],
  };
  expect(chainGradeFailures(value)).toEqual([]);
  expect(chainGradeFailures(value, { side: "other", maximumDrop: 2 })).toEqual(
    [],
  );
  expect(
    chainGradeFailures(value, { side: "own", maximumDrop: 2 }),
  ).toHaveLength(1);
  expect(
    chainGradeFailures(value, { side: "both", maximumDrop: 1 }),
  ).toHaveLength(2);
  expect(
    chainGradeFailures(
      {
        own: [],
        other: [{ position: "RB", before: "n.a.", after: "B", drop: null }],
      },
      { side: "other", maximumDrop: 12 },
    )[0],
  ).toContain("unavailable");
});

// Invalid anchors fail before enumeration, and broadening never relaxes hard player or grade requirements.
it("validates ownership, package sizes and conflicting offers while preserving constraints during broadening", async () => {
  const { m, q } = await sample();
  expect(
    chainErrors(m, {
      ...q,
      first: { ...q.first, requiredGet: ["6", "5"] },
    }).join(),
  ).toContain("required receive");
  expect(
    chainErrors(m, {
      ...q,
      second: { ...q.second, requiredGive: ["4"] },
    }).join(),
  ).toContain("selected pool");
  expect(
    chainErrors(m, { ...q, first: { ...q.first, requiredGive: ["1"] } }).join(),
  ).toContain("cannot also");
  expect(
    chainErrors(m, {
      ...q,
      first: { ...q.first, gradeLimit: { side: "both", maximumDrop: 1.5 } },
    }).join(),
  ).toContain("whole-number");
  const configured = {
    ...q,
    second: {
      ...q.second,
      gradeLimit: { side: "other" as const, maximumDrop: 2 },
    },
    discovery: {
      ...q.discovery!,
      broaden: {
        enabled: true,
        maximumRecipientLoss: 2,
        maximumValueLossPct: 1,
        indexExtra: 5,
      },
    },
  };
  for (const round of chainSearchRounds(configured)) {
    expect(round.query.second.requiredGive).toEqual(["1"]);
    expect(round.query.second.gradeLimit).toEqual(configured.second.gradeLimit);
    expect(round.query.first.receivePosition).toBe("RB");
  }
});

// The explicit coverage preset is permissive on price tests but keeps legality, mutual recipient scoring and dependency requirements.
it("provides a configurable coverage preset without overwriting anchors, scope or grade protection", async () => {
  const { q } = await sample();
  q.second.gradeLimit = { side: "own", maximumDrop: 1 };
  const preset = applyChainPreset(q, "coverage");
  expect(preset.pricePolicy).toBe("warnings");
  expect(preset.minimumGain).toBe(1);
  expect(preset.recipient?.minimumGain).toBe(0);
  expect(preset.discovery?.broaden?.maximumRecipientLoss).toBe(0);
  expect(preset.dependency?.route).toBe("either");
  expect(preset.first.receivePosition).toBe("RB");
  expect(preset.first.teams).toBe(q.first.teams);
  expect(preset.second.requiredGive).toBe(q.second.requiredGive);
  expect(preset.second.gradeLimit).toBe(q.second.gradeLimit);
});
