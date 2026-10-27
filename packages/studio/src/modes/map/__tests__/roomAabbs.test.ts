import { describe, expect, it } from 'vitest';
import {
  emptyLayoutDocument,
  emptyMapDocument,
  emptyRoomDocument,
  newPlaceObject,
  type RoomInstance,
} from '@officexr/world/scenes';
import { createTestApi } from '../../../test-harness/createTestApi.ts';
import { computeRoomAabbs } from '../roomAabbs.ts';

const KIND = '__primitive_blue';
const POSITION: [number, number, number] = [10, 1, 20];

// Each primitive footprint is 4 voxels wide, so the union is x [0,6), y [0,4), z [0,5) half-open.
const commands = [
  newPlaceObject({ kindId: KIND, position: [0, 0, 0] }),
  newPlaceObject({ kindId: KIND, position: [1, 0, 0] }),
  newPlaceObject({ kindId: KIND, position: [2, 0, 1] }),
];

function aabbs(rotationY: RoomInstance['rotationY'], baked = false) {
  const api = createTestApi();
  const room = emptyRoomDocument('r');
  const layout = emptyLayoutDocument('l');
  if (baked) {
    room.layoutName = 'l';
    layout.commands = commands;
  } else {
    room.commands = commands;
  }
  const map = {
    ...emptyMapDocument('m'),
    rooms: [{ id: 'p', roomName: 'r', position: POSITION, rotationY }],
  };
  return computeRoomAabbs(
    map,
    new Map([['r', room]]),
    new Map([['l', layout]]),
    api.rooms,
    api.geometry,
  );
}

describe('computeRoomAabbs', () => {
  // Expected boxes are the inclusive hull of the footprint rotated like the
  // rendered room (three.js Ry: rot1 (x,z)->(z,-x)), then offset by POSITION.
  const cases = [
    { rot: 0, min: [0, 0, 0], max: [5, 3, 4] },
    { rot: 1, min: [0, 0, -6], max: [4, 3, -1] },
    { rot: 2, min: [-6, 0, -5], max: [-1, 3, -1] },
    { rot: 3, min: [-5, 0, 0], max: [-1, 3, 5] },
  ] as const;

  it.each(cases)('rotation $rot matches the rendered footprint', ({ rot, min, max }) => {
    const [px, py, pz] = POSITION;
    expect(aabbs(rot)).toEqual([
      {
        id: 'p',
        min: [min[0] + px, min[1] + py, min[2] + pz],
        max: [max[0] + px, max[1] + py, max[2] + pz],
      },
    ]);
  });

  it('gives a baked room the same box via its layout', () => {
    expect(aabbs(1, true)).toEqual(aabbs(1));
  });
});
