# Implementation Notes

## Task 01: RoomHistory Engine (TDD)

- **Decisions**: Used a doubly-linked list (`HistoryNode` with `prev`/`next`) stored in a `useRef` to avoid triggering React re-renders on every history mutation. Chose `_currentDoc` as a cached field on the `RoomHistory` class rather than recomputing on every access by replaying from base — `redo` can just apply the next action incrementally, while `undo` must replay from base.
- **Deviations**: The `applyAction.ts` stub created in Task 01 handled only the `'place'` action type (returning the doc with the new command appended). This was sufficient for all 11 `RoomHistory` tests since they test linked-list mechanics rather than specific action semantics. Full implementation landed in Task 02.
- **Trade-offs**: `getNodes()` strips `prev`/`next` references before returning to avoid circular-reference issues if the caller serializes the array. This means callers can't walk the list themselves, but that's fine — they only need the flat list for the history panel UI.
- **Risks**: `jumpTo` with a large history replays from base every time — O(n) per jump. Acceptable for editor-scale histories (dozens to low hundreds of nodes).

## Task 02: applyAction Pure Reducer (TDD)

- **Decisions**: Implemented `applyAction` as a pure function with no side effects — every action variant returns a new `RoomDocument` object without mutating the input. Used spread operators throughout (`{ ...doc, commands: [...] }`).
- **Deviations**: None. The 15 tests covered all 9 action types plus sequence replay and immutability invariants.
- **Trade-offs**: The `delete` action's `groupsAffected` field tracks which group memberships to remove — this is computed in `useRoomDocument` before calling `push()` and stored on the action so `applyAction` doesn't need to re-derive it. Slightly redundant data on the action object, but keeps `applyAction` stateless.
- **Risks**: No non-obvious risks.

## Task 03: Wire RoomHistory into useRoomDocument

- **Decisions**: `historyRef = useRef<RoomHistory | null>(null)` stores the mutable linked-list without triggering re-renders. A `getHistory(baseDoc)` lazy-init function creates the `RoomHistory` on first call and returns the existing one thereafter. Every mutator follows the same pattern: construct `EditAction` → `getHistory(doc).push(action)` → `setDoc(h.currentDoc)`.
- **Deviations**: `historyNodes` and `historyCurrentNodeId` are derived from the ref at render time (read after every `setDoc` call), not stored in separate state — avoids double-renders.
- **Trade-offs**: The history ref is reset on `storage.load` (load from disk replaces the base document). Any in-flight undo/redo history is discarded — intentional, since loading a different room should start fresh.
- **Risks**: No non-obvious risks.

## Task 04: Remove Extrude Tool

- **Decisions**: Removed `ExtrudeInspector` component, `ExtrudeProps` interface, the extrude Section from `PlaceCubeInspector`, and the `extrudeFromFace`/`setExtrudeFace`/`setExtrudeCount` mutators from `useRoomDocument`. Also removed `newExtrude` and `CubeFace` imports since they were only used by extrude.
- **Deviations**: Added a `Readonly label="id"` row to `PlaceCubeInspector` displaying the command ID — this was not in the original spec but makes debugging easier and was a natural addition given the inspector already showed kindId and position.
- **Trade-offs**: None — the extrude tool was a planned removal.
- **Risks**: No non-obvious risks.

## Task 05: Keyboard Shortcuts (Undo/Redo)

- **Decisions**: Added Ctrl/Cmd+Z (undo), Ctrl/Cmd+Shift+Z (redo), Ctrl+Y (redo, Windows convention) inside the existing `ctrlKey` block in `RoomApp.tsx`. The Ctrl+Shift+Z check comes before the plain Ctrl+Z check to avoid misfiring.
- **Deviations**: None.
- **Trade-offs**: `Ctrl+Y` is skipped when `metaKey` (Mac Command) is held — `Cmd+Y` is an uncommon Mac shortcut and avoiding it prevents surprising behavior on Mac.
- **Risks**: No non-obvious risks.

## Task 06: History Panel UI (TDD)

- **Decisions**: Rewrote `CommandHistory.tsx` with new props (`nodes`, `currentNodeId`, `onJumpTo`) replacing the old delete-button-based API. Visual states: past items (normal), current item (blue `#1d4ed8` background, `data-current="true"`), future items (muted `#525252` text, `data-future="true"`).
- **Deviations**: `@testing-library/jest-dom` is not installed in the studio package, so `toBeInTheDocument` was not available. Tests were rewritten to use `container.textContent` (contains check), `container.querySelector()`, and `getAttribute()` instead.
- **Trade-offs**: No `data-testid` attributes added — used structural queries and `data-current`/`data-future` attribute assertions instead, which also double as useful CSS/accessibility hooks.
- **Risks**: No non-obvious risks.

## Task 07: Generalized ObjectPalette (TDD)

- **Decisions**: Exported `groupByCategory` as a pure function for unit-testability. Used `vi.mock('@officexr/world/scenes', ...)` with `async (importOriginal)` pattern to mock `useCubeCatalog` and `thumbnailUrlForKind` in tests. Added `thumbnailUrlForKind` to `packages/world/src/scenes/index.ts` export.
- **Deviations**: `thumbnails.ts` in Task 07 was created as a stub returning `null` always (the real implementation came in Task 10).
- **Trade-offs**: `KindButton` renders a swatch fallback (colored div) when no thumbnail exists — uses the kind's `color` field if available, else a default grey. This keeps the palette usable before thumbnails are generated.
- **Risks**: No non-obvious risks.

## Task 08: Category Editing in Object Editor

- **Decisions**: Added `'character'` to `CubeKindCategory` union in `cube-kinds-schema.ts` and to `CUBE_KIND_CATEGORIES` array. Added 4 new tests to `cube-catalog.test.ts` covering `patchKind` category update, subscriber notification, `'character'` as a valid category, and `CUBE_KIND_CATEGORIES` including `'character'`.
- **Deviations**: None.
- **Trade-offs**: No non-obvious trade-offs.
- **Risks**: No non-obvious risks.

## Task 09: Thumbnail Generation Script

- **Decisions**: Created `packages/world/scripts/gen-thumbnails.ts` using Playwright to navigate to `/#object?thumbnailMode=true`, click `[data-kind-id]` buttons, and screenshot the canvas. Added `thumbnailMode` detection to `ObjectPreviewCanvas.tsx` via `new URLSearchParams(window.location.search).get('thumbnailMode') === 'true'`. Added `playwright` to `packages/world/package.json` devDependencies after a typecheck failure revealed it was missing (previously only in studio's devDeps).
- **Deviations**: Used `pnpm install` (without `--frozen-lockfile`) to update the lockfile when adding playwright to world's devDeps — the lockfile was out of sync.
- **Trade-offs**: Playwright is a dev dependency in `@officexr/world` even though the thumbnails script runs against the studio dev server. This is a slight SRP bend — the script could live in a separate tooling package — but keeping it co-located with the thumbnail output directory and manifest is pragmatic.
- **Risks**: The gen-thumbnails script requires the studio dev server to be running. It exits with a helpful error message if the server is not reachable.

## Task 10: Pre-generated Thumbnails + World Export

- **Decisions**: Created `thumbnail-manifest.ts` as an empty placeholder (`export const THUMBNAIL_MANIFEST: Record<string, string> = {}`). Updated `thumbnails.ts` to use the real manifest via `THUMBNAIL_MANIFEST[id] ?? null`. The actual PNGs are generated by running `pnpm gen:thumbnails` after starting the dev server.
- **Deviations**: Could not run `pnpm gen:thumbnails` in this environment since the dev server was not running. The manifest remains empty — this is the documented workflow (commit the placeholder, run gen:thumbnails separately, commit the populated manifest + PNGs).
- **Trade-offs**: Vite's asset pipeline will process `new URL('...', import.meta.url).href` entries in the manifest — this is the correct pattern for Vite to hash and copy PNG assets. The empty manifest is safe; `thumbnailUrlForKind` returns `null` for all kinds until the manifest is populated.
- **Risks**: No non-obvious risks.

## Task 11: Move Tool (TDD)

- **Decisions**: Split the move tool's geometry into two pure modules: `moveOccupancy.ts` (collision check) and `moveDelta.ts` (position translation). The `MoveController` R3F component handles pointer events inside the Canvas so it can access `camera`, `gl`, and `raycaster` from `useThree`. Used a ref-based approach (`stateRef`, `selectionRef`, `docRef`, `compiledRef`) to give the raw pointer listeners access to the latest state without re-binding the listeners on every render.
- **Deviations**: The `MoveState` type stores `proposedPositions` and `occupancyResult` directly on the dragging state (rather than in separate `useState` hooks) so the pointer-up handler can read a consistent snapshot without closure issues.
- **Trade-offs**: None remaining — the original fallback to multiple `setPositionForCommand` calls has been replaced; see Critical Fix below.
- **Risks**: XZ-plane projection uses `raycaster.ray.intersectPlane` against a horizontal plane at the first selected object's Y. If no objects are selected (edge case), defaults to world Y=0.

## Critical Fix: Move Tool — Single `setPositionMany` History Action (review-report §Critical 1)

- **Problem**: The move tool was committing N separate `setPositionForCommand` history actions per drag (one per selected object), requiring N Ctrl+Zs to undo a multi-object move.
- **Fix**:
  1. Added `setPositionMany(moves)` mutator to `useRoomDocument.ts` — constructs a single `setPositionMany` EditAction and pushes it through the existing history pipeline (same pattern as `setPositionForCommand`).
  2. Updated `handleMoveSelection` in `RoomApp.tsx` to call `roomDoc.setPositionMany(moves)` instead of looping `setPositionForCommand`.
  3. Removed the dead `instancesByKindRef` block (lines 1318–1328 pre-fix) from `MoveController` in `SceneEditorCanvas.tsx` — the `instancesByKind` map was computed but never read; the `void ibk;` suppression was the only consumer.
  4. Added regression test `setPositionMany — pushing one action for N objects grows historyNodes by exactly 1, not N` in `RoomHistory.test.ts` to lock the invariant.
- **Files changed**: `useRoomDocument.ts`, `RoomApp.tsx`, `SceneEditorCanvas.tsx`, `RoomHistory.test.ts`.
