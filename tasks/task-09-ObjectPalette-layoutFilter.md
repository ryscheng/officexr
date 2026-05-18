# Task 09: `ObjectPalette.layoutFilter` prop and Room view toggle

## Objective
Make the Object Palette aware of layout-vs-furnishing categorization. Room view defaults to hiding `isLayoutObject` kinds with a session-local toggle to show them all. Layout view will require them (the prop wiring for Layout view comes in Task 11).

## Dependencies
- Task 01 (`isLayoutObject` field exists on `WorldObjectKind`).

## Context Files
- `tasks/shared-context.md`
- `tasks/updated-prd.md`
- `packages/studio/src/modes/room/ObjectPalette.tsx` — current filter pipeline at line 103: `groupByCategory(filterByName(allKinds, deferredQuery), ['character'])`.
- `packages/studio/src/modes/room/RoomApp.tsx:25-335` — the consumer that mounts `ObjectPalette` (around line 269).
- `packages/world/src/scenes/world-object-kinds-schema.ts` — `WorldObjectKind` interface.

## Files to Modify
- `packages/studio/src/modes/room/ObjectPalette.tsx`
- `packages/studio/src/modes/room/RoomApp.tsx`

## Requirements
1. Add a `layoutFilter?: 'exclude' | 'require' | 'all'` prop to `ObjectPalette` (default `'all'` if undefined — preserves current behavior anywhere unspecified).
2. Implementation: insert a filter step in the pipeline:
   ```
   const layoutFiltered = layoutFilter === 'all'
     ? allKinds
     : allKinds.filter(k => layoutFilter === 'require' ? k.isLayoutObject : !k.isLayoutObject);
   const grouped = groupByCategory(filterByName(layoutFiltered, deferredQuery), ['character']);
   ```
3. In `RoomApp.tsx`:
   - Add session-local state `const [showLayoutObjects, setShowLayoutObjects] = useState(false);`.
   - Pass `layoutFilter={showLayoutObjects ? 'all' : 'exclude'}` to the `ObjectPalette`.
   - Add a small toggle UI inside the LeftPanel header above the palette: label "Show layout objects" with a checkbox. Match the styling of existing room view chrome (look at the existing buttons in `RoomApp.tsx`).

## Acceptance Criteria
- In Room view (no toggle), kinds where `isLayoutObject` is true are absent from the palette.
- Toggling on shows them; toggling off hides them again. State persists across renders within the session, resets on full reload (per-session is fine).
- The placement code path (selecting a kind, dragging into the canvas) is unchanged.
- Existing tests still pass.
- TypeScript compile clean.

## Implementation Notes
- Don't add a "Layout" category — that's the boolean field's job (per Task 01 / design decision 1).
- The toggle is a session-local design decision (per the design plan); don't add a global setting or persist it to disk.
- Layout view also uses `ObjectPalette` but will pass `layoutFilter='require'` (wired in Task 11).
