# Player card hero and tier entrances — Implementation Plan

> **For agentic workers:** Implement task by task. **A task is done only when its test exists and passes.** Each task ends with `npm run check`; the plan ends with `npm run build`, the browser specs below, and light and dark screenshots (and a short screen recording of each entrance) for the owner. Run browser specs as the project memory note says.

**Goal:** Make the player card's header feel like a sports-game player screen, after the owner's reference: a Madden-style "Player management" header. The reference elements to carry over:
- a team-coloured halftone background;
- a large dotted numeral;
- a stacked first name and LAST NAME;
- a form bar;
- a glassy profile panel;
- the position written out in full.

When a card opens, it plays an entrance that depends on how good the player is:
- **Superstar:** paparazzi camera flashes. This is the flashiest entrance.
- **Star:** a narrow diagonal silver-white reflection sweeps across the card, like light on a glossy trading card.
- **Good:** a soft glint. This is the least flashy entrance.
- **Everyone else:** no entrance.

**Design reference:** `docs/design/gameday-plus/D_GamedayPlus.dc.html`. Search for:
- `hero hx`: the markup;
- `.hx-*`, `.tier-*` and `.fx-*`: the styles;
- `@keyframes pap`, `bloom`, `sweep` and `glint`: the animations;
- `cardFx(id)`: the trigger and sounds;
- `p.tier`: the tier calculation.

On the canvas, open any player card on board 6:
- Jalen Mercer is a superstar;
- Kendrick Shaw is a star;
- Tyrese Lamb is good;
- Hank Morrow has no tier.

**Version:** moderate change → npm minor bump.

---

## 0. Ground rules

- The tier is **display only**. It changes no valuation, grade, lineup or trade result.
- All calculation in `src/domain`; the UI does not rank players itself.
- Every number on the header keeps its existing source and its null-versus-zero handling.
- The motion, sound and haptics settings already in the Feel menu govern every entrance (section 4).

## 1. Tiers (`src/domain/player-tier.ts`)

- [ ] **1.1 Ranking.**
  - Rank every player in the dataset, rostered and free agents, **across all positions** (not by position, at the owner's request), by **fantasy points per game played** this season (`Actual_PPG`).
  - Only players with at least `TIER_MIN_GAMES = 4` games are ranked. Others get `rank: null` and no tier, never a rank computed from 0 points.
  - Per game rather than season total, so that a superstar who missed a week is not demoted.
- [ ] **1.2 Cut-offs** scale with league size. *T* = number of fantasy teams.

  | Tier | Ranks | 12-team league |
  | --- | --- | --- |
  | Superstar | 1 … 1×*T* | 1–12 |
  | Star | 1×*T*+1 … 3×*T* | 13–36 |
  | Good | 3×*T*+1 … 6×*T* | 37–72 |
  | None | below that | — |

  Use named constants: `TIER_SUPERSTAR_PER_TEAM = 1`, `TIER_STAR_PER_TEAM = 3`, `TIER_GOOD_PER_TEAM = 6`.
- [ ] **1.3 Return** `{ rank, rankedCount, tier: "superstar" | "star" | "good" | null, ppg, games }`.
- [ ] **1.4 Tests:**
  - ties share the better rank;
  - a 3-game player has no rank;
  - a 10-team league gives cut-offs at 10, 30 and 60;
  - a player with null `Actual_PPG` has no tier;
  - kickers and D/ST are ranked in the same list as everyone else.

**Note for the owner:** across all positions, quarterbacks will fill much of the superstar tier, because they score the most. That is what "not position based" means. If it feels wrong after seeing real data, the alternative is to rank by points above the position's replacement level (VORP), which is already calculated.

## 2. Header layout (replaces the current hero)

Desktop, top to bottom and left to right:

- [ ] **2.1 Background:**
  - the team primary colour, darkened at both edges (a left-to-right gradient);
  - a **halftone dot layer** (7px grid of soft white dots) masked to fade in from the middle and out at the right edge;
  - no images needed.
- [ ] **2.2 Breadcrumb**, top left, in small spaced capitals: "Gameday / Scouting / Player card". The middle part is the screen the card was opened from.
- [ ] **2.3 Rank numeral:**
  - the player's overall rank ("1", "12"), ~250px, **dotted fill with a thin white outline**, behind the content and left of the profile panel;
  - decorative (`aria-hidden`), since the profile panel states the rank in words;
  - with no rank, no numeral.
- [ ] **2.4 Photo frame:**
  - 140 × 164 portrait, white 3px outline and a soft drop shadow;
  - uses the existing `PlayerPhoto` headshot (`a.espncdn.com/i/headshots/nfl/players/full/{id}.png`), enlarged from today's 72px circle;
  - the image is a landscape 350 × 254, so use `object-fit: cover` with `object-position: 50% 15%` to crop to head and shoulders;
  - it is sharp at normal resolution; on high-density screens it is slightly soft (254px source for a 328px slot). Do not upscale beyond that, and add no blur or filter;
  - initials on the team's secondary colour as the fallback.
- [ ] **2.5 Name block:**
  - the first name in spaced capitals (20px);
  - the LAST NAME in condensed capitals (78px);
  - for D/ST, the team name, then "D/ST".
- [ ] **2.6 Meta line:** "WR · Harbor · 8 games · Sunday Syndicate".
- [ ] **2.7 Form bar** (the reference's morale bar):
  - a 150px bar showing Recent 3 against Expected PPG:
    - width = 50% + (Recent 3 − EPPG) ÷ EPPG × 120%, clamped to 6–100%;
    - green with the word "Hot" if Recent 3 is more than 1 point above EPPG;
    - red with "Cold" if more than 1 point below;
    - sand with "Steady" otherwise.
  - Hover or focus shows "Recent 3 14.1 vs Expected PPG 12.3".
  - Never colour alone: the word is always shown.
- [ ] **2.8 Tier badge + labels row:**
  - **Badge:** "★ Superstar" in gold foil, "Star" in silver foil, "Good" in bronze. Foil means a diagonal metallic gradient.
  - **Badge is a button:** its accessible name is "Superstar, replay the card entrance". Clicking it replays the entrance. Hover shows "#1 in fantasy points per game across every position (minimum 4 games). Click to replay."
  - **Rest of the row:** the injury status chip and the existing labels follow the badge.
- [ ] **2.9 Profile panel**, top right (232px):
  - dark glass: 58% black, 6px backdrop blur, a hairline white border;
  - titled "◉ Profile";
  - rows: Fantasy team · Status · FPTS / game "21.6 · #1 of 33" · Games · ESPN season "19.5 PPG";
  - footer: the position spelt out, "WIDE RECEIVER".
- [ ] **2.10 Metrics row and buttons** stay as they are: MPPG, Expected PPG · season, Recent 3, Surplus, then versus, trade room, previous/next and close.
- [ ] **2.11 Phones (≤720px):**
  - the numeral shrinks to 150px at the top right;
  - the photo becomes 92 × 108;
  - the last name drops to 46px;
  - the profile panel drops below the name as a full-width block;
  - nothing is hidden.
- [ ] **2.12 Light and dark:** the header is always on the team colour with white text in both themes, as the hero is today. Check contrast for every team colour: white text needs at least 4.5:1, so darken the gradient for light team colours.

## 3. Entrances

All three run once when the card opens: from any list, from previous/next, and when the badge is clicked. Each is an overlay inside the header (`pointer-events: none`, `aria-hidden`). It never moves or covers the content after it ends, and never delays input. The card is usable from the first frame.

- [ ] **3.1 Superstar: paparazzi** (about 1.6 s):
  - **Flashes:** 9 camera flashes at scattered points over 0.05–1.45 s. Each is a white radial burst with a thin four-point star (a horizontal and a vertical light streak). Each grows from 40% to 125% in 0.55 s, peaking at 10%.
  - **Whole-card brightening:** 2 brief whole-card washes, peaking at 26% and 18% white opacity, at about 0.13 s and 0.95 s.
  - **Sound** (if sound is on): a camera-shutter click for each flash. It's a short band-passed noise burst with a quieter second click 45 ms later, like a mirror slap.
  - **Haptics** (if on): a light 8 ms tick for each flash.
  - **Photosensitivity rule:** whole-card washes stay at **two**, more than 0.5 s apart, and below 30% opacity. Each localised flash covers well under a quarter of the card. Together that keeps the effect under the three-flashes-per-second limit (WCAG 2.3.1). A test checks the keyframes (section 5).
- [ ] **3.2 Star: glossy sweep** (about 1.2 s):
  - **Band:** one narrow band (9% of the card width) tilted 22°, moving from left to right over 1.15 s, starting at 0.25 s, with ease-in-out.
  - **Look:** a silver-white gradient with a bright 50% core, drawn with `mix-blend-mode: screen` so it reads as reflected light, not paint.
  - **Second streak:** a 2% hairline follows 0.11 s behind it for the trading-card gloss.
  - **Sound:** a quiet rising chime (1.4 → 2.8 kHz, 0.4 s).
  - **Haptics:** one 12 ms pulse.
- [ ] **3.3 Good: soft glint** (about 0.9 s):
  - **Glint:** a single small four-point sparkle (46px) at the photo frame's upper right. It fades to 75% while turning 45°, then fades out while turning on to 90°.
  - **Sound:** a very quiet single ping (2.1 kHz, 0.14 s).
  - **Haptics:** none.
- [ ] **3.4 No tier:** nothing plays.

## 4. Settings

- [ ] **4.1 Motion:**
  - **Full:** entrances play.
  - **Reduced:** no entrance, so no flashes, sweep or glint. The badge still shows the tier.
  - **Off:** no entrance and no entrance sound.
  - "Following your device" respects `prefers-reduced-motion`.
- [ ] **4.2 Sound and haptics:** use the existing switches. With sound off, entrances are silent; with haptics off or unsupported (iOS Safari), there is no vibration.
- [ ] **4.3** Add a "Player card entrances" switch to the Feel menu (on by default) for owners who like motion elsewhere but not here.

## 5. Verification

- [ ] Unit tests from 1.4.
- [ ] **Static flash test:** parse the `bloom` keyframes and fail if there are more than 2 whole-card peaks, if any peak is above 0.3 opacity, or if two peaks are less than 0.5 s apart.
- [ ] **Browser spec** (synthetic fixture with players in each tier):
  - opening a superstar's card shows `.fx-pap` and the badge "★ Superstar";
  - a star shows `.fx-shine`;
  - a good player shows `.fx-glint`;
  - a no-tier player shows no `.fx` element;
  - with motion "Reduced" or "Off", no `.fx` element is visible but the badge is;
  - clicking the badge replays the entrance (the element is re-created);
  - Tab and Escape behave as before; the first focusable element is reachable during the entrance.
- [ ] **Snapshot test:** valuation, grades, lineups and trade results are identical before and after.
- [ ] **Screenshots and recordings:**
  - light and dark, desktop and 390px, for one card per tier;
  - plus a short recording of each entrance, for the owner to approve.
