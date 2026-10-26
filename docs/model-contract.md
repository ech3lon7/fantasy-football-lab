# Model contract

## Opportunity evidence update October 2026

The imported dataset keeps modelVersion `v5.2-port-1` as its source-workbook contract. Runtime analysis adds `opportunity-1`. The importer and `verify-excel.ts` evaluate explicit workbook mode to validate original cached values; ordinary app analysis uses the corrected evidence below. This intentionally changes workload, regression and gem outputs relative to older Excel caches.

- Carries, targets, receptions, touchdown counts and shares use verified completed-game history, matching actual PPG's scoring window. Aligned season totals are a fallback only when weekly fields are absent and their game counts match. Missing teammate counts make team shares unavailable. Explicit absent counting stats in verified ESPN records are zero; absent fields are unknown.
- Role-growth watch compares the latest three played games with the configured minimum earlier games. Default criteria require at least two extra opportunities per game, at least 20% growth and the position's recent workload threshold. QB trends use rushing attempts; passing attempts can be supplied separately. Scoring breakout watch identifies rising recent scoring above the season forecast without requiring season-long outperformance. Signals coexist with TD caution and legacy classifications.
- New screener fields cover recent carries, recent targets, role growth and optional route participation. The former default four-signal bundle gains the new watch types. Explicit narrower saved selections remain unchanged.
- Experimental next-game role forecasts fit separate RB carries/targets coefficients or receiving-target coefficients. Walk-forward holdouts train only on earlier scoring weeks; at least 30 training examples are required per fit. These exploratory checks do not validate archived ESPN forecasts, current consistency settings, or future seasons. Singular or negative-opportunity fits remain unavailable.
- A synced role-scenario weight defaults to zero. Positive weights blend the original forecast with the role forecast once, where both exist, before consistency, replacement baselines, VORP and trade evaluation. The UI and trade uncertainty explicitly identify active scenarios. There is no separate opportunity bonus to the index.
- Supplemental CSV rows require known PlayerID, Week, Source and AsOfUTC. Completed player-week fields can supply snaps, routes, passing attempts, target/air-yard shares, goal-line carries, red-zone targets and externally calculated league-scored usage xFP. Usage xFP, FPOE and WOPR require coverage of the same recent played-game window. They are distinct from the blended forecast and simple xTD estimate.
- Current market references require redraft/one-QB/full-PPR format, overall ROS ranks or provider trade values, and source timestamps. Trade comparisons require a complete common source and reject references older than 24 hours. Provider units never combine with surplus units or draft ADP.
- ReturnWeek is an explicit user-selected conditional availability scenario. It updates available games and weekly lineups consistently; no return date is inferred. Unknown-return normal/downside scenarios remain visible.
- Optional evidence is tied to one dataset hash and ignored with an explanation after a different import. It occupies a bounded string in existing account-scoped state filters, preserving the cloud schema and Trainwise objects. CSV bytes are not retained. Evidence replaces the current set rather than creating an archive.

Adapter: V5.2. Model: v5.2-port-1. See `workbook-profile.json` for allowlisted table columns and settings cells. Header and table signatures identify the workbook; filenames do not.

The domain engine owns adaptive values, replacement pools, VORP, linear index, offensive ranks, ADP comparisons, workload/regression, gems, trends, legal lineups, position assessment and trade scenarios. UI components display these results and do not duplicate the formulas.

## Recorded values and projections

Use league-scored completed played games, including zero, negative and injury-shortened scores. Preserve nonparticipation/byes separately. Reconcile prepared actual aggregates with verified history. Invalid history makes the affected player unavailable. Season ESPN projected PPG is independent of current-week ESPN points; zero projections with no supporting game/point records remain unavailable.

## Adaptive values

Observed PPG uses the imported recent weight. Actual weight is games/(games+prior games). Expected PPG blends observed scoring with usable season projected PPG. Consistency loss is capped, uses sample SD and applies only after the configured minimum games with positive Expected PPG. Value PPG subtracts the loss. No history uses usable projections; missing projections require at least four actual games for observed-only value.

## Replacements and surplus

Average the top three usable active free agents at each position, excluding unusable history and players without remaining games. Sort Value PPG descending and PlayerID numerically ascending. One/two players make the baseline conditional; none makes it unavailable. Current byes do not remove season candidates.

VORP = (Value PPG − baseline) × available remaining games. Preserve negative VORP. Index = 100 × positive VORP / maximum positive VORP; missing remains null, while usable values with no positive peak return zero. Keep real-snapshot baselines fixed across hypothetical trades.

## Lineups, trades and tie rules

Port the supported workbook’s QB/RB/WR/TE, FLEX, K and D/ST selection order. Select by Value PPG descending and numeric PlayerID ascending. IR assignment preserves the imported rules and existing eligible IR slots. Confirmed current absences and byes are excluded; downside scenarios exclude all uncertain players.

Drop candidates must be droppable and reduce the current roster conflict. Minimize horizon lineup-value loss; ties use lower surplus index then PlayerID. Fill candidates maximize incremental horizon value; ties use higher surplus index then PlayerID. Recompute after each selection and preserve team processing order. Display dropped IDs in the source roster order, matching Excel’s output.

Grades compare incoming and outgoing Positive VORP without premiums. Package requirements separately apply the premium once for unequal sizes. Drop replacement costs belong only to the fantasy-points requirement. Trade-only, waiver-only and combined lineup results remain distinct. Legacy coverage Expected scoring uses the same starters chosen by Value PPG.

Trade discovery distinguishes marked-starter impact from roster potential. Marked starters retain their assigned roles: an existing reserve may fill only a departing starter's role, and incoming players may improve distinct roles. Surviving starters cannot receive unrelated reserve upgrades. A bench-only departure has zero direct impact. Roster potential independently selects full-roster lineups by Expected PPG both before and after the trade, using identical schedules, availability, IR rules and required drops; speculative waiver additions are excluded. Value PPG is reported for those same Expected-PPG lineups. Search and saved current summaries use roster-potential gain for both teams for filters and ranking, while exposing marked-starter impact and named weekly changes separately. Primary weekly gain is the total expected gain divided by every remaining fantasy week, including bye weeks, rather than a player’s PPG. The impact version is `roster-potential-primary-2`; older original summaries retain their original method. Saved current results recalculate; original summaries retain their scoring-method version. Legacy Value-PPG coverage calculations remain unchanged.

Position grades compare modeled starter value per slot against the imported fantasy-league median. Grade bands and the reserve cutoff are imported settings. FLEX is assigned before useful reserves; depth never boosts the starter grade.

## Provenance and states

Null means unavailable; zero stays numeric. Sources, import timestamps and synchronization timestamps are separate. A source older than 24 hours is stale. Results are keyed by dataset content hash, settings and model version. Weights, replacement pools, premiums, grade bands and gem thresholds are provisional assumptions.


## Historical player-label evidence

`label-rules.ts` owns the current label-policy constants and effective setting metadata. Gem remains `automatic-breakout-3`, registry `label-rules-1`. The compatibility `defaultGemRules` export is the same shared object: positional means feed both Gem and Watch. Existing custom settings retain their original bindings; they do not replace primary Gem/Watch means. No Gem, Watch, forecast, value or trade predicate changes in this release.

`historical-label-reference.json` contains aggregate-only 2023–2025 references for the historical nine-team modeled starter-quality cohort, sampled after Weeks 4, 8 and 12. Each metric counts only its contributing observations, distinct players and player-seasons. Recent means require three played games; preceding-window and all-earlier growth references require at least two earlier games. QB target references and mismatched individual-game/cumulative comparisons are omitted. Quantiles use linear interpolation; repeated players are correlated. These descriptive references never supply classification thresholds.

Active Why sections preserve the Required / Actual evidence / Margin / Result comparisons, scores and weeks. Compatible historical context appears in the existing evidence cell, with the existing 700 ms hover-only help. Historical PPG context is withheld unless observed offensive scoring weights match; unknown scoring bonuses remain disclosed. Workload context explicitly identifies its historical scoring/roster cohort, rather than implying an average of the current fantasy rosters.

Model & audit > Player-label evidence separates first-alert discoveries from repeated weekly labels. Current Gem had 96 successes / 154 first alerts (62.3%, matched base 14.8%, lift 4.22x) and 323 / 494 weekly labels (65.4%, matched base 14.6%, lift 4.48x). Decision weeks are 1–14 in 2023–2025. Success means future PPG entering a modeled nine-team starter pool over the next three calendar weeks, with at least two appearances; insufficient follow-up remains a failure. Baselines match each label's position/season/date distribution and minimum played-game eligibility. First-alert and weekly base rates are not interchangeable. Volume is 11.76 repeated Gem labels per season-week across 42 season-weeks, or 14.97 across the 33 Weeks 4–14 season-weeks where four-game qualification is possible. These rates are retrospective method results, not individual probabilities, acquisition success or untouched holdout performance. TE tuning was underpowered.

`label-evidence-binding.ts` binds classifier/registry/reference versions, source fingerprint, native research replay hash and deployed aggregate hash. Tests reject drift. Calibration is withheld if the active shared policy differs from its recorded configuration. Custom setting applicability is shown in the effective-rule inventory. The workbook model version remains unchanged.

Fixed policy parameters change only after an explicitly reviewed recalibration with new usable outcomes and a frozen comparison protocol. Existing percentile and TD-rate distribution values still update with each snapshot. A date alone cannot change thresholds. The stricter WR Watch filter and new rarity/composite rules remain deferred; no manual labeling or new scoring bonus is introduced. Raw historical extracts and research scripts remain outside deployment and Git.

## Prospective Gem comparisons

The mandatory individual-game workload-support floor remains provisional. In the combined-rule 2023–2025 study, removing only this gate changed zero of the 494 weekly labels / 154 first alerts. This is historical redundancy under the other current gates, not proof the floor is optimal or can never matter. The live scoring, mean workload, support predicates, Watch rules, valuation and trade calculations are unchanged. Why Gem and the rule inventory identify this limitation without replacing the original numbers or weeks.

`gem-tracking.ts` automatically observes the first fresh current-season snapshot per completed decision week (1–14, with a full three-week horizon before the fantasy cutoff). Source age must be at most 24 hours, source/import dates cannot be implausibly future-dated, and prior weeks are never backfilled. An observation records its source hash/time, capture time, frozen rules, eligible player IDs/positions, and a five-method classification bitmask. Population: RB/WR/TE, at least four verified played games, complete counting-stat evidence for the latest four games, ACTIVE status, no unresolved availability and remaining games. Eligible non-labels are included for coverage measurement. Current classifications come from the live model; shadow classifications never feed tags, forecasts, values, filters or trades.

The frozen research alternatives use the following tuples in **each** overlapping three-game window: workload mean / individual-game workload floor / number meeting that floor; scoring mean / individual-game scoring floor / number meeting that floor. RB workload is carries plus targets; WR/TE workload is targets. These were frozen in the prior 2023 selection exercise; they are trial definitions, not newly validated recommended thresholds.

| Trial | RB | WR | TE |
| --- | --- | --- | --- |
| Confidence | 18 / 16 / 3; 16 / 16 / 2 | 6 / 5 / 2; 14 / 14 / 3 | 4 / 4 / 2; 12 / 12 / 2 |
| Rarity | 22 / 12 / 3; 14 / 14 / 2 | 7 / 5 / 2; 18 / 14 / 3 | 7 / 7 / 2; 11 / 12 / 2 |
| Coverage | 16 / 14 / 3; 16 / 16 / 2 | 6 / 5 / 2; 16 / 16 / 2 | 4 / 4 / 2; 12 / 10 / 2 |

The fifth method retains all current gates except individual-game workload support. Both overlapping windows, mean-workload and scoring gates remain mandatory. No rule is automatically promoted or tuned.

Later imports resolve three-/five-calendar-week outcomes only after the entire horizon completes, using a source dated after capture and complete verified offensive history. Success is future actual PPG in the captured league's positional starter pool plus FLEX, with at least two/three played games respectively. Rank PPG descending, numeric PlayerID ascending; fill QB/RB/WR/TE slots before FLEX. Byes/nonparticipation are excluded from played averages; zero and negative played scores remain included. Verified insufficient participation fails. Missing players or incomplete ranking-pool history leave the outcome pending, never an invented failure. The first verified outcome is frozen with its own source hash/time and recording date; subsequent source corrections do not rewrite it. Five-week horizons beyond the fantasy cutoff are unavailable, not shortened.

Model & audit > Prospective Gem tracking reports first-recorded and repeated-week accuracy, pending counts, labels per recorded eligible week, and productive player-weeks missed (including those labelled by Current Gem). First-recorded means since observation began, not the season's first historical qualification. Unrecorded weeks are excluded from volume denominators; correlated repeated weeks are not independent samples. Seasons, team identities, scoring/roster formats and rule definitions are separate cohorts. Team renaming can split cohorts because the adapter has no guaranteed league ID.

The private journal occupies a separate account-scoped IndexedDB `current` key (`gem-tracking:<owner>`), bounded to 10 MiB / 100 cohorts. It is **browser-local**, not placed in the 64 KB cloud-state payload; it stores no XLSX copies. Minimal ranking-pool IDs and as-of game counts also guard against later missing players or lost history masquerading as failures. Re-importing an earlier scoring period cannot append historical labels or change the meaning of first-recorded. Existing sign-out/clear-account removal deletes the journal with that account's workspace. Corrupt or unsupported journals and capacity failures preserve existing bytes and show a nonblocking audit notice. Workspace saves and tracking writes share the existing queue; delayed work verifies the current saved owner/dataset before writing. Background completion is observed only inside the audit panel and does not rerender active screens elsewhere. Other account records are isolated. No Supabase schema, sync contract, service worker or deployment change is part of this feature.

## Hypothetical rosters and search diagnostics

`roster-scenarios.ts` applies ordered ownership moves, cuts and starter choices after the real snapshot has been valued. It does not recalculate forecasts, indices, replacement pools, label research or the prospective journal from hypothetical ownership. Trade workers receive the real dataset plus the recipe; each saved trade carries an independent recipe copy. Refreshing imports updates real values and replays the moves, flagging unknown players, changed ownership, season conflicts, undroppable cuts and unresolved roster limits as conditional. Already completed moves are idempotent. The simulator shows live and simulated average weekly optimized scoring, plus their difference, for the team being edited. No hypothetical move is sent to ESPN.

Up to ten named scenarios and one hundred moves per scenario use existing account-scoped settings sync within the existing 64 KB total state budget. Undo/redo changes an applied-step cursor; a new move truncates its redo branch. Returning to live mode does not delete saved scenarios. My Team is explicitly selected and remembered independently of browsing opponents; it also controls the analyzer’s outgoing side.

Pool index ranges are exact raw min/max sums for every allowed outgoing count, before premiums or search filters; gaps inside these intervals are possible. A single-candidate diagnostic checks the manually selected offer against current ownership, package counts, index range, target, position/signals, deficit, positional upgrades, usefulness, protected drops and weekly-gain constraints. Pricing-test failures alone do not exclude index matches. The local debug download separates edited controls from the last applied query and includes analysis/source metadata, modeled rosters and values, never authentication/session state or raw weekly history. Full searches remain exhaustive and paginated.


The roster simulator presents live and hypothetical player-card boards for the same selected week. Best available uses the existing Expected-PPG optimizer; Marked starters shows the saved role assignments even during a bye or confirmed absence; cards retain availability warnings while the existing scoring engine gives unavailable players zero for that week. Editing another card retains those assignments. The remaining-season summary always optimizes each week independently. Slot replacement leaves the displaced player on the roster, optionally transfers the incoming player, and records explicit starter choices. Manual input and detailed starter tables remain available in collapsed sections; mobile tabs retain full-size cards. Public player portraits have an icon fallback and never supply calculation data.

Flexible-search scope now displays effective outgoing counts separately from the incoming count/range. An outgoing pool does not enable incoming packages. Zero qualified rows show how many index candidates were evaluated and rejected by weekly limits; the existing filters and scoring algorithms remain unchanged.


## Guided trade discovery and explicit recovery

New search sessions use automatic index matching and allow 1–3 incoming players. Automatic means no hidden summed-index interval; existing surplus/points tests, valuations, roster legality, protections and availability rules are unchanged. Strict below/above offsets remain optional in Advanced search controls. Saved queries without an index mode retain strict matching.

The goal selector offers exploration, weekly scoring improvement, a position upgrade, and custom controls. Explicit presets retain offered/protected players and any required incoming target, reset other screening restrictions, and allow singles through triples. Improvement requires your optimized remaining-season average weekly gain ≥ +1 and theirs ≥ 0; these are adjustable discovery defaults, not validated acceptance thresholds. A position goal additionally requires an incoming player at that position and a positive change in that position's contribution to the same optimized weekly lineups, including FLEX appearances. Ranking does not imply fairness or acceptance.

After zero exact results, a cancellable worker evaluates named recovery changes: your minimum down to +1, their minimum down to 0, automatic index matching, 1–3 incoming sizes (retaining a larger selected maximum), and their combination where applicable. Targets, player labels/positions, opponent fit/deficit criteria and protected players stay enforced. Exact preview counts use the complete authoritative evaluator and current source/scenario/settings; zero-count changes are omitted. Counts include the same flagged conditional/legality cases as a normal search, rather than promising acceptable trades. No change takes effect until clicked, which restores the proposed controls and starts a new search. Editing inputs invalidates the previews; cancellation terminates their worker.


Manual roster-card edits store an optional ordered `assignments` vector in the lineup recipe and saved starter plan, following the existing QB/RB/WR/TE/FLEX/K/DST slot order. Card placement and marked-starter scoring use that exact template, including deliberate vacancies; PPG changes never reorder it. Moving an existing starter clears its original slot, benches the displaced occupant, and preserves every unrelated slot. IR restrictions control hypothetical scoring, not placement; known bye weeks and temporary injury absences are ignored. Undo/redo, save/reload and saved scenario copies retain the vector. Older plans without assignments preserve their previous behavior; explicit Optimize/Reset may create a new automatically assigned plan. Best available remains independently optimized.


## Hypothetical roster-potential scoring

Every active roster scenario sets analysis-only `ignoreByeWeeks` and `ignoreTemporaryAbsences` policies before moves are replayed. Known byes, temporary OUT/questionable/doubtful absences and their return-week/downside scenarios do not reduce hypothetical lineup scoring. Players actually assigned to IR (slot 21), or carrying IR/INJURY_RESERVE status, remain excluded throughout the horizon. Temporary OUT alone does not assign a player to modeled IR. Missing schedules and non-temporary restrictions such as suspension remain enforced. Live models retain their scheduled availability. No player EPPG, Value PPG, VORP, index, replacement pool, recorded schedule or available-game count is rewritten.

Both hypothetical roster boards, Optimize, marked-starter scoring, trade evaluation, search filters/rankings, recovery previews, saved-scenario recalculation and both fantasy teams' before/after lineup totals share that policy. The live-roster side of a simulator comparison uses the same bye-free basis, preventing a free gain from opening an unchanged scenario. Hypothetical scoring averages the remaining weeks under this stated assumption; it is not a calendar-accurate weekly forecast. Recorded injury labels and uncertainty warnings stay visible separately; eligibility is a roster-potential assumption, not a predicted return date. The hypothetical overview and Best available boards/trades optimize by Expected PPG; marked-starter comparisons retain the saved lineup. Price-test formulas retain their imported remaining-game inputs independently of lineup gain.

The hypothetical analysis version includes `hypothetical-potential-2`, invalidating old search contexts; debug exports and visible lineup source labels identify the policy. Returning to live restores scheduled-week calculations without changing any source data. Manual slot assignments remain pinned.


## Completed hypothetical trades

Trade Analyzer can apply its selected 1–5 players per side as a completed hypothetical exchange, including a draft loaded from search results. It appends one `trade` recipe step to the active scenario, or creates a new scenario when live mode is active. Both sides must be distinct fantasy teams with currently owned, distinct player selections. Price tests, player value availability and lineup verdicts do not gate the forced move. No ESPN transaction occurs.

Replay validates the whole exchange before changing either owner. All arrivals move to the simulated bench; departed players are cleared from their old starter slots while unrelated manual placements and vacancies remain pinned. Both rosters and all future dropdowns, candidate pools, trade-search workers and saved-scenario copies use the resulting ownership. Undo/redo reverses/restores the exchange as one step. The consumed analyzer draft clears; unselected pool players remain protected. No automatic drops, waiver fills or invented acceptance occur. Roster conflicts remain visible and conditional.

A refreshed snapshot that fully reflects the exchange is idempotent. Partial/conflicting ownership skips the entire exchange with an explicit warning, preserving the refreshed source ownership rather than applying half a simulated trade. Original source tables, historical evidence, values, replacement pools and the existing hypothetical bye policy remain intact.


## Explicit trade lineup scoring basis

`tradeLineupBasis` is an account-scoped analysis preference: `best-available` (default) or `marked-starters`. One choice drives both teams' primary analyzer totals, search weekly limits, ranking, position-scoring goals, detailed replacements, candidate diagnostics and saved summaries. The shared `tradeImpact` domain helper selects the existing optimized or direct outputs; player valuations, replacement pools, price tests, roster repair and availability rules do not change.

Each primary result carries its basis plus both teams' average Before and After Expected points/week, gain/week and the same remaining-week horizon. Missing required weekly scoring invalidates the full average, rather than being removed or converted to zero. The alternative basis is explicitly secondary and retains its own before/after baseline. It cannot be added to the primary Before value.

Switching basis invalidates running/completed search results and requires an explicit new search. Context identity includes the scoring interpretation version and basis, so old worker pages/details/recovery responses cannot supply the new selection's numbers. Guided presets and Clear filters preserve the shared preference. Restoring a saved trade restores its recorded basis; current saved evaluations use that saved basis independently of the active screen preference.

Optional basis and before/after metadata preserve old saved records. Old queries lacking a basis retain optimized-search semantics. Original summaries remain immutable; only known historical calculation versions identify an omitted original basis, while unknown legacy originals are labeled unspecified. Incompatible original/current bases carry a notice. Debug exports preserve the previous availability field and add separate lineup-basis/availability metadata and selected/alternative candidate scoring.
