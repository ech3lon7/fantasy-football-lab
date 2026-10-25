// Keep labeling policy separate from workbook valuation, app versions and descriptive historical percentiles.
export const labelRuleVersion = "label-rules-1";
export const gemVersion = "automatic-breakout-3";
export const gemPositions = ["RB", "WR", "TE"] as const;
export const labelPolicy = {
  window: 3,
  gemGames: 4,
  support: 2,
  watchGames: 5,
  priorGames: 2,
  declinePct: 0.2,
  decline: { RB: 3, WR: 2, TE: 2 },
  roleGrowth: 2,
  roleGrowthPct: 0.2,
  qbCarries: 3,
  volumeQuantile: 0.8,
  buySigma: 0.5,
  sellSigma: 1.5,
};

// This is intentionally one shared binding: changing a positional mean affects both Gem and Watch.
export const defaultGemRules = {
  growthPct: 0.25,
  positions: {
    RB: { mean: 18, floor: 14, growth: 3, points: 16 },
    WR: { mean: 7, floor: 5, growth: 2, points: 16 },
    TE: { mean: 6, floor: 5, growth: 2, points: 11 },
  },
};

// Preserve existing persisted setting names and defaults; runtime callers continue honoring user overrides.
export const labelSettingDefaults = {
  MinOpportunity: 10,
  GemMinGames: 4,
  GemMinGap: 2,
  GemMinGapPct: 0.2,
  GemMinPriorGames: 2,
  GemTrendFloor: 1,
  GemTrendPctFloor: 0.1,
  GemWRTargets: 6,
  GemWRShare: 0.18,
  GemTETargets: 5,
  GemTEShare: 0.1,
  GemRBOpportunities: 12,
  GemRBRushShare: 0.3,
  GemRBTargetShare: 0.1,
};

// Metadata lists the engine's actual bindings and route relationships; it never evaluates a second set of predicates.
export function effectiveLabelRules(settings: typeof labelSettingDefaults) {
  const parameter = (
    id: string,
    value: number,
    unit: string,
    operator = "≥",
    binding = id,
  ) => ({ id, value, unit, operator, binding });
  const setting = (key: keyof typeof labelSettingDefaults, unit: string) =>
    parameter(key, settings[key], unit, "≥", `settings.${key}`);
  const shared = gemPositions.flatMap((pos) => {
    const r = defaultGemRules.positions[pos];
    const unit = pos === "RB" ? "carries + targets/game" : "targets/game";
    return [
      parameter(
        `${pos}.mean`,
        r.mean,
        unit,
        "≥",
        `Gem + Watch.positions.${pos}.mean`,
      ),
      parameter(`${pos}.floor`, r.floor, unit.replace("/game", "/played game")),
      parameter(`${pos}.points`, r.points, "PPG / points per played game"),
      parameter(`${pos}.growth`, r.growth, unit),
    ];
  });
  return [
    {
      id: "Gem",
      positions: "RB / WR / TE",
      window:
        "Latest 3 AND previous overlapping 3; 4+ played games; 2/3 scoring AND workload support in each; active availability required",
      evidence:
        "Current gates retained; individual-game workload floors are mandatory but provisional and historically redundant within the full rule; TE selection underpowered",
      parameters: [
        ...shared.filter((p) => !p.id.endsWith(".growth")),
        parameter("sample", labelPolicy.gemGames, "games"),
        parameter("support", labelPolicy.support, "games per window"),
      ],
    },
    {
      id: "Watch",
      positions: "RB / WR / TE",
      window:
        "Latest 3 vs preceding 2–3; positive change AND (shared level OR absolute AND percentage growth); under 5 games: level only; excludes Gem",
      evidence:
        "Retrospectively explored; broad Watch retained; stricter WR filter deferred",
      parameters: [
        ...shared.filter(
          (p) => p.id.endsWith(".mean") || p.id.endsWith(".growth"),
        ),
        parameter("growthPct", defaultGemRules.growthPct, "fraction"),
        parameter("historyBranch", labelPolicy.watchGames, "games"),
      ],
    },
    {
      id: "Reduced workload",
      positions: "RB / WR / TE",
      window:
        "Latest 3 vs preceding 2–3; 5+ games; absolute AND relative decline AND 2/3 lower games",
      evidence: "Explored decline context; no scoring or trade-value penalty",
      parameters: [
        ...gemPositions.map((pos) =>
          parameter(
            `${pos}.decline`,
            labelPolicy.decline[pos],
            pos === "RB" ? "carries + targets/game" : "targets/game",
          ),
        ),
        parameter("relativeDecline", labelPolicy.declinePct, "fraction"),
        parameter("support", labelPolicy.support, "games"),
      ],
    },
    {
      id: "Role-growth watch",
      positions: "QB / RB / WR / TE",
      window:
        "Latest 3 vs ALL earlier; level AND absolute AND relative growth; earlier sample from settings",
      evidence: "Explored workload context; no archived dated team shares",
      parameters: [
        setting("GemMinPriorGames", "games"),
        setting("GemRBOpportunities", "carries + targets/game"),
        setting("GemWRTargets", "targets/game"),
        setting("GemTETargets", "targets/game"),
        parameter("QB.level", labelPolicy.qbCarries, "carries/game"),
        parameter("growth", labelPolicy.roleGrowth, "workload/game"),
        parameter("growthPct", labelPolicy.roleGrowthPct, "fraction"),
      ],
    },
    {
      id: "Scoring breakout watch",
      positions: "QB / RB / WR / TE",
      window:
        "Latest 3 vs ALL earlier; scoring gain AND recent PPG ≥ ESPN season projection",
      evidence:
        "Only scoring component explored; archived ESPN forecast gate unavailable",
      parameters: [
        setting("GemMinPriorGames", "games"),
        setting("GemMinGap", "PPG"),
      ],
    },
    {
      id: "Projection-gap watch",
      positions: "QB / RB / WR / TE",
      window:
        "Actual season minus ESPN season forecast; absolute AND applicable percentage gap; recent ≥ forecast; legacy precedence retained",
      evidence:
        "Unsupported by supplied archived forecasts; provisional settings",
      parameters: [
        setting("GemMinGames", "games"),
        setting("GemMinGap", "PPG"),
        setting("GemMinGapPct", "fraction"),
      ],
    },
    {
      id: "BUY LOW / SELL HIGH / TD caution",
      positions: "RB / WR / TE",
      window:
        "Cumulative completed-game opportunities; positional peers; TD caution echoes SELL HIGH",
      evidence:
        "TD-regression context, not demonstrated acquisition profit; percentile/SD values update with the snapshot",
      parameters: [
        setting("MinOpportunity", "opportunities"),
        parameter("volumeQuantile", labelPolicy.volumeQuantile, "quantile"),
        parameter("buySigma", labelPolicy.buySigma, "SD below peer mean", "<"),
        parameter(
          "sellSigma",
          labelPolicy.sellSigma,
          "SD above peer mean",
          ">",
        ),
      ],
    },
    {
      id: "Trend arrows",
      positions: "QB / RB / WR / TE / K / D/ST",
      window:
        "Latest 3 vs ALL earlier; max(absolute floor, percentage × absolute earlier PPG); descriptive direction",
      evidence: "Descriptive, never a scoring forecast",
      parameters: [
        setting("GemMinPriorGames", "games"),
        setting("GemTrendFloor", "PPG"),
        setting("GemTrendPctFloor", "fraction"),
      ],
    },
    {
      id: "Workbook legacy workload support",
      positions: "RB / WR / TE",
      window:
        "Season workload AND target share; RB permits rush OR target share; workbook parity path retained",
      evidence:
        "Historical dated team-share denominators unverified; not the current Gem/Watch classifier",
      parameters: [
        setting("GemWRTargets", "targets/game"),
        setting("GemWRShare", "fraction"),
        setting("GemTETargets", "targets/game"),
        setting("GemTEShare", "fraction"),
        setting("GemRBOpportunities", "carries + targets/game"),
        setting("GemRBRushShare", "fraction"),
        setting("GemRBTargetShare", "fraction"),
      ],
    },
  ].map((rule) => {
    // Distinguish effective custom settings from the default configurations explored in the historical study.
    const custom = rule.parameters.some(
      (p) =>
        p.binding.startsWith("settings.") &&
        p.value !==
          labelSettingDefaults[p.id as keyof typeof labelSettingDefaults],
    );
    return {
      ...rule,
      evidence: custom
        ? `${rule.evidence}; custom settings differ from researched defaults and are not validated by those results`
        : rule.evidence,
    };
  });
}
