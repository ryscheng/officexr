# Portrait one-handed HUD: best practice for a 3D social/action game

Date: 2026-11-20. Scope: phone portrait, one hand, 3D avatar world with proximity voice, chat,
missions, map, people list, build mode. Patterns only; no game's look is copied.

## Unit note

On Android Chrome, 1 CSS px = 1 dp = about 0.16 mm. On iOS, 1 CSS px = 1 pt = about 0.16 mm.
So: 44 px = about 7 mm; 48 px = 7.6 mm; 64 px = 10 mm; 94 px = 15 mm.

## How evidence is weighted

- **Strong consensus**: two or more platform guides (Apple HIG, Android, Xbox XAG, Epic) agree, and shipped games show it.
- **Varies by genre**: sources disagree, or only one genre shows it.
- Portrait-specific game-HUD research is thin. Much of the reach data comes from general mobile UX
  (Hoober grip study, n = 1,333) and is applied here by inference. Treat those rules as hypotheses to test.

## Rules

### Strong consensus

**R1. Keep 5-6 controls visible at once, at most. Show the rest only in context.**
Why: small screen, one thumb; every extra control covers the 3D view and raises mis-taps.
Evidence: Epic mobile HUD guide ("no more than 5-6 active controls"); Apple HIG "show and hide virtual
controls to reflect gameplay"; Roblox "limit on-screen content, show contextual controls only when relevant".
Guideline: count controls at rest; target 4-5, plus 1-2 context buttons.

**R2. Primary actions live in the bottom third, on the side of the dominant thumb. Low-frequency items go top.**
Why: thumbs drive most phone touches (Hoober: 75%), right thumb 67%; top corners are hardest to reach one-handed.
Evidence: Apple HIG ("place secondary controls, like menus, at the top"); Epic ("thumb zone, bottom corners,
is where primary actions take place; maps, timers at top or collapsible"); Smashing one-hand study
(moving a menu to the bottom raised clicks 9%, menu items 30% in one app).
Guideline: anything used more than once a minute sits in the bottom 40% of the screen height.

**R3. Movement uses a floating joystick: it appears where the thumb lands, inside a large activation zone.**
Why: no need to find a fixed center; thumb drift on a fixed stick causes loss of control.
Evidence: Apple HIG ("show a virtual thumbstick wherever the player lands their thumb"); Epic ("joysticks
are dynamic"); portrait one-thumb games (survivor-like, auto-aim archer pattern) use touch-anywhere sticks;
Roblox ships a dynamic thumbstick mode.
Guideline: activation zone = lower 45-50% of screen minus control hit areas; stick base 100-120 px;
show a faint resting ghost (30-40% opacity) at the default spot; dead zone about 10% of radius.

**R4. Also allow direct tap-to-move / tap-to-interact on the world.**
Why: lowest-effort input for social worlds; required alternative to a path gesture (drag) for accessibility.
Evidence: Apple HIG ("let players tap objects instead of adding a button"); Xbox XAG 107 (single-click
move as alternative to drag; avoid required path gestures); map-based social games are tap-driven.
Guideline: tap on floor = walk there; tap on avatar = person card.

**R5. Touch targets: 48 px minimum hit area, 56-64 px for frequent controls, larger in corners and while moving.**
Why: corners and edges are touched less accurately than the center; people in motion miss more.
Evidence: Apple 44 pt default / 28 pt minimum for menus; Android 48 dp; NN/g 1 cm (about 63 px) minimum,
primary about 2 cm; Xbox XAG suggests 15 mm (about 94 px) for game touch targets on phones;
Hoober (secondhand) 7 mm center, 9 mm edges, 12 mm corners.
Guideline: visible icon may be 40-44 px, but hit area at least 48 px with 8 px gap; primary action
buttons 64-72 px; corner hit areas 64+ px.

**R6. Respect safe areas, cutouts and system gesture strips.**
Why: notch / Dynamic Island hide icons; the bottom edge is the home gesture, side edges are back.
Evidence: Android large-screen Tier 3 ("unobstructed HUD safe areas"); Android gesture insets
(`getMandatorySystemGestureInsets`, exclusion only during gameplay); Apple HIG (don't overlap Home indicator
or Dynamic Island).
Guideline: pad with `env(safe-area-inset-*)` plus 8 px; keep interactive controls 16-24 px above the
bottom inset and 16 px from side edges; never start a drag control in the bottom gesture strip.

**R7. Every press has a visible press state that shows around the finger, plus haptic.**
Why: the finger covers the control; no feedback feels like lag.
Evidence: Apple HIG ("visible and tactile press states"); Xbox XAG (activate on touch-end, allow slide-off to cancel).
Guideline: glow/ring larger than the finger; `navigator.vibrate(10)` where available; act on pointerup.

**R8. One bottom sheet at a time for panels (chat, people, missions, map list).**
Why: sheets open from the reachable edge, keep context visible, and close with a swipe down or back.
Evidence: Smashing one-hand patterns (bottom sheets, trays); Android Tier 2 (bounded-width dialogs,
Back closes overlays); common pattern in portrait social and idle games.
Guideline: peek 25-35%, half 50-60%, full 90% of height; drag handle 32x4 px; system Back / Esc closes
the top sheet; max width 600 px on large screens.

**R9. HUD must reflow for any aspect ratio and keep hit-boxes correct after resize, fold and rotation.**
Evidence: Android Tier 3 (accurate touch hit-boxes across fold, rotate, multi-window); Tier 2 (scale
proportionally, keep controls near edges, clear of the fold crease, no oversized buttons over center).
Guideline: anchor to edges with relative units; test 9:16, 9:21, 1:1 (unfolded), split-screen.

**R10. Offer HUD settings: scale, opacity, left-handed mirror, joystick mode, presets.**
Why: no single layout fits all hands; in one test each of four layouts was used by about 25% of players.
Evidence: Xbox XAG 107 (adjust size, spacing, position of all touch targets; preset layouts);
Apple HIG (personalize controls); shooter pattern (per-control scale and opacity sliders, saved layouts);
battle-royale pattern (named presets).
Guideline: scale 80-140%; opacity 40-100%; "left-handed" mirrors bottom controls; joystick
floating / fixed / tap-to-move only; reset to default.

**R11. Teach in play, one hint at a time, at the moment of need.**
Why: written tutorials are skipped; hints near the control stick.
Evidence: Apple HIG ("teach through play", "defer requests until the right time"); proximity-prompt pattern (Roblox).
Guideline: first-run ghost hand on the joystick zone; context hint when someone is first near ("Wave to say hi");
each hint shown at most twice, dismiss on first use.

**R12. Toasts: one at a time, short, top-center, never over bottom controls.**
Why: the bottom is the input zone; stacked toasts cover the world and block taps.
Evidence: Epic (info at top center or collapsible); Apple HIG (secondary at top); general game practice of
a single queued banner. (Inference: no platform states a toast rule for games.)
Guideline: below the call pill / safe area; 3-4 s; queue; tap to open source; swipe up to dismiss;
max 2 lines; important items also go to an inbox (bell) so nothing is lost.

### Varies by genre

**R13. Auto-fade or collapse non-essential HUD while moving; bring it back on stop or event.**
Why: more world visible during motion; but fading critical info hurts (strategy-style games).
Evidence: Apple HIG (thumbstick less visible at rest); contextual-HUD games fade elements over time;
Tobii UI guide (timer-based fade, delay first, fade gradually, be conservative when UI is the game).
Guideline: after 1.5-2 s of movement, fade trackers to 40% or collapse to an icon; restore 0.5 s after stop;
never fade the joystick, call controls, or a new message badge. Make it a setting.

**R14. Chat: icon with badge as the entry; short-lived peek line; full sheet for typing.**
Why: social games need presence of chat without covering the view; keyboards cover half the screen.
Evidence: player complaints that keyboard hides chat and send is tiny; requests for quick phrases;
Xbox XAG (support dictation); Android Tier 2 (Enter sends); Chrome viewport behavior (fixed bottom bars sit
under the keyboard by default since Chrome 108). Pattern strength: medium.
Guideline: peek = 1-2 lines above the bottom controls, 4-6 s, tap opens sheet; sheet input pinned to the
visual viewport (`interactive-widget=resizes-content` plus a `visualViewport` fallback for iOS);
quick replies / emotes row; send button 48 px; keep keyboard open after send.

**R15. Mission tracker: one compact line with progress; tap to expand.**
Why: quests must be glanceable but are not a frequent touch.
Evidence: Epic (timers/scores top or collapsible); contextual HUD patterns; portrait idle/RPG pattern of a
small objective chip near a top corner or above the action area. Placement varies by genre.
Guideline: chip of max 1 line, 32-40 px tall, top-left under the safe area; checkmark animation on progress;
auto-collapse while moving (R13).

**R16. Map: a button that opens a full map sheet, not a permanent minimap, in portrait.**
Why: portrait width is scarce; a minimap at 25% of width is too small to read and blocks the view.
Evidence: Epic (maps top or collapsible); map-based social games use the whole screen as the map and
a corner "nearby" tracker for what is close. Varies: action games keep minimaps.
Guideline: map icon in top row; optional "nearby people" chip (up to 3 faces) near the bottom.

**R17. Context buttons appear next to the primary-action spot when relevant, and leave when not.**
Why: one spot for "do the thing here" is learned fast; no permanent clutter.
Evidence: Roblox (place custom buttons relative to the main action button; proximity prompts);
Apple HIG (hide when not available; combine tap and long-press into one control).
Guideline: at most 2 context buttons, 56-64 px, in an arc around the primary spot, 8-12 px apart;
200 ms fade/scale in; long-press variants instead of more buttons.

**R18. Modes swap the whole HUD set (for example build mode).**
Why: each mode needs different controls; mixing them breaks R1.
Evidence: battle-royale pattern of "build" vs "combat" HUD presets; Epic (design the HUD per genre/mode).
Guideline: entering build hides social controls except call mute and chat badge; one clear "Done" at
bottom; tool palette as a bottom strip with swipe (Epic: swipe beats taps for material selection).

## Mapping to our controls

Current portrait layout: top-right icon row (chat, menu, ping bell, map, 44 px), call pill under it,
full-width folded missions bar above a fixed 110 px joystick at bottom-left, Wave/Speak bottom-right when
someone is near, one panel open at a time, chat peeks on new message.

| Control | Keep | Change | Rules |
|---|---|---|---|
| Top buttons (menu, bell, map) | Top row for low-frequency items | Hit area 48 px+ with 8 px gaps (visible may stay 40-44); pad by safe-area + 8 px; move chat out of this row | R2, R5, R6 |
| Chat | Peek on new message; one sheet | Entry = icon + badge at bottom-right edge (above Wave/Speak); peek line 4-6 s above bottom controls; sheet input pinned to visual viewport, quick replies, Enter/send keeps keyboard | R2, R8, R14 |
| Missions | Folded state | Move from full-width bottom bar to a one-line chip at top-left; auto-collapse while moving; tap opens missions sheet | R1, R13, R15 |
| People list | Panel | Bottom sheet; optional "near you" chip with up to 3 faces near bottom-left; tap avatar in world = person card | R4, R8, R16 |
| Map | Icon in top row | Full map sheet; no permanent minimap in portrait | R16 |
| Call card / pill | Pill near top | Keep pill compact (one line, under safe area); while in call, put mute as a context button next to Speak in the bottom-right arc | R2, R17 |
| Wave / Speak | Context, bottom-right, only when near | Primary-action spot fixed; 64 px; Wave and Speak in an arc; long-press Wave for emote picker; mirror for left-handed | R5, R10, R17 |
| Joystick | 110 px size, bottom-left default | Make floating within lower-left ~60% x lower ~45% zone (ghost at rest); add tap-to-move; settings: floating / fixed / tap only | R3, R4, R10 |
| Build mode | Separate mode | Swap HUD set: hide Wave/Speak, missions, people; keep mute + chat badge; bottom tool strip; one "Done" | R18 |
| Toasts / banners | | Top-center below call pill; one at a time, queue, 3-4 s; log to bell inbox | R12 |
| Onboarding | | Ghost-hand on joystick zone first run; first-near hint on Wave | R11 |
| Settings | | HUD scale, opacity, left-handed mirror, joystick mode, auto-fade on/off, reset | R10, R13 |

## Top 5 changes for portrait

1. Move the missions bar off the bottom: one-line chip top-left, auto-collapse while moving. This frees the prime thumb zone and the joystick area. (High confidence in the principle; placement medium.)
2. Floating joystick in a large lower-left zone plus tap-to-move, with a fixed option in settings. (High.)
3. Move chat entry to the bottom-right edge (badge), keep peek above bottom controls, and pin the composer to the visual viewport with quick replies. (Medium-high.)
4. Grow hit areas to 48 px+ with 8 px gaps, and keep controls clear of the bottom gesture strip and cutouts. (High.)
5. Add HUD settings: scale, opacity, left-handed mirror, joystick mode, auto-fade toggle. (High.)

## Sources (read)

- Apple HIG, Game controls: https://developer.apple.com/design/human-interface-guidelines/game-controls
- Apple HIG, Designing for games: https://developer.apple.com/design/human-interface-guidelines/designing-for-games
- Epic, Designing for mobile in Fortnite: https://dev.epicgames.com/documentation/fortnite/designing-for-mobile-in-fortnite
- Android, Large screen quality guidelines for games: https://developer.android.com/games/large-screen/build-large-screen-games
- Android, Tier 2 (Optimized) games: https://developer.android.com/games/large-screen/tier-2
- Xbox Accessibility Guideline 107 (input, mobile touch): https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/107
- Roblox, Cross-platform UI design: https://create.roblox.com/docs/ui/cross-platform-design
- Roblox, Mobile input: https://create.roblox.com/docs/input/mobile
- NN/g, Touch target size: https://www.nngroup.com/articles/touch-target-size/
- Smashing, Design mobile apps for one-hand usage: https://smashingmagazine.com/2020/02/design-mobile-apps-one-hand-usage/
- Game Developer, Designing for thumbs (Hoober grip data): https://gamedeveloper.com/design/how-to-design-for-thumbs-in-the-era-of-huge-screens
- GameAnalytics, Mobile vs desktop UI: https://www.gameanalytics.com/blog/mobile-desktop-ui-design
- Chrome, Viewport resize behavior: https://developer.chrome.com/blog/viewport-resize-behavior

Seen in search summaries only (not opened): Android gesture-navigation codelab
(https://developer.android.com/training/gestures/edge-to-edge), Tobii UI fade guidance, IxDF article citing
Hoober 7/9/12 mm, Habby / Survivor.io design coverage (pocketgamer.biz, globalgamesforum.com),
game accessibility guidelines (gameaccessibilityguidelines.com), itch.io chat complaint thread.
