# HUD controls: fold and hide

Every control that renders in an office, with the decision for each. "Fold" means the user can collapse it to
its header; the choice is kept per control in `localStorage` under `officexr:fold:<name>` (see
`hud/foldPrefs.ts`) and still works for the session when storage throws. `FoldablePanel`
(`hud/ui/FoldablePanel.tsx`) is the shared header and toggle (`aria-expanded`, a real button, 48 px on touch).

| Control | File | Foldable | Shown when | Reason |
|---|---|---|---|---|
| Identity card (name, status, chat and menu buttons) | `hud/IdentityCard.tsx` | No | Always (desktop; on touch the chat and menu buttons move: landscape to the top-right row, portrait menu to the top row and chat to the bottom right) | It holds the only entry points to chat and the menu, and it is one row tall. |
| Chat | `hud/ChatPanel.tsx`, `hud/ChatTicker.tsx`, `hud/useChatVisibility.ts` | Yes (`chat`), default open on desktop and folded on touch | Folded: nothing but the chip (desktop) or the badge on the chat button (touch). Open: peeks on a new message (10 s desktop, 5 s phone portrait) only while not folded; stays while typing | Folding is the user putting the chat away: no peek, only an unread count. Opening it again unfolds it. An empty log is never drawn, only "No messages yet.". On a phone in portrait the open chat is a near-full-height sheet and a peek is a two-line preview, never a log over the world. |
| People list | `hud/PresenceList.tsx` | Yes (`roster`), default open on desktop and folded on touch | Only after "People here" in the menu | On demand; folded it is a count chip. |
| Office menu | `OfficeHud.tsx` | No | Only after the menu button; Escape closes it | A popover. |
| Call card | `hud/CallCard.tsx` | Yes (`call`), default open on desktop; the touch card is always the folded form | Only while in a call | Folded it keeps the title, mute and leave. The call list under it still opens on demand. |
| Missions panel | `hud/missions/MissionsPanel.tsx`, `MissionRow.tsx` | Yes (`missions`), default open on desktop and folded on touch | Always (the T key unfolds it and opens the add form) | Desktop and landscape: a panel, folded to its header (a `w-fit` pill on touch). Phone portrait: a one-line chip under the top bar (current mission or "Missions", and the count), at most 60% of the width, that shrinks to icon and count while the avatar moves; unfolded it is a bottom sheet at 55% or 90% of the height with Mine and Team tabs. |
| Near-you card and buttons | `hud/NearYouCard.tsx` | No | Only while someone named is within 8 m | It already goes away on its own and has two actions. |
| Ping bell and inbox | `hud/PingInboxHud.tsx` | No | Only once a ping has arrived this session (or while its list is open) | An empty inbox has nothing to show; the bell was a permanent control for a rare event. |
| Map button and full map | `OfficeHud.tsx`, `hud/FullMap.tsx` | No | Button always (it is the only way to the map and has the M key); the map only when opened | Small and always needed; the map is a modal. |
| Build indicator (new) | `hud/BuildIndicator.tsx` | No | Only while build mode is open (B): prop name and the keys Tab, R, Enter, B | Shows which prop is selected; there is no build button. The key hints are hidden on touch. |
| Connection toast | `hud/ConnectionToast.tsx` | No | Only while connecting or reconnecting | Transient status. |
| Replaced and error banners | `hud/HudBanner.tsx` | No | Only while active; error banners can be dismissed | Must stay visible until the user acts. |
| Arrival bubble | `hud/PresenceList.tsx` | No | 4 s after someone joins | Transient. |
| Desk banner and buttons | `desk/DeskHud.tsx` | No | Only next to a claimable or owned desk, or when a seat is near (Sit, touch) | Context buttons. |
| Click-to-play prompt | `hud/ClickToPlayPrompt.tsx` | No | Only while the world has no keyboard focus, and never on a touch screen | Disappears on the first click; a touch screen has no keyboard focus to lose, and in portrait the prompt covered the middle of the view. |
| Shortcuts and new-mission form | `room/`, `hud/missions/` | No | Only when opened | Modals and sheets; the new-mission form is a sheet in portrait. |
| Floating joystick (new in this pass) | `world/react/VirtualJoystick.tsx` | n/a | Touch only; in portrait it starts where a thumb lands on the world in the lower 45% x left 60% of the screen, with a faint hint in the corner at rest; "Fixed" in Settings, Controls keeps the old corner stick | Nothing has to keep clear of a fixed widget, and a tap on the world still reaches the canvas. Landscape keeps the fixed stick. |
| Chat button and preview (portrait) | `hud/OfficeHud.tsx`, `hud/ChatTicker.tsx` | n/a | Chat button always (bottom right, above Wave and Speak, with the unread badge); the preview only for 5 s after a message, if not folded | Frequent action in the right thumb zone; the preview is above the controls, in the lower half, tappable. |
| Portrait sheets (chat, missions, menu, people, new mission) | `hud/ui/PortraitSheet.tsx` | n/a | Only when opened; one at a time | A bottom sheet under the top bar, 48 px close button, follows `visualViewport` so a keyboard cannot cover it; Escape closes it. |
| Screen-share viewer | `voice/JaasMeeting.tsx` | No | Only while someone in the call shares; Enlarge opens it full screen | It was missing from the first table. In portrait it is 192x108 px and sits below the call and mission rows (`--hud-share-top`), inside the safe area. |
| Seat refusal toast | `world/react/hud.tsx` | No | 1.5 s after a refused sit | Missing before. In portrait it sits above the preview and controls (`--hud-seat-toast-bottom`), clear of the joystick. |
| Map error banner | `world/react/hud.tsx` | No | Only on a map load error; click dismisses | Missing before. In portrait it starts below the top rows (`--hud-error-top`). |
| Teleport flash, loading screen | `world/react/hud.tsx`, `LoadingScreen.tsx` | No | 0.45 s after a sit teleport; until the world is ready | Missing before. Transient, no input; not changed. |
| Settings modal, full map | `room/SettingsModal.tsx`, `hud/FullMap.tsx` | No | Only when opened | Modals; targets raised to 48 px on touch. Settings, Controls has the new Joystick choice (touch only). |
| Debug and Leva panels | `world/react/hud.tsx` (`hud="debug"`) | No | Never in the web app (`hud="player"`); no Leva in the repo | Checked: nothing debug can show in production. |
| Tooltips, Picture-in-picture window, in-world name tags and bubbles | `hud/IconButton.tsx`, `pip/`, world renderer | No | Hover only; own window; in the world | Not part of the touch HUD; not changed. |

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

Portrait captures, all eight `/hud-preview` scenarios, light and dark, iPhone 13 (390x664 browser viewport) and
iPhone SE (320x568 browser viewport), are in `docs/hud-review/fold-hide/portrait/` with a `.json` box dump
beside each. `crowd-missions-open` and `crowd-menu-open` show the one-panel-at-a-time rule.
