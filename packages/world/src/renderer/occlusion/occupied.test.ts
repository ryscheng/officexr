import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { OccluderRegistry } from './OccluderRegistry.ts';
import { collectOccupiedInstanceIds } from './occupiedInstances.ts';
import { collectOccupiedAnchor } from './occupiedAnchor.ts';
import { createAnchor, setAnchorAt } from './occlusionMath.ts';
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
const NO_ANCHOR = createAnchor();
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
    registry.updateOccupantSilhouette('p1', camera, [head, chest], new Set(['sofa']), NO_ANCHOR);
    expect(registry.silhouetteSuppressed('p1')).toBe(true);

    const wall = boxes([[0, 2, 5]], [2, 4, 0.4]);
    registry.addInstanced(wall.mesh, 1, ['wall']);
    registry.updateOccupantSilhouette('p1', camera, [head, chest], new Set(['sofa']), NO_ANCHOR);
    expect(registry.silhouetteSuppressed('p1')).toBe(false);

    registry.updateOccupantSilhouette('p2', camera, [head, chest], new Set(), NO_ANCHOR);
    expect(registry.silhouetteSuppressed('p2')).toBe(false);
  });
});

function bakedBox(size: [number, number, number], at: [number, number, number]) {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial());
  mesh.position.set(...at);
  root.add(mesh);
  root.updateMatrixWorld(true);
  return mesh;
}

function runLow(registry: OccluderRegistry, cam: THREE.Vector3, seconds = 0.5) {
  for (let t = 0; t < seconds; t += 0.02) registry.updateFades(cam, [head, chest], 0.02, true);
}

describe('occupied anchor', () => {
  const low = new THREE.Vector3(0, 0.9, 8);

  it('derives the anchor from seat, swim and ride state', () => {
    const out = createAnchor();
    const pos = { x: 1, y: 2, z: 3 };
    expect(collectOccupiedAnchor(out, { pos }, 0.4).active).toBe(false);
    expect(collectOccupiedAnchor(out, { seat: 's', pos }, 0.4)).toMatchObject({ active: true, y: 2 });
    expect(collectOccupiedAnchor(out, { pose: 'swim', pos }, 0.4).y).toBeCloseTo(2.5);
    expect(collectOccupiedAnchor(out, { pose: 'scooter', pos }, 0.4).y).toBeCloseTo(2.8);
  });

  it('seated: a baked seat mesh holding the seat point does not fade, a wall still does', () => {
    const sofa = bakedBox([2, 1.2, 1], [0, 0.6, 0.6]);
    const wall = bakedBox([4, 3, 0.2], [0, 1.5, 3]);
    const registry = new OccluderRegistry();
    registry.addMesh(sofa);
    registry.addMesh(wall);
    runLow(registry, low);
    expect(sofa.visible).toBe(false);
    registry.restoreAll();
    const anchor = createAnchor();
    setAnchorAt(anchor, 0, 0.6, 0.6);
    registry.setOccupiedAnchor(anchor);
    runLow(registry, low);
    expect(sofa.visible).toBe(true);
    expect(wall.visible).toBe(false);
  });

  it('in water: a baked water mesh holding the feet does not fade', () => {
    const water = bakedBox([4, 0.9, 4], [0, 0.45, 0]);
    const lowest = new THREE.Vector3(0, 0.1, 8);
    const registry = new OccluderRegistry();
    registry.addMesh(water);
    const anchor = createAnchor();
    setAnchorAt(anchor, 0, 0.3, 0);
    registry.setOccupiedAnchor(anchor);
    runLow(registry, lowest);
    expect(water.visible).toBe(true);
    registry.setOccupiedAnchor(NO_ANCHOR);
    runLow(registry, lowest);
    expect(water.visible).toBe(false);
  });

  it('applies to instances without ids and leaves distant instances alone', () => {
    const { root, mesh } = boxes([[0, 0.6, 0.6], [0, 0.6, 3]], [2, 1.2, 1]);
    const registry = new OccluderRegistry();
    registry.addInstanced(mesh, 2);
    const anchor = createAnchor();
    setAnchorAt(anchor, 0, 0.6, 0.6);
    registry.setOccupiedAnchor(anchor);
    runLow(registry, low);
    expect(fadedSlots(root, mesh)).toBe(1);
  });

  it('a seat mesh is not part of the roof cover', () => {
    const canopy = bakedBox([4, 0.2, 4], [0, 3.1, 0]);
    const registry = new OccluderRegistry();
    registry.addMesh(canopy);
    const anchor = createAnchor();
    setAnchorAt(anchor, 0, 3.0, 0);
    registry.setOccupiedAnchor(anchor);
    for (let t = 0; t < 0.5; t += 0.02) registry.updateFades(new THREE.Vector3(0, 30, 6), [head], 0.02, true, { x: 0, feetY: 0, z: 0 });
    expect(registry.cutCount()).toBe(0);
  });

  it('a room-sized mesh around the player is never treated as occupied', () => {
    const room = bakedBox([20, 3, 0.4], [0, 1.5, 0.6]);
    const registry = new OccluderRegistry();
    registry.addMesh(room);
    const anchor = createAnchor();
    setAnchorAt(anchor, 0, 0.6, 0.6);
    registry.setOccupiedAnchor(anchor);
    runLow(registry, low);
    expect(room.visible).toBe(false);
  });

  it('silhouette: not triggered by a baked seat holding the anchor, triggered by a wall', () => {
    const sofa = bakedBox([2, 1.2, 1], [0, 0.6, 0.6]);
    const registry = new OccluderRegistry();
    registry.addMesh(sofa);
    const anchor = createAnchor();
    setAnchorAt(anchor, 0, 0.6, 0.6);
    registry.updateOccupantSilhouette('p1', low, [head, chest], new Set(), anchor);
    expect(registry.silhouetteSuppressed('p1')).toBe(true);
    registry.addMesh(bakedBox([4, 3, 0.2], [0, 1.5, 3]));
    registry.updateOccupantSilhouette('p1', low, [head, chest], new Set(), anchor);
    expect(registry.silhouetteSuppressed('p1')).toBe(false);
  });
});
