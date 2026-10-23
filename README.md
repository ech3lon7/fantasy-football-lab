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

## Trade-search filters and saved trades

**Search approach** adds optional discovery controls. Enable **Find outgoing combinations**, select up to 12 tradable players (everyone else is protected from offers and automatic drops), and set an inclusive 1–5 player outgoing range. The worker evaluates every eligible subset using the existing analyzer; larger pools/counts take longer and remain cancellable. Choose **Required incoming player** to target one rostered player, or use the existing incoming-position filters for a positional goal. **Rank trades by → Benefit to both teams** puts legal packages with positive weekly gains on both sides first, then ranks by the smaller gain. The default remains your weekly gain. Expand **Trade details → Why the other team might accept** for original positional grades, modeled starter/depth changes, weekly impact, value context and cautions; this is evidence, not an acceptance probability. **Show near misses and adjustments** separately lists up to five evaluated alternatives, searching incoming counts one below/above the requested count and five additional index points outside each bound. Every failed limit is explicit, and protected-player, ownership, target and legality requirements are never relaxed. Loading/saving a flexible result uses its actual outgoing package and preserves the search settings. No original workbook, valuation formula or sync table changes are required.

In **Trade analyzer → Find matching trades**, select incoming **Gem** and/or **Watch** and any positions, then set the minimum matching players for each enabled category. Selecting both signals matches either label; positions also match any selected position. When both categories are enabled, the same incoming players must satisfy both. Empty categories impose no restriction. Existing index, positional-upgrade, deficit and weekly-gain filters still apply, and result ranking is unchanged.

Trade-search controls are grouped into **Value range**, **Incoming players**, **Roster fit** and **Scoring impact**. Hover an existing filter label or selection for 700 ms to see help, with no icon or special cursor. Focusing, typing or tapping does not open help; editing dismisses it and cancels pending hover help. Escape or an outside click closes help; instructions stay inside the tooltip, while errors and important data warnings remain visible. Removable chips show active criteria; removing one invalidates old search results and never changes other filters. Player and Gem screens use the same help treatment. Trade results show a compact usefulness count, expandable comparison evidence and **Why trades were excluded** counts.

Example: set **Filter their weekly gain → minimum 2**, leaving maximum blank, to require at least +2 modeled starting-lineup points per remaining week. Also enable **Every offered player must be useful to the other team** when every offered player must earn a distinct modeled starter or best-backup role. These tests remain independent: net weekly gain follows marked/imported starters, while usefulness checks modeled roster roles. All help examples are illustrative; forecasts and filtering calculations are unchanged.

**Every offered player must be useful to the other team** compares offers with the recipient's roster **before the trade**, including departing players and proposed drops. Trading away a player cannot create a zero-point comparison vacancy; only roles already vacant before the trade use zero. Every offer must improve a distinct modeled Expected PPG starter or best positional backup role and still earn that role in the legal roster after departures and required drops, before waiver fills. Surviving starters cannot be reused as replacement comparisons. The default minimum is +1.0 Expected PPG per offered player, adjustable; a zero minimum still requires positive improvement. Incoming reserves must also beat the strongest other reserve after all arrivals, including displaced starters. Each player and baseline role counts once. Missing competing forecasts, offered players dropped or placed in IR, and unresolved recipient roster capacity cannot qualify. This season-level fit uses modeled roles independently of marked starters and this week's byes. Trade details show comparison players, PPG differences, the applied minimum and reserve competition; value tests, direct weekly gains and legality remain separate. Disabling the filter preserves existing search behavior; saved trades retain its setting.

Choose **Save trade** on a completed search result or **Save current trade** in the analyzer. Expand the **Saved trades** entry to edit its name/notes, compare the original and current results, load its teams/players/search settings, or delete it. Duplicate packages update the existing entry while keeping the original summary, name and notes. Current results recalculate from imported data and settings; ownership-invalid trades are removed automatically. Other-season records retain their original summaries without applying current-season ownership rules.

Saved trades use the existing local/account state and **Sync now** workflow; no workbooks or extra database tables are stored. The shared state-size limit includes saved trades, notes and existing settings. An explicit storage-full message asks you to shorten notes or remove records if another save would exceed it. Saving/loading never sends an ESPN trade.

## Player-tag explanations

Click a player's name to open the popover, or open the full player profile. Each active analytical tag has a separate collapsed **Why [tag]?** section: Gem, Watch, Scoring breakout watch, Role-growth watch, Projection-gap watch, Reduced workload, BUY LOW, SELL HIGH and TD caution. Expand it for the meaning, exact requirements, the player's supporting numbers, the comparison window, source timestamp, interpretation and limitations. Inactive signals, neutral/no-signal states, injury/data-status labels and trend arrows do not create explanation sections.

Watch shows its own workload qualification routes, including the early-sample branch; Gem retains its existing scoring/workload evidence. BUY LOW/SELL HIGH show the positional touchdown-rate and volume comparisons, not market prices. TD caution repeats SELL HIGH evidence without a second penalty. Explanations never assign a label, change a forecast/value, or automatically recommend a transaction. Displayed numbers are rounded; the existing engine compares unrounded values.

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

The footer shows the installed app version and build number; **Model & audit → App version** adds the source commit and build time. The release version comes from `package.json` (currently 0.3.3); each GitHub deployment automatically stamps its workflow build number and commit. Local builds are labeled `Build local`. App versions are independent of workbook and model versions. Versions follow **major.moderate.minor**: first number for major app changes, second for moderate changes, third for minor changes. Player popovers were the minor 0.2.1 change; the stricter Gem classification is the moderate 0.3.0 change. Use `npm version patch --no-git-tag-version` for minor changes, `npm version minor --no-git-tag-version` for moderate changes, or `npm version major --no-git-tag-version` for major changes.

GitHub Actions verifies the source, builds the static application, runs browser smoke tests and deploys GitHub Pages from `main`. Repository base path is `/fantasy-football-lab/`. The offline shell caches only application assets; datasets use account-scoped IndexedDB. Dataset updates require importing refreshed Excel; the app does not directly query ESPN or execute trades.

In **Settings → Pages → Build and deployment**, set **Source → GitHub Actions**. Do not also publish from a branch: the automatic Jekyll publisher can overwrite `dist` with unbuilt source HTML, producing “App couldn't finish loading” in every browser. After correcting the source, run **Actions → Verify and deploy → Run workflow → main**. The workflow checks the Pages source before building and verifies the public compiled entry, stylesheet assets and source commit after deployment. It fails visibly if the published files are wrong; browser cache clearing cannot fix an unbuilt publication.

See [architecture](docs/architecture.md), [implementation plan](docs/implementation-plan.md), [model contract](docs/model-contract.md) and [verification report](docs/verification.md).

## Automatic Gem classification

**Gem** means strong actual scoring backed by sustained workload. Both the latest three played games and the previous overlapping three-game window must pass. Mean actual PPG must reach 16 for RB/WR or 11 for TE, with at least two games individually at that point floor. Mean workload must reach RB18 carries+targets /WR7 targets /TE6 targets, with at least two games individually reaching the workload floor RB14 /WR5 /TE5. Four verified played games are the minimum: compare A/B/C and B/C/D. Stable strong production can qualify; growth and a prior Watch label are not required. Existing history, availability and remaining-game safeguards remain. No manual review, approval, news entry or supplemental CSV is required.

**Watch** keeps its existing workload-only opportunity tests and earlier-game growth comparison. **Reduced workload**, scoring trends, projection gaps and touchdown cautions remain separate supporting signals. Refreshing the imported data automatically recalculates every player's Gem status; scoring forecasts and trade values receive no label bonus. The thresholds have offline historical screening evidence but remain provisional, not calibrated individual success probabilities or proof that a player is undervalued. TE evidence is weaker.

Open **Gem screener** and use **Breakout classification → Gem only / Gem + Watch / All classifications** alongside the existing combined filters. Classification happens for every player on data load, independently of screen filters. Prior saved filter labels migrate automatically while numeric thresholds are preserved. Click a player and expand **Why Gem? / Why Watch?** to see each observed workload, requirement and result.

Stale snapshots and injured same-team competition produce automatic warnings without a manual-confirmation veto. Labels describe the imported data, not verified permanent roles or guaranteed breakouts. Refreshing the workbook and importing it remains the source-update workflow; the app does not fetch ESPN or news automatically. Existing scoring/role watches, BUY LOW/SELL HIGH, valuations and trade calculations remain separate. Thresholds are provisional, not historically validated probabilities.

**Reduced workload** is an independent automatic signal. Compare the last three played games with the immediately preceding 2–3: average workload must fall at least 20% AND 3 carries+targets/game for RBs or 2 targets/game for WR/TE. At least two recent games must each fall below the earlier average by that positional minimum. Five verified games and complete workload data are required. Select Reduced workload in the screener's Signals controls; details and popovers explain the evidence. Gem/Watch labels and scoring/trade values stay unchanged. Injury-shortened games remain included, so the signal does not establish a permanent role loss.

## Update recovery (0.3.1)

Online navigation checks the current deployment; offline navigation uses a complete cached build. Activating an update keeps previous app assets so existing tabs can finish loading their version. Asset caches are scoped to the app path; private datasets remain in IndexedDB.

The update banner compares the running compiled entry with freshly fetched deployment HTML, rather than assuming a waiting offline worker means the app is outdated. If the page already runs the published entry, its waiting worker activates silently and the notice clears. Unverifiable/offline checks do not announce a new release; connectivity restoration retries the check. This does not clear datasets, settings or sign-in storage.

If loading fails, **Reload latest app** checks that the current HTML and entry script are available, then replaces only this app's service-worker registration and reloads with a one-time fresh URL. It does not clear IndexedDB, localStorage, cookies, sign-in, or other applications' registrations. A failed connection leaves saved data in place and permits retry. The normal update button uses the same path after pending local saves finish. Older deployed versions without this recovery screen may need one hard refresh to obtain this fix.

## Manage starters and direct trade impact (0.3.2)

In **My team → Manage starters**, mark each player Starter or Bench, then **Save lineup**. Initial choices come from the imported ESPN lineup. Position/FLEX limits are enforced; IR players require a corrected ESPN roster and reimport first. Partial lineups are permitted and show unfilled slots. **Reset to imported lineup** removes only this team's overrides. Selections use existing private local/account settings sync and never change ESPN. Saved choices are retained on refresh when still valid; roster, season, team and week changes require review.

Trade headline and weekly scores now use **direct starter impact**, anchored to the imported or saved starter group. Removing a bench player alone costs zero direct starting points, including hypothetical future bye cover. Byes and known availability still apply to the marked starter group through the existing final week; an average per week is not a matchup projection. Incoming players are modeled as starters when they improve the current starting score or replace a departing starter. If a marked starter leaves, a named eligible reserve replacement may be promoted. All before/after starters are inspectable. These new incoming/replacement choices use Expected PPG for scoring selection, with Value PPG reported for those same players.

**Modeled future coverage impact (includes bench)** retains the previous all-roster, Value PPG-selected scenario separately. Existing backup depth, waiver proposals, surplus/points tests, deal grade, replacement baselines and player valuations are unchanged. A zero direct scoring change can still be a bad exchange of player value. Saved plans or starter data that are invalid produce unavailable direct scores until reviewed, not fabricated zero-point losses.
