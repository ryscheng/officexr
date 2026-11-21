import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { OccluderRegistry } from './OccluderRegistry.ts';

function wallsMesh(positions: Array<[number, number, number]>, size: [number, number, number]) {
  const geometry = new THREE.BoxGeometry(...size);
  const material = new THREE.MeshStandardMaterial({ color: 0x336699, transparent: false, opacity: 1 });
  const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
  positions.forEach((p, i) => mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(...p)));
  mesh.instanceMatrix.needsUpdate = true;
  const root = new THREE.Group();
  root.add(mesh);
  return { root, mesh, material };
}

const camera = new THREE.Vector3(0, 4, 8);
const head = new THREE.Vector3(0, 1.55, 0);
const chest = new THREE.Vector3(0, 1, 0);

function run(registry: OccluderRegistry, seconds: number, cam = camera) {
  for (let t = 0; t < seconds; t += 0.02) registry.updateFades(cam, [head, chest], 0.02, true);
}

function ghostOf(root: THREE.Group, mesh: THREE.InstancedMesh) {
  return root.children.find((c) => c !== mesh) as THREE.InstancedMesh | undefined;
}

describe('instanced occluders', () => {
  it('fades an instance that contains the camera', () => {
    const { root, mesh } = wallsMesh([[0, 2, 3]], [2, 4, 1]);
    const registry = new OccluderRegistry();
    registry.addInstanced(mesh, 1);
    run(registry, 0.5, new THREE.Vector3(0, 1.5, 3.2));
    expect(ghostOf(root, mesh)?.count).toBe(1);
  });

  it('fades only the instance between camera and player', () => {
    const { root, mesh } = wallsMesh([[0, 2, 3], [6, 2, 3], [0, 2, -3]], [2, 4, 0.4]);
    const registry = new OccluderRegistry();
    registry.addInstanced(mesh, 3);
    run(registry, 0.5);
    const ghost = ghostOf(root, mesh);
    expect(ghost?.count).toBe(1);
    const ghostMatrix = new THREE.Matrix4();
    ghost?.getMatrixAt(0, ghostMatrix);
    expect(new THREE.Vector3().setFromMatrixPosition(ghostMatrix).z).toBe(3);
    const hidden = new THREE.Matrix4();
    mesh.getMatrixAt(0, hidden);
    expect(hidden.elements[0]).toBe(0);
    mesh.getMatrixAt(1, hidden);
    expect(hidden.elements[0]).toBe(1);
    expect(ghost?.instanceColor?.array[0]).toBeCloseTo(0.28, 2);
  });

  it('restores the exact original matrices and material when clear', () => {
    const { root, mesh, material } = wallsMesh([[0, 2, 3]], [2, 4, 0.4]);
    const before = Array.from(mesh.instanceMatrix.array);
    const registry = new OccluderRegistry();
    registry.addInstanced(mesh, 1);
    run(registry, 0.5);
    expect(ghostOf(root, mesh)?.count).toBe(1);
    run(registry, 0.5, new THREE.Vector3(30, 4, 8));
    expect(ghostOf(root, mesh)?.count).toBe(0);
    expect(Array.from(mesh.instanceMatrix.array)).toEqual(before);
    expect(material.transparent).toBe(false);
    expect(material.opacity).toBe(1);
    expect(material.depthWrite).toBe(true);
  });

  it('leaves floors unfaded', () => {
    const { root, mesh } = wallsMesh([[0, 0.1, 3]], [8, 0.2, 8]);
    const registry = new OccluderRegistry();
    registry.addInstanced(mesh, 1);
    run(registry, 0.5, new THREE.Vector3(0, 0.1, 9));
    expect(ghostOf(root, mesh)).toBeUndefined();
  });

  it('restoreAll and removal put everything back', () => {
    const { root, mesh } = wallsMesh([[0, 2, 3]], [2, 4, 0.4]);
    const before = Array.from(mesh.instanceMatrix.array);
    const registry = new OccluderRegistry();
    const remove = registry.addInstanced(mesh, 1);
    run(registry, 0.5);
    remove();
    expect(Array.from(mesh.instanceMatrix.array)).toEqual(before);
    expect(root.children).toEqual([mesh]);
  });
});

describe('mesh occluders', () => {
  it('fades a plain mesh through a ghost and restores visibility', () => {
    const root = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ opacity: 1 });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.3), material);
    wall.position.set(0, 1.5, 3);
    root.add(wall);
    root.updateMatrixWorld(true);
    const registry = new OccluderRegistry();
    expect(registry.addMesh(wall)).not.toBeNull();
    run(registry, 0.5);
    expect(wall.visible).toBe(false);
    const ghost = root.children.find((c) => c !== wall) as THREE.Mesh;
    expect((ghost.material as THREE.Material).opacity).toBeCloseTo(0.28, 2);
    expect(material.opacity).toBe(1);
    run(registry, 0.5, new THREE.Vector3(30, 4, 8));
    expect(wall.visible).toBe(true);
    expect(ghost.visible).toBe(false);
    expect(material.transparent).toBe(false);
  });

  it('fades a wall that contains the camera', () => {
    const root = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 1), new THREE.MeshStandardMaterial());
    wall.position.set(0, 1.5, 3);
    root.add(wall);
    root.updateMatrixWorld(true);
    const registry = new OccluderRegistry();
    registry.addMesh(wall);
    run(registry, 0.5, new THREE.Vector3(0, 1.5, 3.2));
    expect(wall.visible).toBe(false);
    run(registry, 0.5, new THREE.Vector3(30, 4, 8));
    expect(wall.visible).toBe(true);
  });

  it('does not register floor-like meshes', () => {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(10, 0.1, 10), new THREE.MeshStandardMaterial());
    new THREE.Group().add(slab);
    expect(new OccluderRegistry().addMesh(slab)).toBeNull();
  });
});
