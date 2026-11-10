# Gameday Plus Redesign — Design Brief

Status: design agreed with the owner on 2026-11-10. **No implementation has started.** This brief is the fixed reference for it.

Design reference: canvas `https://claude.ai/artifact/UpP7GTcDSV69N87aW87EjG` (private to the owner), board **"6 · Direction D — Gameday Plus"**. Boards A, B and C are the rejected or partly borrowed explorations; board 1 is the UX audit. You may not be able to open the canvas, so this brief restates every decision.

The canvas uses synthetic players and simplified maths. Where the brief and the canvas differ on a number or a formula, the **existing domain code is right** and the canvas is illustrative.

Version: a full interface overhaul is a major change → **1.0.0** (`npm version major`). Ship in phases behind a preview switch so 0.x keeps working until 1.0.0 replaces it.

---

## 0. Ground rules (from AGENTS.md)

- All calculation stays in `src/domain`. New chart data, lineup move lists, grade steps, floor and ceiling, and preset rules are domain outputs; the UI only renders them.
- Null is not zero. Unavailable values render as a quiet "—" or "N/A" with the reason on hover or focus. They are never charted as 0 and never shown as grade F.
- Keep source timestamps visible. Keep surplus exchange, lineup impact, legality and uncertainty as four separate verdicts, never one score or colour.
- Synthetic data only in tests, fixtures and screenshots.
- **Never display "no change".** When a grade, lineup or value is unaffected, show nothing for it: no "no change" text, no empty chip, no placeholder row. A section with nothing to report is hidden entirely.
- The label Why panel domain work in `docs/superpowers/plans/2026-11-09-label-why-panel.md` is unchanged. Only its mount point and chrome change (section 7).

---

## 1. Visual identity

- **Style:** broadcast editorial. Condensed, uppercase display type for headings and big numbers (canvas uses Barlow Condensed with Barlow for body). Bold outlines, generous numbers, team colours on player surfaces.
- **Themes:** light and dark, with a System option that follows the device. Every surface, chip, badge, chart and native control (sliders, dropdowns) must follow the theme. No black fills in light mode and no white fills in dark mode.
- **Selected state:** yellow fill with dark text, in both themes. Used for selected pills, tabs and segmented options, and for primary buttons.
- **Provenance:** green = recorded facts (●), blue = ESPN projections (◆), pink = model outputs (▲), purple = editable controls (■). Colour is always paired with the glyph or a label.
- **Positional grade colours:** a muted six-step scale from brick red (F) through clay, sand and sage to deep green (A). The grade letter is always shown.
- **Team colours:** player card headers, scouting card headers and trade sides use the player's NFL team colours. These stay the same in both themes.

---

## 2. Navigation

One horizontal bar: **This week · Roster · Scouting · League · Trade room · Lab**. It replaces today's nine sidebar items.

| New section | Replaces |
| --- | --- |
| This week | My team (overview part) |
| Roster | My team (roster, starters, hypothetical simulator) |
| Scouting | Players, Gem screener, Weekly streamers |
| League | League teams |
| Trade room | Trade analyzer (all three tools), saved trades, Trade journal |
| Lab | Model & audit, Data & account, app preferences |

Shell elements, always visible: wordmark, section tabs, player search with live results, week and source-freshness text, a "Hypothetical: name" chip when a simulation is active, a light/dark switch and the Feel menu. Below the bar, a signals ticker lists current label changes; it scrolls only when animation is Full.

---

## 3. This week (home)

1. Headline and one-paragraph summary of the roster's biggest gap and best fix. Numbers in it are computed, never hard-coded.
2. **Starting score outlook:** the user's modeled starters versus the league median by remaining week, led by the average and the gap to the median.
3. Three move cards: a trade, a waiver target, a lineup note.
4. Scoreboard: each position's starter value versus the league median with its grade.

---

## 4. Roster

- **Hypothetical roster simulator** at the top: switch between Live roster and saved simulations, create, save to a roster slot, delete. With a simulation active: add any league player (the existing league player picker), cut players, undo either. Unsaved simulations are marked. This is today's `RosterSimulator` behaviour in new chrome.
- **Depth chart** by position. Every tile uses the theme's card background. Starters have a yellow left edge and solid outline; bench players a faint outline. Each tile shows role, EPPG and a nine-week scoring strip.
- All grades and lineups across the app use the active simulation.

---

## 5. Scouting (players, gem screener, streamers in one)

- **Saved searches** across the top: All players, Gem screener, Rising targets, Buy low · sell high, Weekly streamers, plus "Save current as…".
- **Filter panel**, applied live with a count beside every option (no Apply button):
  - Player pool, Position.
  - **Signals (badges):** every existing label, with "Require all / Any of", Select all, Clear.
  - Moving averages: Golden cross only, Death cross only. Include injured.
  - Minimum trend PPG, minimum surplus index, minimum recent PPG.
  - "Advanced filters" holds the rest of today's set unchanged, including maximum surplus index.
- Results header: match count, the applied filters in words, and the existing "N more players match your other filters but are hidden by the selected signals" notice.
- **Cards or Table** view, sortable. Expected PPG is the default sort.
- The gem screener's filtering by badges must behave as it does today.

---

## 6. League

A grid of every team × QB, RB, WR, TE, FLEX, K, D/ST showing the positional grade on the muted colour scale. Clicking a grade opens a popover listing that team's players at the position (role, EPPG, labels), each with a link to the player card, which opens on top.

---

## 7. Player card (one popover, everywhere)

Every player name in the app opens the same animated popover, 1040px wide on desktop, over the current screen. There is no separate player page.

- **Header:** team colours, name, labels, **Expected PPG** as the largest number with next-game floor and ceiling beneath, recent and surplus, Add to versus, Take to trade room, previous / next (when opened from a list), Close.
- **Tabs:** Story · Numbers · Why the labels · Calculation. A new card opens on the last tab the user used.
- **Story:** Next-refresh EPPG scenarios, plain-language bullets, radar versus position average, and the moving-average chart.
- **Moving-average chart:** as today (`PlayerStockChart`): fast 2-game and slow 5-game averages on fantasy points, hollow volume bars, player and league volume averages. Interactive: hovering or focusing a week shows points, fast MA, slow MA, the gap and touches.
- **Next-refresh EPPG scenarios:** as today (`next-refresh.ts`): floor = EPPG − spread, ceiling = EPPG + spread, where spread blends the player's SD with the positional reference. Table: Assumption, Next-game points, Next EPPG, EPPG change. One small, out-of-the-way line states the blend (for example "64% his games · 36% WR history").
- **Why the labels:** today's panel layout: label tabs; verdict; "Is the production real?" check rows with value, threshold, meter and margin; "Is there enough to trust?" chips; chart of earlier versus last three games; "What could undo it" or "What would flip it"; historical reference; "Show the N games"; Details and caveats.

Expected PPG is the lead metric throughout the app: cards, tables, roster tiles, lineup slots and trade gains.

---

## 8. Trade room

Tabs: **Manual analyzer · Find trades · Chain planner**, plus Saved trades and Journal. Nothing in today's trade tools is removed.

### Manual analyzer
- Two team-coloured panels (you send / you receive) with a "tale of the tape" between them.
- **Grade steps:** small chips directly under each panel, one per impacted position ("WR D+→B− +4"). Unimpacted positions are never shown; "no change" is never displayed.
- **Force this trade into a hypothetical roster:** creates a simulation with the players moved, regardless of the verdict.
- **Lineup impact field:** Your team / Their team, Before / After, week. Slots show the player picture, EPPG and a tag: New, Shifted from X, Up from bench, Leaves, To bench. A plain list states who is replaced and who shifts.
- **Verdict:** four separate rows: surplus exchange, lineup impact (EPPG), legality, uncertainty.
- **Lineup gain ± spread:** the lineup impact row shows the gain with a range, labelled "Lineup gain ± spread", with floor and ceiling. The spread combines the next-refresh spreads (section 7) of every player whose lineup spot changes, as independent values: the square root of the sum of their squares. State in the UI that this slightly understates the range when two of those players share an NFL team. Find trades results show the same "± spread" beside each lineup gain.

### Find trades
- League-wide scan with teams to search, team needs, and **positional grade goals** (team, position or Overall, and today's step options).
- The controls panel uses folding groups, each with a one-line summary of its current settings: Players & packages, Teams to search, Team needs, Search limits, Manager profiles & acceptance. The same pattern is used on phones (section 11a).
- Each goal shows a plain-language line translating the steps into a grade, for example "Your WR is D+ today. +2 steps means C or better."
- Results show offer → receive, grade-step chips for both sides, lineup gain, surplus, and Analyze.

### Chain planner
- **Presets (10):** Balanced opportunities, Mutual benefit, Acquire a star, Turn a star into depth, Acquire coverage then upgrade, Connected chains, **Surface-stat trading** (renamed from "Surface-stat opportunities"; saved presets under the old name load under the new one), Speculative sequences, and two new ones:
  - **Fix my weakest position:** adds a goal of +2 grade steps at the lowest-graded position and no drop beyond 2 steps elsewhere.
  - **Buy low, then flip:** trade 1 must receive a BUY LOW player; trade 2 must send a SELL HIGH player.
- A preset only describes the kind of chain to look for. Switching presets keeps teams, protected players, required targets and positional goals. Custom presets can be saved.
- Surface-stat trading results show two figures per step: their gain on surface stats and the user's gain in EPPG.

### One search method (Find trades and Chain planner)
- **No strictness setting.** Every search uses one method with today's Balanced limits.
- **Shared, editable limits** in one collapsed section, the same in both tools: minimum final gain, maximum temporary loss, maximum recipient value loss, index window. Presets never change them and saved presets do not store them. The index window replaces "Use strict index range".
- An "edited" marker shows on the section header and on each changed limit.
- **Automatic widening:** if a search finds nothing, limits loosen step by step **from the user's values**. Each widened result states which limit moved and by how much.
- **Result order:** passes every price test, then price warning, then widened. Price tests never hide a result.
- Old saved presets that stored a strictness level load into the single method.

---

## 9. Lab

Feel settings, model settings (purple controls), evidence sources, audits, data and account, and a keyboard reference. Split today's long Model & audit page into these sections.

---

## 10. Feel: theme, motion, sound, haptics

Independent settings, synced with the account:

- **Theme:** System · Light · Dark.
- **Animation:** System · Full · Reduced · Off. System follows `prefers-reduced-motion`. Reduced keeps short fades only; Off removes all transitions. Nothing conveys meaning through motion alone.
- **Sound:** off by default; short tones for tap, select, success, caution.
- **Haptics:** off by default; short vibration pulses. Show "not supported" where the Vibration API is missing (for example iOS Safari).

---

## 11. Keyboard

- **Esc** closes the top popover only, then the one beneath.
- Opening a popover moves focus into it; closing returns focus to the element it was opened from, including list rows.
- **Tab** stays inside an open popover.
- **↑ ↓** move between players in scouting results, the roster and position lists; **Enter** opens the card.
- **← →** in a player card opened from a list step to the previous or next player on the same tab; in the versus comparison they swap sides.

---

## 11a. Phones and tablets

Canvas boards "7 · Phone layouts" (screens 1–9) and "8 · Phone layouts, part 2" (screens 10–17); "6b" shows the desktop design at iPad width.

- **Tablets use the desktop design.** The phone layout applies only below 720px wide. An iPad in portrait or landscape gets every desktop column.
- **Touch screens of any size:** controls are at least 44px tall, and hover becomes tap (tapping a week on the moving-average chart pins its values under the chart).
- **Phones keep every control.** Nothing is removed from Find trades or the Chain planner; controls move into sheets.
- **Phone navigation:** a bottom bar with Week, Roster, Scout, League, Trades. Lab, Feel and theme open from a header menu.
- **Phone patterns:**
  - Tables become rows: one player per row, EPPG large on the right, badges and the floor-to-ceiling bar under the name.
  - Filters, search controls, pickers and the grade-goal editor open as bottom sheets. The filter sheet's main button states how many players will show.
  - The player card is a full-height sheet: swipe down or ✕ to close, swipe sideways or ‹ › for the next player. The Why panel stacks into one column.
  - Roster is one list grouped by position, each group headed by its grade; swipe a row to cut while a simulation is active.
  - League keeps the grade grid as seven small squares per team; tapping a grade raises a half-height sheet.
  - Manual analyzer: the two sides stack with grade-step chips under each; the lineup field becomes a slot list with the same tags; the four verdicts stay pinned above the tab bar as separate cells, each opening its own detail sheet.
  - Chain planner: presets as a swipe row; Trade 1 and Trade 2 settings behind a two-way switch, with whole-chain settings beneath. The search button stays pinned above the tab bar.
  - **Folding settings groups:** on the Find trades controls sheet and the chain settings screen, each group of settings folds to one line that summarises its current values (for example "Target Isaiah Crane · Standard depth · Either route"). Groups are not draggable. The app remembers which groups were left open. Edited search limits keep their purple marker in the folded summary.

---

## 11b. Five added features

Chosen by the owner from twenty proposals (canvas boards 9 and 10; the other fifteen are not part of the design). All five are drawn on board 6. They are new functionality, not restyling, and can follow the core redesign.

1. **Start or sit odds** (in the versus comparison). The chance one player outscores the other this week, from each player's EPPG and blended spread, treated as independent. Shown as a percentage with both ranges on one line and a plain reading ("close to a coin flip", "modest edge", "clear edge"). Labelled an estimate from past variability, not a prediction.
2. **League power ranges** (League screen, under the grade grid). Every team's total starter EPPG for the week as floor, expected and ceiling, ranked, with spreads combined as independent. Beside each opponent: the chance the owner's lineup outscores theirs, by the same method as start or sit odds.
3. **Waiver add and drop pairs** (Roster screen, above the depth chart). For each available player, the drop that helps the lineup most, with lineup gain ± spread and whether the pickup would start or only add depth. "Try in a simulation" creates a hypothetical roster with the pair applied. Reuses existing drop rules, including undroppable players.
4. **Since last import** (This week, above the move cards). A digest of labels gained and lost and the largest EPPG movers since the previous import. Requires keeping a small per-player summary of the previous import (labels, EPPG; later grades, owner, injury). It is not the workbook, but the "one current snapshot" wording must be updated to say so.
5. **Counter-offer builder** (Trade room, fourth tab). Starting from the offer in the Manual analyzer, list the alternatives that differ by one swap or one added player and still help the owner, with both lineups' change. Counters that help both sides come first. "Use this" loads one into the analyzer; each can be logged to the journal as a counteroffer.

Not yet drawn for phones.

---

## 12. Domain work this design needs

Each item is a domain output with tests; none changes valuation.

1. Lineup move list for a trade: per slot before and after, with new / shifted / benched / leaving status, for both teams.
2. Grade-step changes per position for both teams, impacted positions only.
3. Next-game floor and ceiling per player, exposed for cards and lists (the scenario maths already exists).
4. Golden-cross and death-cross flags usable as filters, if not already exposed.
5. Radar axes per player, normalised within position, with gaps for missing inputs.
6. Live facet counts for the screener.
7. Two new chain presets and the single search method: remove strictness, share limits between Find trades and chains, widen from user limits, tag widened results, order by price-test status.
8. Home summary sentences and move cards generated from model results.
9. Preset rename migration for "Surface-stat opportunities".
10. Lineup gain spread for a trade: the combined spread of players whose lineup spot changes, with floor and ceiling, for the analyzer and for each search result.
11. Plain-language grade-goal sentences (current grade and the grade the goal implies).
12. Outscore probability for two players and for two lineups, from EPPG and spread.
13. Team lineup totals with combined spread for every team.
14. Best add and drop pairs for the owner's roster.
15. Previous-import summary storage and the comparison that produces the digest.
16. One-step counter-offer generation from a given trade.

---

## 13. Suggested phases

1. Shell, navigation, theme tokens, Feel settings, keyboard and popover behaviour.
2. Player card popover with all tabs; Scouting with live filters and saved searches.
3. Roster with the simulator; League grid and popovers.
4. Trade room: Manual analyzer and lineup field, then Find trades, then Chain planner with the single search method and presets.
5. This week, Lab, phone layouts, browser and Excel parity checks, release 1.0.0.

---

## 14. Not yet verified or decided

- The canvas has only been seen by the owner in parts (Roster in light mode, Scouting filters in dark mode). Home, League, Trade room and the player card have not been reviewed on screen in dark mode.
- Phone layouts are designed as static screens (section 11a) and the owner has seen the first nine rendered. The second set (screens 10–17) has not been reviewed on screen. The owner has confirmed the iPad-width view looks fine.
- Player pictures are placeholders on the canvas; the app's existing player card pictures are used.
- The header wraps onto two rows near 1000px wide and needs tightening.
