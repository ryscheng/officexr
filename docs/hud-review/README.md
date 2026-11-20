# Web HUD review

Screenshots in `before/` come from the hermetic preview (`pnpm --filter @officexr/web dev:hud-preview`, then
`/hud-preview?scenario=<name>`), driven by `tests/playwright/hud-capture.spec.ts`. Each `.png` has a `.json`
next to it with the viewport, every HUD box, the overlapping pairs, the boxes outside the safe area and the
touch targets under 44 px. File names are `<scenario>__<device>__<theme>`.

Captured (1x pixel ratio, so software WebGL stays fast): iPhone 13 landscape (all six scenarios, light; `crowd`
and `build` also dark), iPhone 13 and Pixel 5 portrait (`crowd`), Pixel 5 landscape (`crowd`), iPad Pro 11
landscape and desktop 1440x900 (`crowd`, `wand`, `build`, `full`; `crowd` also dark). `full` on desktop in light
did not finish in the time limit. Phones in portrait show the "Turn your phone" prompt over the HUD, so a portrait
capture shows only that prompt.

## Faults found (before any change)

Overlaps and z-order
1. The touch pad's Build button (outer ring, 240 px from Jump) sits on the top-right row (Pings, Build B, Stop
   building) and touches the minimap. Seen in every touch capture.
2. The folded people chip under the minimap overlaps the Poke pad button (and Jump on a short screen); the
   minimap's folded "Show map" tile overlaps Cast when the wand is held.
3. With the wand held, Jump overlaps "Put wand back" and Emote overlaps "Spell: Fireball" (both in the pad's
   outer rings); in build mode Emote overlaps Place.
4. The top-right row (status, hand, emote, pings, Build, settings) is six controls wide. On 844 px it reaches
   under the centre toasts: "Poked by ..." overlaps the status and hand buttons.
5. The build panel (448 px wide, top centre) covers the middle of a phone screen and sits above the pad, so pad
   buttons show through its glass. Its key hints (Enter, R, Tab, T, G, Delete) mean nothing on touch.
6. The spell bar (about 400 px wide, bottom centre) runs into the joystick and chat chip on a phone and shows
   keycaps 1-4 on touch.

Safe area and edges
7. `HudLayout` used a fixed 12 px inset with no safe area. With iPhone landscape insets (47 px left and
   right) eight controls were outside: Jump, Poke, settings, the minimap tile, mute, the call count and the
   chat chip. Fixed (see below).

Sizes and text
8. Touch targets under 44 px: spell-bar slots (27 px high), the "(you)" name button in the people list (16 px).
9. Text of 10-11 px in the people list (status line, distance), the call label and badges; minimap labels
   are 7-8 px. Names and status lines truncate with no way to read them in full ("Chiamaka Oko...").
10. Panel widths vary with no rule: map 240, people 240, chat 320, build 448, status popover 256, pings 240,
    emote 224.

Consistency
11. The status chip and the chat chip use the same speech-bubble icon, and the top row is icon-only with no
    labels, so status, hand, emote and pings are hard to tell apart.
12. In-world name tags and status bubbles are glass-on-glass where they pass under HUD panels; the tag of a
    player near the top edge ends up under the toolbar.
13. Settings is the only accent-filled glass button while Build (the other primary) is a text button, so the
    top row mixes three button styles.

## What was fixed

Only the safe-area bug (7): `HudLayout`, the touch pad and the joystick now keep off the edge through
`--hud-inset-*` tokens in `index.css` (12 px edge gap or the safe area, whichever is larger; no change on a
screen without a notch). The layout is otherwise unchanged by request; the rest is left for the design.

`hud-layout.spec.ts` fails on the faults above until the layout is redesigned, so it is not in `test:e2e:ci`.
A draft of a phone drawer, call pill and pad with a "more" menu is on the local branch `hud-layout-draft`
for reference; it is not part of this branch.

## Update: HUD reverted

The touch action pad, status chip and editor, emote picker, hand button, focus and poke toasts, status rows in the
people list, build panel, spell bar, sound settings and the `--hud-inset-*` safe-area tokens were removed again, so
the on-screen HUD matches the one before those changes. The faults above that name those parts no longer apply.
The keyboard paths, in-world visuals, the preview and the specs stay. Captures of the reverted HUD are in
`after-revert/`.

## B4 mission list

The approved layout is built; `b4/` holds captures of `/hud-preview?scenario=missions` (desktop 1440x900 and iPhone landscape, light and dark): `missions` (one mission current), `new-mission` (the form, or the bottom sheet on touch) and `map` (the full map opened with M).
