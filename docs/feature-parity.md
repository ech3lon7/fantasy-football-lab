# Feature mapping

The October opportunity-evidence update intentionally extends the workbook's role and gem logic. Original Excel parity is checked in explicit workbook mode. Normal app analysis fixes the completed-game workload window and adds independent signals, role scenarios, sourced supplemental metrics and market references. See `model-contract.md` for the revised runtime behavior.

| Workbook function | App owner | Screen | Verification |
| --- | --- | --- | --- |
| Six Model tables and context | import/workbook.ts | Lab (Data and account, Settings, Audits) | Real XLSX import and source validation |
| Adaptive values, projection fallback, consistency | domain/valuation.ts | All player views | All-player native Excel comparison and synthetic boundaries |
| Replacement audit, VORP, linear index and rank | domain/valuation.ts | Lab (Audits); player card | All-player native comparison; missing/thin pool tests |
| Buy-low/sell-high and xTD | domain/valuation.ts | Roster, player card, all-fields table | Native metric comparison |
| Gems and trend arrows | domain/valuation.ts | Scouting, Roster and This week | Native metric comparison and trend boundaries |
| Weekly K/DST view | features/next/Scouting.tsx | Scouting (Weekly streamers) | Browser navigation and source data |
| Weekly lineups, IR and roster rules | domain/lineups.ts | League and Trade room | Nine team assessments and native trade cases |
| Position grades, median and advice | domain/lineups.ts | This week, Roster and League | All nine native team grade comparisons |
| Five players per trade side, IDs and ownership | domain/trades.ts | Trade room | 25 size combinations and invalid selections |
| Grade/bar, package tests and shortfalls | domain/trades.ts | Trade room | Native scenarios and exact grade boundaries |
| Drops, fills, conditional availability and depth | domain/lineups.ts; domain/trades.ts | Trade room | Native scenarios, drop/fill IDs and downside gains |
| Model settings, grade bands and premium | domain/contracts.ts; workbook profile | Lab (Settings) | Schema/range checks and recalculation |
| Team and trade selections | app workspace | League and Trade room | Persistence and browser workflow |
| All important evaluation fields | ui/components.tsx | Roster all-fields table; Scouting | Source/model fields and browser rendering |
| Power Query refresh, credentials and bindings | Existing Excel workbook | Refresh remains in Excel | Explicitly outside browser execution |

Cloud configuration requires a selected Supabase project and applied migration. Database policies/RPCs are tested locally; hosted account and two-device tests are completed when a project is configured.

The full row-by-row mapping from the earlier screens to the Gameday Plus screens is in `docs/superpowers/specs/gameday-plus-parity-checklist.md`.
