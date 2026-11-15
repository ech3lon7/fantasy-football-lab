import { fixture } from "./fixtures";
import { fromTables } from "../src/import/workbook";
import { mean, sd, type Row } from "../src/domain/contracts";

// A repeatable league of realistic size (17 players a team, five weeks of history) for timing the trade search.
export async function bigLeagueFixture(teams = 12) {
  // A repeatable pseudo-random sequence, so every run measures the same league.
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  const d = await fixture();
  const t = d.tables;
  t.ModelContext[0].TeamCount = teams;
  Object.assign(t.ModelContext[0], {
    QBSlots: 1,
    RBSlots: 2,
    WRSlots: 2,
    TESlots: 1,
    FlexSlots: 1,
    KSlots: 1,
    DSTSlots: 1,
    BenchSlots: 6,
  });
  t.ModelTeams = Array.from({ length: teams }, (_, i) => ({
    TeamID: i + 1,
    TeamName: `Team ${i + 1}`,
  }));
  t.ModelPlayers = [];
  t.ModelRosters = [];
  t.ModelHistory = [];
  const roles: [string, number, number][] = [
    ["QB", 2, 17],
    ["RB", 5, 12],
    ["WR", 6, 12],
    ["TE", 2, 8],
    ["K", 1, 8],
    ["D/ST", 1, 8],
  ];
  let id = 1000;
  for (let team = 1; team <= teams; team++)
    for (const [pos, count, base] of roles)
      for (let i = 0; i < count; i++) {
        const played = Array.from({ length: 5 }, () =>
          Math.max(0, base + (rand() - 0.5) * base),
        );
        const projected = (mean(played) ?? 0) + (rand() - 0.5) * 2;
        const row: Row = {
          PlayerID: id,
          Player: `P${id}`,
          Position: pos,
          ProTeamID: 1,
          NFLTeam: "TEST",
          OnTeamID: team,
          InjuryStatus: "ACTIVE",
          Droppable: true,
          GamesPlayed: 5,
          ActualPoints: played.reduce((a, b) => a + b, 0),
          Actual_PPG: mean(played),
          Last3_PPG: mean(played.slice(-3)),
          ScoreSD: sd(played),
          HistoryIssue: "",
          Season_Games: 5,
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
        t.ModelPlayers.push(row);
        t.ModelRosters.push({ PlayerID: id, TeamID: team, LineupSlotID: 20 });
        played.forEach((points, w) =>
          t.ModelHistory.push({
            PlayerID: id,
            Season: 2026,
            Week: w + 1,
            Points: points,
            Games: 1,
            HistoryStatus: "Valid",
            SourceRefreshUTC: new Date().toISOString(),
          }),
        );
        id++;
      }
  return fromTables(t, d.settings);
}
