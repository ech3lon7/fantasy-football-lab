import { describe, expect, it } from "vitest";
import { fairChainFixture } from "./chain-fixture";
import { evaluate } from "../src/domain/valuation";
import {
  applyChainPreset,
  applyChainPresetKeepingLimits,
  chainPresets,
  chainSearchRounds,
  currentPresetLabel,
} from "../src/domain/chain-discovery";
import {
  applyLimitsToChainQuery,
  applyLimitsToSearchQuery,
  chainPriceRank,
  defaultSearchLimits,
  editedLimits,
  migrateStrictness,
  orderChainsByPrice,
  readSearchLimits,
  widenedLimits,
  writeSearchLimits,
  type SearchLimits,
} from "../src/domain/search-limits";
import {
  discoverTradeChains,
  type ChainQuery,
  type TradeChain,
} from "../src/domain/trade-chains";
import type { TradeSearchQuery } from "../src/domain/trade-search";

const base = (): ChainQuery => ({
  team: "1",
  pool: ["3", "8", "9"],
  mode: "safe",
  maximumLoss: 0,
  minimumGain: 2,
  basis: "best-available",
  depth: "standard",
  first: {
    teams: ["2"],
    offer: { minimum: 1, maximum: 1 },
    receive: { minimum: 1, maximum: 1 },
    indexWindow: { below: 3, above: 3 },
  },
  second: {
    teams: ["3"],
    offer: { minimum: 1, maximum: 2 },
    receive: { minimum: 1, maximum: 1 },
  },
});

describe("shared limits", () => {
  it("default to Balanced with the index window Off", () => {
    expect(defaultSearchLimits).toEqual({
      minimumFinalGain: 2,
      maximumTemporaryLoss: 0,
      maximumRecipientValueLoss: 0.2,
      indexWindow: null,
    });
    expect(editedLimits(defaultSearchLimits)).toEqual([]);
  });
  it("mark exactly the limits that differ from the defaults", () => {
    expect(
      editedLimits({
        ...defaultSearchLimits,
        maximumTemporaryLoss: 3,
        indexWindow: 10,
      }),
    ).toEqual(["maximumTemporaryLoss", "indexWindow"]);
  });
  it("store only edited limits and read them back", () => {
    expect(writeSearchLimits(defaultSearchLimits)).toBe("");
    const edited: SearchLimits = { ...defaultSearchLimits, indexWindow: 12 };
    expect(readSearchLimits(writeSearchLimits(edited))).toEqual(edited);
  });
  it("fall back to the defaults for missing or malformed saved values", () => {
    for (const bad of [
      undefined,
      "",
      "{",
      "[]",
      '{"minimumFinalGain":-1}',
      '{"maximumRecipientValueLoss":4}',
      '{"indexWindow":0}',
    ])
      expect(readSearchLimits(bad)).toEqual(defaultSearchLimits);
    expect(readSearchLimits('{"indexWindow":null}').indexWindow).toBeNull();
  });
});

describe("applying limits", () => {
  it("sets chain limits, warns instead of hiding on price and drops strictness-era broadening", () => {
    const q = applyLimitsToChainQuery(base(), {
      ...defaultSearchLimits,
      maximumTemporaryLoss: 3,
    });
    expect(q.mode).toBe("both");
    expect(q.maximumLoss).toBe(3);
    expect(q.minimumGain).toBe(2);
    expect(q.pricePolicy).toBe("warnings");
    expect(q.recipient?.maximumValueLossPct).toBe(0.2);
    expect(applyLimitsToChainQuery(base(), defaultSearchLimits).mode).toBe(
      "safe",
    );
  });
  it("Off removes every per-leg index window and a number sets both legs", () => {
    expect(
      applyLimitsToChainQuery(base(), defaultSearchLimits).first.indexWindow,
    ).toBeUndefined();
    const q = applyLimitsToChainQuery(base(), {
      ...defaultSearchLimits,
      indexWindow: 8,
    });
    expect(q.first.indexWindow).toEqual({ below: 8, above: 8 });
    expect(q.second.indexWindow).toEqual({ below: 8, above: 8 });
  });
  it("maps the window onto Find trades: Off is automatic, a number is the strict range", () => {
    const find = {
      indexMode: "strict",
      below: 5,
      above: 5,
    } as TradeSearchQuery;
    expect(applyLimitsToSearchQuery(find, defaultSearchLimits).indexMode).toBe(
      "automatic",
    );
    const strict = applyLimitsToSearchQuery(find, {
      ...defaultSearchLimits,
      indexWindow: 10,
    });
    expect(strict).toMatchObject({ indexMode: "strict", below: 10, above: 10 });
  });
});

describe("widening from the user's values", () => {
  it("starts with the user's own limits and no change text", () => {
    const user = {
      ...defaultSearchLimits,
      minimumFinalGain: 3,
      indexWindow: 10,
    };
    const rounds = widenedLimits(user);
    expect(rounds[0]).toEqual({ limits: user, changes: [] });
    expect(rounds).toHaveLength(3);
  });
  it("names each limit that moved and by how much, and never invents an index window when it is Off", () => {
    const [, one, two] = widenedLimits(defaultSearchLimits);
    expect(one.limits.minimumFinalGain).toBe(1.5);
    expect(one.changes).toContain("Minimum final gain 2.0 → 1.5 EPPG");
    expect(one.changes).toContain("Maximum temporary loss 0.0 → 1.0 EPPG");
    expect(one.changes).toContain("Maximum recipient value loss 20% → 25%");
    expect(two.limits.maximumTemporaryLoss).toBe(2);
    expect(two.changes.join(" ")).not.toMatch(/Index window/);
    expect(two.limits.indexWindow).toBeNull();
  });
  it("widens a numeric index window and never below zero gain", () => {
    const [, one] = widenedLimits({
      ...defaultSearchLimits,
      minimumFinalGain: 0.2,
      indexWindow: 10,
    });
    expect(one.limits.minimumFinalGain).toBe(0);
    expect(one.limits.indexWindow).toBe(15);
    expect(one.changes).toContain("Index window ±10.0 → ±15.0");
  });
  it("drives chain search rounds when a query carries limits, leaving limit-free queries unchanged", () => {
    const withLimits = applyLimitsToChainQuery(base(), defaultSearchLimits);
    const rounds = chainSearchRounds(withLimits);
    expect(rounds).toHaveLength(3);
    expect(rounds[0].changes).toEqual([]);
    expect(rounds[1].query.minimumGain).toBe(1.5);
    expect(chainSearchRounds(base())).toHaveLength(1);
  });
});

describe("result ordering", () => {
  const chain = (
    key: string,
    surplus: string,
    points: string,
    relaxations?: string[],
  ) =>
    ({
      key,
      relaxations,
      first: { row: { surplus, points } },
      second: { row: { surplus: "PASS", points: "PASS" } },
    }) as unknown as TradeChain;
  it("ranks passes, then price warnings, then widened results, without dropping any", () => {
    const list = [
      chain("warn", "FAIL", "PASS"),
      chain("wide", "PASS", "PASS", ["Minimum final gain 2.0 → 1.5 EPPG"]),
      chain("pass", "PASS", "PASS"),
      chain("warn2", "PASS", "UNAVAILABLE"),
      chain("pass2", "PASS", "PASS"),
    ];
    expect(list.map(chainPriceRank)).toEqual([1, 2, 0, 1, 0]);
    expect(orderChainsByPrice(list).map((c) => c.key)).toEqual([
      "pass",
      "pass2",
      "warn",
      "warn2",
      "wide",
    ]);
  });
});

describe("presets", () => {
  it("offers ten presets and renames Surface-stat opportunities to Surface-stat trading", () => {
    expect(chainPresets).toHaveLength(10);
    expect(chainPresets.find((p) => p.id === "surface")?.label).toBe(
      "Surface-stat trading",
    );
    expect(chainPresets.map((p) => p.id)).toEqual(
      expect.arrayContaining(["need", "flip"]),
    );
    expect(currentPresetLabel("Surface-stat opportunities")).toBe(
      "Surface-stat trading",
    );
    expect(currentPresetLabel("Mutual benefit")).toBe("Mutual benefit");
  });
  it("never changes the shared limits, whichever preset is chosen", () => {
    const limits = {
      ...defaultSearchLimits,
      minimumFinalGain: 4,
      maximumTemporaryLoss: 2,
      indexWindow: 9,
    };
    for (const p of chainPresets) {
      const q = applyChainPresetKeepingLimits(base(), p.id, limits, {
        weakest: "WR",
        others: ["QB", "RB", "TE"],
      });
      expect(q.minimumGain).toBe(4);
      expect(q.maximumLoss).toBe(2);
      expect(q.recipient?.maximumValueLossPct).toBe(0.2);
      expect(q.first.indexWindow).toEqual({ below: 9, above: 9 });
    }
  });
  it("Fix my weakest position adds +2 at the weakest position and a two-step drop limit elsewhere, and removes them on switching", () => {
    const q = applyChainPreset(base(), "need", "balanced", {
      weakest: "WR",
      others: ["QB", "RB", "WR", "TE"],
    });
    const rules = q.first.gradeImpacts!;
    expect(rules.find((r) => r.position === "WR")).toMatchObject({
      steps: 2,
      type: "upgrade",
      side: "own",
    });
    expect(
      rules
        .filter((r) => r.type === "drop_limit")
        .map((r) => r.position)
        .sort(),
    ).toEqual(["QB", "RB", "TE"]);
    expect(q.second.gradeImpacts!.every((r) => r.type === "drop_limit")).toBe(
      true,
    );
    const back = applyChainPreset(q, "balanced");
    expect(back.first.gradeImpacts).toBeUndefined();
    expect(back.second.gradeImpacts).toBeUndefined();
  });
  it("keeps a goal you set yourself when a preset adds and removes its own", () => {
    const mine = {
      id: "mine",
      side: "own" as const,
      position: "TE",
      steps: 1,
      type: "upgrade" as const,
    };
    const start = {
      ...base(),
      first: { ...base().first, gradeImpacts: [mine] },
    };
    const need = applyChainPreset(start, "need", "balanced", {
      weakest: "WR",
      others: ["QB", "RB", "TE"],
    });
    expect(need.first.gradeImpacts).toContainEqual(mine);
    expect(applyChainPreset(need, "mutual").first.gradeImpacts).toEqual([mine]);
  });
  it("Buy low, then flip requires a BUY LOW arrival first and a SELL HIGH departure second, and clears them on switching", () => {
    const q = applyChainPreset(base(), "flip");
    expect(q.first.receiveRegression).toBe("BUY LOW");
    expect(q.second.sendRegression).toBe("SELL HIGH");
    const back = applyChainPreset(q, "balanced");
    expect(back.first.receiveRegression).toBeUndefined();
    expect(back.second.sendRegression).toBeUndefined();
  });
  it("leaves teams, protected pool and targets in place", () => {
    const q = applyChainPreset(
      {
        ...base(),
        discovery: {
          sequences: "both",
          ranking: "own",
          requiredTargets: ["5"],
        },
      },
      "flip",
    );
    expect(q.team).toBe("1");
    expect(q.pool).toEqual(["3", "8", "9"]);
    expect(q.discovery?.requiredTargets).toEqual(["5"]);
    expect(q.first.teams).toEqual(["2"]);
  });
});

describe("flip enforcement and migration", () => {
  it("rejects a first leg with no BUY LOW arrival, and strictness migrates away without losing other settings", async () => {
    const d = await fairChainFixture();
    const m = evaluate(d, d.settings);
    const q = applyChainPreset(
      {
        ...base(),
        pricePolicy: "warnings",
        recipient: { maximumValueLossPct: 0.25, minimumGain: -3.25 },
        discovery: {
          sequences: "both",
          ranking: "own",
          requiredTargets: ["5"],
          pinnedFirst: { teamA: "1", teamB: "2", give: ["3"], get: ["2"] },
        },
      },
      "flip",
    );
    // No player in this fixture carries BUY LOW, so the required label removes every chain.
    const result = discoverTradeChains(m, {
      ...q,
      discovery: { ...q.discovery!, broaden: undefined },
    });
    expect(result.chains).toHaveLength(0);
    const saved = {
      id: "x",
      name: "Mine",
      strictness: "negotiable",
      query: { team: "1" },
    };
    const migrated = migrateStrictness(saved);
    expect("strictness" in migrated).toBe(false);
    expect(migrated).toEqual({ id: "x", name: "Mine", query: { team: "1" } });
  });
});
