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

Choose signals (OR), or clear them for **Any signal**; enter numeric thresholds (AND), then choose **Apply filters**. For example: Gem or Watch, trend ≥+2 PPG, surplus index 10–40, recent PPG ≥12. **Rising targets** applies that editable example and includes owned players as well as free agents. **Available** searches free agents; choose **All** to include rostered players.

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

## Opportunity evidence

Click player names to inspect stats without leaving your current screen. Details open beside the name on desktop and in a bottom sheet on mobile. Key scoring/value metrics appear first; expand the evaluation, workload, history or imported-field sections for more. In Trades, select a player and click the name shown beneath their selector. Escape, Close or an outside click dismisses the panel; **Open full player page** still navigates to the full profile. Ctrl/Cmd-click on a player link retains normal browser behavior.

Use **Gem screener** to combine the new **Role-growth watch** and **Scoring breakout watch** signals with existing labels. Advanced filters include recent carries, recent targets, role increase per game and sourced route participation. Player details and roster tables show independent signals together.

In **Model & audit**, inspect exploratory role-model errors, optionally apply a clearly labeled forecast scenario, import source-dated player-week/market CSV evidence, or select an injury return-week scenario. The original forecast remains the default. Advanced xFP, WOPR, routes and market references remain unavailable until valid source data is supplied; CSV columns and units are described in the app. Supplemental evidence is replaced as one current set and follows the existing account sync.

## Hosting

The footer shows the installed app version and build number; **Model & audit → App version** adds the source commit and build time. The release version comes from `package.json` (currently 0.3.1); each GitHub deployment automatically stamps its workflow build number and commit. Local builds are labeled `Build local`. App versions are independent of workbook and model versions. Versions follow **major.moderate.minor**: first number for major app changes, second for moderate changes, third for minor changes. Player popovers were the minor 0.2.1 change; the stricter Gem classification is the moderate 0.3.0 change. Use `npm version patch --no-git-tag-version` for minor changes, `npm version minor --no-git-tag-version` for moderate changes, or `npm version major --no-git-tag-version` for major changes.

GitHub Actions verifies the source, builds the static application, runs browser smoke tests and deploys GitHub Pages from `main`. Repository base path is `/fantasy-football-lab/`. The offline shell caches only application assets; datasets use account-scoped IndexedDB. Dataset updates require importing refreshed Excel; the app does not directly query ESPN or execute trades.

See [architecture](docs/architecture.md), [implementation plan](docs/implementation-plan.md), [model contract](docs/model-contract.md) and [verification report](docs/verification.md).

## Evidence-backed Gems (0.3.0)

**Gem** now means sustained developing workload plus current sourced support for an ongoing role. RB: last-three mean ≥18 carries+targets and every game ≥14; WR: mean ≥7 targets and every game ≥5; TE: mean ≥6 and every game ≥5. Growth versus the immediately preceding 2–3 played games must reach +3 for RB or +2 for WR/TE AND +25% (absolute gate only if prior work is zero). At least five played games are required. **Watch** is promising but unresolved; low projections and high scoring alone cannot qualify. No current sourced context means Watch, even if workload passes.

1. Open **Gem screener**, choose **Breakout classification → Gem only / Gem + Watch / All classifications**, then Apply. Clearing signals still permits numeric-only searches. Older label selections require review and Apply; thresholds are kept.
2. Click a player and expand **Why Gem? / Why Watch?** for every requirement, observed window, failure and source. The same table appears on the full profile. BUY LOW/SELL HIGH and scoring/role watches stay separate.
3. In **Model & audit → Gem rules and role reviews**, select a player and supply outlook, named source/URL, source UTC timestamp, last played week reviewed and rationale. Or import the documented role-review CSV. Current reviews expire after seven days by default and must be renewed for each imported snapshot. Stale snapshots also cap classification at Watch. Sources are user-provided assertions, not an automatic verified news feed.
4. **Adjust provisional Gem thresholds** exposes the small rule configuration. No new probability or GemScore is calculated. Valuations, scoring Trend PPG and trade calculations are unchanged.

## Update recovery (0.3.1)

Online navigation checks the current deployment; offline navigation uses a complete cached build. Activating an update keeps previous app assets so existing tabs can finish loading their version. Asset caches are scoped to the app path; private datasets remain in IndexedDB.

If loading fails, **Reload latest app** checks that the current HTML and entry script are available, then replaces only this app's service-worker registration and reloads with a one-time fresh URL. It does not clear IndexedDB, localStorage, cookies, sign-in, or other applications' registrations. A failed connection leaves saved data in place and permits retry. The normal update button uses the same path after pending local saves finish. Older deployed versions without this recovery screen may need one hard refresh to obtain this fix.
