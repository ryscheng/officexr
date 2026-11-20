# HUD and UI rules

Format of each rule: the rule; **Why**; **Number** (where a source supports one); **Here** (what
it means in officexr). Source keys in brackets map to `sources.md`. "Inference" marks rules that
no game source states directly.

Units: on phones 1 CSS px is about 1 pt (iOS) or 1 dp (Android), about 0.16 mm. 44 px is about
7 mm, 48 px about 7.6 mm, 64 px about 10 mm.

## A. What goes on the HUD

**H1. Write the HUD stance first: the world is the screen, the HUD is a concession.**
- Why: without a stated stance, each addition looks reasonable alone and the HUD grows until it
  covers the world. [donchitos-hud]
- Number: none.
- Here: officexr's stance is "show who is here and how to reach them; everything else on
  demand". Use it to push back on a new permanent element.

**H2. Every element needs a reason to be on screen: the player would decide worse without it, or
would have to stop to find it.**
- Why: a "rule of necessity" gives a veto over HUD requests. [donchitos-hud]
- Number: one source suggests "removing it confuses more than 25% of testers" as a test.
- Here: a ping bell for a rare event failed this test and now appears only after a ping
  arrives (`docs/hud-review/fold-hide.md`).

**H3. Sort each piece of information into: always, contextual, on demand, or in the world.
Default to contextual.**
- Why: information that appears when relevant and leaves when not keeps the view clear and still
  informs. [donchitos-hud] [epic-mobile] [roblox-xplat]
- Number: none.
- Here: always = movement control, chat entry, menu, map button; contextual = near-you card
  (within 8 m), call pill (in a call), build indicator (in build mode), desk buttons; on demand =
  people list, full map, settings; in the world = name tags, status and emote bubbles, raised
  hand.

**H4. Use the world before the HUD: a name tag, a bubble or a prop is better than a panel.**
- Why: diegetic and spatial UI keep attention on the scene; non-diegetic UI is for what the
  world cannot show legibly. [stonehouse-ui] [fagerholt-beyond]
- Number: none.
- Here: status, focus mode, raised hand and emotes already live above avatars. Prefer a new
  in-world marker to a new HUD row. Keep in-world text readable: outline or backing plate, no
  glass-on-glass where tags pass under HUD panels (fault 12 in `docs/hud-review/README.md`).

**H5. Modes swap the HUD set; they do not add to it.**
- Why: each mode needs different controls; stacking them breaks the control budget. [donchitos-hud]
  [android-portrait R18] [epic-mobile]
- Number: none.
- Here: build mode should hide social context buttons except mute and the chat badge, and show
  one clear "Done". Frozen mode, focus mode and the full map follow the same rule.

## B. Layout zones

**H6. Name the zones and give each a maximum count.**
- Why: placing ad hoc leads to overlap; zones make conflicts visible before code. [donchitos-hud]
- Number: centre zone (about +-15% of the screen) holds nothing persistent, one momentary item
  at most. [donchitos-hud]
- Here: top bar (low-frequency buttons), toasts (top centre, one at a time), bottom-left
  (movement), bottom-right (context actions), panels (one column, under the top bar). Nothing
  persistent in the centre.

**H7. Primary, frequent actions go in the bottom corners (thumb zone). Low-frequency items go top.**
- Why: thumbs drive most phone touches; top corners are hardest to reach one-handed. [epic-mobile]
  [apple-hig-games] [hoober-uxm]
- Number: Hoober: 49% one-handed, 36% cradled, 75% of touches by thumb, 67% right thumb.
  Guideline: actions used more than once a minute sit in the bottom 40% of screen height.
  [android-portrait R2]
- Here: joystick bottom-left, Wave and Speak bottom-right; menu, map and ping bell top-right.

**H8. Respect the safe area with tokens, not fixed pixels.**
- Why: notches, rounded corners and the home bar hide or block controls. [android-portrait R6]
  [gamedev-ui-ux] [roblox-xplat]
- Number: iPhone 13 portrait insets 47 px top, 34 px bottom; landscape 47 px left and right,
  21 px bottom. Keep interactive controls 16-24 px above the bottom inset. [android-portrait R6]
- Here: `--hud-inset-*` = max(12 px, safe area); `viewport-fit=cover` makes `env()` real.
  `hud-layout.spec.ts` fails on any box outside the safe area.

**H9. Reflow for every aspect ratio and keep hit boxes right after resize or rotation.**
- Why: phones from 9:16 to 9:21, foldables near 1:1, split screen. [android-portrait R9]
  [android-large-screen]
- Number: test at least 1440x900, 844x390, 390x844, 320x568 (iPhone SE browser viewport).
- Here: `/hud-preview` devices cover desktop, iPhone 13 both ways, iPhone SE, Pixel 5 both
  ways, iPad landscape.

**H10. Pick panel widths from a short list.**
- Why: random widths (224-448 px seen here) make the HUD look unplanned and collide. [hud-review]
- Number: inference: two widths on desktop (for example 280 and 360 px); full width minus
  insets on phone portrait; at most 600 px wide for any sheet on a large screen. [android-portrait R8]
- Here: reuse `hud/ui/Panel.tsx` and `FoldablePanel.tsx` rather than new containers.

## C. Panels, sheets and messages

**H11. One panel open at a time on phone portrait; opening one closes or folds the others.**
- Why: two panels leave no world; the user loses track of which closes what. [android-portrait R8]
- Number: sheet heights: peek 25-35%, half 50-60%, full 90% of height. [android-portrait R8]
- Here: implemented for chat input, menu, people list and missions in portrait. Keep it for any
  new panel. Escape and the back gesture close the top layer (`escapeStack.ts`).

**H12. A folded panel is one row: title plus one number or bar.**
- Why: glanceable, and it does not cost a second row of screen. [fold-hide]
- Number: folded header 44 px tall on touch.
- Here: missions folded shows title and count (desktop) or progress bar (touch). Use
  `FoldablePanel`; save fold state under `officexr:fold:<name>`; work when storage throws.

**H13. Transient messages: one at a time, top centre, short, queued, never over bottom controls.**
- Why: stacked toasts cover the world and block taps; one queue avoids clutter. [gow-hud]
  [android-portrait R12]
- Number: 3-4 s on screen, at most 2 lines; keep important ones in an inbox so nothing is lost.
  Chat peek: 4-6 s (officexr uses 10 s). [android-portrait R12, R14]
- Here: connection toast, arrival bubble (4 s), poke and ping toasts. When a call pill shows, the
  toast column starts below it. One queue for all of them.

**H14. Banners that need action stay until the user acts; everything else times out.**
- Why: a timed-out error is a lost error. [fold-hide]
- Number: none.
- Here: `HudBanner` for replaced-session and errors; errors are dismissable.

**H15. Each message needs an interrupt rule: what happens when a menu, a modal or a higher-priority
message opens.**
- Why: queues break on interruptions (pause, cinematic, vendor). [gow-hud]
- Number: none.
- Here: decide whether a toast waits, drops or moves when the full map or settings open.

## D. Controls and reading

**H16. Show a control only while it can be used.**
- Why: disabled or irrelevant controls cost space and attention. [apple-hig-games] [roblox-xplat]
- Number: at most 5-6 active controls at once on a phone. [epic-mobile]
- Here: Sit appears near a seat; Wave and Speak near a person; click-to-play only on desktop
  without focus.

**H17. Touch targets: 44 px minimum (repo test), 48 px preferred, 56-64 px for frequent actions,
8 px gap.**
- Why: edges and corners are hit less accurately; people in motion miss more. [nng-target]
  [android-portrait R5] [xag-107]
- Number: Apple 44 pt; Android 48 dp; NN/g about 1 cm; Hoober 7 mm centre, 9 mm edge, 12 mm
  corner. The visible icon may be smaller than its hit area.
- Here: `hud-layout.spec.ts` lists targets under 44 px. Spell slots (27 px) and the "(you)"
  button (16 px) failed it before.

**H18. Text a player must read: 16 px body on phones, 12 px absolute minimum for labels; let it
scale.**
- Why: phones are read at arm's length, often in glare. [xag-101] [epic-mobile]
- Number: Xbox: 18 px at 1080p for PC; scale to 200% without loss; line length up to 80
  characters; line spacing 1.5. Epic: text under 18 pt is hard to read on a phone.
- Here: people list status and distance (10-11 px) and minimap labels (7-8 px) were too small.
  Long names: truncate with a way to read the full name (tap, tooltip or person card).

**H19. One icon, one meaning; frequent icon-only buttons get a label, tooltip or `aria-label`.**
- Why: identical icons for different things (status and chat) confuse; icon-only rows are hard
  to tell apart. [hud-review]
- Number: none.
- Here: check the whole HUD for a reused icon before you add one.

**H20. One button style per role.**
- Why: three styles in one row read as noise. [hud-review]
- Number: inference: primary (filled accent), secondary (glass), text link. One primary per zone.
- Here: use `hud/ui/Button.tsx`, `IconButton.tsx`, `RoundButton.tsx` consistently.

**H21. Key hints only for keyboard users.**
- Why: keycaps mean nothing on touch and cost space. [hud-review]
- Number: none.
- Here: `Keycap` components hide under `pointer: coarse`; build indicator already does.

**H22. Map: a button that opens a full map on phones; a minimap only where width allows.**
- Why: a minimap at a quarter of portrait width is too small to read and blocks the view.
  [android-portrait R16] [donchitos-hud]
- Number: if a minimap shows, about 150 px minimum and labels at least 12 px (inference from H18).
- Here: map button (M) always; full map is a modal. Minimap labels need a size check.

**H23. HUD settings: scale, opacity, left-handed mirror, joystick mode, reset.**
- Why: no single layout fits all hands; one test saw four layouts each used by about 25%.
  [android-portrait R10] [xag-107]
- Number: scale 80-140%, opacity 40-100%.
- Here: not built yet. Propose as its own task; do not add ad hoc toggles per control.

## E. Verify

**H24. Verify by capture and box dump, not by reading code.**
- Why: overlaps are pixel facts. [hud-review] [gamedev-ui-ux]
- Number: three device classes minimum (desktop, phone landscape, phone portrait), two themes.
- Here: `tests/playwright/hud-capture.spec.ts` with `HUD_CAPTURE_DIR`; read the `.json` lists of
  overlaps, boxes outside the safe area and small targets; then `hud-layout.spec.ts`.
