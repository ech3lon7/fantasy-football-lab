import { fixture } from "./fixtures";
import { fromTables } from "../src/import/workbook";

// A tiny synthetic league supplies one safe bridge and one losing bridge; both steps pass the unchanged asking-price tests.
export async function chainFixture() {
  const d = await fixture();
  Object.assign(d.tables.ModelContext[0], {
    TeamCount: 3,
    QBSlots: 0,
    RBSlots: 1,
    WRSlots: 1,
    TESlots: 0,
    FlexSlots: 0,
    KSlots: 0,
    DSTSlots: 0,
    BenchSlots: 4,
  });
  d.tables.ModelTeams = [
    { TeamID: 1, TeamName: "Chain A" },
    { TeamID: 2, TeamName: "Chain B" },
    { TeamID: 3, TeamName: "Chain C" },
  ];
  const rb = d.tables.ModelPlayers.find((p) => p.PlayerID === 1)!;
  const wr = d.tables.ModelPlayers.find((p) => p.PlayerID === 2)!;
  for (const [id, name, position, owner, points, slot] of [
    [1, "Chain Starter RB", "RB", 1, 20, 2],
    [2, "Chain Bridge WR", "WR", 2, 21, 4],
    [3, "Chain Reserve RB", "RB", 1, 18, 20],
    [4, "Chain Protected WR", "WR", 1, 20, 4],
    [5, "Chain Target WR", "WR", 3, 30, 4],
    [6, "Chain B RB", "RB", 2, 10, 2],
    [7, "Chain C RB", "RB", 3, 10, 2],
  ] as const) {
    const original = d.tables.ModelPlayers.find((p) => p.PlayerID === id);
    const player = original ?? { ...(position === "RB" ? rb : wr) };
    Object.assign(player, {
      PlayerID: id,
      Player: name,
      Position: position,
      OnTeamID: owner,
      ActualPoints: points * 5,
      Actual_PPG: points,
      Last3_PPG: points,
      ScoreSD: 0,
      ESPN_Projected_PPG: points,
      ESPN_Projected_Total: points * 17,
    });
    if (!original) d.tables.ModelPlayers.push(player);
    d.tables.ModelHistory = d.tables.ModelHistory.filter(
      (h) => h.PlayerID !== id,
    );
    for (let week = 1; week <= 5; week++)
      d.tables.ModelHistory.push({
        PlayerID: id,
        Season: 2026,
        Week: week,
        Points: points,
        Games: 1,
        HistoryStatus: "Valid",
        SourceRefreshUTC: d.sourceUTC,
      });
    d.tables.ModelRosters = d.tables.ModelRosters.filter(
      (r) => r.PlayerID !== id,
    );
    d.tables.ModelRosters.push({
      PlayerID: id,
      TeamID: owner,
      LineupSlotID: slot,
    });
  }
  return fromTables(d.tables, d.settings);
}

// Separate mutual-benefit fixture leaves existing search/surface samples intact: spare RB/TE players fund distinct recipient upgrades.
export async function fairChainFixture() {
  const d = await chainFixture();
  d.tables.ModelContext[0].TESlots = 1;
  for (const [id, name, pos, owner, points, slot] of [
    [3, "Chain Reserve RB", "RB", 1, 20, 20],
    [5, "Chain Target WR", "WR", 3, 26, 4],
    [8, "Chain Reserve TE", "TE", 1, 20, 20],
    [9, "Chain Starter TE", "TE", 1, 21, 6],
    [10, "Chain B Reserve WR", "WR", 2, 20, 20],
    [11, "Chain C Reserve WR", "WR", 3, 25, 20],
    [12, "Chain C TE", "TE", 3, 5, 6],
    [13, "Chain B TE", "TE", 2, 5, 6],
  ] as const) {
    const existing = d.tables.ModelPlayers.find((p) => p.PlayerID === id);
    const base =
      existing ?? d.tables.ModelPlayers.find((p) => p.Position === pos)!;
    const player = {
      ...base,
      PlayerID: id,
      Player: name,
      Position: pos,
      OnTeamID: owner,
      ActualPoints: points * 5,
      Actual_PPG: points,
      Last3_PPG: points,
      ScoreSD: 0,
      ESPN_Projected_PPG: points,
      ESPN_Projected_Total: points * 17,
      Current_Week_Projection: points,
    };
    d.tables.ModelPlayers = d.tables.ModelPlayers.filter(
      (p) => p.PlayerID !== id,
    );
    d.tables.ModelPlayers.push(player);
    d.tables.ModelRosters = d.tables.ModelRosters.filter(
      (p) => p.PlayerID !== id,
    );
    d.tables.ModelRosters.push({
      PlayerID: id,
      TeamID: owner,
      LineupSlotID: slot,
    });
    d.tables.ModelHistory = d.tables.ModelHistory.filter(
      (h) => h.PlayerID !== id,
    );
    for (let week = 1; week <= 5; week++)
      d.tables.ModelHistory.push({
        PlayerID: id,
        Season: 2026,
        Week: week,
        Points: points,
        Games: 1,
        HistoryStatus: "Valid",
        SourceRefreshUTC: d.sourceUTC,
      });
  }
  return fromTables(d.tables, d.settings);
}
