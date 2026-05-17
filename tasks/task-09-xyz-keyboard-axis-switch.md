# Task 09: X/Y/Z Keyboard Shortcuts to Switch Next Tiling Axis

## Objective
Wire X, Y, Z key events to `switchNextAxis` in the tiling state machine during an active tile gesture, and show a hint in the UI.

## Context

**Quick Context:**
- `switchNextAxis` from `tileStateMachine.ts` (task-08) accepts a `TileAxis` and returns the updated state. The canvas needs to call `setTileState(switchNextAxis(tileState, axis))` when X/Y/Z is pressed.
- The keyboard listener pattern already exists in `SceneEditorCanvas.tsx`: the Escape key is handled by a `useEffect` with a `window.addEventListener('keydown', ...)` pattern.
- A UI hint should appear in the existing hint area (if present) or be added as a small overlay during the tile gesture. Look at the existing hint/tooltip area in `RoomApp.tsx` or `Toolbar.tsx` before deciding placement.

## Requirements

1. In `SceneEditorCanvas.tsx`, add a `useEffect` (when `tool === 'tile'`) that:
   - Listens for `keydown` on `window`.
   - Ignores events where the target is `INPUT` or `TEXTAREA`.
   - On `key === 'x'` (or `'X'`): calls `setTileState(switchNextAxis(tileState, 'x'))`.
   - On `key === 'y'` (or `'Y'`): calls `setTileState(switchNextAxis(tileState, 'y'))`.
   - On `key === 'z'` (or `'Z'`): calls `setTileState(switchNextAxis(tileState, 'z'))`.
   - The effect cleanup removes the listener.
   - Use `tileState` in the effect dependency array (or use a `ref` mirror to avoid stale closure — see the existing `stateRef` pattern in `MoveController`).

2. The hint area:
   - Locate the nearest existing hint/tooltip container in `RoomApp.tsx` or `SceneEditorCanvas.tsx`. Prefer reusing existing patterns over adding new DOM elements.
   - During `tool === 'tile'` and `tileState.stage !== 'idle'`, render a small text hint: `"X / Y / Z — switch axis"`.
   - The hint may be a simple absolute-positioned div overlaid on the canvas, or appended to the existing toolbar hint area. Match the visual style of other hints in the UI.
   - The hint should only show when there are at least 2 axes available for the current kind (i.e. `tileState.remainingAxes.length > 1`).

3. Key handling must be case-insensitive: both lowercase `'x'` and uppercase `'X'` (Shift+X) should trigger the switch.

## Existing Code References
- `packages/studio/src/modes/room/SceneEditorCanvas.tsx` — existing Escape key handler pattern (around line 298); `tileState` / `setTileState` state
- `packages/studio/src/modes/room/tileStateMachine.ts` — `switchNextAxis` (task-08)
- `packages/studio/src/modes/room/RoomApp.tsx` — top-level room editor; look for existing hint/status area
- `packages/studio/src/modes/room/Toolbar.tsx` — toolbar component; may contain a hint row

## Implementation Details
- Use a `tileStateRef` (mirror of `tileState` in a ref) in the key handler to avoid re-adding the listener on every state change — same pattern as `stateRef` in `MoveController`.
- Alternatively, keep the effect dependency on `tileState` if the re-registration cost is negligible (the tile gesture is short-lived). Choose whichever is cleaner.
- Do NOT block the Escape handler — both Escape (cancel gesture) and X/Y/Z (switch axis) should be handled independently.

## Acceptance Criteria
- [ ] Pressing X during an active tile gesture (stage `placed` or `axis-extruded`) sets `nextAxis` to `'x'` if `'x'` is in `remainingAxes`.
- [ ] Pressing Y or Z changes `nextAxis` to the respective axis if available.
- [ ] Pressing an axis key that is not in `remainingAxes` has no effect on the state.
- [ ] Pressing X/Y/Z while typing in an input/textarea field does NOT trigger axis switching.
- [ ] The hint "X / Y / Z — switch axis" is visible during an active tile gesture when 2+ axes are available.
- [ ] The hint is hidden when the tile tool is idle.
- [ ] `pnpm --filter @officexr/studio build` passes without type errors.
- [ ] Existing Escape behavior still works (cancels the tile gesture).

## Dependencies
- Depends on: task-08 (tiling state machine with `switchNextAxis`)
- Blocks: task-11
