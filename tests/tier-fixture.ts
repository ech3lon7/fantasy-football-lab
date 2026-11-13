import { fixture } from "./fixtures";
import { fromTables } from "../src/import/workbook";

// A two-team league with free-agent players in every tier. With two teams the cut-offs are ranks 2, 6 and 12.
//   901-902 superstar, 903-906 star, 907-912 good, 913 ranked but no tier, 914 scored well in only 3 games (unranked).
export async function tierFixture() {
  const d = await fixture();
  d.tables.ModelContext[0].TeamCount = 2;
  // Everyone already in the fixture scores low, so the synthetic players take the top of the ranking.
  for (const p of d.tables.ModelPlayers) Object.assign(p, { GamesPlayed: 6, Actual_PPG: 5 });
  const base = d.tables.ModelPlayers[0];
  const history = d.tables.ModelHistory.filter((h) => h.PlayerID === base.PlayerID);
  const entries: [number, string, string, number, number][] = [
    [901, "Sam", "Superstar", 40, 6],
    [902, "Sasha", "Superbright", 39, 6],
    [903, "Stella", "Starling", 30, 6],
    [904, "Stan", "Starkey", 29, 6],
    [905, "Stu", "Starr", 28, 6],
    [906, "Sky", "Starfield", 27, 6],
    [907, "Gwen", "Goodman", 20, 6],
    [908, "Gus", "Goodwin", 19, 6],
    [909, "Gabe", "Goodrich", 18, 6],
    [910, "Gail", "Goodall", 17, 6],
    [911, "Gil", "Goodfellow", 16, 6],
    [912, "Gia", "Goodchild", 15, 6],
    [913, "Nate", "Nobadge", 10, 6],
    [914, "Few", "Games", 50, 3],
  ];
  for (const [id, first, last, ppg, games] of entries) {
    d.tables.ModelPlayers.push({
      ...base,
      PlayerID: id,
      Player: `${first} ${last}`,
      OnTeamID: 0,
      GamesPlayed: games,
      Actual_PPG: ppg,
      Last3_PPG: ppg,
      ESPN_Projected_PPG: ppg,
    });
    d.tables.ModelHistory.push(...history.map((h) => ({ ...h, PlayerID: id, Points: ppg })));
  }
  return fromTables(d.tables, d.settings);
}
