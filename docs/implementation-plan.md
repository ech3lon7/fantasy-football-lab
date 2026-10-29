# Fantasy Football GUI Implementation Plan

October 14, 2026 · Plan version 1.0 · Based on architecture specification 1.0

Implement the complete fantasy football application as a GitHub Pages frontend with local Excel imports, a TypeScript calculation engine, and Supabase synchronization. Open to Los Chilones, include every workbook function, and keep one current extracted dataset per account without storing uploaded workbooks.

The build proceeds through working increments. The first complete release includes the full agreed feature set; intermediate milestones are development checkpoints, not a reduced release scope. Calculation parity must pass before the interface presents trade advice as usable.

## 1. Execution order

| Phase | Outcome | Depends on | Completion gate |
| --- | --- | --- | --- |
| 0 | Workbook inventory and expected results | Architecture and V5.2 workbook | Every function, setting and output mapped; reference fixtures captured |
| 1 | Application foundation and contracts | Phase 0 inventory | Build, routes, schemas, worker protocols and basic checks run |
| 2 | Safe import and local workspace | Phase 1 | A valid import persists; invalid imports preserve existing data |
| 3 | Player valuation and signals | Phases 0–2 | All-player Excel parity and boundary cases pass |
| 4 | Legal lineups and team assessment | Phase 3 | Weekly assignments, totals, position grades and depth match Excel |
| 5 | Complete trade engine | Phase 4 | Package tests, grades, scenarios and transactions match Excel |
| 6 | Complete responsive interface | Phases 2–5 | All required screens and controls work with real imported data |
| 7 | Authentication and Supabase sync | Contracts from Phase 1; local behavior from Phase 2 | Isolation, revisions, conflicts and offline tests pass |
| 8 | Release verification and deployment | Phases 0–7 | End-to-end workflow passes on the actual hosted URL |

Prepare the Supabase migration and shared interface components after the contracts are stable; they need not wait for every calculation. Keep calculation implementations and screens connected through the domain API rather than copying formulas into UI components.

## 2. Phase 0 Establish the reference model

### Tasks

1. Use the delivered V5.2 workbook as the initial supported source. Keep it and earlier workbooks unchanged. Capture expected values from a saved native-Excel recalculation of a disposable copy, without refreshing the source snapshot during baseline capture.
2. Inventory the six Model tables, required columns, supported named settings, selections, named calculations and every visible output. Map each item to its canonical field, owning module, destination screen and verification fixture.
3. Inspect the current native formulas as the authority; use the existing verification scripts as supporting evidence. Trace dependencies for adaptive values, replacements, offensive ranks, ADP comparisons, regression alerts, gems, trends, availability, IR, lineups, drops, waiver fills, grades and trade tests.
4. Record exact missing-data handling, projection-only and actual-only branches, source statuses, participation rules, rounding and tie-breaking. In particular, drop/fill ties use surplus index and PlayerID; do not substitute Value PPG.
5. Capture reference outputs for all players, replacement candidates, all teams and their weekly lineups. Build trade fixtures covering every size from one to five players per side, both unequal directions, injuries, required drops and waiver proposals.
6. Separate private reference evidence from public test fixtures. Run the full real-snapshot parity suite locally; use synthetic or sanitized fixtures in GitHub. Preserve identifier relationships, ranking order and tie behavior when sanitizing, or use wholly synthetic equivalents.

### Deliverables

- `docs/workbook-adapter.md`: table/field/settings mapping and supported structural signature.
- `docs/model-contract.md`: formulas, units, statuses, ordering and scenario semantics.
- `docs/feature-parity.md`: workbook feature → module → screen → test matrix.
- A private reference harness and publishable synthetic fixtures.

**Gate:** every workbook function has an owner and a test strategy. Any difference between the architecture’s summary and the actual workbook is documented for resolution before implementation; it is not silently treated as a new model rule.

## 3. Phase 1 Build the application foundation

### Tasks

1. Create a dedicated application directory and initialize the repository structure described in the architecture. Use a neutral working title until branding is selected.
2. Set up React, TypeScript and Vite with pinned reviewed dependencies and a lockfile. Add scripts for development, type checks, lint, unit tests, browser tests and production builds.
3. Establish hash-based navigation for My Team, Teams, Players, Trades, Gems, Weekly, Model and Audit, and Data and Account. Add player-detail and comparison routes. Keep the repository base path configurable until the deployment name is known.
4. Define Zod contracts for the canonical dataset, settings, current application state, import reports and every domain result. Use string IDs, finite numeric values, explicit units and separate statuses/reasons. Make null distinct from zero.
5. Define import/calculation worker message types, progress messages, cancellation, request IDs and error results. Every calculation request includes dataset, settings and model versions.
6. Define shared metric rendering and color tokens. Implement labeled controls, searchable selectors, cards, tables, status badges, expandable details and an accessible centered advantage bar.
7. Add ignore rules before importing development data. Exclude real XLSX files, private extracted datasets, private fixtures, local environment files and credentials. Add a build-artifact check for unexpected private files and secret-like values, permitting only documented public configuration.

### Deliverables

- A running application shell with functional navigation.
- Typed contracts and domain API interfaces.
- Shared UI components and color definitions.
- CI checks that build and test the application without deploying it.

**Gate:** an empty or signed-out workspace has clear next steps; the shell builds without requiring private data or secret keys.

## 4. Phase 2 Implement import and local persistence

### Tasks

1. Implement the versioned V5.2 adapter using table metadata, column signatures and allowlisted names. Support renamed files with the same structure; reject unsupported structures with a specific explanation.
2. Parse XLSX inside the import worker. Enforce the architecture’s proposed compressed, expanded, canonical-payload, row-count and runtime limits. Verify ZIP entry metadata and bounded decompression rather than trusting only the file’s compressed size.
3. Extract only supported table data, settings and comparison outputs. Never persist or transmit raw workbook bytes, custom XML, connections, Power Query, external links or arbitrary notes. Release file references when the import completes or is canceled.
4. Normalize timestamps, ownership, participation, projections and statuses. Validate referenced teams/players, duplicate IDs, roster ownership, schedule periods and history uniqueness. Missing ownership must not become free agency.
5. Reconcile Power Query-prepared actual aggregates with completed played-game history. Coalesce only equivalent duplicates; mark conflicts and missing data explicitly. Preserve genuine zero and negative scores.
6. Build the import preview: source refresh time, import time, player/team counts, recognized settings, warnings, unsupported features and blocking issues. Explain that importing does not refresh ESPN.
7. Create an IndexedDB repository for one current local workspace and one latest pending sync intent. Replace the dataset atomically after confirmation and validation. Preserve existing app overrides by default on later imports, while allowing the imported settings to be chosen explicitly.
8. Establish source freshness from source UTC, not import time. Add the existing greater-than-24-hour stale warning. Preserve source timestamps in all relevant views.
9. Initially wire the importer to schema and source validation. Add the calculation-parity preview in Phase 3; import parity uses workbook settings even if the user keeps app overrides for normal use.

### Verification

Test a valid workbook; renamed workbook; unsupported layout; missing/extra columns; missing cached formula results; zero values; corrupted ZIP; oversized data; canceled parsing; conflicting history; missing ownership; and interrupted persistence. Verify that unsupported required calculations request a recalculated saved workbook instead of inventing values.

Inspect network requests and browser storage to confirm that no original XLSX is uploaded or retained. A failed/canceled import leaves the current usable dataset intact. A completed replacement must not leave an application-managed import archive.

**Gate:** refresh/save/import/reopen works locally, and invalid data cannot silently produce healthy-looking values.

## 5. Phase 3 Port player calculations and signals

Implement these modules in dependency order, with an independent fixture for each:

| Order | Module | Required behavior |
| --- | --- | --- |
| 1 | History and projection eligibility | Verified completed games, participation, actual aggregates, usable projection records and source statuses |
| 2 | Adaptive values | Actual/recent/observed PPG, adaptive weight, Expected PPG, consistency loss and Value PPG with all fallback branches |
| 3 | Availability and horizon | Imported current/final periods, scheduled games, byes, confirmed absences and uncertain scenarios |
| 4 | Replacement pools | Eligible available players, top-three selection, arithmetic means and conditional/unavailable pools |
| 5 | VORP and rankings | Negative VORP, Positive VORP, linear surplus index, offensive ranks and draft ADP edge |
| 6 | Workload and regression | Carries, targets, shares, opportunities, xTD and existing buy-low/sell-high rules |
| 7 | Gem screening and trends | Candidate/watch precedence, emerging/TD caution, scoring gaps, workload support, arrows and explanations |

Use one shared domain implementation for all screens. Cache by dataset hash, settings hash and model version. Keep source inputs immutable; build derived results separately. Settings changes invalidate dependent calculations without altering recorded data.

### Verification

- Compare every player’s app results to the saved native-Excel reference with the same snapshot and workbook settings.
- Test no history; one to three games; four-game consistency boundary; steady versus volatile scores; zero/negative Expected PPG; valid zero projections; missing forecasts; and incomplete history.
- Test replacement pools of zero, one, two and three or more candidates; ownership/injury exclusions; current byes; equal Value PPG; and no positive VORP.
- Verify index ratios match Positive VORP ratios. An unrelated elite player may rescale indices but must not change package surplus-test results.
- Test every gem-rule boundary, fewer than two earlier games, zero earlier mean, exact trend thresholds, ten-decimal stabilization and SELL HIGH precedence.
- Verify workload denominators and disclose incomplete imported team coverage.

**Gate:** numeric parity is within absolute tolerance 1e−8 except documented Excel rounding steps. IDs, counts, statuses and ordering match exactly. Unexplained mismatches block trade-advice readiness; do not tune the formulas toward preferred player rankings.

## 6. Phase 4 Implement lineups and team evaluation

### Tasks

1. Build deterministic availability and IR-assignment functions from the imported rules. Distinguish confirmed current absence from an unknown return date.
2. Implement legal weekly slot assignment using Value PPG, eligibility and league starter counts. Fill legal slots when players are available, including negative-valued players where the workbook fills them; report any genuinely unfilled slot as zero points and missing coverage.
3. Reproduce the workbook’s slot and PlayerID tie order. Test multi-eligible formats separately so an expanded optimizer does not silently change the supported workbook’s assignments.
4. Calculate Expected PPG and Value PPG totals for the same selected lineup. Produce weekly and horizon totals for both optimistic and unavailable injury scenarios where applicable.
5. Port team position grades, median comparisons, starter coverage, full-availability core, useful reserves, limited spare value and position advice. Allocate FLEX before identifying reserves.
6. Provide explicit missing-value and baseline conditions. Bench counts must not inflate starter grades; team medians use the imported fantasy league rather than the NFL player pool.

### Verification

Compare weekly assignments and totals for every imported team. Test positional limits, zero starter slots, FLEX allocation, IR capacity, unavailable players, byes, unknown returns, negative values, missing values, ties and the final-week cutoff. Test every letter-grade boundary and reserve classification.

**Gate:** all supported team/weekly reference results match, and the app can explain an unfilled slot or conditional grade by its actual cause.

## 7. Phase 5 Implement the complete trade engine

### Tasks

1. Implement trade draft validation: one to five players per side, ownership, counterparty, duplicate IDs, optional ID entry and valid current references.
2. Evaluate existing rosters, trade-only rosters with required drops, and optional waiver-filled rosters as distinct stages for both teams.
3. Port legal roster repair. At each step, propose a droppable player who reduces the conflict and minimizes horizon lineup-value loss. Recompute after each proposal and preserve the workbook’s surplus-index/PlayerID tie order.
4. Port waiver fills by largest incremental lineup value. Recompute each step, preserve the existing team processing order, and prevent duplicate claims across the two teams. Keep claim availability conditional.
5. Compute independent surplus and fantasy-points package requirements. Apply the premium once for unequal sizes, in either direction; equal-size trades have no premium. Keep H10’s imported value and 25–35% validation range.
6. Add required-drop replacement costs only to the points test, floored at zero and using the same horizon. Keep the real-snapshot replacement baselines fixed throughout the hypothetical scenario.
7. Port deal grades, the centered advantage bar, absolute difference and shortfalls. Preserve grade boundaries, uncapped numeric advantages, zero-surplus special cases and conditional suffixes.
8. Report expected scoring gain, adjusted lineup-value gain, legality, depth and uncertainty separately. Provide both horizon totals and average gain per remaining fantasy week, plus the weekly series.
9. Invalidate/recalculate the draft on new imports, changed teams, settings changes or ownership changes. Never retain a result marked current after its input version changes.

### Verification

Run all 25 size combinations from 1-for-1 through 5-for-5, representative roster compositions, and both unequal directions. Include boundary premiums, both packages at zero surplus, zero outgoing surplus, thin/unavailable baselines, undroppable players, IR conflicts, required drops, impossible legal repair, waiver contention and conditional injuries.

Verify no rounding before comparisons, no premium in the deal grade, no index/points unit mixing, no double-counted drop costs and no waiver gains attributed to the trade-only stage. Independently sum the displayed weekly deltas and check the average denominator includes every remaining scoring period.

**Gate:** the trade engine reproduces native Excel reference cases and exposes each conclusion separately. A favorable grade cannot suppress a legality failure, lineup loss or unavailable result.

## 8. Phase 6 Complete the interface

Build screens in this order so each is backed by a verified domain module:

| Screen | Implementation tasks | Acceptance example |
| --- | --- | --- |
| Data and Account | Import preview, replace controls, timestamps, validation reports and local removal | User can identify which snapshot is active and why an import failed |
| Players and detail | Search, filters, rankings, comparisons, projections, model explanations and source status | User can distinguish Actual PPG, ESPN projected PPG, Expected PPG and Value PPG |
| Teams | Team selection, entire roster, all evaluation fields, grades, depth and advice | Selecting any league team shows its full imported roster and position assessment |
| My Team | Preferred-team landing screen, initially Los Chilones, position needs and supported opportunities | Overview links each recommendation to the underlying player/position evidence |
| Gems | Pool/team/position/signal filters, thresholds, trends and explanations | Candidate/watch labels remain separate from replacement value and lineup benefit |
| Weekly | K and D/ST opponents, bye, actual averages and ESPN weekly points | Season projected PPG cannot be mistaken for current-week projection |
| Trades | Searchable selectors, package cards, grades/bar, shortfalls, lineup series, drops, fills and conditions | A user can tell how far off the exchange is and what it does to each lineup |
| Model and Audit | Settings, baseline candidates, calculations, history issues and supported source-table views | Every setting and audited value is traceable to its owner and data source |

Retain green factual values, blue ESPN projections, pink model values and purple inputs. Preserve the documented grade/bar exception. Provide labels and numeric deltas with every color signal. Use two decimals for displayed PPG while keeping calculation precision.

Test at desktop and phone widths, with keyboard-only navigation and appropriate screen-reader labels. Check wide tables, pinned identifiers, expanded detail panels, warning text, empty states, unavailable data and selector errors. The final application must meet the architecture’s WCAG 2.2 AA target through verified contrast and interactions.

**Gate:** every row in the feature-parity matrix has a working screen/control and a passing workflow test. Placeholder charts, hidden missing features and static example recommendations do not count as complete.

## 9. Phase 7 Implement Supabase authentication and sync

### Database and API tasks

1. Resolve the Supabase project before applying migrations. If reusing Trainwise’s project, inspect current objects and policies first; add only fantasy-specific objects and preserve Trainwise’s behavior.
2. Create the single `fantasy_workspaces` row per account, with canonical dataset, current state, independent dataset/state revisions, hashes, versions, timestamps and latest request IDs. Add server-side shape/size checks.
3. Implement `get_fantasy_workspace`, `replace_fantasy_dataset`, `update_fantasy_state` and `delete_fantasy_workspace` as specified. Lock the current row, compare revisions and commit atomically. Handle first creation, immediate retries and delayed stale requests explicitly.
4. Derive ownership from authenticated identity. Deny anonymous access and direct client writes. If using SECURITY DEFINER RPCs, enforce ownership inside every function, qualify names, pin the search path and restrict execution grants.
5. Define replacement side effects: draft reconciliation must increment the state revision when it changes stored state, while unrelated preferences remain intact. The RPC response returns authoritative versions/state so local storage cannot remain on a mixed revision.
6. Implement sign-in, sign-out, reset/session-expiry handling and account-scoped storage. Use the SDK’s session mechanism and never save plaintext passwords. Configure only public Supabase configuration in the frontend.

### Client synchronization tasks

1. Pull current cloud revisions at sign-in, foreground return and manual Sync. Add visible Local only, Syncing, Synced, Offline pending, Conflict and Failed states.
2. Keep only the latest pending desired dataset replacement and current state change. Store the expected revisions and request IDs for retry; do not queue an import archive.
3. On conflict, show local/cloud snapshot summaries. Require an explicit choice, then submit against the newly fetched revision. Revalidate trade selections against the chosen dataset.
4. On first sign-in after anonymous local use, explicitly resolve whether to adopt the local or existing cloud workspace. Never merge accounts or silently overwrite an existing cloud dataset.
5. Clear account caches on logout by default. Cloud deletion clears the active local copy and pending operations on that device. Other devices must check whether a cloud workspace still exists before replaying pending writes; absence pauses replay until an explicit decision to initialize a new workspace.
6. Keep only the app shell in service-worker caches. An offline device may hold its last synchronized data until reconnect/removal; show its true source age.

### Verification

Use two accounts and two independent browser contexts. Test cross-account denial, owner-ID spoofing, direct-write denial, initial creation races, simultaneous imports, state/dataset races, repeated request IDs, stale retries, offline replacements, logout/account switching, cloud deletion and reconnect.

Verify that successful replacement changes the one current row rather than appending snapshots. Verify no XLSX object storage or payload logging. Confirm managed backup retention separately during deployment; application deletion is not a claim of immediate erasure from provider backups.

**Gate:** a second device receives the current dataset/settings/draft, concurrent changes cannot silently overwrite one another, and User A cannot read or mutate User B’s workspace.

## 10. Phase 8 Verify and release

### Final verification

- Run the full private real-snapshot parity harness and publishable synthetic domain/import suite.
- Complete the feature-parity matrix, mobile/desktop workflows, keyboard checks and status/color review.
- Measure the architecture’s proposed performance targets on recorded reference devices: import ≤10 seconds, search/filter ≤150 ms for 2,000 players, and five-player-per-side trade preview ≤2 seconds after load. Test at least 2,000 players and 40,000 history rows within limits.
- Verify worker cancellation and version checking prevent an older computation from overwriting a newer result.
- Inspect the production artifact and network traffic for private datasets, workbook bytes, passwords, session leakage and secret keys.
- Test service-worker updates and schema-version behavior. An older application must refuse an unsupported dataset instead of corrupting it.

### Deployment sequence

1. Resolve the repository name/URL, Supabase project and authentication redirect URLs. No infrastructure identifier is invented in the plan.
2. Finish the local build and release report before requesting any final publication approval required by the active session. Approval, if required, applies to the concrete reviewed build and migration.
3. Apply the tested fantasy migrations to the selected Supabase project through the controlled deployment procedure. Keep database administrative credentials out of browser code and build artifacts.
4. Configure the repository base path, Pages environment and public Supabase configuration. Deploy the tested static artifact through GitHub Actions.
5. On the actual Pages URL, complete: sign in → import refreshed/saved workbook → inspect Los Chilones → evaluate a trade → sync → open another device → confirm matching data and results.
6. Check deep links, auth redirects, offline reload, manual sync, import replacement and app-shell update behavior on the hosted origin.
7. Deliver the site URL, source repository, version, brief user guide, parity/performance/security results, and any explicitly unresolved limitations.

**Release gate:** all architecture requirements pass or are explicitly changed by the user. No unexplained calculation mismatch, missing agreed feature or account-isolation failure is accepted as a finished release.

## 11. Required implementation decisions

These inputs are needed at the indicated point; they do not prevent local implementation and testing:

| Input | Needed before | Treatment until resolved |
| --- | --- | --- |
| GitHub repository name/URL | Repository publication and base-path deployment | Use a dedicated local app directory and configurable base path |
| Reuse Trainwise Supabase project or use a separate project | Applying cloud migrations | Use local/test Supabase with fantasy-specific names |
| Authentication choice | Production auth configuration | Email/password is the spec’s proposed starting point, not a confirmed user selection |
| Production redirect URLs | Hosted authentication testing | Use local test redirects only |
| App name | Final branding/release | Use Fantasy Football as the working title |

Measure workbook sizes and calculation performance early. If limits or the architecture’s implementation details need adjustment, record the reason and affected acceptance tests. Preserve agreed behavior rather than silently dropping features to meet a target.

## 12. Completion checklist

- [ ] Every workbook feature, setting and output mapped and implemented.
- [ ] One current extracted dataset per account; no stored workbook/import archive.
- [ ] Imports validate source data, preserve zero/missing distinctions and replace atomically.
- [ ] Adaptive values, replacements, index, signals, grades and ranks match Excel.
- [ ] Weekly lineups, trade scenarios, drops, fills and conditional results match Excel.
- [ ] Scoring gains show total and average per remaining week with clear units.
- [ ] All required screens work with Los Chilones as the initial preferred team.
- [ ] Supabase sign-in and multi-device synchronization pass isolation/conflict tests.
- [ ] Offline, account switching, deletion and update behavior are verified.
- [ ] Mobile/desktop readability, keyboard access, colors and performance are verified.
- [ ] Hosted end-to-end workflow passes and delivery documentation is complete.

The replacement pool, adaptive weights, consolidation premium, grade bands and gem thresholds remain the existing provisional assumptions. Porting them correctly does not establish historical validation.

Source architecture: [Fantasy Football GUI Architecture](Fantasy%20Football%20GUI%20Architecture.md).


## Surface manager redesign delivery

1. Add versioned pure classification, distinct main/compensation matching and provisional range rules with boundary/monotonicity tests.
2. Add opt-in independent direct/standard/per-stage chain adapters; retain legacy filters and default behavior.
3. Add compact numerical evidence and grouped alternatives without changing Save/Load access.
4. Add private journal/profile import, explicit immutable forecast logging, record-revision sync and conflict handling.
5. Verify disabled parity, counter direction, snapshot preservation, real-only outcome tracking, hypothetical contexts, migration/RLS, browser workflows, production build and publication privacy. No version bump, commit or deployment is automatic.
