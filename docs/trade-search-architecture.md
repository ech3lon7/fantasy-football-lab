# Index-based trade search — architectural specification

Specification 1.0 · October 21, 2026 · Proposed implementation

Add a search panel to the existing Trade Analyzer. It finds single players or packages whose summed value indices fall within a user-defined range of the selected outgoing players. It then ranks all matches by their effect on the user's expected starting-lineup scoring, using the existing trade engine.

This document specifies the feature; it does not implement application changes. Its version is independent of the application version.

## 1. Agreed behavior

| Decision | Required behavior |
| --- | --- |
| Outgoing package | Keep every selected outgoing player fixed, up to five. Never search subsets or add unselected players. |
| Search scope | All other fantasy teams. Each incoming package must belong to one team. |
| Index range | Independent offsets below and above the outgoing summed index, initially five index points each. |
| Packages | With Create package off, receive one player. With it on, select one incoming count from one through five. |
| Matching | Compare raw summed indices. Consolidation premiums do not change the search range. |
| Results | Retain all index matches, including negative scoring impacts, injuries and conditional evaluations. |
| Default order | Largest gain in the user's expected starting-lineup points per week first. |
| Load action | Set the counterparty and incoming players in the current analyzer; preserve the outgoing package. |

An index match is a discovery result, not a declaration that a trade is fair, legal or likely to be accepted. Show value exchange, scoring impact, legality and uncertainty separately.

## 2. Boundaries

Use the current imported snapshot, current model settings, existing evidence and availability scenarios, and saved or imported starters. The selected own team comes from the analyzer, rather than being hardcoded to Los Chilones.

Preserve the existing calculations for player value, projections, replacement baselines, linear index, trade grades, premiums, fantasy-point tests, required drops, IR, waivers and starter impact. Gem, Watch and Reduced workload signals are outside this change.

No new ESPN requests, server endpoints, Supabase tables, dependencies, workbook storage or automatic league transactions are required. Search runs locally in the browser. Search controls and results remain component-local in this first implementation; the existing loaded trade draft continues to use existing persistence and synchronization. Leaving the screen can discard search results.

## 3. Interface

Place **Find matching trades** between the existing trade builder and its evaluation panels. Reuse existing controls, tables, player popovers and status styles.

The panel contains:

- A read-only summary of the selected outgoing players and their combined index.
- Separate **Below outgoing total** and **Above outgoing total** sliders, each paired with an accessible numeric input. Values are nonnegative, finite index points, not percentages. Numeric inputs support two-decimal adjustments; the slider track must not prevent entry of a valid wider range.
- A live inclusive incoming-index range, displayed to two decimals.
- **Create package** and, when enabled, **Players to receive: 1–5**.
- **Search**, **Cancel** while running, and **Show more** for completed results.

Do not cap package totals at 100: multiple individual indices can sum above 100. Reject invalid offsets rather than silently clamping or replacing them.

Each result shows incoming names, owning team, incoming index total, signed difference from outgoing total, both teams' expected scoring gains per week, trade grade, separate surplus and fantasy-point tests, and availability or roster warnings. Expand details for remaining-horizon totals and proposed drops or IR moves. Reuse name popovers and provide **Load trade**.

Label scoring as **model expected lineup gain per week** and show whether its starting-lineup baseline is saved in the app or imported from ESPN. This is not ESPN's current-week team projection. Preserve the model's data timestamp and horizon. Use explicit warning text alongside color.

## 4. Inputs and eligibility

Capture one immutable search context when Search is clicked.

| Input | Validation |
| --- | --- |
| Own team | Exists in the current dataset. |
| Outgoing IDs | One through five distinct players, all currently owned by that team. |
| Outgoing indices | Every index is finite and numeric. A missing index blocks search; zero is valid. |
| Incoming count | Exactly one effective count from one through five. |
| Range offsets | Both finite and nonnegative. |
| Incoming candidates | Players owned by a valid other fantasy team, with a finite numeric index. |

Free agents are outside the selected search scope. Include every position, injury status and bye status when an index is usable. Do not introduce extra workload, quality or health filters. Report excluded missing-index candidates and teams with too few eligible players, so an empty result has an explanation.

Generate unique unordered combinations of exactly the requested size. Do not mix owners, repeat a player, treat permutations as separate packages, discard distinct equal-sum packages, or exclude zero-index players as package fillers.

## 5. Index matching

Let S be the sum of the current outgoing indices, B the below offset, and A the above offset. The incoming sum I matches when:

**S − B ≤ I ≤ S + A**

Use the underlying numeric values for sums and comparisons; do not round before matching. Display two decimals and make full precision available in details where boundary behavior could otherwise be confusing.

Example: 34.86 + 10.45 = 45.31. Offsets of five below and five above produce an inclusive range of **40.31–50.31**. These are illustrative input values, not assertions about the current dataset.

Enumerate candidates separately for each owner, in a deterministic order. A depth-first combination search chooses increasing candidate positions. Bounds on the smallest and largest achievable remaining sums may prune a branch only when it cannot produce a match. Tie ordering uses PlayerID. Tests must compare pruning against exhaustive enumeration on small fixtures.

The consolidation premium remains part of the existing asking-price tests. It is never applied to S, I or the search bounds.

## 6. Scoring and ordering

Evaluate every index match through the existing `evaluateTrade(model, draft, true, lineupsRaw)` path. Construct a temporary draft with the fixed outgoing package, the candidate's owner and its incoming IDs. Search must not modify the live draft.

| Result | Existing authority |
| --- | --- |
| Primary ranking score | `directA.expectedPerWeek` |
| Counterparty gain per week | `directB.expectedPerWeek` |
| Remaining-horizon scoring gains | `directA.expected` and `directB.expected` |
| Grade and asking-price tests | Existing returned grade, surplus test and fantasy-points test |
| Proposed roster moves and conflicts | Existing legality, drop, IR and waiver evaluation |
| Uncertainty | Existing availability scenarios and data warnings |

This preserves the current starter-aware behavior: trading an unused bench player alone does not subtract his scoring from the user's active lineup. Existing replacement and incoming-upgrade behavior still applies. Do not substitute optimized future coverage (`a`/`b`) for direct starter impact, or add a separate waiver pickup's benefit to the headline trade-only gain.

Keep positive, zero and negative gains visible. An unavailable scoring result remains null, displays **Unavailable**, and sorts after all numeric gains. Never turn missing scoring into zero. Index matches with resolvable roster conflicts remain visible and flagged; existing engine rules determine their evaluation status.

After every match has been evaluated, sort by:

1. User's direct expected gain per week, descending; null last.
2. Absolute incoming-minus-outgoing index difference, ascending.
3. TeamID, then the sorted incoming PlayerID tuple, using existing identifier comparison behavior.

Do not evaluate only the closest index totals. A farther match may yield a larger lineup improvement. Do not present a partial scan as the globally best result. Index proximity and the trade grade are not estimates of another manager's acceptance probability.

## 7. Components and computation flow

Use a dedicated search worker so combination enumeration and trade evaluation do not block the interface or the analyzer's existing worker. Reuse the existing domain functions without copying their formulas.

| Module | Responsibility |
| --- | --- |
| New `src/domain/trade-search.ts` | Query validation, exact combination matching, compact result mapping and deterministic sorting. |
| New `src/workers/trade-search.worker.ts` | Build one model from captured inputs, run search and evaluation, publish progress, retain completed result pages. |
| New `src/features/TradeSearch.tsx` | Controls, worker lifecycle, progress, paginated results and load requests. |
| Existing `src/features/views.tsx` | Embed the panel in TradeView and connect its load action to the existing draft change callback. |
| Existing `src/app/App.tsx`, only if needed | Supply workspace identity or key the TradeView to clear search state on account changes. |

Reuse existing styles; touch `src/ui/styles.css` only where required for usable controls or results. Do not refactor unrelated components or change the existing model worker's calculation behavior. Add short helper comments to each new logical code block during implementation.

Worker flow:

1. Validate and capture the context; construct the same model as the current analyzer.
2. Enumerate matching packages and retain compact ID/total records.
3. Evaluate all matches through the existing trade engine, with throttled progress updates.
4. Sort completed compact results globally.
5. Return the first page and serve subsequent pages from retained worker memory.

Retain IDs and summarized evaluation results, not full weekly trade-result trees for every package. Resolve names and popovers against the current matching model. Pagination limits rendering, not the number of searched or evaluated packages. Proposed initial page size is 50.

## 8. Worker messages and cancellation

| Message | Required information |
| --- | --- |
| Start | Request ID, context fingerprint, dataset, settings, evidence/scenario inputs, saved starters and normalized query. |
| Progress | Request ID, fingerprint, phase, teams processed, matches found and matches scored. |
| Complete | Request ID, fingerprint, total match count and first result page. |
| Page request/response | Request ID, fingerprint, offset, page size and returned rows. |
| Error | Request ID, fingerprint and actionable error text. |

Show enumeration and scoring phases with counts. Do not invent a completion percentage when the total workload is unknown. Completion with zero matches differs from failure or cancellation.

Cancel terminates the dedicated worker. A second Search terminates its predecessor before starting again. Navigation, unmount and account changes also terminate it. Ignore any late messages whose request ID or fingerprint no longer matches. A cancellation message alone is insufficient if synchronous enumeration prevents the worker from processing it promptly.

Do not silently cap candidates, truncate combinations or stop at a time limit. For unusually large searches, keep progress and cancellation available. Report resource failures explicitly rather than showing partial results as complete.

## 9. Consistency and loading

The context fingerprint covers workspace/account identity, dataset hash, model settings, evidence and scenario inputs, saved starters, model/horizon version, own team, outgoing IDs, effective incoming count and range offsets.

Changing any of these cancels or invalidates the current search. Mark displayed results stale and disable Load until a new search completes. Do not automatically start an expensive new search after each edit. Counterparty and incoming draft selections are not search inputs because scope remains all other teams; loading one result should not unnecessarily invalidate the completed comparison list.

Before loading, verify the fingerprint and current ownership again. Atomically update only `draft.teamB` and `draft.get`. Preserve `draft.teamA`, every outgoing ID and their order. Use the existing callback so existing draft persistence and synchronization continue normally.

The analyzer then recomputes the loaded trade normally. With identical inputs, its direct gain and tests must agree with the search row. Search itself never changes starters, imports, settings or roster data, and loading is not a league transaction.

## 10. Result contract

A compact result contains:

- Stable key from counterparty ID plus sorted incoming IDs.
- Counterparty ID and incoming IDs.
- Exact outgoing total, incoming total and signed index difference.
- Own and counterparty direct gains per week and over the remaining horizon, each nullable.
- Existing grade, surplus-test and fantasy-points-test statuses.
- Legality status, proposed drop/IR IDs and availability/data warnings.

Request identity and context can be shared in the page envelope. Keep source timestamps in the captured context. Do not persist search results or add credentials, raw workbooks or private fixtures to deployment assets.

## 11. Performance and verification gates

Measure enumeration, evaluation, total elapsed time and peak result counts on the existing nine-team snapshot and synthetic worst cases. Proposed targets on a representative desktop are under two seconds for singles and under ten seconds for typical two- or three-player searches; these are engineering targets to measure, not guarantees. Record four- and five-player performance explicitly. Any optimization must preserve exact matching, complete evaluation and existing trade math.

Acceptance checks:

- The 45.31 example, inclusive bounds, fractional boundaries, totals above 100, zero indices and missing indices behave as specified.
- Incoming counts one through five produce no duplicates, permutations, cross-team packages or free agents. Fixed outgoing selections never change.
- Pruning returns the same complete set as exhaustive enumeration, including equal sums and zero-index combinations.
- Injuries and byes remain searchable; uncertain or unavailable scoring is labeled, retained and never replaced with zero.
- Positive, zero and negative impacts remain visible. Global ordering includes all matches, including a higher-gain match farther from the index target.
- Both teams' direct gains agree with the existing analyzer using saved and imported starters, bench departures, incoming upgrades, required drops and availability scenarios.
- Equal and unequal packages in both directions leave premiums, separate scoring units and asking-price tests unchanged.
- Cancel, restart, navigation, account switching, late messages, pagination and data/settings/starter changes cannot load stale results.
- Loading changes only counterparty and incoming players; search alone never changes the draft.
- Keyboard controls, numeric inputs, mobile layout, popovers and explicit status text remain usable.
- Run `npm run check`, `npm run build`, targeted browser workflows and existing trade/Excel parity checks before delivery. Existing Gem, Reduced workload, starter management, import and sync behavior must remain intact.

Implementation is limited to the modules directly required above and focused tests. No unrelated cleanup, application version change, commit, push or deployment is included in this specification task.
