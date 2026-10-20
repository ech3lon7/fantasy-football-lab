# Gem Screener filters implementation plan

October 15, 2026 · Plan 1.0 · Status: ready for implementation

Implement [Gem Screener advanced filters](gem-screener-filters-spec.md) in the existing Fantasy Football Lab app. The outcome is a search such as **Gem candidate OR Opportunity watch, AND trend ≥+2 PPG, AND surplus index 10–40, AND recent PPG ≥12**, with clear evidence for each result.

This plan adds filtering and presentation around existing model outputs. It does not change player values, gem classifications, trend calculations, or trade logic. No new data source, package, database table, RPC, or Supabase permission is needed.

## Delivery sequence

| Phase | Deliverable | Completion gate |
| --- | --- | --- |
| 1 | Typed filter contract and legacy compatibility | Old selections decode correctly; invalid new filters cannot broaden a search |
| 2 | Pure query engine and evidence classification | Combined searches, boundaries, and missing-data cases pass synthetic tests |
| 3 | Apply/reset controls and state integration | Draft edits stay separate; only applied filters persist |
| 4 | Results, explanations, sorting, and responsive layout | Counts, matching evidence, incomplete results, and pagination agree |
| 5 | Regression and synchronization verification | Existing workflows remain intact; saved searches survive reload and sync |
| 6 | GitHub Pages release and documentation | CI and deployed-site acceptance pass; limitations are stated accurately |

Complete phases in order. Keep partial work local until the full screen passes its acceptance checks. Existing authorization to commit and publish applies when implementation is requested; this planning task does not itself deploy app changes.

## 1. Establish the filter contract and compatibility layer

**Files:** new `src/domain/gem-screening.ts`; new `tests/gem-screening.test.ts`.

1. Define the complete signal enum and current default set: Gem candidate, Opportunity watch, Projection-gap watch, Emerging. Retain current pool, position, injury, selected-team, and sort behavior.
2. Define separate types for raw form values and validated applied queries. Raw thresholds remain strings so blank text, partial edits, and invalid input can be represented without coercion. A validated inactive threshold is null; zero remains zero.
3. Define a validation result containing either a complete valid query or field-specific errors. Accept trimmed decimal numbers with an optional sign; reject hexadecimal text, Infinity, NaN, and malformed input. Enforce index 0–100, whole-number games 0–17, and minimum index ≤ maximum index. Do not repair an inverted range automatically.
4. Add decoding and encoding for the spec's string-valued `state.filters` keys. Serialize selected signals as a JSON array in a stable enum order with duplicates removed; serialize applied numeric values consistently. Explicitly write empty strings for cleared numeric fields so merging a patch cannot retain old thresholds.
5. Decode legacy `gemSignal`: map Candidates and watches to the four current defaults, All signals to the complete enum, and recognized single signals to one-item arrays. Preserve all existing pool/team/position/injury/sort selections. Legacy queries receive no numeric thresholds.
6. Write the legacy compatibility hint alongside new-format selections, as defined in the spec. New-format `gemSignals` is authoritative. Unsupported versions, malformed new-format JSON, invalid numeric fields, and invalid active team selections produce a recoverable error; do not fall back to an unfiltered result list.
7. Implement a screener-only reset patch. Restore the original defaults and clear every new threshold, while retaining `gemTeam` and unrelated application filters. Do not replace the entire `state.filters` map.

**Gate:** tests cover legacy selections, empty signal selection, round trips, explicit clearing, invalid ranges, signed and zero values, corrupted saved state, and preservation of unrelated filters.

## 2. Implement the pure query engine

**Files:** `src/domain/gem-screening.ts`; `tests/gem-screening.test.ts`; synthetic fixtures under `tests/`.

Suggested API boundaries:

```ts
decodeGemFilters(saved, teamIds) // valid query or recoverable saved-state errors
validateGemDraft(draft, teamIds) // valid query or field errors
encodeGemFilters(query)         // string-valued patch, including cleared keys
screenGems(players, query)      // matches, incomplete evidence, excluded count
```

Names may follow repository conventions; retain the separation of parsing, filtering, and rendering.

1. Consume `Player.gem`, `trendDelta`, `index`, `recent`, `games`, `gap`, `value`, and `baseline`. Use the existing ownership, position, and injury fields. Do not rederive scoring or gem classification from raw workbook rows.
2. Apply OR within the signal set and AND across filter categories. No selected signals means zero matches.
3. Evaluate thresholds against finite, unrounded values. Inclusive bounds apply to all minimums and the index range. Above replacement requires `value - baseline > 0`, independently of VORP or available games.
4. Return three outcomes: match, incomplete evidence, or excluded. Any known failure wins over missing evidence. Null/non-finite values affect membership only when that metric is required by an active filter.
5. Keep missing-data classification independent of whether the UI displays it. The toggle controls visibility of the separate incomplete section, never whether an unknown condition becomes a pass.
6. Return structured evidence: metric key, raw value, threshold/range, pass/unknown status, and missing-data reason. Render readable explanations from this structure; avoid maintaining a second set of predicates for explanation text.
7. Preserve existing player warnings, including thin replacement pools and injury uncertainty. Do not turn meeting search criteria into a definitive pickup recommendation.

**Gate:** exercise the complete example search with hand-authored expected memberships. Include a player matching every condition, one with the wrong signal, one failing each numeric threshold, exact boundaries, real zero values, negative values, a missing trend, and a player with both a missing metric and a known failure. Test PPG advantage versus VORP explicitly, including unavailable and thin baselines.

## 3. Build the filter controls and applied-state workflow

**Files:** new `src/features/GemScreener.tsx` or a dedicated feature directory; `src/features/views.tsx`; existing `src/app/App.tsx` integration; `src/ui/styles.css`.

1. Move the screener's growing UI out of the large shared views file, retaining its public props and current route. Do not refactor unrelated screens.
2. Replace the single Signals dropdown with accessible checkboxes, Select all, and Clear selections. Add minimum trend PPG, minimum/maximum index, and minimum recent PPG to the main filter area.
3. Add Advanced filters for games played, projection-gap PPG, above replacement, and missing-data visibility. Display the number of active advanced conditions in the disclosure heading.
4. Maintain two states: persisted applied query and component-local draft controls. Ownership, team, position, injury, signals, and thresholds all participate in Apply. Table sorting remains immediate and independently persisted.
5. Apply validates the entire draft and sends one complete screener patch through the existing `onFilters` callback. The parent continues merging it into `w.state.filters` and uses the existing local-save/state-sync path. Invalid drafts retain current applied results and never save invalid values.
6. Show Unapplied changes, inline errors, and an applied-query summary. Enter in a numeric input applies only a valid draft. Empty signal selection is allowed as an explicit zero-result query, with a helpful prompt.
7. Reset applies the screener defaults immediately and resets the sort. Add Rising targets exactly as specified: All pool, RB / WR / TE, the two selected signals, trend +2, index 10–40, recent 12, games 5, other thresholds off, injured/missing off, current sort retained. Label the preset as an editable example.
8. Implement condition chips using the same query contract. Numeric-bound chips clear only their own bound; removing an above-replacement chip disables that requirement. Signal-chip removal deselects that signal and may leave an explicit empty signal set. If a chip, preset, or reset would discard unapplied edits, show an in-app choice to discard edits or cancel.
9. Reconcile restored or remotely synced applied state carefully. Reinitialize drafts on account changes. Do not reset a dirty form merely because sorting, model recalculation, or unrelated app state changes. If the applied query changes while edits are dirty, show that saved filters changed; allow loading the saved query or continuing edits while results remain tied to the current saved query. A later Apply uses the existing revision/conflict mechanism.
10. Reevaluate the applied query on dataset/model updates. Preserve it across imports; a now-missing selected team requires correction. Do not automatically relax thresholds when new data removes matches.

**Gate:** browser checks demonstrate Apply versus draft edits, invalid-input correction, Reset isolation, preset behavior, empty selection, chip removal, and changing saved state while edits are pending.

## 4. Render trustworthy results and support mobile use

**Files:** screener feature module; `src/ui/components.tsx` if needed; `src/ui/styles.css`.

1. Render confirmed matches and incomplete evidence as separate sections. Show distinct counts and explicit wording that incomplete players are not confirmed to satisfy every condition.
2. Include the spec's primary metrics and both explanations: Matching evidence for this search, and Why flagged for the engine's original signal. Retain workload/share details without crowding the main controls.
3. Keep the source refresh timestamp and stale-data warning visible. Explain the trend comparison period and surplus-index meaning beside the relevant controls.
4. Display two decimals normally and accessible extra precision where rounding can conceal a boundary decision. Preserve green facts, blue projections, pink derived values, purple inputs, gray unavailable values, and amber/red warning fills.
5. Apply all predicates before table sorting and pagination. Count all matches, not only visible rows. Keep incomplete results outside the main sorted match list.
6. Add an opt-in table tie-breaker if the shared component needs one: numeric PlayerID ascending after the selected sort comparison. Keep unknown values last in either direction, including deterministic ordering among unknowns. Leave unrelated table behavior unchanged.
7. Reset the screener table's visible-row limit to its first batch after Apply, Reset, preset application, chip changes, or dataset replacement. Prefer a screener-specific query/dataset key around the controlled-sort table if this avoids adding unnecessary shared pagination state. Verify that sorting does not discard the applied search or form edits.
8. Implement a useful zero-results state with current query, editable controls, and explicit remove/reset actions. Never auto-loosen the search.
9. Make controls keyboard accessible, associate validation errors with their inputs, and announce updated counts through a polite live region. On mobile, stack inputs and allow the result table to scroll within its panel. Keep Apply/Reset and applied-query summary outside the Advanced disclosure.

**Gate:** desktop and mobile checks show readable labels, unclipped controls, discoverable hidden advanced conditions, correct colors, working keyboard operation, separate missing-evidence counts, and correct first-batch/sort behavior.

## 5. Verify persistence, regression, and synchronization

**Files:** `tests/gem-screening.test.ts`; browser tests under `tests/browser/`; test-only fixture helpers; README and verification report.

Use synthetic browser fixtures with enough players to exercise pagination and numeric boundaries. Seed an isolated test browser's local workspace through test-only helpers matching the existing IndexedDB format; do not add a production debug route or depend on private workbook data in CI.

Run these acceptance workflows:

| Workflow | Required evidence |
| --- | --- |
| Primary search | Both selected signal types appear; every confirmed result meets all thresholds |
| Missing evidence | Missing active fields appear only in the separate section; known failures remain excluded |
| Input behavior | Invalid/inverted ranges preserve applied results; blank and zero remain distinct |
| Persistence | Applied filters and sort survive route changes, reload, and offline reopening; drafts are not saved |
| Compatibility | Legacy state restores correctly; malformed new state requires correction without broadening |
| Dataset replacement | Same query reevaluates against changed player data and ownership; source timestamp updates |
| Account isolation | An account change clears draft controls and loads only that account's applied filters |
| Sync | Two authenticated browser contexts reproduce the same applied query after explicit Sync now; stale updates retain existing conflict handling |
| Shared table behavior | Filtering precedes pagination; ties, missing metrics, counts, and first-batch reset are correct |
| Regression | Existing import, roster, player, trade, and local/offline workflows still pass |

For hosted sync testing, use an authorized test account/workspace or the user's signed-in session with a recoverable filter-state change. Do not overwrite the user's current dataset, model settings, or trade draft to run a filter test. If real-account access is unavailable, finish deterministic sync-client/database checks and identify hosted cross-device acceptance as pending rather than claiming it passed.

Run `npm run check`, `npm run build`, and the relevant Playwright suite against the production build and Pages base path. Run the existing real-workbook flow locally. The valuation engine should remain untouched; if an implementation change reaches its calculations, rerun native Excel/model parity before release. Capture desktop/mobile screenshots and inspect them.

**Gate:** resolve relevant failures before release. Record actual test results and outstanding hosted-access limitations. Do not claim historical validation of the example search thresholds.

## 6. Publish and verify

1. Review the final diff for accidental model, account, database, or unrelated-screen changes. Confirm private datasets, workbook files, screenshots, and credentials remain outside committed assets.
2. Update README with one concise example search, the meaning of Trend PPG, inclusive index bounds, Apply/Reset behavior, missing-evidence handling, and explicit sync instructions.
3. Commit the feature and tests to the existing GitHub repository, then push through its existing Pages workflow. Reuse the configured public Supabase variables. Do not create a new hosting project or change Trainwise infrastructure.
4. Confirm CI/deployment success and run smoke checks against the actual live Pages URL. Verify the service-worker update/reload path loads the new controls while retaining the current workspace.
5. Exercise the primary search, invalid-input correction, and reload persistence on the deployed app. Exercise actual account sync when a signed-in session is available.
6. Deliver the live link, short usage steps, verification results, and any remaining acceptance limitation. Do not present the filtering preset as a trade-price guarantee or pickup recommendation.

If an acceptance failure is discovered after deployment, fix and republish. If a rollback is necessary, republish the previous frontend build; no database rollback or private-data restoration should be necessary. Retain the new filter keys rather than deleting user searches. Older builds can read only the legacy signal hint, so custom multi-select and numeric criteria are unavailable until the feature build is restored.

## Completion criteria

The deployed screener supports the full spec, the example search is reproducible, results explain every active condition, incomplete evidence is clearly separated, old saved selections remain usable, and applied queries persist through existing local/cloud paths. Relevant checks pass, and any real-account testing limitation is explicit.

This document is the implementation plan. No application code or deployed behavior has been changed by creating it.
