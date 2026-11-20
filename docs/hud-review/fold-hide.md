# HUD controls: fold and hide

Every control that renders in an office, with the decision for each. "Fold" means the user can collapse it to
its header; the choice is kept per control in `localStorage` under `officexr:fold:<name>` (see
`hud/foldPrefs.ts`) and still works for the session when storage throws. `FoldablePanel`
(`hud/ui/FoldablePanel.tsx`) is the shared header and toggle (`aria-expanded`, a real button, 44 px on touch).

| Control | File | Foldable | Shown when | Reason |
|---|---|---|---|---|
| Identity card (name, status, chat and menu buttons) | `hud/IdentityCard.tsx` | No | Always (desktop; on touch its buttons move to the top-right row) | It holds the only entry points to chat and the menu, and it is one row tall. |
| Chat panel | `hud/ChatPanel.tsx` | No, it already hides | Peeks on a new message for 10 s, stays while typing (Enter) | A log that is open all the time covers the world. |
| People list | `hud/PresenceList.tsx` | Yes (`roster`), default open on desktop and folded on touch | Only after "People here" in the menu | On demand; folded it is a count chip. |
| Office menu | `OfficeHud.tsx` | No | Only after the menu button; Escape closes it | A popover. |
| Call card | `hud/CallCard.tsx` | Yes (`call`), default open on desktop; the touch card is always the folded form | Only while in a call | Folded it keeps the title, mute and leave. The call list under it still opens on demand. |
| Missions panel | `hud/missions/MissionsPanel.tsx` | Yes (`missions`), default open on desktop and folded on touch | Always (the T key unfolds it and opens the add form) | Folded it keeps the title and a count (open on desktop, progress bar on touch). On touch it no longer previews three rows, because a folded panel is one row. |
| Near-you card and buttons | `hud/NearYouCard.tsx` | No | Only while someone named is within 8 m | It already goes away on its own and has two actions. |
| Ping bell and inbox | `hud/PingInboxHud.tsx` | No | Only once a ping has arrived this session (or while its list is open) | An empty inbox has nothing to show; the bell was a permanent control for a rare event. |
| Map button and full map | `OfficeHud.tsx`, `hud/FullMap.tsx` | No | Button always (it is the only way to the map and has the M key); the map only when opened | Small and always needed; the map is a modal. |
| Build indicator (new) | `hud/BuildIndicator.tsx` | No | Only while build mode is open (B): prop name and the keys Tab, R, Enter, B | Shows which prop is selected; there is no build button. The key hints are hidden on touch. |
| Connection toast | `hud/ConnectionToast.tsx` | No | Only while connecting or reconnecting | Transient status. |
| Replaced and error banners | `hud/HudBanner.tsx` | No | Only while active; error banners can be dismissed | Must stay visible until the user acts. |
| Arrival bubble | `hud/PresenceList.tsx` | No | 4 s after someone joins | Transient. |
| Desk banner and buttons | `desk/DeskHud.tsx` | No | Only next to a claimable or owned desk, or when a seat is near (Sit, touch) | Context buttons. |
| Click-to-play prompt | `hud/ClickToPlayPrompt.tsx` | No | Only while the world has no keyboard focus | Disappears on the first click. |
| Settings, shortcuts, new-mission form | `room/`, `hud/missions/` | No | Only when opened | Modals and sheets. |

Not changed: the in-world name tags and bubbles, and the touch joystick, which is the movement control.

Captures are in `docs/hud-review/fold-hide/before` (main) and `after` (this branch), rendered from `/hud-preview`
at 1x: desktop 1440x900 and iPhone 13 landscape. `crowd-folded` has the missions panel and call card folded;
`crowd-unfolded` has the touch missions panel opened; `build-open` has build mode open.

## Phone portrait

The "Turn your phone" prompt is gone: the office plays upright. Portrait is a touch device with a narrow,
tall screen (`pointer: coarse` and `orientation: portrait`; Tailwind `pointer-coarse:portrait:`). Checked at
iPhone 13 (390x844, notch 47 px, home indicator 34 px), iPhone SE (375x667) and Pixel 5 (393x851).

Layout, from the top down:

- Safe area. `HudLayout` and the joystick sit inside `--hud-inset-*` (12 px, or the device's safe area if larger;
  `viewport-fit=cover` makes `env(safe-area-inset-*)` real). Nothing is drawn under the notch or the home bar.
- Top bar (right-aligned, one row, thumb-reachable with a stretch only for the map): chat, menu, ping bell (only
  once a ping arrived) and map, each 44 px. The identity card does not render on touch.
- Call pill, only in a call: under the top bar on its own row, with title, mute and leave. In landscape it stays
  in the top row. Chat, menu and people panels open below the pill in the same column, so they never cover it.
- Toasts and banners: top centre under the bar; when a call pill is shown they start below it.
- Bottom left: the virtual joystick (110 px), in the thumb zone, fixed to the safe-area corner.
- Bottom right: Wave and Speak, only while someone is near; the other thumb.
- Missions: a full-width bar folded above the joystick (title, progress, count), so the middle of the 3D view and
  the thumb zones stay clear. Unfolded it is a sheet above the joystick, at most `100dvh - 300px` tall.
- Build mode needs the B key, so there is no touch build UI; the indicator, if a keyboard is attached, sits in the
  toasts column.

One panel at a time in portrait: opening the chat input, the menu or the people list folds the missions panel,
and unfolding the missions panel closes the chat, menu and people list. Fold state defaults to folded on touch;
a user's choice is kept.

The default view in portrait has no panel over the middle of the screen: top bar, joystick, folded missions bar,
and Wave and Speak when someone is near. `tests/playwright/hud-layout.spec.ts` covers the portrait phones: no
overlapping HUD boxes, nothing outside the safe area, 44 px touch targets, no horizontal scroll and a canvas that
fills the viewport, for every `/hud-preview` scenario.
