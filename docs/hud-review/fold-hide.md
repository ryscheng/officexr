# HUD controls: fold and hide

Every control that renders in an office, with the decision for each. "Fold" means the user can collapse it to
its header; the choice is kept per control in `localStorage` under `officexr:fold:<name>` (see
`hud/foldPrefs.ts`) and still works for the session when storage throws. `FoldablePanel`
(`hud/ui/FoldablePanel.tsx`) is the shared header and toggle (`aria-expanded`, a real button, 48 px on touch).

| Control | File | Foldable | Shown when | Reason |
|---|---|---|---|---|
| Identity card (name, status, chat and menu buttons) | `hud/IdentityCard.tsx` | No | Always (desktop; on touch the chat and menu buttons move: landscape to the top-right row, portrait menu to the top row and chat to the bottom right) | It holds the only entry points to chat and the menu, and it is one row tall. |
| Chat | `hud/ChatPanel.tsx`, `hud/ChatTicker.tsx`, `hud/useChatVisibility.ts` | Yes (`chat`), default open (peeks on a new message) | Folded: nothing but the chip (desktop) or the badge on the chat button (touch). Open: peeks on a new message (10 s desktop, 5 s phone portrait) only while not folded; stays while typing | Folding is the user putting the chat away: no peek, only an unread count. Opening it again unfolds it. An empty log is never drawn, only "No messages yet.". On a phone in portrait the open chat is a near-full-height sheet and a peek is a two-line preview, never a log over the world. |
| People list | `hud/PresenceList.tsx` | Yes (`roster`), default open on desktop and folded on touch | Only after "People here" in the menu | On demand; folded it is a count chip. |
| Office menu | `OfficeHud.tsx` | No | Only after the menu button; Escape closes it | A popover. |
| Call card | `hud/CallCard.tsx` | Yes (`call`), default open on desktop; the touch card is always the folded form | Only while in a call | Folded it keeps the title, mute and leave. The call list under it still opens on demand. |
| Missions panel | `hud/missions/MissionsPanel.tsx`, `MissionRow.tsx` | Yes (`missions`), default open on desktop and folded on touch | Always (the T key unfolds it and opens the add form) | Desktop and landscape: a panel, folded to its header (a `w-fit` pill on touch). Phone portrait: a one-line chip at the top centre, under the top bar (current mission or "Missions", and the count), at most 60% of the width, that shrinks to icon and count while the avatar moves; unfolded it is a bottom sheet at 55% or 90% of the height with Mine and Team tabs. |
| Near-you card and buttons | `hud/NearYouCard.tsx` | No | Only while someone named is within 8 m | It already goes away on its own and has two actions. |
| Ping bell and inbox | `hud/PingInboxHud.tsx` | No | Only once a ping has arrived this session (or while its list is open) | An empty inbox has nothing to show; the bell was a permanent control for a rare event. |
| Map button and full map | `OfficeHud.tsx`, `hud/FullMap.tsx` | No | Button always (it is the only way to the map and has the M key); the map only when opened | Small and always needed; the map is a modal. |
| Build indicator (new) | `hud/BuildIndicator.tsx` | No | Only while build mode is open (B): prop name and the keys Tab, R, Enter, B | Shows which prop is selected; there is no build button. The key hints are hidden on touch. |
| Connection toast | `hud/ConnectionToast.tsx` | No | Only while connecting or reconnecting | Transient status. |
| Replaced and error banners | `hud/HudBanner.tsx` | No | Only while active; error banners can be dismissed | Must stay visible until the user acts. |
| Arrival bubble | `hud/PresenceList.tsx` | No | 4 s after someone joins | Transient. |
| Desk banner and buttons | `desk/DeskHud.tsx` | No | Only next to a claimable or owned desk, or when a seat is near (Sit, touch) | Context buttons. |
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

The rules come from `docs/hud-review/android-hud-best-practice.md` (R1 to R18, with sources). Portrait is a touch
device with a narrow, tall screen (`pointer: coarse` and `orientation: portrait`; Tailwind `pointer-coarse:portrait:`).
Desktop and landscape keep the earlier layout. Every position and size lives in one place, the portrait block of
`src/index.css` (`--hud-inset-*`, `--hud-portrait-*`, `--hud-sheet-*`), so it is easy to adjust.

Layout, from the top down:

- Safe area and insets (R6): the safe area plus 8 px at the top and sides (at least 12 px top, 16 px sides) and plus
  16 px at the bottom (at least 16 px), so nothing sits in the bottom gesture strip.
- Top bar, right-aligned: menu, ping bell (only once a ping arrived) and map, each 48 px with 8 px gaps. They fade to
  40% while the avatar moves. Chat is no longer here (R2: low-frequency items go top, frequent ones go to the thumb).
- Mission chip (R15), top centre, under the top bar: a one-line pill, 40 px visible and 48 px hit area, at most 60%
  of the width. The tracker sits at the top centre in all 12 portrait screens of the game survey. It shows the current mission (or "Missions") and `done/total`. After 1.5 s of
  movement it shrinks to icon and count; 0.5 s after the avatar stops it comes back (R13, `useMovingFade`).
- Call pill, only in a call: under the chip row, right-aligned, on its own row. Never faded. A sheet that opens during a
  call stops under the pill, so mute and leave stay reachable.
- Toasts and banners: one column, top centre, under the pill row.
- Bottom left: nothing fixed. The joystick floats (R3): it starts under the thumb where a touch lands on the world in
  the lower 45% x left 60% of the screen, base 110 px, with a faint hint (40% opacity) in the corner at rest. A touch
  that lands on a HUD control never starts it, and the world still receives the touch. Settings, Controls has
  "Joystick: Floating or Fixed" (kept in `localStorage`, `hud/joystickMode.ts`).
- Bottom right, from the top down: the chat preview (only for 5 s after a message, if the chat is not folded; two lines,
  tappable), the chat button with the unread badge, then Wave (64 px, raised on an arc) and Speak (72 px) while someone is near
  (R17).
- Sheets (R8): chat, missions, menu, people and the new-mission form are bottom sheets under the top bar, with a
  48 px close button and Escape. One at a time: opening one closes the others. The missions sheet is 55% of the
  height (90% on screens under 700 px, or after Enlarge). The chat sheet is near full height, follows
  `visualViewport` (so a keyboard on iOS does not cover the input; Android resizes the window), and keeps the
  keyboard open after Send.
- Build mode (R18): while it is open, the mission chip, Wave and Speak and the people sheet are hidden; mute (call pill)
  and the chat button stay. Build mode still needs the B key, so there is no touch build UI.
- Touch targets are at least 48 px with at least 8 px between targets (R5).

HUD coverage at rest (union of all HUD boxes over the viewport, measured by the layout spec on `/hud-preview?scenario=crowd`,
with a call and someone near): 12.0% on a 390x844 portrait phone and 12.0% on an 844x390 landscape phone; the spec fails
above 20%. The middle third of the portrait view holds no HUD box at rest (also checked).

The default view in portrait has no panel over the middle of the screen: top bar, mission chip, the chat button,
and Wave and Speak when someone is near. `tests/playwright/hud-layout.spec.ts` covers the portrait phones: no
overlapping HUD boxes, nothing outside the safe area, 48 px targets, 8 px gaps, nothing in the bottom 16 px,
the mission chip centred, at most 60% wide and in the top third, one sheet at a time, the chat sheet above a simulated keyboard,
the chat preview and its fold, the chip collapsing while moving, and the floating and fixed joystick, for every
`/hud-preview` scenario and state.

## What is not done (follow-up)

- Tap-to-move on the floor (R4): there is no floor-tap walking in the world package today (only `goTo` a player and
  seat `goToPoint`). It needs a raycast in the renderer and the mugshot and e2e suites, so it is not in this change.
  The floating joystick leaves the canvas touch alone, so it can be added without changing the stick.
- HUD settings (R10) other than joystick mode: scale, opacity, left-handed mirror, auto-fade toggle and reset.
  Left-handed needs every zone mirrored, so it is a separate change.
- Quick-reply chips in the chat sheet, a "nearby people" chip (R16), first-run hints (R11), haptics and press rings
  (R7), a queue for toasts (R12, toasts are still stacked), and a Sit button in the right-thumb arc (it still shows
  in the toast column).

## References: portrait action RPG patterns

Generic patterns of one-handed portrait action games, not any one game's look. Applied as follows.

| Pattern | Applied | How |
|---|---|---|
| Zones: thin top strip, nothing persistent in the middle, thumb zone at the bottom | Yes | Top bar and chip at the top; no panel in the middle at rest; chat, Wave and Speak at the bottom right; the floating stick in the lower left. |
| Floating joystick with an idle hint, not a fixed widget | Yes, with a Fixed option | `VirtualJoystick floating`; portrait only. |
| One primary context action, large, in the right-thumb arc; secondary smaller on an arc | Yes | Speak 72 px, Wave 64 px raised. The Sit button is not moved (follow-up). |
| Quest tracker: compact one-line chip top left, tap for a sheet | Yes | Mission chip and the 55% or 90% sheet. |
| Chat: icon with badge, short ticker, near-full-height sheet with the input above the keyboard | Yes, the icon is bottom right (R2, R14) | Chat button, preview, sheet. |
| Menus, people, map, settings as full-screen or bottom sheets, one at a time | Menu and people yes; map and settings stay centred modals | They are already one-at-a-time modals with a close button. |
| Toasts: one slot under the top strip | Partly | One column under the chip row; not queued yet. |
| 44 px+ targets and safe-area insets | Yes, 48 px | See the layout above. |

Captures are in `docs/hud-review/fold-hide/portrait-v3/` (iPhone 13 and iPhone SE, light and dark) with a `.json` box
dump beside each; the earlier #259 portrait captures stay in `docs/hud-review/fold-hide/portrait/` as the "before".
