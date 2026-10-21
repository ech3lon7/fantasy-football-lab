# Index-based trade search — implementation plan

October 21, 2026 · Plan 1.0 · Status: ready for implementation

Based on [trade-search architecture specification 1.0](trade-search-architecture.md). Add discovery of index-matched players and packages to the existing Trade Analyzer, preserving its calculations, starter choices, data sources and saved draft behavior.

This is a planning deliverable. No application code, version, dependency, database, commit or deployment changes are part of this task.

## 1. Execution order

| Phase | Deliverable | Depends on | Completion gate |
| --- | --- | --- | --- |
| 0 | Existing-behavior baseline and change boundary | Specification | Relevant current checks and representative trade results recorded locally. |
| 1 | Typed query, exact index matching and ordering | Phase 0 | Synthetic enumeration and boundary tests pass. |
| 2 | Existing-engine scoring adapter and performance checkpoint | Phase 1 | Search rows match direct trade evaluations; package costs measured. |
| 3 | Dedicated worker and request lifecycle | Phase 2 | Complete results, progress, pagination and cancellation work without blocking the UI. |
| 4 | Search controls and result presentation | Phase 3 | Singles and packages work with accessible controls and explicit statuses. |
| 5 | Safe loading and context invalidation | Phases 3–4 | Loaded results match analyzer results; stale/account-crossing loads are impossible. |
| 6 | Regression verification and local handoff | Phases 0–5 | Source, build, browser and relevant parity checks pass. |

Do not wire an incomplete search panel into the main screen. Complete the domain and worker behavior before exposing it in TradeView. Implement sequentially; no additional infrastructure or feature-flag system is needed.

## 2. Phase 0 — establish the boundary

1. Inspect current working changes and preserve all user edits. Read the project instructions and existing architecture/model documents. Do not reset, reformat or clean unrelated files.
2. Confirm the current integration points: TradeView receives the model, draft, draft-change callback and saved starter data; the existing model worker creates the model from dataset, settings, evidence and role-scenario inputs.
3. Record representative results from `evaluateTrade` for saved and imported starters, outgoing bench players, outgoing starters, incoming upgrades, unequal packages, required drops and uncertain availability. Keep real snapshot evidence in the ignored private area.
4. Run the existing source checks and a production build to identify pre-existing failures separately from new failures. Record existing test/build limitations without changing unrelated code to address them.
5. Record enumeration sizes and representative evaluator cost. Package search multiplies an already substantial calculation cost; prior verification reports include an approximately 112 ms individual trade evaluation. That is historical evidence, not a timing guarantee for the current engine.

**Gate:** the authoritative calculation path and fields are confirmed, and current behavior is reproducible without modifying model logic.

## 3. Phase 1 — query contracts and exact matching

Create `src/domain/trade-search.ts`. Keep calculation and search logic out of React components. Define exported search types here rather than expanding the global persisted workspace schema.

### Contracts

Define a normalized query containing own-team ID, ordered fixed outgoing IDs, effective incoming count, below offset and above offset. Define compact candidate/result records, search counts, and typed worker request/response envelopes. Use discriminated message types and the existing domain types for IDs, settings and datasets.

Keep these distinctions explicit:

- Missing index versus numeric zero.
- No matches versus failed or cancelled search.
- Index match versus a successful or conditional trade evaluation.
- Nullable scoring versus a genuine zero-point gain.

Build a deterministic context identity from workspace identity, dataset hash, model/settings/evidence/scenario inputs, saved starters, horizon/model version and normalized query. Do not include the currently selected incoming players or counterparty. Reuse existing canonical serialization if suitable; otherwise add a small local deterministic serializer for the actual fields required, without new dependencies.

### Validation and enumeration

1. Require one through five unique outgoing IDs, owned by the selected own team, each with a finite index.
2. Require finite nonnegative offsets and an incoming count from one through five. Package mode off always means one incoming player. Reject non-finite derived sums or bounds.
3. Calculate unrounded outgoing sum S and inclusive bounds S minus below and S plus above. Do not clamp the lower bound to zero or cap aggregate totals at 100.
4. Group eligible candidates by valid other-team ownership. Exclude free agents and missing indices, counting exclusions. Preserve zero indices, all positions, injuries and byes.
5. Enumerate unique unordered combinations of exactly the selected count using deterministic candidate order and increasing positions. Retain distinct packages with equal sums.
6. Add conservative minimum/maximum remaining-sum pruning. Skip only impossible branches; never use a nearest-index shortlist, arbitrary candidate cap or premium-adjusted range. Ensure floating-point pruning cannot exclude a package that the final unrounded comparison would accept.
7. Expose phase/count progress hooks without introducing UI dependencies into the domain module.

Create `tests/trade-search.test.ts` with synthetic fixtures. Include a small exhaustive reference enumerator in the tests and compare complete result keys against the pruned algorithm for counts one through five, ties, zero-index players and boundary cases. Include the illustrative 45.31 outgoing sum with 40.31–50.31 bounds, totals above 100 and missing/invalid inputs.

**Gate:** complete matching sets agree with the exhaustive reference, independent of scoring.

## 4. Phase 2 — authoritative scoring and early performance gate

Extend the new domain module with a scoring adapter that constructs a temporary draft for each match and calls `evaluateTrade(model, candidateDraft, true, lineupsRaw)`.

Map the returned fields directly:

| Search field | Existing result |
| --- | --- |
| Own expected gain per week | `directA.expectedPerWeek` |
| Other team's expected gain per week | `directB.expectedPerWeek` |
| Remaining-horizon gains | `directA.expected`, `directB.expected` |
| Asking-price and fairness outputs | Existing grade, surplus test and fantasy-points test |
| Roster/availability details | Existing legality, proposed drops/IR moves and uncertainty |

Do not copy formulas, call a simplified alternate trade engine, substitute optimized coverage for direct starter impact, or credit separate waiver gains to the headline scoring value. The original outgoing draft remains immutable.

Handle both branches of the existing TradeResult type. A normal `valid: false` result becomes a retained index match with null scoring and its errors. A thrown unexpected error fails the search explicitly; do not silently discard that package and claim complete results. If direct scoring alone is unavailable, preserve other returned details and warnings.

Sort only after every match is evaluated: own numeric gain descending, null last; then absolute index gap ascending; then TeamID and sorted incoming PlayerID tuple. Reuse the existing identifier comparison convention. Preserve negative and zero gains.

Test each compact row against a direct call to the existing evaluator using identical inputs. Cover starters versus bench, drops, IR, uncertainty and both unequal-package directions. Assert that index matching never uses the premium even though existing asking-price tests still do.

Benchmark singles and counts two through five using the private current snapshot and synthetic wide-range/zero-heavy cases. Record model-build, enumeration and evaluation time, number of matches and retained-result size. The specification's under-two-second singles and under-ten-second typical two/three-player targets require measurement. Large four/five-player searches may take substantially longer.

If performance misses targets, first profile avoidable allocation, ordering and bound computation inside the new search module. Retain one model per search and compact results. Do not change existing trade formulas or hide matches to improve timings. Report measured limits; any broader engine optimization or product-scope change requires a separate decision before implementation.

**Gate:** correctness matches the existing analyzer and performance costs are understood before interface work.

## 5. Phase 3 — dedicated search worker

Create `src/workers/trade-search.worker.ts` using the existing module-worker construction pattern. Leave `src/workers/model.worker.ts` unchanged.

1. Accept a typed Start message containing request ID, context identity and captured model/query inputs.
2. Build the model once with the same evidence and role-weight semantics as the existing worker. Pass saved starters to every trade evaluation.
3. Enumerate matches, evaluate every match and sort the completed compact list. Retain compact IDs/summaries rather than full weekly evaluation trees.
4. Throttle progress messages to approximately 100–200 ms intervals, including phase, teams processed, matches found and matches scored. Avoid per-package message floods.
5. Return a completed first page of 50 results and total match count. Retain remaining rows in worker memory for explicit page requests.
6. Validate request/context identity and page bounds. Return explicit errors for failed initialization or computation. Never return a partial list labeled complete.

Worker termination is the cancellation mechanism. Keep its lifecycle in the feature component: a cancel, restart, unmount or account/context change terminates the worker and invalidates its request ID. Do not rely on a Cancel message being processed during synchronous computation.

Add worker-specific browser coverage using the real module worker and synthetic imported data. Verify phase progress, completion, cancellation, restart, paging and rejection of late messages. Confirm the main thread remains interactive during a larger search.

**Gate:** completed pages represent the entire ranked matching set, and cancellation immediately frees the search lifecycle.

## 6. Phase 4 — controls and results

Create `src/features/TradeSearch.tsx` with component-local controls and lifecycle state. Suggested states are idle, running, complete, cancelled, stale and error; keep validation errors separate from worker failures. Reuse existing visual conventions and player popovers.

### Controls

- Show the fixed outgoing names, combined index, data timestamp and scoring horizon.
- Initialize independent below/above controls to five. Pair each slider with a labeled numeric input supporting hundredths. Keep editable text separate from validated numeric values so blank or partially typed values do not become zero accidentally.
- Expand the slider's usable range when necessary to accommodate valid numeric entry; never silently clamp the query to a track limit.
- Show the inclusive range to two decimals, with precise values accessible in details.
- Provide package toggle and one receive-count selector from one through five. Preserve outgoing selections and require an explicit Search click.

### Results and statuses

Show player names/team, incoming index, signed index gap, both teams' expected lineup gains per week, grade, separate tests and warnings. Provide expandable horizon totals and roster moves, plus Load trade and Show more. Page size affects rendering only.

Label the gain as model expected lineup gain per week, and identify the saved/imported starting-lineup source. Do not present this as a current-week ESPN projection or likely acceptance. Keep negative, zero, conditional and unavailable scores visible with explicit wording.

Empty results explain the actual range, effective incoming count, excluded missing indices and insufficient team pools. Cancelled and failed searches must not resemble an empty successful search. Use accessible progress announcements, labeled keyboard-operable controls, and text alongside colors. Verify mobile table scrolling within the panel.

Add the panel to `TradeView` in `src/features/views.tsx` between the builder and evaluation panels. Do not restructure the existing builder or result panels. Add narrowly scoped CSS only if existing classes cannot support the controls/results.

**Gate:** controls accurately express the requested query, and all completed matches remain discoverable through pagination.

## 7. Phase 5 — load safely and invalidate stale results

1. Supply workspace identity from App if needed. Prefer a minimal TradeView key or explicit identity prop; do not alter global workspace persistence.
2. Compare the captured context with current inputs. Own-team, outgoing-player, offset, effective-count, dataset, settings, evidence, scenario, horizon or starter changes invalidate/cancel search. Clear results on account changes.
3. Mark retained old results stale and disable Load. Never auto-run a replacement search after edits.
4. Ignore late worker and page messages using both request ID and context identity.
5. On Load, recheck context, current team ownership and selected IDs. Atomically call the existing draft-change callback with only `teamB` and `get` replaced. Preserve `teamA`, all `give` IDs and their order.
6. Let the existing analyzer recompute the loaded draft. Do not inject a cached search result into its evaluation state.
7. Keep the completed search usable when only the current incoming draft/counterparty changes. Search scope remains all other teams, so loading a row should not invalidate its peer results.

Browser checks must prove row/analyzer agreement, preserved outgoing selections and no draft changes before Load. Cover cancellation on navigation, ownership refresh, starter/settings changes, account changes and delayed messages. Loading conditional trades is allowed for review; stale or invalid-ownership loads are blocked.

**Gate:** the displayed comparison context and loaded trade agree, with existing persistence handling the resulting draft normally.

## 8. Planned file boundary

| File | Planned change |
| --- | --- |
| New `src/domain/trade-search.ts` | Search contracts, matching, scoring adapter and ordering. |
| New `src/workers/trade-search.worker.ts` | Dedicated background search and paged results. |
| New `src/features/TradeSearch.tsx` | Controls, lifecycle, results and load requests. |
| Existing `src/features/views.tsx` | Minimal TradeView integration and load callback. |
| Existing `src/app/App.tsx`, if needed | Workspace identity/reset wiring only. |
| Existing `src/ui/styles.css`, if needed | Feature-specific layout only. |
| New `tests/trade-search.test.ts` | Synthetic matching, scoring and ordering tests. |
| New `tests/browser/trade-search.spec.ts` | Actual worker and end-to-end search/load coverage. |
| Existing `tests/fixtures.ts`, if needed | Minimal reusable synthetic fixture additions only. |
| Existing `docs/verification.md` | Measured results, limitations and completion evidence. |

Add short helper comments for every new logical code block, explaining its purpose. Format only touched code; avoid the repository-wide format command. Do not alter valuation, starter, Gem, screening, sync, service-worker or deployment logic. Explain any necessary expansion beyond this file boundary before making it.

No application-version bump is selected by this plan. Any approved bump must follow the user's major.moderate.minor convention and keep package metadata consistent.

## 9. Final verification and handoff

Run focused tests while developing, then the required completion checks:

1. `npm run check` — compilation, lint, domain tests and publication scan.
2. `npm run build` — verify the production build, including the new worker chunk and existing Pages base-path configuration.
3. `npm run test:browser -- tests/browser/trade-search.spec.ts` — with the established preview/server and APP_URL configuration.
4. `npm run test:browser` — retain current starter, player-popover, Gem screener, app-loading and import workflows.
5. `node --import tsx scripts/verify-excel.ts` and `node --import tsx scripts/verify-scenarios.ts` — when existing ignored private reference fixtures are present. Report missing prerequisites explicitly; never manufacture parity evidence or add real data to public fixtures.
6. Compare selected search rows against the fully loaded analyzer on the same snapshot and settings. Verify count, range precision, negative/null scores, premiums, roster conflicts, proposed moves and starter source.
7. Inspect keyboard/mobile behavior, warnings, pagination and responsiveness. Record measured timing for every supported incoming count, including difficult wide-range searches.
8. Inspect the final diff for unrelated edits, private data, new dependencies and unintended persistent-state changes. Preserve all pre-existing user modifications.

Update verification documentation with actual results rather than targets. Deliver a short guide: select outgoing players, set offsets and incoming count, Search, compare scoring/value/warnings, then Load trade for full review. Disclose measured large-package performance and the imported snapshot's freshness.

All implementation remains local. Do not stage, commit, push, publish or deploy; the user manages GitHub.
