# Feature mapping

| Workbook function | App owner | Screen | Verification |
| --- | --- | --- | --- |
| Six Model tables and context | import/workbook.ts | Data and account; Model and audit | Real XLSX import and source validation |
| Adaptive values, projection fallback, consistency | domain/valuation.ts | All player views | All-player native Excel comparison and synthetic boundaries |
| Replacement audit, VORP, linear index and rank | domain/valuation.ts | Model and audit; player detail | All-player native comparison; missing/thin pool tests |
| Buy-low/sell-high and xTD | domain/valuation.ts | Roster, player detail, all-fields table | Native metric comparison |
| Gems and trend arrows | domain/valuation.ts | Gems, rosters and overview | Native metric comparison and trend boundaries |
| Weekly K/DST view | features view | Weekly streamers | Browser navigation and source data |
| Weekly lineups, IR and roster rules | domain/lineups.ts | Teams and Trades | Nine team assessments and native trade cases |
| Position grades, median and advice | domain/lineups.ts | My team and League teams | All nine native team grade comparisons |
| Five players per trade side, IDs and ownership | domain/trades.ts | Trade analyzer | 25 size combinations and invalid selections |
| Grade/bar, package tests and shortfalls | domain/trades.ts | Trade analyzer | Native scenarios and exact grade boundaries |
| Drops, fills, conditional availability and depth | domain/lineups.ts; domain/trades.ts | Trade analyzer | Native scenarios, drop/fill IDs and downside gains |
| Model settings, grade bands and premium | domain/contracts.ts; workbook profile | Model and audit | Schema/range checks and recalculation |
| Team and trade selections | app workspace | Teams and Trades | Persistence and browser workflow |
| All important evaluation fields | ui/components.tsx | Roster all-fields table; Players | Source/model fields and browser rendering |
| Power Query refresh, credentials and bindings | Existing Excel workbook | Refresh remains in Excel | Explicitly outside browser execution |

Cloud configuration requires a selected Supabase project and applied migration. Database policies/RPCs are tested locally; hosted account and two-device tests are completed when a project is configured.
