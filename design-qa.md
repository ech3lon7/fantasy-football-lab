# Trade search visual QA — 2026-11-02

final result: passed

## Scope and visual truth

Approved visual: `C:/Users/israe/.codex/generated_images/01a18526-81b2-72e0-bdf6-2905f3f411d9/exec-67201ebc-13c0-434d-9f5b-b5d485cf3fbe.png`.

Local implementation: `http://127.0.0.1:4187/#/trades`.

Evidence folder: `C:/Users/israe/Documents/Codex/2026-10-08/se/outputs/trade-search-ui-2026-11-02/`.

- Implementation screenshots: `trade-desktop.png`, `chain-desktop.png`, `trade-mobile.png`.
- Full-view comparison: `comparison-full.png` (approved concept and implementation together).
- Focused comparison: `comparison-needs.png`.
- Mobile detail: `mobile-card-review.png`.

The reference and desktop implementation are both 1536 × 1024 at 1 CSS pixel per image pixel. Mobile uses 390 × 844 CSS pixels with a full-page capture. Comparisons use natural dimensions with no stretched typography. The concept uses illustrative players/grades; the implementation reads the private saved workbook. The application navigation, valid-trade score strip, imported roster rules and existing selection controls remain functional rather than being replaced with fictional mock data.

## Findings and iteration history

1. P2 — Repeated selection controls and unavailable score totals pushed the lineup field too far down. Reduced selected-card chrome and pool-card spacing; incomplete offers now show one compact prompt. Complete trades retain the same authoritative before/after scores.
2. P2 — The previous side-drawer width calculation would unnecessarily narrow inspected trade details. Restored their normal readable width for the new stacked layout.
3. P1 — The previous phone-grid coordinates conflicted with desktop card compaction, putting names and EPPG inside the portrait column. Reset the phone grid coordinates and added a browser assertion that the name and forecast do not overlap. The refreshed mobile capture shows readable cards and loaded portraits.
4. P2 — Disabling deficit targeting could lose the remembered child protection state on reload. Persist the dormant toggle/minimum separately from the effective disabled query; the browser workflow checks an actual parent-off reload.

Post-fix screenshots and the focused production-build workflow were reviewed. No actionable P0/P1/P2 issue remains in the changed controls.

## Fidelity surfaces

- Typography: retained the existing DM Sans/Manrope families and application type hierarchy; compact controls and long names wrap without horizontal overflow. Source illustration values are not copied into forecasts.
- Layout: four expandable task groups; position grades and a miniature roster preview; deficit targeting and its dependent protection are adjacent. A single grade threshold controls both. Existing player photos and lineup field remain on the left. Each chain leg has independently expandable package/value controls.
- Colors: existing forest, sage, ivory, purple-input and pink-model tokens; restrained weak-grade tint; explicit grade letters and checkbox states accompany color.
- Assets: existing ESPN headshot source, existing football-field image and existing icon library. No new asset downloads, substitute player art or dependency changes.
- Copy: one grade threshold, a separate minimum positional gain, concise visible labels and complete marker-free hover help. Fixed offers use “Not offered”; active flexible pools use “Protected”, matching their different drop-protection semantics.
- Interaction: drag from player-card grips or use the native Move selector; position chips support selection/drag with native incoming checkboxes. Active-filter chips remain removable. Header search shortcuts invoke the same worker actions. Escape, keyboard/touch alternatives and reduced motion retain support.

## Verification

- Full local release gate passed: TypeScript, lint, 318 unit tests, publication scan, GitHub Pages build, 84 browser workflows; one existing private-workbook browser case skipped without its opt-in path.
- Final mobile-only CSS correction: checks rerun, Pages artifact rebuilt, and the compact-search/persistence/native-drag/mobile-overlap workflow passed against that production artifact.
- Native grip dragging passed three consecutive focused runs.
- Real workbook imported through the production adapter with cached calculation parity checks. Desktop, chain and mobile rendering produced no page errors or horizontal overflow.
- No domain valuation or worker calculation changes, dependency changes, version changes, commits, pushes or deployments.

## Intentional adaptations and follow-up polish

- Actual starter counts and editable native player selectors are retained; larger rosters and expanded advanced controls can require internal scrolling. Persistent search actions and removable chips stay reachable.
- The illustration’s placeholder comparison and “Save search” action are represented by real roster previews and the existing automatic search-setting persistence, not fabricated forecasts or a new persistence system.
- P3: a single-position preview could be made more horizontal in a future visual iteration. This does not obstruct a control or hide player data.

## Completion checklist

- [x] Preserve the left player-photo/EPPG experience.
- [x] Group search options into Players & packages, Team needs, Value & acceptance, Scoring impact.
- [x] Link protection to enabled deficit targeting using one grade threshold.
- [x] Keep each finder and chain leg independent.
- [x] Preserve saved choices, search math, save/load and existing value/legality distinctions.
- [x] Verify desktop/mobile interactions, photos, typography, overflow, motion and production-path loading.
