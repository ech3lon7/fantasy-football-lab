# Gameday Plus parity checklist

Task 0.2 of `docs/superpowers/plans/2026-11-10-gameday-plus-redesign.md`. This is the acceptance list for Phase 10: every existing user-facing function needs a home in the new interface, and each row is verified there before cutover.

Walked from `src/app/App.tsx`, `src/features/*.tsx`, `docs/feature-parity.md` and the brief, at app version 0.8.19. Status values: **Planned** (has a home in the brief or plan), **Needs decision** (no home yet; raise with the owner before Phase 1 ends), **Verified** (checked in the new interface; filled in during Phase 10).

| # | Existing function | Current location | New home | Plan task | Status |
| --- | --- | --- | --- | --- | --- |
| **Shell and app behavior** | | | | | |
| 1 | Hash navigation with nine sidebar items; mobile nav toggle | App.tsx `nav` | Six-section bar; phone bottom bar; old hash routes mapped | 1.3, 8.3 | Planned |
| 2 | Workbook import, import preview (counts, issues, imported settings), "Replace dataset" and "Replace and use workbook settings" | App.tsx | Shell import action and preview; phone header menu | 1.3 | Planned |
| 3 | Sync status, Sync now, sync conflict panel (use cloud / keep this device / decide later) | App.tsx, Account | Shell status and conflict panel; Lab, Data and account | 1.3, 7.1 | Planned |
| 4 | Update-ready notice, error notices, calculating notice, import busy and cancel | App.tsx | Shell | 1.3 | Planned |
| 5 | Saved data timestamp with stale (over 24 h) warning | App.tsx page heading | Shell freshness text (amber when stale) | 1.3 | Planned |
| 6 | Hypothetical roster chip, "Not saved" indicator, simulation issue alerts | App.tsx | Shell chip; Roster | 1.3, 4.1 | Planned |
| 7 | Role forecast scenario percentage notice; evidence issue notice | App.tsx | Shell or Lab | 1.3, 7.1 | Needs decision |
| 8 | Welcome and first-import state | `Welcome` | This week empty state | 5.2 | Planned |
| 9 | Legend of provenance colours; footer with app version and build | App.tsx `Legend`, footer | Shell footer; Lab | 1.3, 7.1 | Planned |
| 10 | Gameday Plus preview switch (new in 0.9.0) | Data and account | Removed at cutover | 0.3, 10.2 | Verified |
| **My team (overview)** | | | | | |
| 11 | Team name, position health, "Where to focus" | `Overview` | This week headline, outlook, scoreboard | 5.1, 5.2 | Planned |
| 12 | "Signals on your roster" (gem, buy low, sell high, trends) | `Overview` | This week signals ticker; Roster tile badges | 5.2, 4.1 | Planned |
| 13 | Roster all-fields evaluation table | `TeamView`, `ui/components.tsx` | Reachable from the League team name; Roster | 4.2 | Planned |
| 14 | Hypothetical roster simulator: live and saved slots 1 to 10, create, save, delete, add player, cut, undo | `RosterSimulator` | Roster, top | 4.1 | Planned |
| 15 | Marked starters editor with warnings, save and reset | `StarterLineupEditor` | Roster (not drawn on the canvas) | 4.1 | Planned |
| **League teams** | | | | | |
| 16 | Team dropdown and full roster table | `TeamView` | League: reachable from the team name | 4.2 | Planned |
| 17 | Position grades, league median, roster advice, depth | `TeamView` | League grade grid and popovers | 4.2 | Planned |
| **Players, gems, weekly** | | | | | |
| 18 | Player search and league player pool with ownership, position and injury filters and sorts | `PlayerList` | Scouting | 3.1 to 3.4 | Planned |
| 19 | Gem screener filters (signals, thresholds, include injured, selected team, sorting), saved filter state, legacy `gemSignal` migration | `GemView`, `gem-screening.ts` | Scouting filter panel and saved searches | 3.1 to 3.3 | Planned |
| 20 | "N more players match but are hidden by the selected signals" notice | `GemView` | Scouting results header | 3.3 | Planned |
| 21 | Prospective Gem tracking | `GemTracking` | Scouting | 3.5 | Planned |
| 22 | Player comparison (three names) | `PlayerList` "Player comparison" | Versus (two players) | 3.5 | Needs decision |
| 23 | Weekly K and D/ST view with opponent, bye, actual and projection | `Weekly` | Scouting saved search "Weekly streamers" | 3.1 | Planned |
| 24 | ESPN weekly and season projections, ADP comparisons | `PlayerList` | Scouting table columns | 3.4 | Planned |
| **Player detail** | | | | | |
| 25 | Performance momentum and moving-average chart | `PlayerDetail`, `PlayerStockChart` | Card Story tab | 2.2 | Planned |
| 26 | Next-refresh EPPG scenarios | `NextRefreshScenarios` | Card Story tab, top | 2.2 | Planned |
| 27 | "Why this value?" calculation steps | `PlayerDetail` | Card Calculation tab | 2.1, 2.2 | Planned |
| 28 | Gem and regression evidence; role and opportunity | `PlayerDetail` | Card Numbers and Why tabs | 2.1, 2.2 | Planned |
| 29 | Label Why panel | `LabelWhy` | Card "Why the labels" tab, unchanged layout | 2.2 | Planned |
| 30 | Current market reference | `PlayerDetail` | Card Numbers tab | 2.1 | Needs decision |
| 31 | "Player unavailable" state | `PlayerDetail` | Card empty state | 2.1 | Planned |
| 32 | Player popover (1040px) | `PlayerPopover` | The single player card | 2.2, 2.3 | Planned |
| 33 | `#/player/:id` route | App.tsx | Opens the card over This week | 2.4 | Planned |
| **Trade analyzer** | | | | | |
| 34 | Manual analyzer: up to five players per side, searchable selectors, optional IDs | `TradeView` | Trade room, Manual | 6.4 | Planned |
| 35 | Surplus exchange, deal grade and advantage bar | `TradeView` | Verdict row 1 | 6.4 | Planned |
| 36 | Expected team gain per week, direct starter weekly table | `TradeView` | Verdict row 2 (lineup gain ± spread) | 6.3, 6.4 | Planned |
| 37 | Optimized future lineups and coverage | `TradeView` | Disclosure under lineup impact | 6.4 | Planned |
| 38 | Requirements and conditions | `TradeView` | Disclosure under a verdict | 6.4 | Planned |
| 39 | Required changes and optional pickups | `TradeView` | Disclosure under legality | 6.4 | Planned |
| 40 | Market reference | `TradeView` | Disclosure | 6.4 | Planned |
| 41 | Stress test | `TradeStressTest` | Disclosure | 6.4 | Planned |
| 42 | Surface assessment | `SurfaceAppeal` | Disclosure | 6.4 | Planned |
| 43 | Lineup basis switch (best available or marked starters) | `trade-impact.ts` | Trade room and Roster | 6.4 | Planned |
| 44 | Force trade into a hypothetical roster; restore scenario | `forceTrade`, `restoreScenario` | "Force this trade" button | 6.4 | Planned |
| 45 | Find matching trades: packages 1 to 5, protected players, targets, team needs, incoming filters, near-miss diagnostics | `TradeSearch` | Find trades | 6.5 | Planned |
| 46 | Positional grade goals including opponent overall step matching | `PositionalGradeImpactControls` | Find trades goals | 6.5 | Planned |
| 47 | Deficit protection controls | `DeficitProtectionControls` | Find trades | 6.5 | Needs decision |
| 48 | Manager profiles and acceptance estimates | `Negotiations`, `manager-expectations.ts` | Find trades group; Journal | 6.5, 6.8 | Planned |
| 49 | Strictness control, strict index range | `TradeSearchControls` | Replaced by the single search method | 6.6 | Planned |
| 50 | Automatic broadening of empty searches | `chainSearchRounds` | Widening with tags | 6.6 | Planned |
| 51 | Chain planner, eight presets, per-trade controls, custom presets | `TradeChains` | Chain planner, ten presets | 6.7 | Planned |
| 52 | Surface trading toggle | `TradeChains`, `TradeSearch` | Surface-stat trading preset | 6.7 | Needs decision |
| 53 | Saved trades | `SavedTrades` | Trade room header | 6.8 | Planned |
| 54 | Trade journal, imported historical evidence, prospective acceptance tracking | `Negotiations` | Trade room, Journal | 6.8 | Planned |
| **Model and audit, data and account** | | | | | |
| 55 | Model settings (weights, pools, premium, grade bands, gem thresholds) | `ModelView` | Lab, Settings | 7.1 | Planned |
| 56 | Player-label evidence | `ModelView` | Lab, Audits | 7.1 | Planned |
| 57 | Evidence sources: opportunity and market data | `EvidenceSettings` | Lab, Evidence sources | 7.1 | Planned |
| 58 | Injury return scenarios; role forecast calibration | `EvidenceSettings` | Lab | 7.1 | Planned |
| 59 | Replacement baseline audit; source data audit | `ModelView` | Lab, Audits | 7.1 | Planned |
| 60 | App version and build | App.tsx | Lab | 7.1 | Planned |
| 61 | Import and replace, remove from this device, delete cloud workspace | `Account` | Lab, Data and account | 7.1 | Planned |
| 62 | Supabase configuration, sign in, sign up, sign out | `Account` | Lab, Data and account | 7.1 | Planned |

## Open decisions for the owner

Rows marked **Needs decision** have no home in the brief. Suggested defaults are below; none is applied without a yes.

- **7, 30, 47, 52 and 22:** keep role-scenario notice and market reference as card disclosures (Numbers tab); keep deficit protection inside Find trades "Team needs"; keep surface trading as the preset's own control; keep three-name comparison as a versus that accepts a third player.
