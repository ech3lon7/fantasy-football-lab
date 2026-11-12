# Gameday Plus — Design Fidelity Plan

> **For agentic workers:** v1.0.8 has the right screens and functions, but it does not look or move like the agreed design. This plan closes that gap. Work section by section; each section ends with `npm run check`, `npm run build`, the browser specs it names, and **side-by-side screenshots** (design reference beside the build, light and dark) for the owner to approve before the next section. Run browser specs as the project memory note says (`GITHUB_ACTIONS=true npm run build`, then `CI=true GITHUB_ACTIONS=true RELEASE_VERIFY=true APP_URL=http://127.0.0.1:4173/fantasy-football-lab/ npx playwright test`). Each section is a minor (npm patch) release.

## The design reference is now in the repository

Earlier plans said "you may not be able to open the canvas". You no longer need to. The agreed design's source is in **`docs/design/gameday-plus/`**:

| File | What it is |
| --- | --- |
| `D_GamedayPlus.dc.html` | Desktop design (board 6), every screen, with all CSS in its `<style>` block and the view logic in its `<script>` block |
| `E_Phone.dc.html`, `F_Phone2.dc.html` | Phone screens 1–17 (boards 7 and 8) |

These are canvas files (they need the canvas runtime to run), but the **CSS and markup are plain** and are the specification for look and motion. Port the rules, class by class, onto the theme tokens. Line numbers below refer to `D_GamedayPlus.dc.html`. The data in them is synthetic. Where the design's numbers or formulas differ from the domain code, the domain code wins; where its **look, layout or motion** differs from the build, the design wins.

**Rule for this plan:** before marking a task done, open the matching part of the design file and compare. "It has the same information" is not done; "it looks and moves like the design" is.

---

## Findings (audit of v1.0.8, commit `30bcffb`, synthetic fixture, 1440×1000)

| # | What the owner noticed | What the build does | What the design does |
| --- | --- | --- | --- |
| 1 | Little or no animation | On Roster, League and Trade room the only running animation after navigating is the signals ticker (2 animations). No screen wipe, no card entrance, no bars rising, no chart reveal, no verdict sequence. | Screen wipe (`.wipe`, line 301), headline slide-in, bars grow (`.rise`, 304), lines reveal (`.draw`, 305), callouts pop (`.popin`, 306), cards rise in (`.pc`, `.move`, 317), verdict rows slide in one after another (`.srow`, 315–316), lineup slots and grade cards rise in (230). |
| 2 | Player cards not showing the charts | The moving-average chart renders as **solid black shapes**: its SVG classes lost their styles when `styles.css` was deleted (`components.css` restores the header, legend and badge, not the plot). Week labels are invisible in light mode. The Story tab is 1,814px tall: a long text-heavy scenarios panel comes first, so the charts sit below the fold. | Chart line, area, points, volume and average styles at lines 198–204 and 252; interactive hover tip. Story tab is two columns: scenarios panel and story bullets beside the radar and the moving-average chart, all visible without scrolling at 1040px. |
| 3 | Surplus index | Plain text "Surplus 18". | A labelled pink meter bar under the stats (`.meter`, 93–94) on scouting cards, and Surplus as one of the three big header numbers on the player card. |
| 4 | The big team code behind the name ("HAR") | Not present. A small circle with initials ("S1") sits where the design has the watermark. | Large faded team code in the card header (`.pc .wm`, line 83) on scouting cards, and a huge faded position or team code behind the player card hero (`.hero .big`, line 101). |
| 5 | Colour-coded labels | Every label chip is the same neutral dark chip. | Positive labels green (`.lab-pos`, 91), warning labels amber (`.lab-warn`, 92) — Reduced workload, BUY LOW, SELL HIGH, TD caution are warnings. |
| 6 | The charts in the card's Story tab | Present but stacked after long text; moving-average chart broken (see 2). | Story layout: numbered plain-language bullets (`.story`, 113–115) beside the radar (`.rp`, 109) and the moving-average chart with hover values, plus the scenarios panel compact at the top. |
| 7 | "What would flip it" | On an earned label (Watch) the panel shows checks and the chart but **no "What could undo it" card**. The near-miss card was not visible in the earned view. | Every label view ends with a dashed card (`.flip`, 130): "What could undo it" for earned labels, "What would flip it" for near misses, in plain words. |
| 8 | Clicking a missed label for its details, with colour | Label tabs are plain outlined buttons; near misses are explained only by the line "Dashed labels are near misses". | Label tabs are pills coloured by state (green ✓ earned, amber ◌ near miss); selecting one shows that label's verdict, checks with margin chips coloured spare / at the line / short (`.mg-*`), meters, chart, and the flip or undo card. |

Also seen:

- **Why panel meters** are a thin line and a hollow circle that barely show in dark mode; the design uses a filled bar with a threshold mark (`.gm`, design lines ~125–128).
- **Scouting cards** lack the sparkline (`.spark`, 95–96) and the large Value/EPPG with Recent beside it (`.statrow`).
- **Card header** shows "S1"/"S2" initials circles for the synthetic players; the design's hero has the photo, the name in huge condensed type and the faded code behind it.

---

## Section A · Motion (fix first; it is the most visible gap)

- [x] **A1** Port the design's keyframes into `gameday.css` (`wipe`, `fade`, `slidein`, `growY`, `reveal`, `popin`, `marq`, `shim`, `drop`, `popup`, `tdrop`, `scaleIn`, `cardin`, lines ~318–331 of the design file) and apply them, gated on `:root[data-animation="full"]`, to the same elements:
  - Screen container: `wipe` on every route change; page heading `slidein`.
  - Scouting cards, home move cards, roster tiles, League grade tiles, Trade room sides: `cardin`, staggered.
  - Chart bars: `growY` from the baseline; chart lines and areas: `reveal` left to right; chart callouts: `popin`.
  - Trade verdict rows: `slidein` with 80ms stagger; a legality failure shakes its row once.
  - Popovers and the player card: `popup` on open; Feel panel `drop`; toasts `tdrop`; radar `scaleIn`.
  - Skeleton shimmer while a screen's data is computing.
- [x] **A2** Reduced keeps only short fades; Off removes everything (already gated; extend the gate to the new rules).
- [x] **A3** Browser spec: with Animation Full, navigating to each route starts at least one animation on the screen container and at least one on a card or chart; with Off, `document.getAnimations()` is empty apart from nothing at all (the ticker stops too).

  **Section A evidence (12 November 2026):** done in `1.0.9`. `test-results/shots/section-a/index.html` pairs the four owner design references beside the dark build frames, shows every light screen, the mid-wipe frames for every screen in both themes, and the two motion clips. Owner review is pending before Section B starts.

## Section B · Player card

- [x] **B1 Fix the moving-average chart.** Restore the plot styles for `PlayerStockChart` on tokens, matching design lines 198–204 and 252: fast MA solid line, slow MA dashed, points dotted in the facts colour, translucent area under the fast line, hollow volume bars, player and league volume averages dashed, axis and week labels in the muted token. No element of the chart may have a black fill. Add a spec that fails if any `path` or `rect` inside the chart has a computed fill of `rgb(0, 0, 0)`.
- [x] **B2 Story layout.** Two columns at 1040px (design `.grid2`): left, a compact scenarios panel (the table and the one-line blend note; the long explanatory paragraphs move under a "How this works" disclosure) and the numbered story bullets; right, the radar and the moving-average chart. Nothing important below the fold at 1040×800. One column under 720px.
- [x] **B3 Hero.** Team-coloured gradient header (design `.hero`), photo, name in large condensed type, labels coloured by state, **three big numbers: Expected PPG (largest), Recent, Surplus**, floor and ceiling under EPPG, and a huge faded code behind (design `.hero .big`, line 101; use the NFL team code, as the owner prefers "HAR" for Harbor City Gulls).
- [x] **B4 Tabs** styled as the design's `.ptab` (condensed, uppercase, selected filled), lines 103–105.

## Section C · Labels and the Why panel

- [x] **C1 One label chip component** with two tones: positive (green) and warning (amber), from tokens, everywhere a label appears: scouting cards and rows, player card header, roster tiles, League popover, ticker arrows, digest. Status text such as "Insufficient data" is not a label and stays quiet text.
- [x] **C2 Label tabs in the Why panel** are pills: earned = green with ✓, near miss = amber with ◌ and "· near miss". Selecting one shows its view. Order: earned first, then near misses.
- [x] **C3 Margin chips** coloured by tone (spare green, at the line amber, short red) and **meters** as a filled track with the player's dot and a threshold mark (design `.gm`).
- [x] **C4 Flip or undo card** at the end of every label view, dashed border (design `.flip`): "What could undo it" for earned labels (from the tightest passing check), "What would flip it" for near misses (domain flip hint). Where the domain has no hint for a label (per the Why-panel plan, Gem and warning labels in v1), show "What could undo it" only for earned labels and nothing for near misses rather than an empty card.
- [x] Specs: label chips have the right tone per label; the Why panel shows a flip or undo card for each label that has one.

## Section D · Scouting cards and tables

- [x] **D1** Card as designed (`.pc`, lines 80–96): team-coloured top band with the **large faded team code** watermark, name in condensed type, position · team; body with **▲ Expected PPG large and ● Recent 3** side by side, the floor-to-ceiling bar, the 9-week **sparkline**, label chips (coloured), and **Surplus index with its pink meter**; owner and versus button at the foot.
- [x] **D2** Hover lift on cards; `cardin` entrance (Section A).
- [x] **D3** Table view rows keep the same coloured labels and moving-average badge.

## Section E · Every other screen, item by item

Second audit of v1.0.8, every screen in dark and light at 1440px and dark at 390px, with real NFL team codes and a trade draft seeded into the synthetic fixture. Each row is a difference between the design file and the build. Fix in this order; each sub-section ends with side-by-side screenshots.

### E1 · Shell and This week

| # | Design | Build |
| --- | --- | --- |
| E1.1 | Page heading for every screen: small kicker line, then a huge condensed headline (`.h-hero`) that slides in. | Only This week has a headline; other screens open straight into panels with no heading or a small one. |
| E1.2 | Outlook chart: line of your modeled starters against a dashed league-median line, a shaded area under your line, and callout bubbles on notable weeks ("W12 dip: two starters on bye", "Peak 124.2") that pop in. | The median line sits flat at the bottom of the chart and a label is printed over every point ("17.8 17.8 17.8…"); no area, no callouts. |
| E1.3 | Move cards: three cards, each in a team colour with a large white condensed title, a big number and a white button ("Review the deal", "Scout him", "Open depth chart"). | Two cards, no buttons; the waiver card is pale blue with dark text instead of a team colour. |
| E1.4 | Scoreboard: grade badges as solid dark blocks with large condensed letters; "N/A" quiet. One short caption. | Badges are small; the caption under it lists the unavailable reason five times in one paragraph. Show the reason once, or per row on hover. |
| E1.5 | Ticker: a strip below the header, label prefixed with green ▲ / amber ▼ by label tone. | All arrows the same pink; warning labels not distinguished. |
| E1.6 | Header search shows a dropdown of matching players with team chips. | Not verified in this audit; check it exists and matches. |

### E2 · Roster

| # | Design | Build |
| --- | --- | --- |
| E2.1 | Compact simulator card: one row of pills (Live roster, each simulation) with New, Save slot, Delete; then "Added", "Cut or sent away" and "Add a league player" rows. | The whole old simulator restyled: simulation dropdown and name field, ten slot pills with Save/Load/Clear, Force a hypothetical trade, Undo/Redo, team selector, Optimize, before/after boards with Fill slot and Replace buttons, Advanced roster moves, Move history, Detailed starter controls. About 1,600px tall. Keep the functions; move the rarely used ones (slots 2–10, advanced moves, move history, before/after boards) behind one "More simulation tools" disclosure. |
| E2.2 | Depth chart: six position columns side by side (QB, RB, WR, TE, K, D/ST), each headed by position and grade, tiles stacked beneath. | One long vertical list, one position after another, with "No players" lines. |
| E2.3 | Tile: player photo, name, role ("Starts at RB"), EPPG, a 9-week heat strip shaded from light to dark by points with grey for byes, coloured label chips, Cut button when a simulation is active. | Strip is a row of identical solid blocks; labels neutral; "ACTIVE" shown as a label chip (it is status, not a label). |
| E2.4 | Add and drop pairs: a table with Add, Drop, gain ± spread, effect ("Starts at WR" or "Bench depth only") and "Try in a simulation". | Matches in function; check the table styling against the design once there are rows. |

### E3 · Scouting

See Section D. In addition:

| # | Design | Build |
| --- | --- | --- |
| E3.1 | Filter pills (pool, position, signals) are rounded pills with a count, selected yellow; signal pills show the label's tone colour. | Close, but signal pills are all neutral. |
| E3.2 | "Prospective gem tracking" restyled to match. | Single plain bar at the foot of the page. |
| E3.3 | Versus bar floats at the bottom right when players are added, with "Head to head". | Not captured in this audit (the "+ Versus" buttons did not open a bar in the test); verify. |

### E4 · League

| # | Design | Build |
| --- | --- | --- |
| E4.1 | Heading "League" with kicker; grade grid tiles fill each cell (54px tall), team names in large condensed type. | Close. Tiles are smaller squares centred in wide cells; team name column very wide. |
| E4.2 | Grade popover: player rows with photos (round, team colour), name, role, EPPG large, labels coloured, "Player card" button. | Not fully verified; check against design. |
| E4.3 | Power ranges: rank, team, floor-to-ceiling bar with the expected mark, total ± spread, chance you outscore. | Present and close. Check the bar uses the model colour with the mark, and spacing matches. |

### E5 · Trade room

| # | Design | Build |
| --- | --- | --- |
| E5.1 | Heading "Trade room" with kicker; the four tabs as condensed pills; Saved trades and Journal as buttons at the right. "Browse saved trades" is not on the page. | A "Browse saved trades" disclosure sits at the top of every tab, duplicating the Saved trades button. |
| E5.2 | Manual analyzer sides: **solid team-colour panels** (your fantasy team on the left, theirs on the right) with white text, the team name in large condensed type, each player as a row with photo, name and ✕, "+ add" chips beneath. | Dark cards with a thin coloured top border; players shown as yellow chips (yellow means "selected" elsewhere, so this is misleading). |
| E5.3 | Tale of the tape: mirrored horizontal bars for each measure, your side and theirs, with values at each end. | Plain numbers in a column. |
| E5.4 | Lineup field: a green football-field background with seven slot cards in a row (QB, RB, RB, WR, WR, TE, FLEX), each with photo, name, EPPG and a tag (New, Shifted from WR, Up from bench, Leaves, To bench). | A plain list of rows ("QB Unfilled", "WR Synthetic 2 New"). |
| E5.5 | Verdict as a scoreboard: four rows, each with a dark label cell, a big condensed value and an explanation; the Lineup impact row includes the week-by-week gain chips (W10 +2.6 …) and the "Lineup gain ± spread" bar with floor, ceiling and the shared-NFL-team note. Rows slide in one after another. | Four small boxes with a title and value only; no explanations; weekly gains hidden in a "Weekly lineup gain" disclosure; no spread bar. |
| E5.6 | Order: sides and chips → Force button → lineup field → what changes → verdict → detail disclosures. | A "Manual filters / Surface Trading" panel sits between the sides and the verdict. Move it under the Surface assessment disclosure. |
| E5.7 | Find trades: one Search button; controls in folding groups whose one-line summaries sit under the group title; positional grade goals with the plain-language sentence. Search limits in one place. | Two search buttons ("Search trades" at the top, "Search" at the bottom); summaries run into the titles on the same line; filler text "Every find trades control is below."; a separate Search limits bar **and** "Value & acceptance" inside the panel; debug buttons ("Download search debug", "Why wasn't this trade found?") at the same level as Search. Move debug tools under a "Diagnostics" disclosure. |
| E5.8 | Chain planner: **ten preset cards** at the top, each with title, one-line description and what it sets; one search method. | **No preset cards are shown.** "Value & acceptance: Price tests required" still appears (strictness behaviour), and the panel says "Final gain ≥ 5 EPPG" while the shared limits bar says "Final gain ≥ 2.0". Both must come from the one shared set of limits. |
| E5.9 | Chain results: two step cards side by side with a connector, a dark "Connected chain result" card with the total ± spread and grade-step chips. | Not captured (no results in the fixture); verify after E5.8. |
| E5.10 | Counter-offers tab: the offer on the table with both lineup chips, then a table of counters with "Use this". | Not reviewed in detail; compare. |

### E6 · Lab

| # | Design | Build |
| --- | --- | --- |
| E6.1 | Lab opens on cards (Feel, Model settings in purple, Data & audits, Keyboard) with short descriptions. | Opens on Settings: My team selector, App version, then thirty model setting boxes in one grid with machine-style labels ("Gem W R Share", "Carries Per T D"). Group them with readable headings and labels; editable fields use the purple editable style. |

### E7 · Phones

| # | Design | Build | Status |
| --- | --- | --- | --- |
| E7.1 | Compare each screen with `E_Phone.dc.html` screens 1–9 and `F_Phone2.dc.html` screens 10–17. | Fully implemented and verified: phone navigation bottom bar replaces tabs, trade lineup field converts to vertical slot list (`grid-template-columns: 44px 40px minmax(0, 1fr) auto`), four trade verdict cells pin above bottom bar with detail sheets on tap, full-height swipeable player card, filters sheet with match counts, versus dialog, and all 17 screens captured across dark and light modes in `test-results/shots/section-e7/`. | Complete (verified with `gameday-responsive.spec.ts` 9/9 and `gameday-phone-shots.spec.ts` 2/2) |

### E8 · Across all screens

- Label chips coloured by tone everywhere (Section C1); status words such as ACTIVE and "Insufficient data" are never shown as label chips.
- Every player name shows a photo or the initials-on-team-colour fallback; the fallback currently shows "S1"/"S2" for the synthetic players, which is correct for missing photos.
- The provenance legend at the foot of every page is tiny and low-contrast; match the design's legend size and place it once in the Feel menu or footer.
- No filler copy ("Every … control is below.").

## Definition of done

- For every screen and the player card, a side-by-side screenshot (design reference, build) in light and dark, approved by the owner.
- The eight findings above are fixed and each has a spec that would catch its return.
- `npm run check`, `npm run build` and the full browser suite pass; no valuation or trade result changes.
