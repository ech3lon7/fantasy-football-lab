# Gem Screener advanced filters

Specification 1.0 · October 15, 2026 · Status: proposed; app changes not implemented

## Goal

Let a user find players matching a specific combination of gem evidence, scoring improvement, and modeled value. The primary workflow is:

> Gem candidate OR Opportunity watch, AND trend at least +2 PPG, AND surplus index between 10 and 40, AND recent PPG at least 12.

Use existing model outputs. Do not change gem classification, adaptive valuation, workload requirements, trend calculations, replacement baselines, trade grades, or model settings. Filtering is a search operation, not a valuation bonus or an automatic pickup recommendation.

## 1. Controls and defaults

Keep the current Player pool, Team, Position, Include injured, table sorting, and snapshot warnings. Team appears only for Selected team. Replace the single Signals selector with labeled multi-select checkboxes.

| Control | Behavior | Default for a new workspace |
| --- | --- | --- |
| Signals | Match any selected signal | Gem candidate, Opportunity watch, Projection-gap watch, Emerging |
| Minimum trend PPG | Trend delta greater than or equal to entered value | Blank; no threshold |
| Surplus index: minimum / maximum | Inclusive range; either end may be blank | Both blank |
| Minimum recent PPG | Last-three-game PPG greater than or equal to threshold | Blank |
| Minimum games played | Whole-number minimum, 0–17 | Blank |
| Minimum projection gap PPG | Actual season PPG minus ESPN season projected PPG, greater than or equal to threshold | Blank |
| Above replacement only | Require Value PPG minus position baseline PPG to be strictly positive | Off |
| Show players with missing filter data | Add a separate incomplete-evidence section | Off |

Preserve existing defaults: Available player pool, RB / WR / TE positions, injured players excluded, and the current priority sort. Do not install the example numeric thresholds as new global defaults.

Signal choices: Gem candidate, Opportunity watch, Projection-gap watch, Emerging, TD caution, No gem signal, Limited history, Projection only, and Data issue. Provide Select all and Clear selections. Selecting none produces no matches and a prompt to select a signal; it must not mean All.

Use the label **Surplus index** consistently, with helper text: “The app’s trade/value index: normalized remaining-season surplus, not a market price.”

## 2. Exact metric definitions

| Filter metric | Existing model source | Interpretation |
| --- | --- | --- |
| Trend PPG | `Player.trendDelta` | Latest three played-game PPG minus PPG across all earlier played games |
| Surplus index | `Player.index` | Existing linear index, 0–100 |
| Recent PPG | `Player.recent` | Latest three played games, or all available played games when fewer than three |
| Games played | `Player.games` | Verified completed played games, including zero and negative scores |
| Projection gap | `Player.gap` | Actual season PPG minus ESPN season projected PPG |
| Above replacement | `Player.value - Player.baseline` | Positive consistency-adjusted PPG advantage over the positional replacement baseline |

Trend PPG does not mean last-three PPG minus full-season PPG. The current model requires three recent games plus `GemMinPriorGames` earlier games to calculate a trend: five total games with current defaults. Respect the model's returned null when history or sample size is insufficient. A minimum-games filter does not manufacture a trend value.

Projection gap uses the season ESPN forecast, not ESPN's current-week matchup projection. Above-replacement filtering uses the PPG difference, not positive VORP: current availability can affect VORP independently.

All comparisons use finite, unrounded model numbers. Render PPG/index values to two decimals. Provide more precision in accessible supporting text when rounding would obscure why a boundary passed or failed. Treat zero as a real value, never as missing.

## 3. Query semantics

Combine distinct filter categories with AND. Combine selected signals with OR. A grouped position choice such as RB / WR / TE retains its existing OR behavior.

Process each player as follows:

1. Apply ownership, team, position, injury, and selected-signal conditions.
2. Evaluate every active numeric filter and the above-replacement condition.
3. Any known failure excludes the player, even if another required metric is missing.
4. If every active condition is known and passes, place the player in Matches.
5. If no known condition fails but one or more active conditions are unavailable, classify as Incomplete evidence. Hide these players unless the missing-data toggle is on.

Missing metrics unrelated to active filters do not affect query membership. Existing injury/data/baseline warnings still remain visible; meeting the query does not erase them.

For a positive-above-replacement query, unavailable player Value PPG or baseline makes the condition unknown. A thin but numeric baseline can satisfy the query, but retain its CONDITIONAL warning. No fixed-rank fallback is introduced.

Use a distinct heading and amber indication for incomplete evidence: “Cannot confirm these players meet every filter.” Never include them in the confirmed match count. Missing-data mode does not bypass the Signals or Include injured selections.

## 4. Inputs and applying a search

Use numeric inputs rather than sliders as the authoritative controls. Surplus index bounds accept decimals from 0 through 100; games played accepts integers from 0 through 17. Other thresholds accept finite signed numbers, including zero and negative values. Empty inputs disable their individual conditions.

Validate the entire proposed query before applying it. Reject nonnumeric text, non-finite values, index bounds outside 0–100, fractional game counts, and index minimum greater than maximum. Display inline errors and a light red fill; retain entered text for correction. Never swap an inverted range, silently discard an active filter, or coerce blank text to zero.

Use **Apply filters** and **Reset screener** buttons. Editing controls shows an “Unapplied changes” indicator while results remain labeled with the last applied query. Apply updates the query, result counts, and saved state together. Enter within a numeric field applies a valid query. Disable Apply while invalid.

Reset restores the complete new-workspace screener defaults, including ownership, positions, signal selection, injury toggle, missing-data toggle, and sort. It preserves the saved team selector and all unrelated app filters, model settings, and trade selections.

Add one explicit convenience button, **Rising targets**. It applies: All player pool; RB / WR / TE; Gem candidate OR Opportunity watch; trend ≥+2; index 10–40; recent PPG ≥12; games ≥5; other thresholds blank; above-replacement off; injured/missing-data off; existing sort retained. Set All so owned trade targets are included. These are editable example search thresholds, not historically validated recommendations.

## 5. Results and explanations

Above results, show:

- Confirmed count and, when enabled, a separate incomplete-evidence count.
- A readable applied-query summary with units and OR/AND relationships.
- Removable chips for applied conditions. Removing a chip applies that change immediately and updates the draft controls; warn before discarding other unapplied edits.
- Source snapshot timestamp and existing stale-data warning. Applying filters does not refresh ESPN or the workbook.

Make the primary result columns: Player; Position; Ownership/team; Signal; Trend PPG with arrow; Recent PPG; Surplus index; Actual PPG; ESPN season PPG; Projection gap; Games played; Vs replacement PPG; Injury/data status; Matching evidence. Retain existing workload/share and Why flagged information in the table's additional columns or an expandable row.

Matching evidence explains the query independently of the existing gem-classification explanation. Example:

> Matches: Opportunity watch · trend +3.20 ≥ +2.00 · index 24.60 within 10–40 · recent 13.10 ≥ 12.00 · 6 games ≥ 5.

For incomplete rows, list missing active metrics by name: “Trend unavailable: not enough earlier games.” Show known passing evidence without claiming that all filters passed.

Preserve sortable columns. Apply thresholds before sorting and pagination; counts refer to the full eligible dataset. Start at the first result batch after applying or resetting a query. Retain current sort unless Reset is selected. Use PlayerID as a deterministic final tie-breaker; unknown numeric metrics sort last in both directions. Keep incomplete rows in their own section.

For zero matches, keep controls and the applied query visible. Explain “No players meet every active filter.” Offer explicit actions to remove individual thresholds or reset; do not automatically loosen criteria.

## 6. Layout and accessibility

On desktop, place existing ownership/position controls and the signal group above a compact numeric-filter grid. Put games played, projection gap, above replacement, and missing-data controls in an Advanced filters disclosure. Show an active-filter count on that disclosure so collapsed conditions remain discoverable. Keep Apply, Reset, applied-query summary, and result counts visible outside it.

On mobile, stack labeled controls, pair the two index bounds when space allows, and use horizontally scrollable result tables. Do not rely on placeholder text as labels. All controls, disclosures, chips, and multi-select checkboxes must work by keyboard; announce updated result counts politely after Apply.

Keep existing color conventions: recorded trend/recent/actual/game counts green; ESPN season PPG blue; surplus index, projection gaps, replacement differences, and signal classifications pink; editable controls purple with light yellow fills; unavailable values gray; explanations charcoal. Use fills/status text for uncertainty and errors. Numeric filtering must not turn model values green because they passed.

## 7. Persistence and compatibility

Save only applied queries through existing `Workspace.state.filters`, IndexedDB, and the current Supabase state-sync RPC. Unapplied edits stay component-local. Preserve account scoping, revision conflicts, offline use, and the existing explicit Sync now behavior; do not imply immediate background cloud synchronization.

Use string-valued keys to fit the existing client schema and server validator:

| Key | Stored representation |
| --- | --- |
| `gemFilterVersion` | `"1"` |
| `gemSignals` | JSON string containing a validated array of signal names |
| `gemTrendMin`, `gemIndexMin`, `gemIndexMax` | Canonical numeric string or empty string |
| `gemRecentMin`, `gemGamesMin`, `gemGapMin` | Canonical numeric string or empty string |
| `gemAboveReplacement`, `gemIncludeMissing` | `"true"` or `"false"` |

Retain `gemPool`, `gemTeam`, `gemPos`, `gemInjured`, `gemSort`, and `gemDirection`. Continue writing legacy `gemSignal` only as a compatibility hint: a single selected signal by name, All signals for every signal, otherwise Candidates and watches. New code treats valid `gemSignals` as authoritative; older app versions cannot fully represent custom multi-select queries.

For older workspaces, map legacy Candidates and watches to the current four default signals, All signals to all signals, and a recognized single signal to a one-item array. Absent or unknown legacy selection falls back to the current four defaults. New numeric thresholds remain blank. Do not reset existing ownership, injury, position, or sort selections.

Validate restored queries as well as form input. If new-format stored values are malformed or their version is unsupported, show a recoverable configuration warning and require correction or Reset before displaying query results. Do not silently broaden the search. If a saved selected team no longer exists after import, require a new team selection when that pool is active.

No Supabase table, RPC, credentials, or Trainwise changes are required: existing filters are a string-valued map. A newly imported dataset reuses the applied query and reevaluates all results against the new snapshot.

## 8. Implementation boundaries

- Add `src/domain/gem-screening.ts` for filter contracts, validation, legacy decoding, predicates, missing-evidence classification, and matching reasons. Keep predicates pure and testable; consume the existing `Player` outputs instead of reproducing the valuation model.
- Update `GemView` in `src/features/views.tsx` to render controls and results from that domain API. Use a separate component/module if its size becomes unwieldy.
- Extend shared table behavior only as needed for deterministic ties and resetting pagination, preserving other screens' behavior.
- Continue using the existing App state update path. Do not introduce a second cloud sync mechanism.
- Document the filters in README and preserve the distinction between gem evidence, surplus value, and lineup benefit.

## 9. Acceptance checks

Use synthetic fixtures and meaningful browser workflows. Keep private workbook evidence out of Git.

1. The example combined query includes both selected signal types and excludes players failing any numeric condition. Other signal types remain excluded even if their numbers pass.
2. Inclusive index and minimum-threshold boundaries pass at equality. Signed thresholds, zero values, blank bounds, and unrounded comparisons behave as defined.
3. Invalid/inverted input cannot change applied results; correction and Apply work. Reset affects only screener state. Removing a chip updates results and handles unapplied edits explicitly.
4. Known failures cannot enter the incomplete section. Missing active metrics appear only there when enabled; missing inactive metrics do not block a match.
5. A four-game promising player with no usable trend is excluded from a known trend query and can appear as incomplete if its selected signal and other known conditions qualify. Increasing `GemMinPriorGames` respects the model's new sample requirement.
6. Above-replacement filtering checks the PPG difference, handles zero/negative differences, and preserves thin/unavailable baseline warnings.
7. Applied filters and sort survive page navigation, reload, offline use, dataset replacement, and an actual authenticated sync to another browser/device. Account switching does not leak another account's filter state.
8. Existing legacy selections restore correctly. Malformed saved queries and missing selected teams require correction without silently broadening results.
9. Filtering precedes pagination; counts, first-batch reset, sort ties, and missing-value placement remain correct. No-results messages and keyboard/mobile workflows pass.
10. Existing valuation and gem outputs remain unchanged for the same dataset/settings. Run `npm run check`, `npm run build`, relevant browser workflows, and the existing model parity checks if calculation code changes beyond the new filtering module. Verify the final deployed Pages workflow before publishing implementation as complete.

## Completion definition

The user can build the example query without editing model settings, see why each player matched, distinguish incomplete evidence, and restore the same applied search locally and through existing account synchronization. This specification does not itself implement or publish those app changes.
