# Gameday Plus — Corrections Plan

> **For agentic workers:** This plan fixes the 1.0.0 release, which shipped the Gameday Plus redesign only partly. Work section by section, in order. Each task ends with `npm run check`; each section ends with `npm run build` and the browser specs it names. Run browser specs the way the project's memory note says: `GITHUB_ACTIONS=true npm run build`, then `CI=true GITHUB_ACTIONS=true RELEASE_VERIFY=true APP_URL=http://127.0.0.1:4173/fantasy-football-lab/ npx playwright test --workers=3`. Never hand-start a preview server.

**Read first:** `AGENTS.md`, the design brief `docs/superpowers/specs/2026-11-10-gameday-plus-redesign-brief.md`, and the original plan `docs/superpowers/plans/2026-11-10-gameday-plus-redesign.md`. The brief is still the source of truth. This document says what is wrong with what was built and how to finish it.

**Version:** these are corrections to a released interface, so each section is a minor (npm patch) bump: 1.0.1, 1.0.2 and so on. Do not bump the major version.

**Audit basis:** the owner's report and screenshot of their own league (2026-11-11), plus an audit of commit `a60e957` using the synthetic browser fixture (`seedLabelWhy`) at 1440×900 in the dark theme. Light theme and phone layouts were not screenshotted in this audit; re-check them in Section 9.

---

## 0. Why it went wrong (so it does not happen again)

1. **Old screens were wrapped, not rebuilt.** The new screens mount these old components largely unchanged:

   | New screen | Old component still rendered | Where |
   | --- | --- | --- |
   | Trade room → Find trades, Chain planner | `TradeView` (the whole old trade screen, including its own Manual analyzer / Find trades / Chain planner tabs, pool boards, lineup field, "Detailed trade calculations", "Browse saved trades") | `src/app/App.tsx` around line 1355 |
   | Roster | `RosterSimulator`, `StarterLineupEditor` and its roster table | `App.tsx` line ~1059, `next/Roster.tsx:216` |
   | League | `TeamView` (grade cards, grade table, full roster table) | `next/League.tsx:193` |
   | Lab | `ModelView`, `Account`, `EvidenceSettings` | `App.tsx` lines ~953, ~1033 |
   | Scouting | `GemTracking` | `next/Scouting.tsx:761` |
   | Every screen | the old hypothetical toolbar and its red notices, the old provenance legend in the footer | `App.tsx` ~1115–1140 and footer |

2. **The old stylesheet still applies to everything.** `src/ui/styles.css` (≈3,400 lines) is imported first in `src/main.tsx`, defines light-only colours on `:root` (`#fff`, `white`, `--ink: #152c29` and dozens more), and is not scoped. Old panels therefore render white in the dark theme, and their headings use the new light ink on a white panel, which makes them invisible: "You offer", "Your player pool", "Lineup impact", "Players & packages", "Team needs", "Hypothetical roster simulator", "Your roster", "Manage starters", and most grade tiles in the old Team needs grid.

3. **The checks could not see it.** `tests/browser/gameday-theme.spec.ts` samples four elements (root, one banner, one selected and one unselected segmented button). A page full of white legacy panels passes it. No spec compares screens with the design.

4. **Feedback and motion were built as utilities but never wired.** `feedback()` in `src/ui/feel/settings.ts` exists, but its only caller is the Feel menu's test button (`next/Shell.tsx:145`). `gameday.css` has two `@keyframes` (the ticker and a pulse) and three transitions; nothing else animates.

5. **Fonts were never loaded.** Tokens name Barlow and Barlow Condensed, but no font is imported or bundled, so headings fall back to Arial Narrow and body text to the system font. The old stylesheet still imports DM Sans and Manrope from Google.

**New rules for this plan:**

- **R1 · No legacy component inside the new shell.** By the end of this plan nothing under `src/features/*.tsx` (outside `src/features/next/`) renders inside the shell unless it has been converted to tokens and `gd-` classes, and `styles.css` is no longer imported. Move logic you need into hooks or domain functions; rebuild the markup.
- **R2 · Tokens only.** No literal colour in any component rule. The only literal colours allowed are inside `tokens.css` and team colours from `nfl-colors.ts`.
- **R3 · Every screen passes the theme sweep** (Task 1.4) in both themes, not four sampled elements.
- **R4 · Visual acceptance.** Each section ends with screenshots of the screens it touched, in light and dark, saved under `test-results/` (ignored by Git) and listed in the section's verification note. The owner reviews them before the next section starts.

---

## 1. Foundations

- [ ] **1.1 Load the fonts.** Self-host Barlow (400, 500, 600, 700) and Barlow Condensed (600, 700, 800) under `public/fonts/` as WOFF2, declare them with `@font-face` in `tokens.css`, and add them to the offline shell list in `vite.config.ts` so they work offline. Both are under the SIL Open Font License; include the licence file. Remove the Google Fonts import from `styles.css`.
- [ ] **1.2 Scope or retire `styles.css`.** As a stop-gap until every legacy screen is rebuilt, wrap the old stylesheet's `:root` rules so they apply only inside a `.legacy` container, and give that container token colours. The end state (Section 10) is that `styles.css` is not imported at all.
- [ ] **1.3 Header fits one row.** At 1440px the Feel button wraps onto a second row (see audit). Combine Keys and Feel into one menu, shorten the sync pill, and add the light/dark switch the brief requires (a one-tap toggle beside the menu; it is missing). Verify one row at 1440, 1280 and 820px.
- [ ] **1.4 Theme sweep spec.** Replace the four-element theme check with a sweep: for every route, every player card tab and every popover, in each theme, assert that no visible element at least 60×24px has a background of pure white (dark theme) or the ink colour (light theme), and that every visible text node has at least 4.5:1 contrast against its nearest opaque background (3:1 for text 24px and larger). Report offenders by selector. This spec must fail on the current build; keep it failing until Section 10 makes it pass, and mark known offenders as expected failures per section so progress is visible.

## 2. Feedback and motion

- [ ] **2.1 Wire feedback.** Create one hook, `useFeedback()`, that reads the current Feel settings and returns `feedback(kind)`. Call it on: navigation and tab changes (tap); selecting a pill, segmented option, filter, preset or player in a picker (select); a search finishing with results, a trade forced into a simulation, a simulation saved, an import accepted (success); a legality failure, a search finding nothing, an import with blocking issues (caution). Unit-test that each call site uses the right kind; browser-test that Sound on produces an `AudioContext` call and Sound off produces none.
- [ ] **2.2 Motion, gated by the animation level.** Add, all respecting `data-animation`:
  - Screen change: content fades and rises 12px over 240ms, with a skeleton until data is ready.
  - Popovers and sheets: open with fade and scale (desktop) or slide up (phone), close in reverse.
  - Charts: bars grow from the baseline and lines reveal left to right over 600ms when first shown.
  - Selection: chips and pills spring when selected; the compare tray or versus chip animates in.
  - Trade verdict: the four rows appear in sequence; a legality failure shakes its row once.
  - Recalculation: affected numbers dim and shimmer.

  Reduced keeps fades only (≤150ms); Off removes all motion. Browser spec: with Off, no element has a running animation or a non-zero transition duration.

## 3. Player pictures and team colours

- [ ] **3.1 One `PlayerPhoto` component.** Today pictures only appear inside old components (`TradeWorkspace.tsx:53`, `ScenarioLineupBoards.tsx:19`, ESPN headshot URL by player ID). Extract that into `src/ui/PlayerPhoto.tsx` with a lazy-loaded image, a fixed size, the team colour behind it, and a fallback of initials on the team colour when the image fails or the player is a D/ST (use the team logo there if the old code does). Never block layout on the image.
- [ ] **3.2 Use it everywhere a player appears:** player card header (large), Scouting cards and rows, Roster tiles, League position popover, Manual analyzer sides and lineup field, Find trades and chain results, versus, pickers, This week move cards and the since-import digest.
- [ ] **3.3 Team colours.** Card headers and trade sides must use the player's NFL team colours from `nfl-colors.ts`. In the audit, Scouting card headers are flat grey and the "You receive" side is lavender. Check `nfl-colors.ts` covers every NFL team abbreviation the workbook uses, and fall back to a neutral token, not a random colour.

## 4. Simulation status and the roster-limit warning

**What the owner saw:** a red banner, "Obi-Amon-Kenobi has an unresolved roster/position limit (1). Analysis is conditional until resolved.", and a chip reading "Hypothetical: Live".

**What it means (from the code):**

- The chip only appears when a hypothetical roster is active. "Live" is the *name of a saved simulation*, not the live roster. A simulation named "Live" is easily mistaken for the real roster.
- The banner comes from `src/domain/roster-scenarios.ts` around line 740. After applying a simulation, every team it touches is checked with `rosterExcess` (`src/domain/lineups.ts:187`): active players (everyone not in a valid IR slot) over the roster capacity (starters + FLEX + bench), plus any count over a position limit. "(1)" means that team has one player too many. The most likely cause is a forced trade in that simulation where Obi-Amon-Kenobi received more players than they sent; a player held in IR who is no longer IR-eligible would cause the same.
- The message gives no rule, no player and no action, and it sits in the old toolbar on every screen.

**Fix:**

- [x] **4.1 Explain the problem in the domain.** Replace the string with a structured issue: team, rule ("roster over capacity" or "too many RBs"), the count over, the players involved (for capacity: the active players beyond the limit, lowest value first; for IR: the IR-slot player who is no longer IR-eligible), and the suggested repair from the existing `makeLegal` drop logic. Unit tests for capacity, position limit and IR cases.
- [x] **4.2 Say it plainly.** Example: "In your simulation ‘Live’, Obi-Amon-Kenobi has 17 active players but room for 16. Suggested drop: Player X (lowest-value bench player). Analysis that involves this team is conditional until it's fixed." With buttons: **Apply suggested drop** (adds the drop to the simulation), **Open simulation** (Roster), **Switch to live roster**.
- [x] **4.3 Put it in one place.** Remove the old toolbar. The shell's simulation chip turns amber when the active simulation has issues and opens a small popover with the explanation above. Screens that use the affected team show a one-line note linked to it, not a red banner.
- [x] **4.4 Make "live" unmistakable.** The chip reads "Simulation: Live" (never "Hypothetical: Live"), and creating a simulation whose name is "Live" or "Live roster" is refused with a prompt to choose another name.

## 5. Trade room (largest section)

The new Manual analyzer exists, but Find trades and Chain planner render the entire old trade screen beneath the new header, so the owner sees two sets of tabs, the old pools and lineup field, and white panels.

- [x] **5.1 Remove `TradeView` from the Trade room.** Keep the worker calls, query building, persistence (`tradeSearchSettings`, `savedTrades`, `managerExpectations`) and result types; rebuild every control and result in the new design. Nothing may render the old "Manual analyzer / Find trades / Chain planner" tab row, "Full trade analysis", "Detailed trade calculations" or "Browse saved trades" blocks.
- [ ] **5.2 Find trades, rebuilt.** *(Unticked 2026-11-12: still the old TradeSearch component; see `2026-11-12-find-trades-chain-planner-rebuild.md`.)* Folding groups with one-line summaries (Players & packages, Teams to search, Team needs, Search limits, Manager profiles & acceptance), positional grade goals with the plain-language sentence, protected players and packages 1–5, incoming filters, near misses, and results with photos, both sides' grade-step chips, lineup gain ± spread, surplus and Analyze. The audit shows a separate "Search limits" bar *and* the old controls; there must be one place for limits.
- [ ] **5.3 Chain planner, rebuilt.** *(Unticked 2026-11-12: still the old TradeChains component; see `2026-11-12-find-trades-chain-planner-rebuild.md`.)* Preset cards (the ten agreed), the single search method, per-trade settings, results with both steps, connected result, spread and, for Surface-stat trading, both sides' gains.
- [x] **5.4 Manual analyzer, completed.** Team-coloured sides with photos and a visible player picker (search as you type, team switch, up to five per side); grade-step chips under each side (impacted positions only); tale of the tape; the lineup field with photos and tags; the four verdict rows with "Lineup gain ± spread"; Force into a hypothetical roster; and, as disclosures under the relevant verdict, the detail that used to live in "Detailed trade calculations" (requirements and conditions, required changes and optional pickups, market reference, stress test, surface assessment).
- [x] **5.5 Saved trades and Journal** open from the Trade room header as new screens or popovers, rebuilt to tokens.
- [x] Browser specs: `gameday-trade-room.spec.ts`, `trade-stress.spec.ts`, `surface-appeal.spec.ts`, `positional-grade-search.spec.ts`, `negotiations.spec.ts`, plus the theme sweep for every Trade room tab. Run the Excel parity checks: trade totals, deal grades and package tests must not change.

## 6. Roster

- [x] **6.1 Rebuild the simulator** in the design: chips for Live roster and each saved simulation, New, Save slot, Delete; with a simulation active, a league player picker with photos, cut buttons on tiles, and the list of adds and cuts with undo. Unsaved simulations are marked.
- [x] **6.2 Rebuild the marked-starters editor** in tokens (it is required and was never drawn: present it as a "Your app lineup" section with the same rules, warnings and Save/Reset), and drop the old roster table: the depth chart is the roster view.
- [x] **6.3 Depth chart.** Every position shown, including empty positions with a quiet "No players" line. Tiles show photo, role, EPPG and the weekly strip. In the audit only RB appears and the weekly strip is a row of identical pink blocks; the strip should shade by points with byes marked, as designed.

## 7. League

- [x] **7.1 Grade grid as designed:** square tiles with the muted grade colours and letters, team names readable (the audit shows them tiny and underlined), clicking a tile opens the position popover with photos and card links. "N/A" tiles stay neutral with the reason on hover.
- [x] **7.2 Replace `TeamView`.** The grade cards, grade table and full roster table below the grid duplicate the grid and use the old look. Move position advice into the grade popover, and give each team a "Full roster" popover built from the Scouting row component.
- [x] **7.3 Power ranges** as designed: floor-to-ceiling bars with the expected mark, not a plain table.

## 8. This week, Scouting and Lab

- [x] **8.1 This week.** Sentences must handle edge cases in the domain: "WR sits 100% below it" appears when the team has no WR starter and should read "You have no usable WR starter". The outlook chart must draw the league median line and weekly values (the audit shows a flat line and a dashed baseline only). Show three move cards when three moves exist.
- [x] **8.2 Scouting.** Team-coloured card headers (3.3), photos (3.2), the floor-to-ceiling bar labelled, and "Prospective gem tracking" rebuilt in tokens.
- [x] **8.3 Lab.** Rebuild `ModelView` and `Account` content into the Lab tabs in tokens. Model settings: purple editable controls grouped under headings (Forecast, Consistency, Gem rules, Grades, Trades) with readable labels; today they are thirty unlabelled-looking boxes in one grid with labels such as "Gem W R Share".

## 9. Phones, tablets and light theme

- [x] **9.1** Re-run the responsive specs at 390×844 and 820×1180 after Sections 5–8, in both themes, and screenshot each screen. Confirm the bottom bar, sheets and full-height player card from brief section 11a.
- [x] **9.2** Screenshot every screen in the light theme and run the theme sweep. The owner reports the light/dark switch appears not to work; part of that is the legacy panels (white in both themes) and the missing one-tap switch (1.3). Confirm the switch changes every screen.

## 10. Cleanup and release

- [x] **10.1** Delete the legacy components that no longer render, and stop importing `styles.css`. `views.tsx` should be gone or reduced to nothing the shell imports.
- [x] **10.2** The theme sweep (1.4) passes on every route, tab and popover, in both themes, with no expected failures left.
- [x] **10.3** Update `docs/verification.md` with a dated entry listing each section, the specs run and the screenshots reviewed, and the parity checklist rows re-verified.
- [x] **10.4** Release as the next minor (npm patch) version.

---

## Acceptance for the whole plan

- No old interface is visible anywhere: no second tab row, no white panels in dark, no invisible headings, no old legend or toolbar.
- Every player shown has a photo or a fallback with initials on the team colour.
- With Sound on, actions make the four tones; with Haptics on and supported, they vibrate; with Animation Full, screens, popovers, charts and verdicts animate; Reduced and Off behave as specified.
- The light/dark switch is one tap from the header and changes every screen.
- The roster-limit warning names the team, the rule, the players and a fix, and "Live" is never used as a simulation name.
- `npm run check`, `npm run build`, all browser specs and the Excel parity checks pass, and the owner has reviewed the screenshots from each section.
