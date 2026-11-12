# Matchup Views — Implementation Plan

> **For agentic workers:** Implement task by task. Each task ends with `npm run check`; the plan ends with `npm run build`, the browser specs named below, and light and dark screenshots for the owner. Run browser specs as the project memory note says.

**Goal:** Let the owner see each player's opponent difficulty, and compare the usual lineup with one that uses ESPN's matchup-aware weekly projection, **without changing any existing number**.

**Design reference:** `docs/design/gameday-plus/D_GamedayPlus.dc.html` (search for `matchup(p, w)`, `mu-chip`, `mu-strip`, `wl`). On the canvas: board 6, This week, Scouting cards, and the player card's Story tab. Its schedule and defence figures are invented; the formulas below are the specification.

**Version:** moderate change (two new features) → npm minor bump.

---

## 0. Ground rules

- **Context only.** Expected PPG, Value PPG, VORP, surplus index, grades, lineups used for trades, and every trade verdict stay exactly as they are. Excel parity must not change. The matchup view is a second, clearly labelled view; it never replaces the season view.
- All calculation in `src/domain`; null is never zero; synthetic fixtures only.
- ESPN's current-week projection (`Current_Week_Projection`, already `p.weekly`) is ESPN's number. Label it "ESPN this week" with the ◆ ESPN provenance glyph.

## 1. What the data has (verified 2026-11-12)

- `ModelSchedule`: `ProTeamID`, `NFLTeam`, `Week`, `ByeWeek`, `HasGame`, `OpponentID`, `Home`, `StatsOfficial`, `Opponent`.
- `ModelHistory`: `PlayerID`, `Season`, `Week`, `Points`, `Games`, workload columns, `HistoryStatus`. **No NFL team per week.**
- `ModelPlayers`: the player's **current** NFL team and position.

Consequence: a player who changed NFL teams mid-season is credited to his current team for every past week. Flag this in the method note; do not guess past teams.

## 2. Domain: defence versus position (new `src/domain/matchups.ts`)

- [ ] **2.1 Points allowed.** For each completed week with `StatsOfficial` true and `HasGame` 1, for each player with a valid played-game history row that week, find his NFL team's `OpponentID` that week. Add his `Points` to that defence's total for his position, and count one game for that defence-position pair per team game (not per player).
  - Result per defence and position: **points allowed per game** = total points scored by that position against the defence ÷ games that defence played.
  - League average per position = mean over defences with at least one game.
  - **Difference** = defence's figure − league average. Positive means the defence gives up more than average (a soft matchup).
  - **Rank** 1…N per position, 1 = allows the fewest (toughest).
  - Use only players who appeared in the history (played games); byes and non-participation are excluded, as everywhere else.
- [ ] **2.2 Small samples.** Return the games behind each figure. Below 3 games for that defence, return the figure with `status: "conditional"` and show it greyed with "Early sample (N games)". With 0 games, `null` and "Unavailable".
- [ ] **2.3 Tone.** `tough` if rank is in the toughest sixth of defences, `soft` if in the softest sixth, otherwise `neutral` (with 32 teams: ranks 1–5 tough, 28–32 soft). Keep the cut points as named constants.
- [ ] **2.4 Player matchups.** `playerMatchups(m, player)` returns, for each week from the current week to the final fantasy week: opponent code, home/away, bye flag, the defence's difference and rank for the player's position, tone, and status. K and D/ST use the same method (points scored by kickers or by D/STs against that team).
- [ ] **2.5 Tests.** Synthetic schedule and history: a defence that allows exactly the average; tough and soft extremes; a bye week; a defence with 2 games (conditional); a player with no team (unavailable); a player whose history includes a week his team was on bye (data issue: excluded and reported).

## 3. Domain: matchup lineup view

- [ ] **3.1** `weekLineups(m, team, week)` returns two lineups for the current week, built with the **existing** lineup rules and slot assignment:
  - **Season view:** the current selection by Value PPG, unchanged.
  - **Matchup view:** the same rules, ranking available players by ESPN's current-week projection (`p.weekly`). A player without a usable weekly projection ranks below every player with one; never treat a missing projection as 0 points.
  - Per slot: both players, both numbers, and whether they differ.
- [ ] **3.2** Only the current week: ESPN's weekly projection exists only for the imported week. Say so in the UI.
- [ ] **3.3 Tests:** identical rosters give identical views; one player with a higher weekly projection swaps into FLEX in the matchup view only; a player on bye or out is excluded from both; missing weekly projections are handled.

## 4. Interface

- [ ] **4.1 Matchup chip** (design `mu-chip`): "W10 vs PHI · soft", coloured by tone (green soft, sand neutral, brick tough; never colour alone: the word is always shown). Hover or focus shows the full sentence: "Soft vs WR · +2.5 points allowed versus average · 28th of 32". Place it on Scouting cards and rows, Roster tiles, League position popovers and lineup slots. Beside it on cards: "◆ ESPN this week 17.3".
- [ ] **4.2 Rest-of-season strip** on the player card's Story tab (design `mu-strip`), above the existing two columns: one cell per remaining week with week, opponent code, and the signed difference, coloured by tone; byes neutral and labelled; early-sample cells greyed. Summary line: "2 soft · 1 tough · ESPN this week 17.3". Method note: "From each defence's points allowed to the position in completed games. Context only: Expected PPG does not use it."
- [ ] **4.3 This week: two lineup views** (design `wl`): a table with Slot · Season view (Expected PPG) · Matchup view (ESPN this week) · Matchup chip. Rows where the views differ get the ESPN-blue edge and "◆ differs". Note under it: how many slots differ, what each view ranks by, and that neither changes the ESPN lineup. When they agree: "Both views pick the same starters this week."
- [ ] **4.4 Scouting:** add "Matchup this week" as a sort and a filter (soft / neutral / tough), and add the chip to the Weekly streamers saved search, where it matters most.
- [ ] **4.5 Phones:** chip under the name in player rows; the strip scrolls sideways inside the card; the lineup table becomes one row per slot with the two players stacked.

## 5. Verification

- [ ] Unit tests from 2.5 and 3.3.
- [ ] Snapshot test: Expected PPG, Value PPG, VORP, grades and trade results on the fixtures are identical before and after.
- [ ] Browser spec: the chip, the strip and the two-view table render with the synthetic fixture (give the fixture a schedule with distinct opponents and a weekly projection that differs from Expected PPG for one bench player).
- [ ] Screenshots in light and dark for the owner.
