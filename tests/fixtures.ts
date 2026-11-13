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

// A 20-player roster with explicit ESPN slots, real backups on every card and deterministic matchups.
// Two defenses are engineered from history: MNE's players face a soft unit, RIV's a tough one, and TE's
// ranks invert so one starter is bad against the soft unit. Options cover the bye-starter and optimal cases.
export async function formationFixture(
  options: { byeStarter?: boolean; optimal?: boolean } = {},
) {
  const current = 10;
  const ctx: Row = {
    Season: 2026,
    CurrentWeek: current,
    FinalWeek: 17,
    TeamCount: 2,
    RefreshUTC: new Date().toISOString(),
    QBSlots: 1,
    RBSlots: 2,
    WRSlots: 2,
    TESlots: 1,
    KSlots: 1,
    DSTSlots: 1,
    FlexSlots: 1,
    BenchSlots: 12,
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
    ModelSchedule: [],
  };
  const sourceUTC = new Date().toISOString();
  // One schedule per NFL team, so every player's tone is decided by the unit he faces.
  const schedule = (proTeamId: number, nfl: string, opponent: string, bye = 0) => {
    for (let week = 1; week <= 17; week++)
      tables.ModelSchedule.push({
        ProTeamID: proTeamId,
        NFLTeam: nfl,
        Week: week,
        HasGame: week === bye ? 0 : 1,
        ByeWeek: bye,
        Opponent: opponent,
      });
  };
  schedule(100, "MNE", "SOFT");
  schedule(200, "RIV", "TOUGH");
  schedule(300, "BYE", "SOFT", current);
  schedule(400, "OUT", "TOUGH");
  // Filler players on the opponent side give each defense a per-position rate over nine played weeks.
  const filler: [string, number, number][] = [
    ["QB", 20, 10],
    ["RB", 18, 8],
    ["WR", 18, 8],
    ["TE", 4, 26],
    ["K", 9, 7],
    ["D/ST", 9, 7],
  ];
  filler.forEach(([pos, soft, tough], i) => {
    for (const [defense, points, id] of [
      ["SOFT", soft, 500 + i * 2],
      ["TOUGH", tough, 501 + i * 2],
    ] as const) {
      schedule(1000 + id, `F${id}`, defense);
      tables.ModelPlayers.push({
        PlayerID: id,
        Player: `${defense} ${pos}`,
        Position: pos,
        ProTeamID: 1000 + id,
        NFLTeam: `F${id}`,
        OnTeamID: 2,
        InjuryStatus: "ACTIVE",
        Droppable: true,
        GamesPlayed: 9,
        ActualPoints: points * 9,
        Actual_PPG: points,
        Last3_PPG: points,
        ScoreSD: 0,
        ESPN_Projected_PPG: points,
        ESPN_Projected_Total: points * 17,
        ESPN_Projected_Games: 17,
        Current_Week_Projection: points,
        RushAttempts: 0,
        Targets: 0,
        ADP: 200,
        SourceRefreshUTC: sourceUTC,
      });
      tables.ModelRosters.push({ PlayerID: id, TeamID: 2, LineupSlotID: 20 });
      for (let week = 1; week <= 9; week++)
        tables.ModelHistory.push({
          PlayerID: id,
          Season: 2026,
          Week: week,
          Points: points,
          Games: 1,
          HistoryStatus: "Valid",
          SourceRefreshUTC: sourceUTC,
        });
    }
  });
  const add = (x: {
    id: number;
    name: string;
    pos: string;
    proTeamId: number;
    nfl: string;
    slot: number;
    projection: number;
    injury?: string;
  }) => {
    // Symmetric variation keeps the mean and last-three mean at the projection while giving a real spread.
    const scores = Array.from({ length: 9 }, (_, i) =>
      i === 6 ? x.projection - 1.5 : i === 7 ? x.projection + 1.5 : x.projection,
    );
    tables.ModelPlayers.push({
      PlayerID: x.id,
      Player: x.name,
      Position: x.pos,
      ProTeamID: x.proTeamId,
      NFLTeam: x.nfl,
      OnTeamID: 1,
      InjuryStatus: x.injury ?? "ACTIVE",
      Droppable: true,
      GamesPlayed: 9,
      ActualPoints: x.projection * 9,
      Actual_PPG: x.projection,
      Last3_PPG: x.projection,
      ScoreSD: sd(scores) ?? 0,
      HistoryIssue: "",
      Season_Games: 9,
      Current_Actual_Games: 0,
      ProjectionRecords: 1,
      ESPN_Projected_PPG: x.projection,
      ESPN_Projected_Total: x.projection * 17,
      ESPN_Projected_Games: 17,
      Current_Week_Projection: x.projection,
      RushAttempts: 0,
      Targets: 0,
      ReceivingTD: 0,
      RushTD: 0,
      ADP: 50,
      SourceRefreshUTC: sourceUTC,
    });
    tables.ModelRosters.push({
      PlayerID: x.id,
      TeamID: 1,
      LineupSlotID: x.slot,
    });
    for (let week = 1; week <= 9; week++)
      tables.ModelHistory.push({
        PlayerID: x.id,
        Season: 2026,
        Week: week,
        // Symmetric variation keeps the mean and last-three mean at the projection, so MPPG is
        // unchanged, while giving every player a real spread.
        Points:
          week === 7
            ? x.projection - 1.5
            : week === 8
              ? x.projection + 1.5
              : x.projection,
        Games: 1,
        HistoryStatus: "Valid",
        SourceRefreshUTC: sourceUTC,
      });
  };
  const mne = { proTeamId: 100, nfl: "MNE" },
    riv = { proTeamId: 200, nfl: "RIV" },
    byes = { proTeamId: 300, nfl: "BYE" },
    outs = { proTeamId: 400, nfl: "OUT" };
  // ESPN starters: soft matchups on MNE, tough on RIV, TE bad against the soft unit.
  add({ id: 1, name: "Jalen Mercer", pos: "QB", slot: 0, projection: 21.6, ...mne });
  add({ id: 2, name: "Rashad Vance", pos: "RB", slot: 2, projection: 11.4, ...mne });
  add({ id: 3, name: "Avery Whitfield", pos: "RB", slot: 3, projection: 13.5, ...riv });
  add({ id: 4, name: "Dante Okafor", pos: "WR", slot: 4, projection: 11.0, ...mne });
  add({ id: 5, name: "Felipe Andrade", pos: "WR", slot: 5, projection: 10.2, ...riv });
  add({
    id: 6,
    name: "Tobias Lamb",
    pos: "TE",
    slot: 6,
    projection: 14.6,
    ...(options.byeStarter ? byes : mne),
  });
  add({ id: 7, name: "Cole Brannigan", pos: "WR", slot: 23, projection: 9.3, ...mne });
  add({ id: 8, name: "Owen Sandoval", pos: "K", slot: 17, projection: 8.1, ...mne });
  add({ id: 9, name: "Summit Hawks", pos: "D/ST", slot: 16, projection: 8.1, ...mne });
  // Bench: every slot has cover, and QB, RB and WR have two. Dunn is the one legal upgrade at FLEX.
  add({
    id: 10,
    name: "Marquise Dunn",
    pos: "RB",
    slot: 20,
    projection: options.optimal ? 3.0 : 11.2,
    ...mne,
  });
  add({ id: 11, name: "Kofi Osei", pos: "WR", slot: 20, projection: 6.4, ...riv });
  add({ id: 12, name: "Jon Park", pos: "WR", slot: 20, projection: 4.1, ...mne });
  add({ id: 13, name: "Ty Boyd", pos: "RB", slot: 20, projection: 3.2, ...riv });
  add({ id: 14, name: "Luca Frank", pos: "TE", slot: 20, projection: 5.5, ...mne });
  add({ id: 15, name: "Nico Reyes", pos: "QB", slot: 20, projection: 12.0, ...mne });
  add({ id: 16, name: "Diego Carr", pos: "K", slot: 20, projection: 7.2, ...riv });
  add({ id: 17, name: "Harbor Gulls", pos: "D/ST", slot: 20, projection: 7.5, ...riv });
  // A bye-week and an out player cannot start or be pinned; both stay as bench cover.
  add({ id: 18, name: "Bo Ito", pos: "RB", slot: 20, projection: 5.0, ...byes });
  add({ id: 19, name: "Otto Vale", pos: "WR", slot: 20, projection: 6.0, injury: "OUT", ...outs });
  add({ id: 20, name: "Ira Moss", pos: "RB", slot: 21, projection: 9.0, ...mne });
  // A third QB exists only so conflicting pins can be exercised; one QB slot cannot start two of them.
  add({ id: 21, name: "Eli Grove", pos: "QB", slot: 20, projection: 9.0, ...mne });
  return fromTables(tables, { ...defaults });
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
