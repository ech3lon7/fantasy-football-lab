import {
  defaults,
  type Dataset,
  type Row,
  positions,
  mean,
  sd,
} from "../src/domain/contracts";
import { fromTables } from "../src/import/workbook";
export async function fixture(scores = [20, 20, 20, 20, 20]) {
  const ctx: Row = {
    Season: 2026,
    CurrentWeek: Math.max(6, scores.length + 1),
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
  function add(
    id: number,
    pos: string,
    owner: number,
    played: number[],
    projected: number,
  ) {
    const p: Row = {
      PlayerID: id,
      Player: `Synthetic ${id}`,
      Position: pos,
      ProTeamID: 1,
      NFLTeam: "TEST",
      OnTeamID: owner,
      InjuryStatus: "ACTIVE",
      Droppable: true,
      GamesPlayed: played.length,
      ActualPoints: played.reduce((a, b) => a + b, 0),
      Actual_PPG: mean(played),
      Last3_PPG: mean(played.slice(-3)),
      ScoreSD: sd(played),
      HistoryIssue: "",
      Season_Games: played.length,
      Current_Actual_Games: 0,
      ProjectionRecords: 1,
      ESPN_Projected_PPG: projected,
      ESPN_Projected_Total: projected * 17,
      ESPN_Projected_Games: 17,
      Current_Week_Projection: projected,
      RushAttempts: 20,
      Targets: 30,
      ReceivingTD: 0,
      RushTD: 0,
      ADP: 100,
      SourceRefreshUTC: new Date().toISOString(),
    };
    tables.ModelPlayers.push(p);
    if (owner)
      tables.ModelRosters.push({
        PlayerID: id,
        TeamID: owner,
        LineupSlotID: 20,
      });
    played.forEach((points, i) =>
      tables.ModelHistory.push({
        PlayerID: id,
        Season: 2026,
        Week: i + 1,
        Points: points,
        Games: 1,
        HistoryStatus: "Valid",
        SourceRefreshUTC: new Date().toISOString(),
      }),
    );
  }
  add(1, "RB", 1, scores, 15);
  add(2, "WR", 2, [15, 15, 15, 15, 15], 15);
  let id = 100;
  for (const pos of positions)
    for (let i = 0; i < 3; i++) add(id++, pos, 0, [10, 10, 10, 10, 10], 10);
  return fromTables(tables, { ...defaults });
}
