# Gameday Plus parity checklist

Task 0.2 of `docs/superpowers/plans/2026-11-10-gameday-plus-redesign.md`. This is the acceptance list for Phase 10: every existing user-facing function needs a home in the new interface, and each row is verified there before cutover.

Walked from `src/app/App.tsx`, `src/features/*.tsx`, `docs/feature-parity.md` and the brief, at app version 0.8.19. Status values (Phase 10 walk, November 10 2026: **Verified in preview** means the function was checked in the new interface by a browser test or a unit test; **Remove at cutover** is the preview switch itself): **Planned** (has a home in the brief or plan), **Needs decision** (no home yet; raise with the owner before Phase 1 ends), **Verified** (checked in the new interface; filled in during Phase 10).

| # | Existing function | Current location | New home | Plan task | Status |
| --- | --- | --- | --- | --- | --- |
| **Shell and app behavior** | | | | | |
| 1 | Hash navigation with nine sidebar items; mobile nav toggle | App.tsx `nav` | Six-section bar; phone bottom bar; old hash routes mapped | 1.3, 8.3 | Verified in preview |
| 2 | Workbook import, import preview (counts, issues, imported settings), "Replace dataset" and "Replace and use workbook settings" | App.tsx | Shell import action and preview; phone header menu | 1.3 | Verified in preview |
| 3 | Sync status, Sync now, sync conflict panel (use cloud / keep this device / decide later) | App.tsx, Account | Shell status and conflict panel; Lab, Data and account | 1.3, 7.1 | Verified in preview |
| 4 | Update-ready notice, error notices, calculating notice, import busy and cancel | App.tsx | Shell | 1.3 | Verified in preview |
| 5 | Saved data timestamp with stale (over 24 h) warning | App.tsx page heading | Shell freshness text (amber when stale) | 1.3 | Verified in preview |
| 6 | Hypothetical roster chip, "Not saved" indicator, simulation issue alerts | App.tsx | Shell chip; Roster | 1.3, 4.1 | Verified in preview |
| 7 | Role forecast scenario percentage notice; evidence issue notice | App.tsx | Shell or Lab | 1.3, 7.1 | Verified in preview |
| 8 | Welcome and first-import state | `Welcome` | This week empty state | 5.2 | Verified in preview |
| 9 | Legend of provenance colours; footer with app version and build | App.tsx `Legend`, footer | Shell footer; Lab | 1.3, 7.1 | Verified in preview |
| 10 | Gameday Plus preview switch (new in 0.9.0) | Data and account | Removed at cutover | 0.3, 10.2 | Remove at cutover |
| **My team (overview)** | | | | | |
| 11 | Team name, position health, "Where to focus" | `Overview` | This week headline, outlook, scoreboard | 5.1, 5.2 | Verified in preview |
| 12 | "Signals on your roster" (gem, buy low, sell high, trends) | `Overview` | This week signals ticker; Roster tile badges | 5.2, 4.1 | Verified in preview |
| 13 | Roster all-fields evaluation table | `TeamView`, `ui/components.tsx` | Reachable from the League team name; Roster | 4.2 | Verified in preview |
| 14 | Hypothetical roster simulator: live and saved slots 1 to 10, create, save, delete, add player, cut, undo | `RosterSimulator` | Roster, top | 4.1 | Verified in preview |
| 15 | Marked starters editor with warnings, save and reset | `StarterLineupEditor` | Roster (not drawn on the canvas) | 4.1 | Verified in preview |
| **League teams** | | | | | |
| 16 | Team dropdown and full roster table | `TeamView` | League: reachable from the team name | 4.2 | Verified in preview |
| 17 | Position grades, league median, roster advice, depth | `TeamView` | League grade grid and popovers | 4.2 | Verified in preview |
| **Players, gems, weekly** | | | | | |
| 18 | Player search and league player pool with ownership, position and injury filters and sorts | `PlayerList` | Scouting | 3.1 to 3.4 | Verified in preview |
| 19 | Gem screener filters (signals, thresholds, include injured, selected team, sorting), saved filter state, legacy `gemSignal` migration | `GemView`, `gem-screening.ts` | Scouting filter panel and saved searches | 3.1 to 3.3 | Verified in preview |
| 20 | "N more players match but are hidden by the selected signals" notice | `GemView` | Scouting results header | 3.3 | Verified in preview |
| 21 | Prospective Gem tracking | `GemTracking` | Scouting | 3.5 | Verified in preview |
| 22 | Player comparison (three names) | `PlayerList` "Player comparison" | Versus (two players) | 3.5 | Needs decision |
| 23 | Weekly K and D/ST view with opponent, bye, actual and projection | `Weekly` | Scouting saved search "Weekly streamers" | 3.1 | Verified in preview |
| 24 | ESPN weekly and season projections, ADP comparisons | `PlayerList` | Scouting table columns | 3.4 | Verified in preview |
| **Player detail** | | | | | |
| 25 | Performance momentum and moving-average chart | `PlayerDetail`, `PlayerStockChart` | Card Story tab | 2.2 | Verified in preview |
| 26 | Next-refresh EPPG scenarios | `NextRefreshScenarios` | Card Story tab, top | 2.2 | Verified in preview |
| 27 | "Why this value?" calculation steps | `PlayerDetail` | Card Calculation tab | 2.1, 2.2 | Verified in preview |
| 28 | Gem and regression evidence; role and opportunity | `PlayerDetail` | Card Numbers and Why tabs | 2.1, 2.2 | Verified in preview |
| 29 | Label Why panel | `LabelWhy` | Card "Why the labels" tab, unchanged layout | 2.2 | Verified in preview |
| 30 | Current market reference | `PlayerDetail` | Card Numbers tab | 2.1 | Verified in preview |
| 31 | "Player unavailable" state | `PlayerDetail` | Card empty state | 2.1 | Verified in preview |
| 32 | Player popover (1040px) | `PlayerPopover` | The single player card | 2.2, 2.3 | Verified in preview |
| 33 | `#/player/:id` route | App.tsx | Opens the card over This week | 2.4 | Verified in preview |
| **Trade analyzer** | | | | | |
| 34 | Manual analyzer: up to five players per side, searchable selectors, optional IDs | `TradeView` | Trade room, Manual | 6.4 | Verified in preview |
| 35 | Surplus exchange, deal grade and advantage bar | `TradeView` | Verdict row 1 | 6.4 | Verified in preview |
| 36 | Expected team gain per week, direct starter weekly table | `TradeView` | Verdict row 2 (lineup gain ± spread) | 6.3, 6.4 | Verified in preview |
| 37 | Optimized future lineups and coverage | `TradeView` | Disclosure under lineup impact | 6.4 | Verified in preview |
| 38 | Requirements and conditions | `TradeView` | Disclosure under a verdict | 6.4 | Verified in preview |
| 39 | Required changes and optional pickups | `TradeView` | Disclosure under legality | 6.4 | Verified in preview |
| 40 | Market reference | `TradeView` | Disclosure | 6.4 | Verified in preview |
| 41 | Stress test | `TradeStressTest` | Disclosure | 6.4 | Verified in preview |
| 42 | Surface assessment | `SurfaceAppeal` | Disclosure | 6.4 | Verified in preview |
| 43 | Lineup basis switch (best available or marked starters) | `trade-impact.ts` | Trade room and Roster | 6.4 | Verified in preview |
| 44 | Force trade into a hypothetical roster; restore scenario | `forceTrade`, `restoreScenario` | "Force this trade" button | 6.4 | Verified in preview |
| 45 | Find matching trades: packages 1 to 5, protected players, targets, team needs, incoming filters, near-miss diagnostics | `TradeSearch` | Find trades | 6.5 | Verified in preview |
| 46 | Positional grade goals including opponent overall step matching | `PositionalGradeImpactControls` | Find trades goals | 6.5 | Verified in preview |
| 47 | Deficit protection controls | `DeficitProtectionControls` | Find trades | 6.5 | Verified in preview |
| 48 | Manager profiles and acceptance estimates | `Negotiations`, `manager-expectations.ts` | Find trades group; Journal | 6.5, 6.8 | Verified in preview |
| 49 | Strictness control, strict index range | `TradeSearchControls` | Replaced by the single search method | 6.6 | Verified in preview |
| 50 | Automatic broadening of empty searches | `chainSearchRounds` | Widening with tags | 6.6 | Verified in preview |
| 51 | Chain planner, eight presets, per-trade controls, custom presets | `TradeChains` | Chain planner, ten presets | 6.7 | Verified in preview |
| 52 | Surface trading toggle | `TradeChains`, `TradeSearch` | Surface-stat trading preset | 6.7 | Verified in preview |
| 53 | Saved trades | `SavedTrades` | Trade room header | 6.8 | Verified in preview |
| 54 | Trade journal, imported historical evidence, prospective acceptance tracking | `Negotiations` | Trade room, Journal | 6.8 | Verified in preview |
| **Model and audit, data and account** | | | | | |
| 55 | Model settings (weights, pools, premium, grade bands, gem thresholds) | `ModelView` | Lab, Settings | 7.1 | Verified in preview |
| 56 | Player-label evidence | `ModelView` | Lab, Audits | 7.1 | Verified in preview |
| 57 | Evidence sources: opportunity and market data | `EvidenceSettings` | Lab, Evidence sources | 7.1 | Verified in preview |
| 58 | Injury return scenarios; role forecast calibration | `EvidenceSettings` | Lab | 7.1 | Verified in preview |
| 59 | Replacement baseline audit; source data audit | `ModelView` | Lab, Audits | 7.1 | Verified in preview |
| 60 | App version and build | App.tsx | Lab | 7.1 | Verified in preview |
| 61 | Import and replace, remove from this device, delete cloud workspace | `Account` | Lab, Data and account | 7.1 | Verified in preview |
| 62 | Supabase configuration, sign in, sign up, sign out | `Account` | Lab, Data and account | 7.1 | Verified in preview |

## Phase 10 walk: findings

Walked every row against the new interface. Gaps found and closed before cutover, each with a browser test in `tests/browser/gameday-parity.spec.ts`:

- Row 6: the "Not saved" link now points at Roster, not My team.
- Row 12: roster tiles show label badges (up to three) beside the injury chip.
- Rows 23 and 24: the Scouting table has the Bye week and Actual PPG columns and an "All evaluation fields" switch that adds every field, including Draft ADP and its edge.
- Rows 28 and 30: the player card's Numbers tab keeps the four detailed disclosures (all evaluation stats, workload and advanced evidence with the market reference, completed-game scores, all imported fields).
- Row 35: the deal-grade advantage bar is in the surplus verdict.
- Rows 36 and 37: the weekly lineup gain table and the optimized future lineups and coverage disclosure are in the Manual analyzer.
- Row 42: the surface assessment was never part of the manual analyzer; it lives in Find trades results and each chain step's "surface evidence", both kept.
- Rows 7, 30, 47 and 52 were decided as suggested: notices stay on every screen; the market reference is in the card; deficit protection stays in Find trades "Team needs"; surface trading stays in the Find trades Value and acceptance group and as the Surface-stat trading preset.

## Still open

- **Row 22:** the old Players page compared up to three players by name. Versus compares two. Suggested default: keep two, because the design's start-or-sit odds and mirrored bars are defined for a pair. This is the owner's call.
