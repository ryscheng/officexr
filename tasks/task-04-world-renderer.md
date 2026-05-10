# Task 04: Build WorldRenderer (Three.js) for debug-app

## Objective
Implement a self-contained `WorldRenderer` class in `packages/debug-app` that reads `OfficeState` from the SDK `Store` and renders players, ground, lighting, camera, and a proximity bubble.

## Context
- Read `tasks/shared-context.md` before starting.
- Task 05 scaffolds `packages/debug-app`. This task may proceed in parallel with Task 05 if the implementer creates the package scaffold manually first, OR it can follow Task 05 sequentially. The preferred order is Task 05 → Task 04.
- Read `packages/core/src/hooks/useSceneSetup.ts` for camera, renderer, and lighting setup patterns. Copy only the Three.js primitives — no React hooks, no old-core imports.
- `BUBBLE_RADIUS = 3` is exported from `packages/sdk/src/game-state/rules/proximity.ts`.
- `OfficeState`, `PlayerState`, `Vec3` types come from `@officexr/sdk`.

**Quick Context:**
- Renderer lives at `packages/debug-app/src/renderer/WorldRenderer.ts`.
- `WorldRenderer` is a plain TypeScript class — no React. The React component in Task 06 mounts it via `useEffect`.
- Three.js is a direct dependency of `packages/debug-app` (added in Task 05 `package.json`).

## Files to Create
- `packages/debug-app/src/renderer/WorldRenderer.ts`

## Requirements

### Constructor
```ts
export class WorldRenderer {
  constructor(container: HTMLDivElement) { ... }
```
- Creates `THREE.WebGLRenderer` attached to `container`
- Creates `THREE.Scene` with `background = new THREE.Color(0x87ceeb)`
- Creates `THREE.PerspectiveCamera(75, aspect, 0.1, 1000)` positioned at `{ 0, 1.6, 5 }`
- Adds `THREE.AmbientLight(0xffffff, 0.6)` and `THREE.DirectionalLight(0xffffff, 0.8)` at `(5, 10, 5)`
- Adds a ground plane: `PlaneGeometry(40, 40)` rotated -90° on X, `MeshLambertMaterial({ color: 0x4a7c59 })`
- Adds a wireframe `SphereGeometry(BUBBLE_RADIUS, 16, 16)` as the local player's proximity bubble (initially positioned at origin; `bubbleMesh.visible = true`)
- Handles window resize: updates camera aspect and renderer size

### `render(state: OfficeState): void`
Called each frame from the RAF loop with the current store state.

- For each `playerId` in `state.players`:
  - If the player's mesh doesn't exist, create a `BoxGeometry(0.6, 1.8, 0.6)` mesh. Use a distinct color for `state.selfId` (e.g. `0x4488ff`) and a neutral color for others (e.g. `0xaaaaaa`).
  - Set mesh position from `player.pos` (`Vec3 → THREE.Vector3`).
  - For `state.selfId`: also move the camera to `{ x: pos.x, y: pos.y + 1.6, z: pos.z + 5 }` and update the proximity bubble mesh to `pos`.
- Remove meshes for player ids no longer in `state.players`.

### `dispose(): void`
- Cancels the resize event listener
- Calls `renderer.dispose()`
- Removes the renderer's canvas from the container

### No animation loop inside WorldRenderer
The renderer does NOT own a `requestAnimationFrame` loop. The caller (Task 06) drives frames
by calling `worldRenderer.render(store.getState())` once per RAF tick.

## Acceptance Criteria
- [ ] `new WorldRenderer(div)` appends a `<canvas>` child to the given div.
- [ ] `render(state)` with a state containing two players creates two box meshes in the scene.
- [ ] The local player's box is at `state.players[selfId].pos` coordinates.
- [ ] The proximity bubble mesh tracks the local player's XZ position each `render()` call.
- [ ] `dispose()` removes the canvas and does not throw.
- [ ] `pnpm --filter @officexr/debug-app typecheck` passes (no Three.js import errors).
- [ ] No imports from `@officexr/core` or any file under `packages/core/src/`.

## Dependencies
- Depends on: Task 05 (package scaffold exists with Three.js in package.json)
- Blocks: Task 06
