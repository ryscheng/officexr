import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { OccluderRegistry, type CoverProbe } from './OccluderRegistry.ts';

function slabs(positions: Array<[number, number, number]>, size: [number, number, number], name = '') {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial(), positions.length);
  positions.forEach((p, i) => mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(...p)));
  mesh.name = name;
  const root = new THREE.Group();
  root.add(mesh);
  return { root, mesh };
}

const camera = new THREE.Vector3(0, 30, 6);
const target = new THREE.Vector3(0, 1.5, 0);
const inside: CoverProbe = { x: 0, feetY: 0, z: 0 };
const outside: CoverProbe = { x: 40, feetY: 0, z: 0 };

function run(registry: OccluderRegistry, cover: CoverProbe | null, seconds = 0.5) {
  for (let t = 0; t < seconds; t += 0.02) registry.updateFades(camera, [target], 0.02, true, cover);
}

function ghostOpacity(root: THREE.Group, mesh: THREE.InstancedMesh, slot: number): number | undefined {
  const ghost = root.children.find((c) => c !== mesh) as THREE.InstancedMesh | undefined;
  return ghost?.instanceColor?.array[slot * 3];
}

describe('roof cutaway', () => {
  it('hides a roof above the player and everything on the storey above it', () => {
    const roof = slabs([[0, 3.1, 0]], [10, 0.2, 10]);
    const upper = slabs([[2, 4.5, 1], [-3, 6, 2]], [1, 1, 1]);
    const registry = new OccluderRegistry();
    registry.addInstanced(roof.mesh, 1);
    registry.addInstanced(upper.mesh, 2);
    run(registry, inside);
    expect(registry.cutCount()).toBe(3);
    expect(ghostOpacity(roof.root, roof.mesh, 0)).toBe(0);
    expect(ghostOpacity(upper.root, upper.mesh, 0)).toBe(0);
  });

  it('keeps walls and furniture below the roof', () => {
    const roof = slabs([[0, 3.1, 0]], [10, 0.2, 10]);
    const room = slabs([[0, 0.5, 4.8], [0, 1.5, -4.8]], [8, 3, 0.3]);
    const registry = new OccluderRegistry();
    registry.addInstanced(roof.mesh, 1);
    registry.addInstanced(room.mesh, 2);
    run(registry, inside);
    expect(registry.cutCount()).toBe(1);
    expect(room.root.children).toEqual([room.mesh]);
  });

  it('does nothing outside the roof footprint and restores on leaving', () => {
    const roof = slabs([[0, 3.1, 0]], [10, 0.2, 10]);
    const before = Array.from(roof.mesh.instanceMatrix.array);
    const registry = new OccluderRegistry();
    registry.addInstanced(roof.mesh, 1);
    run(registry, outside);
    expect(registry.cutCount()).toBe(0);
    run(registry, inside);
    expect(registry.cutCount()).toBe(1);
    run(registry, outside);
    expect(registry.cutCount()).toBe(0);
    const ghost = roof.root.children.find((c) => c !== roof.mesh) as THREE.InstancedMesh;
    expect(ghost.count).toBe(0);
    expect(Array.from(roof.mesh.instanceMatrix.array)).toEqual(before);
  });

  it('ignores low cover that is not above head height', () => {
    const awning = slabs([[0, 1.2, 0]], [4, 0.1, 4]);
    const registry = new OccluderRegistry();
    registry.addInstanced(awning.mesh, 1);
    run(registry, inside);
    expect(registry.cutCount()).toBe(0);
  });

  it('cuts nothing when no cover probe is given', () => {
    const roof = slabs([[0, 3.1, 0]], [10, 0.2, 10]);
    const registry = new OccluderRegistry();
    registry.addInstanced(roof.mesh, 1);
    run(registry, null);
    expect(registry.cutCount()).toBe(0);
  });

  it('uses the player floor level, so a ground floor under an upper storey is covered', () => {
    const slab = slabs([[0, 3.1, 0]], [10, 0.2, 10]);
    const registry = new OccluderRegistry();
    registry.addInstanced(slab.mesh, 1);
    run(registry, { x: 0, feetY: 3.2, z: 0 });
    expect(registry.cutCount()).toBe(0);
  });

  it('cuts a separate roof mesh and puts it back', () => {
    const root = new THREE.Group();
    const roof = new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, 10), new THREE.MeshStandardMaterial());
    roof.position.set(0, 3.1, 0);
    root.add(roof);
    root.updateMatrixWorld(true);
    const registry = new OccluderRegistry();
    expect(registry.addMesh(roof)).not.toBeNull();
    run(registry, inside);
    expect(roof.visible).toBe(false);
    const ghost = root.children.find((c) => c !== roof) as THREE.Mesh;
    expect(ghost.visible).toBe(false);
    run(registry, outside);
    expect(roof.visible).toBe(true);
  });

  it('does not register ordinary low meshes', () => {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(10, 0.1, 10), new THREE.MeshStandardMaterial());
    new THREE.Group().add(slab);
    expect(new OccluderRegistry().addMesh(slab)).toBeNull();
  });

  it('treats a roof-named kind just above head height as cover', () => {
    const named = slabs([[0, 1.9, 0]], [6, 0.2, 6], 'ceiling_tiles');
    const plain = slabs([[0, 1.9, 0]], [6, 0.2, 6]);
    const a = new OccluderRegistry();
    a.addInstanced(named.mesh, 1);
    const b = new OccluderRegistry();
    b.addInstanced(plain.mesh, 1);
    run(a, inside);
    run(b, inside);
    expect(a.cutCount()).toBe(1);
    expect(b.cutCount()).toBe(0);
  });
});
