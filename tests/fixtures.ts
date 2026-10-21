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

// Build a two-QB roster with explicit imported starters and a future bye, without touching real league data.
export async function starterFixture() {
  const d = await fixture();
  const base = d.tables.ModelPlayers.find((p) => p.PlayerID === 102)!;
  d.tables.ModelPlayers.push({
    ...base,
    PlayerID: 200,
    Player: "Incoming QB",
    OnTeamID: 2,
  });
  d.tables.ModelHistory.push(
    ...d.tables.ModelHistory.filter((h) => h.PlayerID === 102).map((h) => ({
      ...h,
      PlayerID: 200,
    })),
  );
  d.tables.ModelRosters.push({ PlayerID: 200, TeamID: 2, LineupSlotID: 0 });
  for (const [id, name, score, slot] of [
    [100, "Main QB", 20, 0],
    [101, "Bench QB", 30, 20],
  ] as const) {
    const p = d.tables.ModelPlayers.find((r) => r.PlayerID === id)!;
    Object.assign(p, {
      Player: name,
      OnTeamID: 1,
      ActualPoints: score * 5,
      Actual_PPG: score,
      Last3_PPG: score,
      ScoreSD: 0,
      ESPN_Projected_PPG: score,
      ESPN_Projected_Total: score * 17,
    });
    d.tables.ModelHistory.filter((h) => h.PlayerID === id).forEach((h) => {
      h.Points = score;
    });
    d.tables.ModelRosters.push({ PlayerID: id, TeamID: 1, LineupSlotID: slot });
  }
  d.tables.ModelRosters.find((r) => r.PlayerID === 1)!.LineupSlotID = 2;
  d.tables.ModelRosters.find((r) => r.PlayerID === 2)!.LineupSlotID = 4;
  Object.assign(
    d.tables.ModelPlayers.find((p) => p.PlayerID === 100)!,
    { ProTeamID: 2, NFLTeam: "MAIN" },
  );
  d.tables.ModelSchedule.push(
    ...d.tables.ModelSchedule.filter((s) => s.ProTeamID === 1).map((s) => ({
      ...s,
      ProTeamID: 2,
      NFLTeam: "MAIN",
      HasGame: s.Week === 8 ? 0 : 1,
      ByeWeek: 8,
    })),
  );
  return fromTables(d.tables, d.settings);
}

// Supply enough synthetic, same-owner packages to exercise search pagination and all five receive counts.
export async function tradeSearchFixture() {
  const d = await starterFixture();
  d.tables.ModelContext[0].BenchSlots = 20;
  const base = d.tables.ModelPlayers.find((p) => p.PlayerID === 2)!;
  const history = d.tables.ModelHistory.filter((h) => h.PlayerID === 2);
  for (let i = 0; i < 10; i++) {
    const id = 300 + i;
    d.tables.ModelPlayers.push({
      ...base,
      PlayerID: id,
      Player: `Search WR ${i}`,
      InjuryStatus: i === 0 ? "QUESTIONABLE" : "ACTIVE",
    });
    d.tables.ModelHistory.push(...history.map((h) => ({ ...h, PlayerID: id })));
    d.tables.ModelRosters.push({ PlayerID: id, TeamID: 2, LineupSlotID: 20 });
  }
  return fromTables(d.tables, d.settings);
}
