import { describe, expect, it } from 'vitest';
import { createInstanceGeometry } from '../geometry-service.ts';
import { createRoomService } from '../room-service.ts';
import { emptyRoomDocument, newExtrude, newPlaceObject } from '../../scenes/commands.ts';
import type { WorldObjectKind } from '../../scenes/world-object-kinds-schema.ts';

describe('RoomService.compileScene', () => {
  it('extrudes a rotated target by its rotated tile step', () => {
    // A 4×1-voxel wall: yawed 90° it is 4 voxels deep along Z.
    const wall = { id: 'wall', dimensions: { width: 2, height: 1, depth: 0.5 } } as WorldObjectKind;
    const geometry = createInstanceGeometry({
      catalog: { getKind: (id) => (id === 'wall' ? wall : undefined) },
      voxelSize: 0.5,
    });
    const room = emptyRoomDocument('r');
    const place = newPlaceObject({ kindId: 'wall', position: [0, 0, 0], yawDeg: 90 });
    room.commands.push(place, newExtrude({ targetCommandId: place.id, face: 'pz', count: 3 }));

    const { instances } = createRoomService({ geometry }).compileScene(room);
    expect(instances.map((i) => i.position[2]).sort((a, b) => a - b)).toEqual([0, 4, 8]);
  });
});
