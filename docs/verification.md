# Verification report

## Opportunity evidence update October 20 2026

- Domain/database/sync tests cover completed-game workload alignment, independent signals, same-window usage xFP/FPOE, market format and freshness, conditional return weeks, chronological role calibration, and opt-in forecast propagation.
- Nine browser workflows passed with the production Pages path, including source CSV import, reload persistence, mobile layout, scenario controls, the real workbook import and all existing screener regressions.
- 29,456 original native-Excel comparisons passed in explicit workbook mode, and the latest supplied XLSX passed import validation. 870 existing team/trade comparisons also passed under ordinary app analysis with role scenario weight zero.
- An isolated browser using the supplied snapshot verified both role-growth and scoring-breakout labels for the previously disputed RB, successful RB role screening, and an actual forecast change when the role scenario was enabled. No browser errors were observed. Private screenshots remain ignored.
- No original forecast or Value PPG changed at scenario weight zero in the inspected latest snapshot. Workload, xTD/regression and gem evidence intentionally use the corrected period and additional signals.
- Exploratory current-snapshot role checks are not historical validation of the ESPN blend. Advanced usage and market fields require source data; unavailable values remain explicit. Supplemental state uses existing fantasy-only sync contracts and no database migration.

October 14, 2026 · Application 0.1.0 · Model v5.2-port-1

## Completed locally

- TypeScript compilation, ESLint, production build and publication-file scan passed.
- 32 automated domain/database/sync tests passed, including grade boundaries, invalid settings, actual-only fallback, negative/zero scores, consistency, replacement eligibility, trend denominator zero, normalized-index independence, canonical hashing, account isolation, RPC-only writes, revision conflicts, retries, deletion, server payload validation, invalid completed-game records, shared-project session isolation, and preservation of existing fitness objects.
- 29,456 comparisons against saved native Excel results passed across 1,052 players. These cover actual/recent/projected/expected PPG, consistency loss, Value PPG, baselines, VORP, linear indices, ranks, ADP edge, workload/regression, gems and trends.
- Real V5.2 XLSX import passed source validation and cached-result comparison.
- 870 additional comparisons passed across all nine fantasy teams’ position grades and 25 native Excel trade cases covering every package size from one to five on either side. Legal rosters, drop/add IDs, surplus requirements, points requirements, expected/value gains, waiver gains and downside totals matched.
- Slowest observed trade evaluation in that 25-case run: approximately 112 ms on the development desktop. This is a local measurement, not a universal performance guarantee.
- Three browser workflows passed against the production build using the actual GitHub Pages base path: desktop/mobile onboarding, rejection of administrative cloud keys, and real workbook import → local persistence → required screens → trade evaluation → offline reload.
- Browser workflow recorded no workbook POST requests. Original workbook bytes are parsed in a worker and are not stored in IndexedDB or sent to a service. Only extracted data becomes the current workspace.
- Desktop and mobile screenshots were inspected. Mobile navigation is collapsed by default, and wide data tables scroll within their panels.

Private source snapshots, native Excel fixtures, extracted datasets and screenshots are ignored by Git. Synthetic tests are the only data fixtures committed to the repository.

## Deployment and cloud checks

GitHub Actions repeats source checks, synthetic tests, a production build and browser smoke tests before publishing Pages. Private workbook/native parity checks run locally and are intentionally not uploaded to CI.

The fantasy migration is installed in Trainwise's existing Supabase project. Hosted PostgreSQL checks verified initialization, dataset/state writes, retries, revision conflicts, direct-write denial, and account isolation, rolling back synthetic changes. Before/after fingerprints confirmed Trainwise records, policies, permissions, and its sync function were unchanged. The public key reaches Auth settings and anonymous fantasy RPC access is denied. Repository build variables configure the existing project. See [shared-project deployment](shared-supabase.md) for remaining auth-redirect and real-account, cross-device acceptance checks. Project-specific backup/quotas have not been audited.

Full WCAG conformance and the larger 2,000-player/40,000-history-row performance targets require separate measured acceptance runs. Keyboard selectors, labeled inputs, text alternatives and responsive layouts are implemented, but these checks are not presented as a completed certification.

## Model limitations

The app ports the workbook’s provisional assumptions. Matching Excel establishes calculation parity for the inspected snapshot and tested cases; it does not establish predictive accuracy, current market prices, claim success or historical validation of weights, replacement pools, premiums, grades or gem thresholds.
