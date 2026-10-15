# Fantasy Football Lab

A personal fantasy football workspace with roster analysis, player comparisons, trades, gem screening, trends and weekly K/D/ST views. Imports the supported adaptive V5.2 Excel workbook locally and stores one current extracted dataset. Original workbooks are never uploaded or archived.

## Use the app

1. Refresh All in Excel, wait for refresh to finish, recalculate and save your V5.2 workbook.
2. Open the app and choose **Import workbook**.
3. Review the snapshot, validation results and settings, then replace the current dataset.
4. **My team** opens to Los Chilones when present. **League teams** lets you inspect any team.
5. Use **Players**, **Gem screener** and **Weekly streamers** to explore options.
6. Build trades in **Trade analyzer**. Read the surplus grade, then check both lineups, requirements, legality, depth and conditions separately.

Actual PPG is recorded scoring; ESPN PPG is the season projection; Expected PPG is the adaptive forecast; Value PPG subtracts the consistency adjustment. Surplus index measures normalized remaining-season value above available replacements, not a market price. Scoring gain per week is a modeled average across all remaining fantasy scoring periods.

Green text identifies recorded facts, blue ESPN projections, pink model outputs and purple editable controls. The deal grade and bar separately use green/orange/red for favorability. All valuation and screening assumptions remain provisional without historical validation.

## Gem Screener filters

Choose signals (OR), or clear them for **Any signal**; enter numeric thresholds (AND), then choose **Apply filters**. For example: Gem candidate or Opportunity watch, trend ≥+2 PPG, surplus index 10–40, recent PPG ≥12. **Rising targets** applies that editable example and includes owned players as well as free agents. **Available** searches free agents; choose **All** to include rostered players.

Trend compares the latest three played games with earlier games. Index bounds are inclusive and describe model surplus, not a market price. Blank thresholds are inactive; zero is a real value. **Advanced filters** adds games played, projection gap, above replacement, and a separate incomplete-evidence view. Matching evidence explains each result. **Reset screener** restores the original search defaults without changing model settings or other screens. Applied searches save locally and use the existing **Sync now** workflow for other devices; unapplied edits are not saved. These screening thresholds remain provisional.

## Development

```sh
npm ci
npm run dev
npm run check
npm run build
npm run test:browser
```

Node 24 is used by CI. TypeScript is pinned to the version supported by the lint toolchain. SheetJS CE comes from its official CDN rather than the outdated npm-registry distribution. The lockfile pins exact dependencies.

Local private verification:

```sh
npx tsx scripts/verify-excel.ts /absolute/path/to/workbook.xlsx
npx tsx scripts/verify-scenarios.ts
```

These harnesses require private reference JSON in the ignored `.private` directory. Private workbook data and reference files must never enter Git or deployment assets. Public tests use synthetic data.

## Supabase setup

Local import and analysis work without Supabase. To enable cross-device synchronization:

1. Use Trainwise’s existing Supabase project. Retain all Trainwise objects and use the separate fantasy objects supplied here. See [shared-project deployment](docs/shared-supabase.md).
2. Apply `supabase/migrations/001_workspace.sql` in that project’s SQL editor or controlled migration workflow.
3. Retain Trainwise’s authentication settings and site URL. Append the Fantasy Pages URL to allowed confirmation/reset redirects.
4. In **Data & account**, enter the project URL and **publishable** key. Never enter a secret/service-role key.
5. Sign in and choose **Sync now**. On first sync, explicitly choose whether to initialize/keep this device’s current dataset or use an existing cloud workspace.

The public project URL/key can alternatively be set using the variables in `.env.example`. Administrative credentials belong only in a secure migration environment.

GitHub Actions reads the public build settings from repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. These values are public browser configuration, not administrative credentials. Each app has its own session store; Fantasy signs out only its current session, preserving Trainwise sessions.

Cloud storage holds one row per user. Replacements use revisions and request IDs; stale devices show a conflict instead of silently replacing newer data. Managed database backup retention is separate from application import history.

## Hosting

GitHub Actions verifies the source, builds the static application, runs browser smoke tests and deploys GitHub Pages from `main`. Repository base path is `/fantasy-football-lab/`. The offline shell caches only application assets; datasets use account-scoped IndexedDB. Dataset updates require importing refreshed Excel; the app does not directly query ESPN or execute trades.

See [architecture](docs/architecture.md), [implementation plan](docs/implementation-plan.md), [model contract](docs/model-contract.md) and [verification report](docs/verification.md).
