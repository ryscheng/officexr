# Mobile controls

Format: rule; **Why**; **Number**; **Here**. Source keys map to `sources.md`.

officexr on touch: `pointer: coarse`. Landscape = two thumbs. Portrait = often one thumb,
`pointer-coarse:portrait:` in Tailwind. Movement is the only control that must always show.

## A. Movement

**M1. Know the three joystick types and pick on purpose.**
- Fixed (static): base stays at one spot. Easy to find again, but the thumb drifts off it.
- Dynamic (floating): base appears where the thumb lands inside an activation zone, goes away on
  release.
- Following: like dynamic, and the base slides after the thumb when it passes the edge.
- Why: a fixed stick needs the player to find its centre; drift causes loss of control.
  [apple-hig-games] [epic-mobile] [nipplejs] [godot-vjoy]
- Number: stick base 100-120 px; knob about 50% of base; dead zone about 10% of radius;
  clamp at the base edge; resting ghost at 30-40% opacity. [android-portrait R3] [nipplejs]
- Here: officexr has a fixed 110 px stick bottom-left. A dynamic stick in the lower-left zone
  (about the lower 45% of height, left 60% of width, minus other controls) is the stronger
  default; keep fixed as a setting.

**M2. The joystick never hides, fades or gets covered.**
- Why: it is the movement control; losing it strands the player. [android-portrait R13]
- Number: none.
- Here: `hud-layout.spec.ts` checks that the joystick is not covered in portrait. Panels and
  sheets open above it, not on it.

**M3. Offer tap-to-move (tap the floor to walk there) and tap-to-interact (tap a person or object).**
- Why: lowest-effort input for a social world; an alternative to a drag path for players who
  cannot hold a drag. [apple-hig-games] [xag-107] [android-portrait R4]
- Number: none.
- Here: tap avatar = person card (talk, wave, ping). Tap floor = walk there with a marker at the
  target. Must not fire while the joystick is held.

**M4. Never start a drag control in the system gesture strips.**
- Why: bottom edge is home, side edges are back on Android; drags there exit the app.
  [android-portrait R6]
- Number: keep drag start zones 16-24 px above the bottom inset and 16 px from side edges.
- Here: the joystick activation zone ends above the home indicator.

**M5. Camera on touch: one-finger drag on empty world to orbit, pinch to zoom; never on top of
the joystick zone.**
- Why: gestures must not compete for the same area. Inference from [apple-hig-games] and
  [epic-mobile] (gesture should match intent).
- Number: none.
- Here: separate zones: left-bottom moves, the rest of the world rotates or taps.

## B. Buttons

**M6. At most 5-6 controls visible at rest; target 4-5 plus 1-2 context buttons.**
- Why: each control covers world and adds mis-taps. [epic-mobile] [android-portrait R1]
- Number: 5-6.
- Here: portrait at rest today: chat, menu, map (top), joystick, folded missions bar. Ping bell,
  call pill, Wave and Speak add only in context.

**M7. Context buttons appear next to one fixed "do the thing here" spot, and leave when not needed.**
- Why: one spot is learned fast; no permanent clutter. [roblox-xplat] [android-portrait R17]
- Number: at most 2 context buttons, 56-64 px, in an arc 8-12 px apart, 200 ms fade or scale in.
- Here: Wave and Speak bottom-right when someone is within 8 m; Sit near a seat. A new context
  action joins this arc; it does not get a new corner.

**M8. Place new buttons relative to the main action button, not at absolute screen positions.**
- Why: reach changes by device; relative placement stays in reach. [roblox-xplat]
- Number: Roblox example: 0.8x the jump button size, 20 px to its left.
- Here: position new context buttons from the bottom-right anchor.

**M9. Use long-press or a "more" menu before you add another button.**
- Why: combine variants into one control. [apple-hig-games] [android-portrait R17]
- Number: long-press about 500 ms (platform default; inference).
- Here: long-press Wave for the emote picker; not a separate emote button.

**M10. Activate on release, allow slide-off to cancel, show a press state bigger than the finger.**
- Why: the finger hides the control; slide-off saves mistakes. [apple-hig-games] [xag-107]
- Number: press feedback within 100 ms; optional haptic `navigator.vibrate(10)` where supported
  (not on iOS Safari).
- Here: buttons act on `pointerup`; `:active` ring or scale on press.

**M11. No repeated tapping or held presses for core actions.**
- Why: button mashing and long holds exclude players with motor limits. [gag] [xag-107]
- Number: none.
- Here: a held key on desktop (sprint) becomes a toggle on touch.

## C. Portrait vs landscape

**M12. Portrait is a first-class layout, not a "turn your phone" gate.**
- Why: many players hold phones upright, often one-handed; GAG lists "allow play in both
  landscape and portrait". [gag] [fold-hide]
- Number: none.
- Here: the rotate prompt was removed; keep it removed.

**M13. Portrait: one thumb. Primary actions in the bottom 40%; low-frequency at top; one panel at a
time.**
- Why: thumb reach; the top is a stretch. [hoober-uxm] [smashing-onehand] [android-portrait R2]
- Number: Hoober 49% one-handed; one app raised menu clicks 9% (items 30%) by moving the menu to
  the bottom. [smashing-onehand]
- Here: today's portrait puts chat, menu and map at top. Chat is frequent; consider moving its
  entry to the bottom-right with a badge.

**M14. Landscape: two thumbs at the bottom corners; the sides are partly under the hands and the
notch.**
- Why: side safe areas are large in landscape; hands cover the lower sides. [donchitos-hud]
  [roblox-xplat]
- Number: one HUD guide suggests 15% side margins on landscape phones; iPhone 13 side inset is
  47 px.
- Here: keep the top row short (six controls collided with toasts on an 844 px phone).

**M15. Panels open as bottom sheets on phones.**
- Why: sheets open from the reachable edge, keep context, close with a swipe or back.
  [smashing-onehand] [android-portrait R8]
- Number: drag handle 32x4 px; peek 25-35%, half 50-60%, full 90%.
- Here: the new-mission form is already a bottom sheet on touch.

**M16. The on-screen keyboard covers half the screen: pin the input to the visual viewport.**
- Why: fixed bottom bars sit under the keyboard on Chrome 108+ by default. [chrome-viewport]
  [android-portrait R14]
- Number: send button 48 px; keep the keyboard open after send.
- Here: chat input on phones: use `interactive-widget=resizes-content` or a `visualViewport`
  listener; check on iOS Safari too.

## D. Settings and testing

**M17. Let the player change the layout: joystick mode, scale, opacity, left-handed mirror.**
- Why: hands differ; layouts tested split players evenly. [xag-107] [android-portrait R10]
- Number: scale 80-140%; opacity 40-100%.
- Here: not built; one settings task, not per-control toggles.

**M18. Test on real sizes: iPhone SE (smallest), iPhone 13, Pixel 5, iPad, both orientations.**
- Why: what fits 390 px may not fit 320 px. [android-large-screen]
- Number: iPhone SE browser viewport 320x568 in the repo captures.
- Here: `HUD_CAPTURE_DEVICES=iphone-se-portrait,iphone13-portrait,iphone13-landscape,pixel5-portrait`.

**M19. Touch hardware is a capability, not the input in use.**
- Why: touch laptops report touch; a phone may have a keyboard. [roblox-ui-skill]
- Number: none.
- Here: decide by `pointer: coarse` for layout and by the last input event for key hints.
