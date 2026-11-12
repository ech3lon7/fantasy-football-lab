# Find Trades and Chain Planner — Rebuild Plan

> **For agentic workers:** These two tabs have been marked "rebuilt" twice and are still the old screens. This plan replaces them. Do the tasks in order. **A task is done only when its acceptance test exists in the repository and passes.** Do not tick a box on any other basis. Each task ends with `npm run check`; the plan ends with `npm run build`, the browser specs below, and light and dark screenshots beside the design for the owner. Run browser specs as the project memory note says.

**Design reference:** `docs/design/gameday-plus/D_GamedayPlus.dc.html`. Find trades is the block starting `<sc-if value="{{tFind}}"`; Chain planner starts `<sc-if value="{{tChain}}"`. Styles: `.scout`, `.fac`, `.chk`, `.rule`, `.res`, `.applied`, `.presets`, `.pre`, `.leg`, `.gsm`, `.chipg`. Phone: `docs/design/gameday-plus/F_Phone2.dc.html` screens 13–15. The brief (`docs/superpowers/specs/2026-11-10-gameday-plus-redesign-brief.md`, section 8) is the source of truth for behaviour.

**Version:** moderate change → npm minor bump.

---

## 0. Why this keeps failing

1. **The old components are still mounted.** `src/features/next/TradeRoom.tsx` (around line 1672) renders `<TradeSearch … workspaceMode={tab === "chains" ? "chain" : "standard"} />`. `TradeSearch.tsx` (3,314 lines) and `TradeChains.tsx` (2,780 lines) are the pre-redesign screens. Restyling them cannot reach the design: their layout, grouping and control order are the old ones.
2. **The ticks were not tied to checks.** The corrections plan has 5.2 and 5.3 ticked "rebuilt" while the old components still render. Nothing tested it.
3. **Strictness survived.** `TradeChains.tsx` still has "Chain strictness", "Chain price tests" (shown as "Price tests required") and the preset as a dropdown, contradicting the single-search-method decision.

## 1. Coordination

Another session is changing the **Manual analyzer** in `TradeRoom.tsx` (uncommitted on 2026-11-12). To avoid conflicts, build the two tabs in **new files** and change `TradeRoom.tsx` only to mount them:

- `src/features/next/trade/FindTrades.tsx`
- `src/features/next/trade/ChainPlanner.tsx`
- `src/features/next/trade/useTradeSearch.ts`, `useChainSearch.ts` (state, persistence, worker calls)
- `src/features/next/trade/SearchControls.tsx` (folding groups shared by both)

Wait for the Manual analyzer work to be committed before touching `TradeRoom.tsx`.

## 2. Architecture

- [ ] **2.1 Extract behaviour, not markup.** Move out of `TradeSearch.tsx` and `TradeChains.tsx` into the two hooks: query state, defaults, saved-settings read/write (`tradeSearchSettings` and the chain settings key), validation messages, worker start/cancel/progress, results, near misses and diagnostics data. Hooks return plain data and callbacks; they render nothing.
  - **Test:** unit tests for each hook's query building and saved-settings round trip, including old saved settings (with `indexMode` or chain strictness) loading into the single method.
- [ ] **2.2 New UI from the design.** `FindTrades.tsx` and `ChainPlanner.tsx` use only `gd-` classes and tokens, with markup following the design file.
- [ ] **2.3 Retire the old screens.** When both tabs are done, nothing imports `TradeSearch.tsx`, `TradeChains.tsx`, `TradeSearchControls.tsx`, `TradeDiscovery.tsx`, `ChainLegControls.tsx`, `PositionalGradeImpactControls.tsx`, `DeficitProtectionControls.tsx` or `TradeResultGroups.tsx`. Delete them, keeping any pure helpers by moving them to `src/domain` or the new folder.
  - **Test (static, must fail today):** a Vitest test that reads every file under `src/features/next/` and `src/app/` and fails if any imports one of the files above.

## 3. Find trades layout (design `tFind`)

Two columns at desktop width (design `.scout`: 270px panel + results).

**Left: search controls panel** (`.fac`). Folding groups; each group shows its **title on one line and its one-line summary on the line below**, never on the same line. Groups and the controls they hold:

| Group | Summary example | Controls (all existing; none removed) |
| --- | --- | --- |
| Players & packages | "Offer 1–2 · receive 1–3 · 2 protected" | Your tradable pool and offering (search with photos instead of drag boards), protected players, offer count, receive count, Create package, required incoming player, find a target player, search within results |
| Teams to search | "All 3 teams" | Teams to search, standard search team |
| Team needs | "Protect their weak positions" | Only teams with a positional deficit, deficit position, maximum position grade, protect their weak positions, minimum positional gain, preview team grade strip |
| Positional grade goals | "Your WR +2 · your RB no worse than −3" | The goals editor (see right column; the group holds the summary and a link to it) |
| What you receive | "Any position · 1+ Gem/Pre-gem/Watch" | Position to receive, incoming players, minimum incoming position matches, minimum incoming Gem/Pre-gem/Watch matches |
| Roster fit | "Offered players must be useful" | Every offered player must be useful, minimum usefulness improvement, require positional upgrades, upgrade target, minimum Expected PPG upgrade, only show positional upgrades for the other team |
| Search limits (shared with chains) | "Defaults" or "Temporary loss 3.0 (edited)" + purple dot | The four shared sliders; replaces "Value range", "Use strict index range" and "Value & acceptance" limits |
| Manager profiles & acceptance | "League baseline" | Manager profile, surface trading toggle, why the other team might accept |
| Ranking | "By lineup gain" | Rank trades by, search goal, search approach |

At the foot of the panel, one **Diagnostics** disclosure holding "Download search debug", "Why wasn't this trade found?", "Why trades were excluded" and "Search attempts". Nothing diagnostic sits beside the Search button.

**Right: goals, summary, results.**

1. **Positional grade goals card** at the top (design `.rule`): one row per goal (team · position or Overall · step option · ✕) with the plain-language sentence beneath each ("Your WR is D+ today. +2 steps means C or better."), "+ Add goal", and **one** primary button: **Search trades across the league**.
2. **Summary line** (design `.applied`): "24 trades meet every goal · 96 combinations examined across 3 teams".
3. **Results table** (design `.res`): Offer → receive (with photos), your grade-step chips, their grade-step chips (impacted positions only), lineup gain **± spread**, surplus verdict, a status tag (Passes every price test / Price warning / Widened search, with what moved), and **Analyze**. Ordered by status, then lineup gain.
4. **Near misses** in a collapsed section below the results, each with the reason it failed.

**Remove from the screen:** the separate "Search limits" bar above the tabs, the "Every find trades control is below." text, the second Search button, the "Filters" toggle button, the "Find matching trades / Independent standard-search controls" header.

## 4. Chain planner layout (design `tChain`)

1. **Header card:** "Two-trade chain planner", chain search depth, required final target, and one primary button **Run chain trade search**.
2. **Preset cards** (design `.presets` / `.pre`): **ten cards** in a grid, one selected, each with title, one-line description and what it sets, in this order: Balanced opportunities, Mutual benefit, Acquire a star, Turn a star into depth, Acquire coverage then upgrade, Connected chains, Surface-stat trading, Speculative sequences, Fix my weakest position, Buy low then flip. A line under the grid states what the selected preset sets. "Save current settings as a preset" with a name field. **No dropdown, no strictness control, no "Chain price tests" control.**
3. **Search limits:** the same shared section as Find trades (one set of values; editing it in either tab changes both).
4. **Per-trade settings:** a two-way switch **Trade 1 settings / Trade 2 settings**, each with the same folding groups as Find trades where they apply, plus the whole-chain group (dependency route, sequence types, rank plans by, target roster need, exclusions).
5. **Results:** the two step cards side by side with a connector (design `.leg`), each with players, grade-step chips, lineup gain ± spread and surplus; then the **connected chain result** card (total ± spread, combined chips, how trade 1 enables trade 2, status tag). For Surface-stat trading, each step also shows their gain on surface stats beside your gain in EPPG.

**Remove:** "Chain strictness", "Chain price tests" ("Price tests required"), the preset `<select>`, "Final gain ≥ 5 EPPG" or any limit text that does not come from the shared limits.

## 5. Acceptance tests (write these first; they must fail on the current build)

- [ ] **5.1 Static:** the import test from 2.3.
- [ ] **5.2 Find trades (browser, `tradeSearchFixture`):**
  - exactly one visible button whose name contains "Search" in the tab;
  - no visible text "Every find trades control is below", "Independent standard-search controls", "Use strict index range" or "Value range";
  - every folding group's summary element sits **below** its title (bounding boxes);
  - the Diagnostics disclosure contains the debug buttons and they are not visible when it is closed;
  - after a search, at least one result row shows a photo or initials fallback, grade-step chips, "±" in the lineup gain and a status tag.
- [ ] **5.3 Chain planner (browser):**
  - a radio group named "Chain preset" with exactly ten options, each with a description;
  - no visible text "strictness", "Price tests required" or "Chain price tests";
  - changing a shared limit in Chain planner changes the same limit's summary in Find trades;
  - after a search on a fixture that yields a chain, two step cards and one connected result card render.
- [ ] **5.4 Theme sweep** (existing spec) passes on both tabs in light and dark.
- [ ] **5.5 No behaviour change:** snapshot the results of `searchTrades` and `searchTradeChains` on the fixtures before starting; after the rebuild they are identical except for the documented single-search-method changes (ordering by status, widening from user limits).

## 6. Done means

- All tests in section 5 exist and pass, and `docs/verification.md` lists them by name.
- Side-by-side screenshots (design canvas in Play mode, build) of both tabs, light and dark, desktop and phone, approved by the owner.
- The old component files are deleted.
