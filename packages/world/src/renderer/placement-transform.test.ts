import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { compileMap } from '../scenes/compile-map.ts';
import { emptyRoomDocument, newPlaceObject } from '../scenes/commands.ts';
import { emptyMapDocument } from '../scenes/map-document.ts';
import { VOXEL_SIZE } from './config.ts';
import { placementTransform } from './placement-transform.ts';

describe('placementTransform', () => {
  const room = emptyRoomDocument('room');
  room.commands.push(newPlaceObject({ kindId: 'k', position: [2, 1, 3] }));
  const localMin = new THREE.Vector3(2, 1, 3).multiplyScalar(VOXEL_SIZE);
  const localMax = new THREE.Vector3(3, 2, 4).multiplyScalar(VOXEL_SIZE);

  it.each([0, 1, 2, 3] as const)('moves a cube onto its compileMap AABB at rotationY %i', (rotationY) => {
    const placement = { position: [7, 2, -5] as [number, number, number], rotationY };
    const map = emptyMapDocument('m');
    map.rooms = [{ id: 'p', roomName: 'room', ...placement }];
    const [inst] = compileMap(map, new Map([['room', room]]), VOXEL_SIZE).instances;

    const { position, rotation } = placementTransform(placement);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(1, 1, 1),
    );
    const world = new THREE.Box3(localMin.clone(), localMax.clone()).applyMatrix4(matrix);

    const [x, y, z] = inst.position;
    expect(world.min.toArray().map((v) => v / VOXEL_SIZE)).toEqual(
      [x, y, z].map((v) => expect.closeTo(v, 9)),
    );
    expect(world.max.toArray().map((v) => v / VOXEL_SIZE)).toEqual(
      [x + 1, y + 1, z + 1].map((v) => expect.closeTo(v, 9)),
    );
  });

  it('is the identity without a placement', () => {
    expect(placementTransform()).toEqual({ position: [0, 0, 0], rotation: [0, 0, 0] });
  });
});
