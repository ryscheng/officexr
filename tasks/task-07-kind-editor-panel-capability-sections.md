# Task 07: ObjectKindEditorPanel — Add Tiling, Gravity, and Optimization Sections

## Objective
Extend `ObjectKindEditorPanel.tsx` with three new sections: Tiling (X/Y/Z axis toggles), Gravity (boolean toggle), and Optimization (scaffold select with a hint), all wired through `applyPatch`.

## Context

**Quick Context:**
- `ObjectKindEditorPanel` is a fully-controlled React panel built with the in-house control kit (`Section`, `Toggle`, `SelectInput`, `Readonly`). No Leva. New sections are added by appending `<Section>` blocks. (The file was renamed from `KindEditorPanel.tsx` in task-00.)
- `applyPatch(partial: Partial<WorldObjectKind>)` routes to `patchKind` in `object-kind-catalog.ts`. Patching `tilingAxes` requires passing the full `tilingAxes` object (not a sub-field), since `patchKind` does a shallow spread.
- The `optimization` field is scaffolded only — the renderer does not yet act on it. Show a small hint to make this clear.

## Requirements

1. Add a **Tiling** section after the existing "Kind" section:
   ```
   <Section title="Tiling">
     <Toggle label="tile X" value={kind.tilingAxes.x} onChange={(v) => applyPatch({ tilingAxes: { ...kind.tilingAxes, x: v } })} />
     <Toggle label="tile Y" value={kind.tilingAxes.y} onChange={(v) => applyPatch({ tilingAxes: { ...kind.tilingAxes, y: v } })} />
     <Toggle label="tile Z" value={kind.tilingAxes.z} onChange={(v) => applyPatch({ tilingAxes: { ...kind.tilingAxes, z: v } })} />
   </Section>
   ```

2. Add a **Placement** section after the Tiling section:
   ```
   <Section title="Placement">
     <Toggle label="gravity" value={kind.gravity} onChange={(gravity) => applyPatch({ gravity })} />
   </Section>
   ```

3. Add an **Optimization** section after the Placement section:
   ```
   <Section title="Optimization">
     <SelectInput
       label="mode"
       value={kind.optimization}
       options={['none', 'static-batch', 'frustum-cull']}
       onChange={(optimization) => applyPatch({ optimization })}
     />
     <Readonly label="" value="scaffold — no runtime effect" />
   </Section>
   ```
   The `Readonly` hint row makes it clear the optimization field is scaffolded.

4. Ensure TypeScript imports `OptimizationMode` type from `@officexr/world` (or wherever it is exported after task-01).

5. Do NOT change the existing "Kind", "Dimensions", or "Material overrides" sections.

## Existing Code References
- `packages/studio/src/modes/object/ObjectKindEditorPanel.tsx` — the full panel (renamed in task-00; read before editing)
- `packages/studio/src/ui/controls/index.ts` — exports `Section`, `Toggle`, `SelectInput`, `Readonly`

## Implementation Details
- The `SelectInput` component already accepts `options: readonly string[]` — verify by checking its implementation. If it is generic, pass the options as `['none', 'static-batch', 'frustum-cull'] as const` or cast appropriately.
- The axis toggles use spread to preserve the other two axis values when one changes: `{ ...kind.tilingAxes, x: v }`. This is correct because `patchKind` shallow-merges.
- Keep the panel's existing layout conventions: `Section` > rows, each row is either a labeled control or a `Readonly` display.

## Acceptance Criteria
- [ ] The Object editor panel shows a "Tiling" section with X/Y/Z toggles for any selected kind.
- [ ] Toggling tile X updates `kind.tilingAxes.x` without affecting Y or Z.
- [ ] The "Placement" section shows a gravity toggle.
- [ ] The "Optimization" section shows a select with three options and a "scaffold — no runtime effect" hint.
- [ ] All three new sections' values persist across catalog save/load round-trips (verifiable by changing a value, saving via the API, and reloading the studio).
- [ ] `pnpm --filter @officexr/studio build` passes without type errors.
- [ ] Existing tests still pass.

## Dependencies
- Depends on: task-01 (`tilingAxes`, `gravity`, `optimization` fields on `WorldObjectKind`)
- Blocks: task-11
