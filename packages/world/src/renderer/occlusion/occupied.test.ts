import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { OccluderRegistry } from './OccluderRegistry.ts';
import { collectOccupiedInstanceIds } from './occupiedInstances.ts';
import type { WaterVolume } from '../../motion/water.ts';

function boxes(positions: Array<[number, number, number]>, size: [number, number, number]) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial(), positions.length);
  positions.forEach((p, i) => mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(...p)));
  const root = new THREE.Group();
  root.add(mesh);
  return { root, mesh };
}

const camera = new THREE.Vector3(0, 4, 8);
const head = new THREE.Vector3(0, 1.55, 0);
const chest = new THREE.Vector3(0, 1, 0);
const pool: WaterVolume = { id: 'pool-1', minX: -3, maxX: 3, minZ: -3, maxZ: 3, baseY: -1, surfaceY: 0 };

function run(registry: OccluderRegistry, seconds = 0.5) {
  for (let t = 0; t < seconds; t += 0.02) registry.updateFades(camera, [head, chest], 0.02, true);
}

function fadedSlots(root: THREE.Group, mesh: THREE.InstancedMesh): number {
  return (root.children.find((c) => c !== mesh) as THREE.InstancedMesh | undefined)?.count ?? 0;
}

describe('occupied instances', () => {
  it('collects the seat instance, the ridden rack and the pool being swum in', () => {
    const out = new Set<string>();
    const at = { x: 1, z: 1 };
    expect([...collectOccupiedInstanceIds(out, { seat: 'sofa-1#2', pos: at }, [])]).toEqual(['sofa-1']);
    expect([...collectOccupiedInstanceIds(out, { pose: 'scooter', poseRack: 'rack-3', pos: at }, [])]).toEqual(['rack-3']);
    expect([...collectOccupiedInstanceIds(out, { pose: 'swim', pos: at }, [pool])]).toEqual(['pool-1']);
    expect([...collectOccupiedInstanceIds(out, { pose: 'swim', pos: { x: 9, z: 9 } }, [pool])]).toEqual([]);
    expect(collectOccupiedInstanceIds(out, { pos: at }, [pool]).size).toBe(0);
  });

  it('seated: the own seat does not fade, other objects still do', () => {
    const { root, mesh } = boxes([[0, 2, 3], [0, 2, 5]], [2, 4, 0.4]);
    const registry = new OccluderRegistry();
    registry.addInstanced(mesh, 2, ['sofa', 'wall']);
    registry.setOccupied(new Set(['sofa']));
    run(registry);
    expect(fadedSlots(root, mesh)).toBe(1);
    const ghost = root.children.find((c) => c !== mesh) as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    ghost.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).z).toBe(5);
  });

  it('riding: the vehicle rack is not an occluder', () => {
    const { root, mesh } = boxes([[0, 2, 3]], [2, 4, 0.4]);
    const registry = new OccluderRegistry();
    registry.addInstanced(mesh, 1, ['rack-3']);
    registry.setOccupied(collectOccupiedInstanceIds(new Set(), { pose: 'scooter', poseRack: 'rack-3', pos: { x: 0, z: 0 } }, []));
    run(registry);
    expect(fadedSlots(root, mesh)).toBe(0);
  });

  it('in water: the pool does not fade while swimming, and does again after leaving it', () => {
    const { root, mesh } = boxes([[0, 2, 3]], [2, 4, 0.4]);
    const registry = new OccluderRegistry();
    registry.addInstanced(mesh, 1, ['pool-1']);
    registry.setOccupied(collectOccupiedInstanceIds(new Set(), { pose: 'swim', pos: { x: 0, z: 0 } }, [pool]));
    run(registry);
    expect(fadedSlots(root, mesh)).toBe(0);
    registry.setOccupied(new Set());
    run(registry);
    expect(fadedSlots(root, mesh)).toBe(1);
  });

  it('an occupied instance already faded returns to full opacity', () => {
    const { root, mesh } = boxes([[0, 2, 3]], [2, 4, 0.4]);
    const registry = new OccluderRegistry();
    registry.addInstanced(mesh, 1, ['sofa']);
    run(registry);
    expect(fadedSlots(root, mesh)).toBe(1);
    registry.setOccupied(new Set(['sofa']));
    run(registry);
    expect(fadedSlots(root, mesh)).toBe(0);
  });

  it('the own seat is not part of the roof cover', () => {
    const { mesh } = boxes([[0, 3.1, 0]], [10, 0.2, 10]);
    const registry = new OccluderRegistry();
    registry.addInstanced(mesh, 1, ['canopy']);
    registry.setOccupied(new Set(['canopy']));
    for (let t = 0; t < 0.5; t += 0.02) registry.updateFades(new THREE.Vector3(0, 30, 6), [head], 0.02, true, { x: 0, feetY: 0, z: 0 });
    expect(registry.cutCount()).toBe(0);
  });

  it('silhouette: not triggered by the own seat, triggered by another object in the way', () => {
    const seat = boxes([[0, 2, 3]], [2, 4, 0.4]);
    const registry = new OccluderRegistry();
    registry.addInstanced(seat.mesh, 1, ['sofa']);
    registry.updateOccupantSilhouette('p1', camera, [head, chest], new Set(['sofa']));
    expect(registry.silhouetteSuppressed('p1')).toBe(true);

    const wall = boxes([[0, 2, 5]], [2, 4, 0.4]);
    registry.addInstanced(wall.mesh, 1, ['wall']);
    registry.updateOccupantSilhouette('p1', camera, [head, chest], new Set(['sofa']));
    expect(registry.silhouetteSuppressed('p1')).toBe(false);

    registry.updateOccupantSilhouette('p2', camera, [head, chest], new Set());
    expect(registry.silhouetteSuppressed('p2')).toBe(false);
  });
});
