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

Grades compare incoming and outgoing Positive VORP without premiums. Package requirements separately apply the premium once for unequal sizes. Drop replacement costs belong only to the fantasy-points requirement. Trade-only, waiver-only and combined lineup results remain distinct. Expected scoring uses the same starters chosen by Value PPG.

Position grades compare modeled starter value per slot against the imported fantasy-league median. Grade bands and the reserve cutoff are imported settings. FLEX is assigned before useful reserves; depth never boosts the starter grade.

## Provenance and states

Null means unavailable; zero stays numeric. Sources, import timestamps and synchronization timestamps are separate. A source older than 24 hours is stale. Results are keyed by dataset content hash, settings and model version. Weights, replacement pools, premiums, grade bands and gem thresholds are provisional assumptions.
