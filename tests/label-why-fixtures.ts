// Synthetic label-why fixtures only; no real league, player or workbook data is used.
import {
  defaults,
  mean,
  sd,
  type Dataset,
  type Row,
} from "../src/domain/contracts";
import { fromTables } from "../src/import/workbook";
import { evaluate, type Model } from "../src/domain/valuation";

export interface PlayerSpec {
  id: number;
  pos: string;
  scores: number[];
  counts: number[];
  projected: number;
  tds?: number[];
  owner?: number;
  name?: string;
  historyIssue?: string;
}

// Build one aligned synthetic dataset from compact per-player specs.
export async function labelWhyFixture(specs: PlayerSpec[]) {
  const ctx: Row = {
    Season: 2026,
    CurrentWeek: 7,
    FinalWeek: 17,
    TeamCount: 2,
    RefreshUTC: new Date().toISOString(),
    QBSlots: 1,
    RBSlots: 1,
    WRSlots: 1,
    TESlots: 1,
    KSlots: 1,
    DSTSlots: 1,
    FlexSlots: 1,
    BenchSlots: 2,
    IRSlots: 1,
    QBLimit: 0,
    RBLimit: 0,
    WRLimit: 0,
    TELimit: 0,
    KLimit: 0,
    DSTLimit: 0,
  };
  const tables: Dataset["tables"] = {
    ModelContext: [ctx],
    ModelTeams: [
      { TeamID: 1, TeamName: "Test A" },
      { TeamID: 2, TeamName: "Test B" },
    ],
    ModelPlayers: [],
    ModelRosters: [],
    ModelHistory: [],
    ModelSchedule: Array.from({ length: 17 }, (_, i) => ({
      ProTeamID: 1,
      NFLTeam: "TEST",
      Week: i + 1,
      HasGame: 1,
      ByeWeek: 0,
      Opponent: "OTHER",
    })),
  };
  for (const spec of specs) {
    const total = spec.counts.reduce((a, b) => a + b, 0);
    const rb = spec.pos === "RB";
    const qb = spec.pos === "QB";
    const tdTotal = (spec.tds ?? []).reduce((a, b) => a + b, 0);
    const row: Row = {
      PlayerID: spec.id,
      Player: spec.name ?? `Synthetic ${spec.id}`,
      Position: spec.pos,
      ProTeamID: 1,
      NFLTeam: "TEST",
      OnTeamID: spec.owner ?? 0,
      InjuryStatus: "ACTIVE",
      Droppable: true,
      GamesPlayed: spec.scores.length,
      ActualPoints: spec.scores.reduce((a, b) => a + b, 0),
      Actual_PPG: mean(spec.scores),
      Last3_PPG: mean(spec.scores.slice(-3)),
      ScoreSD: sd(spec.scores),
      HistoryIssue: spec.historyIssue ?? "",
      Season_Games: spec.scores.length,
      Current_Actual_Games: 0,
      ProjectionRecords: 1,
      ESPN_Projected_PPG: spec.projected,
      ESPN_Projected_Total: spec.projected * 17,
      ESPN_Projected_Games: 17,
      Current_Week_Projection: spec.projected,
      RushAttempts: rb || qb ? total : 0,
      Targets: rb || (!qb && spec.pos !== "K" && spec.pos !== "D/ST") ? total : 0,
      ReceivingTD: rb ? 0 : tdTotal,
      RushTD: rb ? tdTotal : 0,
      ADP: 100,
      SourceRefreshUTC: new Date().toISOString(),
    };
    tables.ModelPlayers.push(row);
    spec.scores.forEach((points, i) => {
      const count = spec.counts[i] ?? 0;
      tables.ModelHistory.push({
        PlayerID: spec.id,
        Season: 2026,
        Week: i + 1,
        Points: points,
        Games: 1,
        HistoryStatus: "Valid",
        Targets: rb || (!qb && spec.pos !== "K" && spec.pos !== "D/ST") ? count : 0,
        RushAttempts: rb || qb ? count : 0,
        ReceivingTD: rb ? 0 : (spec.tds?.[i] ?? 0),
        RushTD: rb ? (spec.tds?.[i] ?? 0) : 0,
        SourceRefreshUTC: new Date().toISOString(),
      });
    });
  }
  const d = await fromTables(tables, { ...defaults });
  return { d, m: evaluate(d, d.settings) };
}

// One player per label plus the exclusivity and filtering cases.
export const LABEL_SPECS: PlayerSpec[] = [
  // Gem: four stable scoring/workload games.
  { id: 1, pos: "WR", scores: [16, 16, 16, 16], counts: [7, 7, 7, 7], projected: 12, name: "Gem WR" },
  // Pre-gem: three games with a scoring rise inside one qualifying window.
  { id: 2, pos: "WR", scores: [10, 20, 20], counts: [7, 7, 7], projected: 12, name: "Pre-gem WR" },
  // Watch: six games with a developing workload.
  { id: 3, pos: "TE", scores: [10, 10, 10, 10, 10, 10], counts: [3, 2, 5, 8, 8, 7], projected: 10, name: "Watch TE" },
  // Role-growth and Watch: all-earlier workload rise.
  { id: 4, pos: "WR", scores: [10, 10, 10, 10, 10], counts: [4, 4, 7, 7, 7], projected: 10, name: "Role WR" },
  // Scoring breakout: QB scoring rise without a Gem position.
  { id: 5, pos: "QB", scores: [10, 10, 12, 12, 12], counts: [5, 5, 5, 5, 5], projected: 12, name: "Scoring QB" },
  // Projection gap: scoring above ESPN without workload support.
  { id: 6, pos: "WR", scores: [18, 18, 18, 18, 18], counts: [4, 4, 4, 4, 4], projected: 12, name: "Gap WR" },
  // Reduced workload: sustained decline.
  { id: 7, pos: "WR", scores: [10, 10, 10, 10, 10], counts: [14, 13, 8, 11, 11], projected: 10, name: "Decline WR" },
  // Regression peers: one BUY LOW and one SELL HIGH.
  { id: 8, pos: "WR", scores: [10, 10, 10, 10, 10], counts: [6, 6, 6, 6, 6], projected: 10, tds: [0, 0, 0, 0, 0], name: "Buy WR" },
  { id: 9, pos: "WR", scores: [10, 10, 10, 10, 10], counts: [2, 2, 2, 3, 3], projected: 10, tds: [2, 1, 1, 1, 1], name: "Sell WR" },
  { id: 10, pos: "WR", scores: [10, 10, 10, 10, 10], counts: [4, 4, 4, 4, 4], projected: 10, tds: [1, 0, 1, 0, 0], name: "Peer WR 1" },
  { id: 11, pos: "WR", scores: [10, 10, 10, 10, 10], counts: [4, 4, 4, 4, 4], projected: 10, tds: [1, 1, 1, 0, 0], name: "Peer WR 2" },
  { id: 12, pos: "WR", scores: [10, 10, 10, 10, 10], counts: [5, 5, 5, 5, 5], projected: 10, tds: [0, 1, 0, 1, 0], name: "Peer WR 3" },
  // Near Gem: three-game Watch with only the four-game Gem sample short.
  { id: 13, pos: "WR", scores: [16, 16, 16], counts: [7, 7, 7], projected: 12, name: "Near Gem WR" },
  // Near Watch: short TE sample below the Watch level.
  { id: 14, pos: "TE", scores: [5, 5, 5], counts: [5, 5, 5], projected: 5, name: "Near Watch TE" },
  // Near Role-growth: level just below the positional minimum.
  { id: 15, pos: "WR", scores: [10, 10, 10, 10, 10], counts: [4, 4, 6, 6, 5], projected: 10, name: "Near Role WR" },
  // Near Scoring breakout: only the ESPN projection gate fails.
  { id: 16, pos: "QB", scores: [10, 10, 12, 12, 12], counts: [5, 5, 5, 5, 5], projected: 13, name: "Near Scoring QB" },
  // Near Projection gap: only the relative gap fails.
  { id: 17, pos: "WR", scores: [20, 20, 20, 20, 20], counts: [4, 4, 4, 4, 4], projected: 17, name: "Near Gap WR" },
  // Near Reduced workload: two failing decline gates.
  { id: 18, pos: "WR", scores: [10, 10, 10, 10, 10], counts: [10, 10, 10, 9, 9, 9], projected: 10, name: "Near Decline WR" },
  // Both Gem and Pre-gem one/two gates short; Gem wins the primary tie.
  { id: 19, pos: "WR", scores: [16, 16, 10], counts: [7, 7, 7], projected: 12, name: "Tie WR" },
  // No label: stable low workload.
  { id: 20, pos: "WR", scores: [5, 5, 5, 5, 5], counts: [2, 2, 2, 2, 2], projected: 5, name: "No Signal WR" },
  // Near Gem: Pre-gem is earned and only the previous-window average is short.
  { id: 21, pos: "WR", scores: [10, 16, 16, 16], counts: [7, 7, 7, 7], projected: 12, name: "Near Gem 4 WR" },
  // Near Role-growth: only the recent-rate gate fails.
  { id: 22, pos: "WR", scores: [10, 10, 10, 10, 10], counts: [3, 3, 5, 5, 5], projected: 10, name: "Near Role 1 WR" },
  // RB Gem so the carries + targets note and touches chart can be exercised.
  { id: 23, pos: "RB", scores: [16, 16, 16, 16], counts: [10, 10, 10, 10], projected: 12, name: "Gem RB" },
  // Six-game decline keeps the older unused chart bars visible.
  { id: 24, pos: "WR", scores: [10, 10, 10, 10, 10, 10], counts: [14, 14, 14, 8, 7, 7], projected: 10, name: "Decline Six WR" },
  // Five-game Gem exercises the unused older bar while still earning Gem.
  { id: 25, pos: "WR", scores: [16, 16, 16, 16, 16], counts: [7, 7, 7, 7, 7], projected: 12, name: "Gem Five WR" },
  // Watch earned while the previous Gem window is one gate short.
  { id: 26, pos: "WR", scores: [15.5, 16, 16, 16], counts: [7, 7, 7, 7], projected: 12, name: "Watch Gem Near WR" },
  // Incomplete history is never a near miss, even with tempting workload numbers.
  { id: 27, pos: "WR", scores: [10, 10, 10, 10, 10], counts: [3, 3, 5, 5, 5], projected: 10, name: "Incomplete WR", historyIssue: "Missing games" },
];

export async function labelWhyModel() {
  return labelWhyFixture(LABEL_SPECS);
}

// Copy a player and attach peer evidence so regression near misses can be exercised without forcing a badge.
export function regressionNear(
  m: Model,
  overrides: {
    id: string;
    opportunities: number;
    tdRate: number;
    highVolume: number;
    meanRate: number;
    rateSD: number;
    games: number;
    regression?: string;
    signals?: string[];
  },
) {
  const base = m.byId.get("10")!;
  const p = {
    ...base,
    id: overrides.id,
    games: overrides.games,
    opportunities: overrides.opportunities,
    tdRate: overrides.tdRate,
    td: Math.round(overrides.tdRate * overrides.opportunities),
    regression: overrides.regression ?? "NEUTRAL",
    regressionEvidence: {
      highVolume: overrides.highVolume,
      meanRate: overrides.meanRate,
      rateSD: overrides.rateSD,
    },
    opportunity: {
      ...base.opportunity,
      signals: overrides.signals ?? base.opportunity.signals,
    },
  };
  return p;
}
