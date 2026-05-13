# Task 7 Review — GhostLayer + roomSnap + Add-tool snap-to-cube-face

## Summary
Almost ships. Snap helpers, hover plumbing, ghost mesh + raycast-layer hygiene, and PulseDriver gating are all there. One Critical bug: the cube and floor `onPointerMove` handlers both fire when the cursor is over a cube (neither stops propagation), so the floor's FloorHit overwrites the cube's CubeHit and the ghost preview lands on the floor below the cube instead of on the cube's face. Click-to-place is unaffected (pointerdown stops propagation), but the headline acceptance criterion — "ghost cube at the snap target on top of a cube" — is broken.

## Spec Compliance

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | `roomSnap.ts` with `snapToVoxel(hit, cubeSize)` covering floor + cube branches | Complete | `roomSnap.ts:42-59` — discriminated union, both branches present |
| 2 | `quantizeAxisAlignedNormal` defends against float noise + handles all 6 cardinal axes + degenerate zero | Complete | `roomSnap.ts:68-84` — `>=` tie-break + `s === 0 ? 1 : s` fallback; covered by 6 tests |
| 3 | `GhostLayer.tsx` — parallel `<instancedMesh>` per kind, cloned transparent material, raycast layer 31 | Complete | `GhostLayer.tsx:41-77,119` |
| 4 | `PulseDriver` — `useFrame` opacity animation; only mounted when ≥1 pulse ghost exists | Complete | `GhostLayer.tsx:74,164-171` — `hasPulse` gates the mount |
| 5 | Add tool uses `snapToVoxel` (works on cube faces, not just floor) | Partial | Logic is correct (`SceneEditorCanvas.tsx:85-92`, `506-511`) but blocked by Critical #1 below — hover state ends up FloorHit even when over a cube |
| 6 | Add tool gains solid ghost preview via `GhostLayer` | Partial | Wired (`SceneEditorCanvas.tsx:76-80,127`); same Critical bug means the preview shows on the floor below the cube, not on top |
| 7 | Tests: `roomSnap` covers floor + cube-face branches | Complete | 12 cases in `roomSnap.test.ts` |
| 8 | Tests: ghost meshes ignore the snap raycaster | Missing | No unit test — only the `mesh.layers.set(31)` write is inspectable. Acceptable since visual/runtime, but worth noting |

**Compliance Score**: 6/8 complete, 2 partial (both blocked by the same Critical issue).

## Issues Found

### Critical (must fix before commit)

- **`packages/studio/src/modes/room/SceneEditorCanvas.tsx:420-433` (cube `handlePointerMove`)** AND **`:520-526` (floor `handlePointerMove`)**: neither handler calls `e.stopPropagation()`. r3f's default pointer-event behavior fires events on ALL raycast intersections in front-to-back order. When the cursor is over a cube, the cube's pointermove fires first (sets CubeHit), then the floor's pointermove fires (overwrites with FloorHit since the floor plane is hit through/under the cube). Result: hovering a cube's top face shows the ghost on the floor at `(x, 0, z)` instead of on the cube at `(cubeX, cubeY+1, cubeZ)`. Pointerdown is unaffected because line 377 calls `e.stopPropagation()` — clicks still place correctly via `onAddClick(cubeHit)`. Fix: add `e.stopPropagation()` at the top of the cube's `handlePointerMove` (after the early `tool !== 'add'` return). The FloorPicker will then only fire when the front-most hit is actually the floor.

### Important (should fix)

- **`packages/studio/src/modes/room/GhostLayer.tsx:106`**: `base.opacity = mode === 'solid' ? 0.5 : 0.5;` — both branches identical. The plan called for pulse to oscillate 0.25–0.75 with the static spec at 0.5; the initial value for pulse mode is immediately overwritten by `PulseDriver` so it doesn't manifest, but the dead conditional looks like a forgotten edit (the author likely meant to set a different initial like `0.25` or `0.75` for pulse, or just write `0.5` once). Either drop the ternary or write the intended starting opacity.

- **`packages/studio/src/modes/room/SceneEditorCanvas.tsx:336-340,448-465`**: `extractGeometry` / `extractMaterial` are still locally defined here even though Task 7 added the renderer re-exports `extractGeometryFromGltf` / `extractMaterialFromGltf` (`packages/world/src/renderer/index.ts:23-28`) explicitly to share them with the studio. The two helpers are identical to the world-package versions. Either delete the local copies and import from `@officexr/world/renderer` (matching `GhostLayer.tsx:7-9`) or note inline why the studio keeps a private copy. As written, this is the same DRY violation in two files in the same package.

- **`packages/studio/src/modes/room/GhostLayer.tsx:123`**: `s = new THREE.Vector3(SEAM_OVERLAP, SEAM_OVERLAP, SEAM_OVERLAP)` ignores `kind.scale`. The opaque renderer applies `SEAM_OVERLAP * kind.scale` (`packages/world/src/renderer/ObjectInstances.tsx:126`). All current cube kinds have `scale: 1` so this is latent, but the moment an asset pack lands with `scale != 1` the ghost preview will be the wrong size relative to the placed cube — silently misleading the user about where the cube ends up. The pre-existing `SceneEditorCanvas.tsx:351` (`baseScale = 1.05`) has the same bug; Task 7 just propagates it. Fix: multiply by `kind.scale` here, and ideally take the same fix to `CubesLayer` so the editor and ghost agree.

- **`tasks/implementation-notes.md`**: no entry for Task 7. Several non-obvious decisions (shared `pulseOpacityRef` across all pulse groups, layer-31 escape via `useEffect` not `useLayoutEffect`, the speculative `buildMaterialForKind`/`hasMaterialOverrides` re-exports that Task 7 doesn't consume, the deliberate retention of the pre-existing `extractGeometry`/`extractMaterial` duplicates) should be documented for the next reviewer.

### Minor (nice to fix)

- **`packages/studio/src/modes/room/GhostLayer.tsx:119`**: `mesh.layers.set(31)` runs in `useEffect`, which fires after the first paint of the InstancedMesh on layer 0. There is a one-frame window during which the snap raycaster could pick the ghost. In practice React 19 + r3f flush the effect before the next pointer event, so it's almost never observable, but `useLayoutEffect` or setting the layer through the `ref` callback would close the window entirely.

- **`packages/studio/src/modes/room/GhostLayer.tsx:79`**: `SEAM_OVERLAP = 1.05` is the third copy of this constant in the repo (also `ObjectInstances.tsx:91` and `SceneEditorCanvas.tsx:351`). Lift it to a shared renderer constant.

- **`packages/studio/src/modes/room/GhostLayer.tsx:100`**: `useGLTF(kind?.gltfPath ?? '/models/blocks/colored_block_blue.gltf')` — a hard-coded fallback path keeps hook order stable when `kind` is missing, but the loaded GLTF is then thrown away (the component returns null at line 142). Cleaner: split into a wrapper that early-returns and a child that calls `useGLTF` unconditionally, or hoist the kind-resolution to the parent and never render a `GhostMeshForGroup` for an unknown kindId.

- **`packages/studio/src/modes/room/GhostLayer.tsx:103-110`**: when `mode` changes (e.g., a kindId's mode flips from solid to pulse for the Tile→Delete handoff in Task 8/9), the cloned material from the previous `useMemo` is leaked — no `dispose()`. Same for the `useEffect` rebuild when `voxels` reference changes. Low frequency in practice; flag for when Task 8's pulse ghosts start landing.

- **`packages/studio/src/modes/room/GhostLayer.tsx:137-140`**: `useFrame` is registered for every `GhostMeshForGroup` regardless of mode, with a `if (mode !== 'pulse') return;` guard. The plan said "Solid ghosts keep their constant 0.5 — no per-frame work"; strictly there's still a (no-op) tick. Trivial; only matters if the bucket count blows up. Consider lifting the pulse opacity write into a single `PulseOpacityApplier` mounted per-group only when `mode === 'pulse'`.

- **`packages/world/src/renderer/index.ts:23-28`**: re-exports `buildMaterialForKind` and `hasMaterialOverrides`, but Task 7's studio code only consumes `extractGeometryFromGltf` + `extractMaterialFromGltf`. The first two are speculative for Tasks 8+ (likely Tile/Delete tools that need to mirror the opaque material's overrides into the transparent clone). Document the speculative export in `implementation-notes.md` so a future reader doesn't delete them as dead.

- **`packages/studio/src/modes/room/SceneEditorCanvas.tsx:64-68`**: hover state is owned by the canvas component. Plan said this was acceptable for Task 7 (no clear when leaving a cube into empty space, since the Add ghost just sticks at the last position). Confirmed. Task 8's Delete tool will need a proper clear path; flag for then.

- **`packages/studio/src/modes/room/GhostLayer.tsx:43-55`**: `groups` is rebuilt every render of `GhostLayer`, including when `hover` flickers between consecutive sub-voxel pointermoves with the same target voxel. Today only one ghost is rendered so this is one bucket per frame — fine. When Task 9's Tile tool emits N ghosts, consider keying the memo on the structurally-quantized voxel list to avoid rebuilding when the integer targets haven't moved.

## What Looks Good

- `roomSnap.ts` is exemplary: discriminated union surface, dominant-axis quantization with `Math.sign(0) === 0` fallback, comments that explain *why* (float-noise defense, voxel-coord invariant). Tests pin the `Math.round(-0.5)` JS quirk (`roomSnap.test.ts:50`) so a future "let's switch to Math.floor" PR will fail loudly.
- `pulseOpacityRef` is a single ref shared across all pulse groups — every pulse ghost in the scene oscillates in phase, which matches what a user expects from a "this is the delete target" cue. Good call.
- `hasPulse` gate (`GhostLayer.tsx:57,74`) keeps `PulseDriver` off the frame loop when only the Add tool is active — the dominant case in Task 7.
- `e.stopPropagation()` on cube pointerdown (`SceneEditorCanvas.tsx:377`) means clicks work even though hover preview is broken. The hover bug doesn't silently corrupt placement.
- The renderer re-exports (`packages/world/src/renderer/index.ts:23-28`) are layered through the existing renderer-public surface — not a DIP violation, just normal high-level → renderer-subpackage dependency.
- DIP greps stay clean: no `from 'three'` or `from 'react'` in `sdk` / `realtime-server` / `core-refactor`.
- All 39 studio tests + 100 world tests pass; full `pnpm typecheck` is clean.

## Test Coverage

| Area | Tests Exist | Coverage Notes |
|---|---|---|
| `roomSnap.snapToVoxel` (floor + cube branches) | Yes | 6 cases — floor rounding, cubeSize divisor, +x/-x/-z faces, cubeSize irrelevance for cube hits |
| `quantizeAxisAlignedNormal` (6 cardinal axes + degenerate zero) | Yes | 6 cases — all sign combinations, dominant-axis tie-break documented |
| `GhostLayer` ghost mesh rendering | No | Visual/DOM-bound; not unit-tested |
| `GhostLayer` raycast-layer escape | No | Would need a JSDOM + r3f test harness to assert `mesh.layers.mask`; documented inline at `GhostLayer.tsx:117` |
| Cube hover plumbing (`onHoverCube` / `onHoverFloor`) | No | Pointer-event-driven; not unit-tested |
| Hover-state propagation bug (Critical above) | No | Tests would have caught the missing `stopPropagation` if there were an integration test asserting "over a cube, hover state is CubeHit" |

**Test Coverage Assessment**: pure-helper coverage is solid. The Critical bug above would not have been caught by any reasonable unit test — it's a multi-handler propagation interaction with r3f. An integration smoke test ("hover over a cube while Add tool is active → ghost world-y matches cube top, not 0") is the smallest harness that would catch it; out of scope for Task 7 but flag for Task 9 when the Tile tool's preview interactions multiply.

## Test Execution

| Check | Result | Details |
|---|---|---|
| Test command discovered | Yes (`pnpm test:studio`, `pnpm test:world`, `pnpm typecheck`) | From root `package.json` scripts |
| Studio tests | Passed (39/39) | Includes 12 new `roomSnap` cases |
| World tests | Passed (100/100) | No regressions from the new re-exports |
| Typecheck | Passed | `pnpm typecheck` clean across 5 packages |
| TDD evidence in implementation-notes | No (N/A) | No Task 7 entry yet; test files exist and pass, so TDD is implied but not documented |

**Test Execution Assessment**: tests run and pass. The Critical bug is a behavioral interaction that no unit test covers; would only surface in a manual smoke or integration test. Implementer's claim "Studio dev boots; the new modules HMR-serve correctly" did not include manual verification of the hover-on-cube case, which is why the bug survived to review.

## Implementation Decision Review

| Task | Decisions Documented | Decisions Sound | Flags |
|---|---|---|---|
| Task 7 | No | N/A | `implementation-notes.md` has no Task 7 section. The shared-pulseRef design, the speculative `buildMaterialForKind` re-export, the `useEffect`-not-`useLayoutEffect` layer set, the choice to keep `SceneEditorCanvas.tsx`'s duplicate `extractGeometry`/`extractMaterial` — all merit a documented decision. |

**Decision Assessment**: the code-level decisions are mostly defensible (shared pulse ref = good; layer-31 escape = correct mechanism; PulseDriver gating = correct). The missing notes file just makes the next reviewer redo this analysis. Add a Task 7 section before commit.

## Recommendations

1. **Fix the cube hover propagation bug.** Add `e.stopPropagation()` to `handlePointerMove` on the cube InstancedMesh (`SceneEditorCanvas.tsx:420-433`). Verify manually: hover over a cube top with Add tool → ghost appears at `cube + [0,1,0]`, not on the floor at `(x, 0, z)`.
2. Fix the dead-conditional opacity (`GhostLayer.tsx:106`) — either `mode === 'solid' ? 0.5 : 0.25` or drop the ternary.
3. Replace `SceneEditorCanvas.tsx`'s private `extractGeometry`/`extractMaterial` with the renderer re-exports.
4. Multiply `SEAM_OVERLAP` by `kind.scale` in `GhostLayer.tsx:123` (and ideally fix the same in `SceneEditorCanvas.tsx:351` while you're there).
5. Add a Task 7 section to `tasks/implementation-notes.md` covering the four non-obvious decisions listed above.
6. (Optional, for Task 8) plan a clear-on-pointerout for cube hover so the Delete tool's pulse preview doesn't stick.
