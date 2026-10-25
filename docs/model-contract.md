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

Trade discovery distinguishes marked-starter impact from roster potential. Marked starters retain their assigned roles: an existing reserve may fill only a departing starter's role, and incoming players may improve distinct roles. Surviving starters cannot receive unrelated reserve upgrades. A bench-only departure has zero direct impact. Roster potential independently selects full-roster lineups by Expected PPG both before and after the trade, using identical schedules, availability, IR rules and required drops; speculative waiver additions are excluded. Value PPG is reported for those same Expected-PPG lineups. Search uses your marked-starter gain and their roster-potential gain for filters and ranking, while exposing both measurements and named weekly changes for both teams. Saved current results recalculate; original summaries retain their scoring-method version. Legacy Value-PPG coverage calculations remain unchanged.

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
