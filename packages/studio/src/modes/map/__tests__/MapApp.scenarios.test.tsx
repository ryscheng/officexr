import { describe, expect, it, vi } from 'vitest';
import { RoomsLayer } from '../MapEditorCanvas.tsx';
import { renderEditorScene } from '../../../test-harness/renderEditorScene.tsx';
import {
  emptyRoomDocument,
  newPlaceObject,
  type RoomDocument,
} from '@officexr/world/scenes';

/**
 * Tier 3: mount the Map editor's room-scene subtree under
 * @react-three/test-renderer and drive synthetic pointer events.
 * Validates the c606f10 class end-to-end (spawn/select routing on a
 * room group, regardless of which descendant mesh was hit).
 *
 * Uses the `__primitive_blue` magic kind, which renders as a plain
 * BoxGeometry InstancedMesh — no GLTF fetch, so the scene mounts
 * hermetically with no network.
 */

const ROOM_NAME = 'test-room';

function roomLibrary(): ReadonlyMap<string, RoomDocument> {
  const doc = emptyRoomDocument(ROOM_NAME, ROOM_NAME);
  doc.commands = [
    newPlaceObject({ kindId: '__primitive_blue', position: [0, 0, 0] }),
    newPlaceObject({ kindId: '__primitive_blue', position: [1, 0, 0] }),
  ];
  return new Map([[ROOM_NAME, doc]]);
}

const instances = [
  { id: 'r1', roomName: ROOM_NAME, position: [0, 0, 0] as [number, number, number], rotationY: 0 as const },
];

async function settle(ms = 50) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Find the room group that carries the pointer handler. */
function findRoomGroup(renderer: Awaited<ReturnType<typeof renderEditorScene>>) {
  const groups = renderer.scene.findAll(
    (n) =>
      n.type === 'Group' &&
      typeof (n.props as { onPointerDown?: unknown }).onPointerDown === 'function',
  );
  return groups[0];
}

describe('Map editor scenarios', () => {
  it('Spawn tool: pointer-down on a room drops a spawn at the hit point (taxonomy A/C/F)', async () => {
    const onPlaceSpawn = vi.fn();
    const onSelect = vi.fn();
    const renderer = await renderEditorScene(
      <RoomsLayer
        instances={instances}
        rooms={roomLibrary()}
        selection={null}
        onSelect={onSelect}
        onMove={vi.fn()}
        tool="spawn"
        onPlaceSpawn={onPlaceSpawn}
      />,
    );
    await settle();

    const group = findRoomGroup(renderer);
    expect(group).toBeDefined();
    await renderer.fireEvent(group, 'pointerDown', {
      button: 0,
      point: { x: 1.5, y: 2.25, z: -3 },
      stopPropagation: () => {},
    });

    // Exact hit point preserved (no y=0 fallback, no voxel rounding).
    expect(onPlaceSpawn).toHaveBeenCalledTimes(1);
    expect(onPlaceSpawn.mock.calls[0][0]).toEqual([1.5, 2.25, -3]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Select tool: pointer-down on a room selects it, no spawn (taxonomy F)', async () => {
    const onPlaceSpawn = vi.fn();
    const onSelect = vi.fn();
    const renderer = await renderEditorScene(
      <RoomsLayer
        instances={instances}
        rooms={roomLibrary()}
        selection={null}
        onSelect={onSelect}
        onMove={vi.fn()}
        tool="select"
        onPlaceSpawn={onPlaceSpawn}
      />,
    );
    await settle();

    const group = findRoomGroup(renderer);
    await renderer.fireEvent(group, 'pointerDown', {
      button: 0,
      point: { x: 0, y: 0, z: 0 },
      stopPropagation: () => {},
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onPlaceSpawn).not.toHaveBeenCalled();
  });
});
