import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createInstanceGeometry } from '../app/geometry-service.ts';
import { compileMap } from '../scenes/compile-map.ts';
import { emptyRoomDocument, newPlaceObject } from '../scenes/commands.ts';
import { emptyMapDocument } from '../scenes/map-document.ts';
import type { WorldObjectKind } from '../scenes/world-object-kinds-schema.ts';
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

  describe('compiled yaw matches the rigid room transform', () => {
    // Non-square and off-centre mesh origin, so any pivot mistake shows.
    const kind = {
      id: 'k',
      localAABB: { min: { x: -0.2, y: 0, z: -0.1 }, max: { x: 1.3, y: 1, z: 0.5 } },
    } as WorldObjectKind;
    const geom = createInstanceGeometry({
      catalog: { getKind: (id) => (id === 'k' ? kind : undefined) },
      voxelSize: VOXEL_SIZE,
    });
    const matrix = (position: readonly number[], rotationY: number) =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(...position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0)),
        new THREE.Vector3(1, 1, 1),
      );

    const cases = [0, 90, 45].flatMap((yawDeg) =>
      ([0, 1, 2, 3] as const).map((rotationY) => ({ yawDeg, rotationY })),
    );
    it.each(cases)('yaw $yawDeg, rotationY $rotationY', ({ yawDeg, rotationY }) => {
      const objectRoom = emptyRoomDocument('room');
      objectRoom.commands.push(newPlaceObject({ kindId: 'k', position: [3, 1, 5], yawDeg }));
      const placement = { position: [7, 2, -4] as [number, number, number], rotationY };
      const map = emptyMapDocument('m');
      map.rooms = [{ id: 'p', roomName: 'room', ...placement }];
      const [inst] = compileMap(
        map,
        new Map([['room', objectRoom]]),
        VOXEL_SIZE,
        undefined,
        undefined,
        geom.worldAABB,
      ).instances;

      const room = placementTransform(placement);
      const local = geom.meshTransform([3, 1, 5], 'k', yawDeg);
      const rigid = matrix(room.position, room.rotation[1]).multiply(
        matrix(local.position, local.rotationY),
      );
      const compiled = geom.meshTransform(inst.position, 'k', inst.yawDeg);
      expect(matrix(compiled.position, compiled.rotationY).elements).toEqual(
        rigid.elements.map((v) => expect.closeTo(v, 9)),
      );
    });
  });

  it('is the identity without a placement', () => {
    expect(placementTransform()).toEqual({ position: [0, 0, 0], rotation: [0, 0, 0] });
  });
});
