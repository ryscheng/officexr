/**
 * Tile-tool functional test.
 *
 * Drives the tile-tool gesture sequence against a fake
 * `SceneEditorBackend` AND against the real `useLayoutDocument` hook,
 * proving both:
 *
 *   1. The backend contract is sufficient — a plain-object backend
 *      satisfies every callback the tile flow needs.
 *   2. `useLayoutDocument.placeMany` and `useLayoutDocument.groupCommands`
 *      are wired correctly. Before this refactor, the Layout editor
 *      passed `() => []` and `() => null` stubs to the canvas; a tile
 *      gesture silently no-op'd in Layout while working in Room. This
 *      test would have caught that regression at the hook level.
 *
 * Why this lives next to the canvas rather than in
 * `modes/layout/__tests__`: the contract under test is the
 * `SceneEditorBackend` interface itself. Both Room and Layout hooks
 * implement it; the test belongs at the abstraction layer that owns
 * the contract.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ApplicationProvider } from '@officexr/world/react';
import {
  createCatalogService,
  createInstanceGeometry,
  createRoomService,
  createBakeService,
  createSceneService,
  type ApplicationApi,
} from '@officexr/world/app';
import type {
  WorldObjectKind,
  WorldObjectKindCatalogV1,
} from '@officexr/world/scenes';

import type { SceneEditorBackend } from '../SceneEditorBackend.ts';
import { useLayoutDocument } from '../../layout/useLayoutDocument.ts';

// ---------------------------------------------------------------------------
// Test helpers (mirrors `application-context.test.tsx`)
// ---------------------------------------------------------------------------

function makeKind(id: string): WorldObjectKind {
  return {
    id,
    label: id,
    gltfPath: `/${id}.glb`,
    swatch: '#fff',
    walkable: false,
    scale: 1,
    tint: null,
    opacity: 1,
    roughness: null,
    metalness: null,
    emissive: null,
    emissiveIntensity: 0,
    category: 'block',
    tilingAxes: { x: true, y: true, z: true },
    gravity: false,
    isLayoutObject: true,
    optimization: 'none',
  };
}

function makeApi(): ApplicationApi {
  const def: WorldObjectKindCatalogV1 = {
    schemaVersion: 1,
    updatedAt: 0,
    kinds: [makeKind('wall')],
  };
  const catalog = createCatalogService({ defaultCatalog: def, apiPath: '' });
  const geometry = createInstanceGeometry({ catalog, voxelSize: 0.5 });
  return {
    voxelSize: 0.5,
    catalog,
    geometry,
    rooms: createRoomService({ geometry }),
    bake: createBakeService({
      catalog,
      loadGltf: () => Promise.reject(new Error('not used in this test')),
    }),
    scenes: createSceneService(),
  };
}

function wrapper(api: ApplicationApi) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <ApplicationProvider api={api}>{children}</ApplicationProvider>;
  };
}

// ---------------------------------------------------------------------------
// Contract test: SceneEditorBackend can be satisfied by a plain object
// ---------------------------------------------------------------------------

describe('SceneEditorBackend contract', () => {
  it('a plain-object backend satisfies the interface', () => {
    // The point of this test is that the type-checker accepts the
    // object below as a `SceneEditorBackend` — if it doesn't, the
    // compile step fails. The runtime asserts are just there so the
    // test reports a useful failure if the *shape* drifts.
    const backend: SceneEditorBackend = {
      compiled: { instances: [], cubeSize: 0.5 },
      selection: new Set(),
      tool: 'select',
      stagedKindId: null,
      buildHeight: 0,
      commandToGroup: new Map(),
      groupMembers: new Map(),
      doc: { commands: [] },
      onPlaceAt: vi.fn(),
      onPlaceMany: vi.fn(() => []),
      onSelectInstance: vi.fn(),
      onDeleteCommand: vi.fn(),
      onClickEmpty: vi.fn(),
      onCreateGroup: vi.fn(() => null),
      onSetTool: vi.fn(),
      onContextMenuRequest: vi.fn(),
      onMoveSelection: vi.fn(),
    };

    expect(backend.tool).toBe('select');
    expect(backend.doc.commands).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Functional test: 4-stage tile gesture against the real Layout hook
// ---------------------------------------------------------------------------

describe('Tile tool — Layout hook integration', () => {
  it('placeMany then groupCommands captures the full tile gesture', () => {
    const api = makeApi();
    const { result } = renderHook(() => useLayoutDocument(), {
      wrapper: wrapper(api),
    });

    // --- Click 1: origin placement at [0, 0, 0]
    let originId = '';
    act(() => {
      originId = result.current.placeObject('wall', [0, 0, 0]);
    });
    expect(result.current.doc.commands).toHaveLength(1);

    // --- Click 2: row along +x (3 more cubes at x=1..3, y=0, z=0)
    let rowIds: string[] = [];
    act(() => {
      rowIds = result.current.placeMany('wall', [
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0],
      ]);
    });
    expect(rowIds).toHaveLength(3);
    expect(result.current.doc.commands).toHaveLength(4);

    // --- Click 3: extrude along +z (3 cubes per row × 3 rows = 9 cubes
    //              at x=0..3, y=0, z=1..3, minus the origin row).
    let gridIds: string[] = [];
    act(() => {
      const positions: [number, number, number][] = [];
      for (let z = 1; z <= 3; z++) {
        for (let x = 0; x <= 3; x++) {
          positions.push([x, 0, z]);
        }
      }
      gridIds = result.current.placeMany('wall', positions);
    });
    expect(gridIds).toHaveLength(12);
    expect(result.current.doc.commands).toHaveLength(16);

    // --- Click 4: group the whole tile into one CommandGroup.
    const allIds = [originId, ...rowIds, ...gridIds];
    let groupId: string | null = null;
    act(() => {
      groupId = result.current.groupCommands(allIds);
    });
    expect(groupId).toBeTruthy();
    expect(result.current.doc.groups?.[groupId!]?.commandIds).toEqual(allIds);

    // --- Deleting any single tile member cascades to the whole group.
    act(() => {
      result.current.deleteCommand(rowIds[1]);
    });
    expect(result.current.doc.commands).toHaveLength(0);
    expect(Object.keys(result.current.doc.groups ?? {})).toHaveLength(0);
  });

  it('placeMany with a fresh groupId creates the group atomically', () => {
    // This is the path the canvas's tile tool actually takes after
    // click 2 — pass `groupId` along with the new positions so the
    // group exists by the time the user sees the ghosts on screen.
    const api = makeApi();
    const { result } = renderHook(() => useLayoutDocument(), {
      wrapper: wrapper(api),
    });

    const groupId = 'g-test-1';
    let newIds: string[] = [];
    act(() => {
      newIds = result.current.placeMany(
        'wall',
        [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
        groupId,
      );
    });

    expect(newIds).toHaveLength(3);
    expect(result.current.doc.groups?.[groupId]?.commandIds).toEqual(newIds);
    expect(result.current.lookup.commandToGroup.get(newIds[0])).toBe(groupId);
  });

  // REGRESSION: placeMany + groupCommands called synchronously (the same
  // sequence the canvas's tile click handler does at click 2). Previously
  // both mutators read the closure's stale `doc`, so the second call
  // wiped out the first's changes. The canvas calls these synchronously
  // from a pointer event handler — `act()` doesn't flush React state
  // updates between them, so the closure stays stale.
  it('placeMany followed by groupCommands in the same act() preserves both', () => {
    const api = makeApi();
    const { result } = renderHook(() => useLayoutDocument(), {
      wrapper: wrapper(api),
    });

    // Click 1 of tile flow: place origin
    let originId = '';
    act(() => {
      originId = result.current.placeObject('wall', [0, 0, 0]);
    });
    expect(result.current.doc.commands).toHaveLength(1);

    // Click 2: place a row of 2 cubes AND group them with the origin —
    // all in ONE synchronous handler (this is what the canvas does).
    let rowIds: string[] = [];
    let groupId: string | null = null;
    act(() => {
      rowIds = result.current.placeMany('wall', [
        [1, 0, 0],
        [2, 0, 0],
      ]);
      groupId = result.current.groupCommands([originId, ...rowIds]);
    });

    expect(rowIds).toHaveLength(2);
    // BUG: after this sequence, only the group survives and the cubes
    // are gone. The doc should still hold 3 cubes plus the group.
    expect(result.current.doc.commands).toHaveLength(3);
    expect(groupId).toBeTruthy();
    expect(result.current.doc.groups?.[groupId!]?.commandIds).toEqual([
      originId,
      ...rowIds,
    ]);
  });

  // REGRESSION: the canvas's click-3 (axis-extruded stage) calls
  // `placeMany(kindId, replicas, tileState.groupId)` to ADD new cubes
  // to the existing tile group. Validate that:
  //   - The new cubes appear in `doc.commands`.
  //   - They're added to the existing group (group.commandIds grows).
  //   - `commandToGroup` is updated for every new id.
  // Before the room-hook unification, layout's placeMany with a groupId
  // was either a no-op or wiped prior state. The user reported X / Z
  // tile extrusion silently failing — this test guards that path.
  it('placeMany with existing groupId extends the group (click-3 path)', () => {
    const api = makeApi();
    const { result } = renderHook(() => useLayoutDocument(), {
      wrapper: wrapper(api),
    });

    // Set up a tile that already has a group (click 1 + click 2).
    let originId = '';
    let rowIds: string[] = [];
    let groupId: string | null = null;
    act(() => {
      originId = result.current.placeObject('wall', [0, 0, 0]);
      rowIds = result.current.placeMany('wall', [
        [1, 0, 0],
        [2, 0, 0],
      ]);
      groupId = result.current.groupCommands([originId, ...rowIds]);
    });
    expect(groupId).toBeTruthy();
    expect(result.current.doc.commands).toHaveLength(3);

    // Click 3: extrude along +z. The canvas does this with a single
    // placeMany call passing the existing groupId.
    let zReplicas: string[] = [];
    act(() => {
      zReplicas = result.current.placeMany(
        'wall',
        [
          [0, 0, 1], [1, 0, 1], [2, 0, 1],
          [0, 0, 2], [1, 0, 2], [2, 0, 2],
        ],
        groupId!,
      );
    });
    expect(zReplicas).toHaveLength(6);
    expect(result.current.doc.commands).toHaveLength(9);
    expect(result.current.doc.groups?.[groupId!]?.commandIds).toEqual([
      originId,
      ...rowIds,
      ...zReplicas,
    ]);
    // Every new id has been mapped into the same group via the lookup.
    for (const id of zReplicas) {
      expect(result.current.lookup.commandToGroup.get(id)).toBe(groupId);
    }
  });

  it('groupCommands rejects when a command is already in a group', () => {
    const api = makeApi();
    const { result } = renderHook(() => useLayoutDocument(), {
      wrapper: wrapper(api),
    });

    let ids: string[] = [];
    act(() => {
      ids = result.current.placeMany('wall', [
        [0, 0, 0],
        [1, 0, 0],
      ]);
    });
    let firstGroup: string | null = null;
    act(() => {
      firstGroup = result.current.groupCommands(ids);
    });
    expect(firstGroup).toBeTruthy();

    // Try to group them again — should refuse.
    let secondGroup: string | null = 'placeholder';
    act(() => {
      secondGroup = result.current.groupCommands(ids);
    });
    expect(secondGroup).toBeNull();
  });
});
