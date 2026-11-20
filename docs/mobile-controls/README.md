# Mobile controls

On touch devices (`pointer: coarse`) the joystick sits bottom-left and the action pad bottom-right.

- `landscape.png`, `portrait.png`: studio Debug view on `pool_party`, Chromium with the iPhone 13 touch profile.
  The studio page is not phone-responsive, so these show the pad inside the world canvas only, not the web HUD.
  Interact is hidden here because no rack or seat is near; it appears in slot 2 (between Sprint and Poke).
- Jump (80 px) is the corner button. Sprint, Interact and Poke fan out on an inner ring; Emote and Hand
  (added by the web client) sit on an outer ring. Slot 6 is free.

Adding an action: build a `MobileAction` (see `packages/world/src/react/mobile-actions.ts`) with an unused `slot`,
and register it from any component under `PlayView` with `useMobileActions(actions)`. If it needs a held key in
the frame loop, add `ACTION_KEYS[id]` in `packages/world/src/input/action-input.ts` and read the key in `SceneFrame`.
