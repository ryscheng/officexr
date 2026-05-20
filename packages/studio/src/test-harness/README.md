# Studio test harness

Hermetic helpers for testing the studio editors without a dev server,
Supabase, or the network. Three layers, mirroring the test pyramid in
the integration-test roadmap.

## What's here

- **`createTestApi()`** — composes an `ApplicationApi` via the
  production `createDefaultApi` with `apiPath: ''` (bundled default
  catalog, no `/api/world-object-kinds` fetch) and a no-op GLTF loader.
- **`StudioHarness`** — wraps children in an `<ApplicationProvider>`
  built from `createTestApi()`. Use as the `wrapper` for `renderHook`
  on any hook that reads `useApplication` (e.g. `useRoomDocument`,
  `useLayoutDocument`).
- **`renderEditorScene(node, { api? })`** — mounts an R3F scene
  subtree under a hermetic provider using
  `@react-three/test-renderer`. Returns the test renderer so you can
  query the scene graph and `fireEvent`.
- **`seeds/`** — fixture documents (`emptyMapSeed`, `simpleRoomSeed`,
  `twoRoomMapSeed`). Pair with an `InMemory*Storage` (from
  `@officexr/world/scenes`) to seed a hook hermetically.

## Tier 2 — document hook tests

`renderHook` the hook against an in-memory storage. No canvas.

```ts
const storage = new InMemoryMapStorage({ seed: [{ name: 'default', doc }] });
const { result } = renderHook(() => useMapDocument({ storage }));
await waitFor(() => expect(result.current.doc.name).toBe('default'));
```

For hooks that read `useApplication`, pass `{ wrapper: StudioHarness }`.

## Tier 3 — editor scene scenarios

`@react-three/test-renderer` reconciles into a **three.js scene graph,
not the DOM**. It therefore CANNOT host an editor App (`<MapApp>` is
DOM chrome wrapped around a `<Canvas>`). Mount the exported **scene
layers** instead and assert on callbacks / the scene graph:

```tsx
const renderer = await renderEditorScene(
  <RoomsLayer instances={…} rooms={…} tool="spawn" onPlaceSpawn={spy} … />,
);
await new Promise((r) => setTimeout(r));      // let catalog-ready settle
const group = renderer.scene.findAll(
  (n) => n.type === 'Group' && typeof n.props.onPointerDown === 'function',
)[0];
await renderer.fireEvent(group, 'pointerDown', {
  button: 0, point: { x: 1.5, y: 2.25, z: -3 }, stopPropagation: () => {},
});
expect(spy).toHaveBeenCalledWith([1.5, 2.25, -3]);
```

### Gotchas

- **Use primitive kinds** (`__primitive_blue` / `__primitive_stone`) in
  scene fixtures. Real catalog kinds load a GLTF over HTTP, which fails
  hermetically. Primitives render as plain `BoxGeometry` instanced
  meshes — no network.
- **Canvas 2D stub**: `src/__tests__/setup-canvas.ts` stubs
  `HTMLCanvasElement.getContext('2d')` because the renderer builds a
  procedural texture at module-load. Without it, importing the renderer
  barrel crashes under jsdom.
- **Synthetic events** need `button: 0`, a `point`, and a
  `stopPropagation` fn — the editor handlers read all three.
- Pointer **drag** flows (move-tool snap) attach listeners to
  `gl.domElement` and read the raycaster/pointer — those are stubbed in
  the test renderer and are better exercised in Playwright (Tier 4).
  The snap math itself is unit-tested in `roomBoundarySnap.test.ts`.

## Coverage map (what tests what)

| Regression class | Where it's caught |
|---|---|
| A pointer hit data | `MapApp.scenarios` (spawn hit point), `roomSnap` unit |
| B batch closure | `useRoomDocument` (placeMany+groupCommands) |
| C hardcoded fallback | `useMapDocument` (spawn position), `MapApp.scenarios` |
| D ref/module staleness | `object-editor.spec.ts` kind-switch (Tier 4) |
| E cross-hook desync | `useRoomDocument` (setLayoutName), `useLayoutDocument` (optimizer) |
| F implicit gating | `mapPointerActions` unit + `MapApp.scenarios` (litmus) |

Tier-3 scenarios currently focus on the Map editor (the c606f10 class).
Room tile-grouping is covered at Tier 2; the Object-editor Leva
kind-switch (a DOM concern, not a scene-graph one) is covered by the
existing `object-editor.spec.ts` at Tier 4.

## Tier 4 — Playwright hermetic mode (`?test=1`)

`App.tsx` boots hermetically when the URL carries `?test=1`: a
bundled-catalog api (no `/api/world-object-kinds` fetch) and in-memory
storages seeded from `window.__OFFICEXR_TEST_SEED__`. The
`goToModeHermetic(page, mode, seed)` helper sets the seed via
`addInitScript` and navigates. See `tests/playwright/map-editor-hermetic.spec.ts`.

**CI** runs `pnpm test:e2e:ci` (scoped to the green, hermetic-friendly
editor specs). Known follow-up: several legacy specs rotted while
Playwright was ungated — `object-editor.spec.ts` / `routing.spec.ts`
query the renamed `/api/cube-kinds` endpoint (now
`/api/world-object-kinds`) and `room-editor.spec.ts` selectors drifted.
Fixing + folding those into `test:e2e:ci` is the next increment.
