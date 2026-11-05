import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyGhostMaterials, GHOST_OPACITY } from './Adventurer.tsx';

describe('applyGhostMaterials', () => {
  it('makes the ghost translucent without touching a shared material', () => {
    const shared = new THREE.MeshStandardMaterial();
    const opaque = new THREE.Mesh(new THREE.BoxGeometry(), shared);
    const ghost = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(), shared));
    applyGhostMaterials(ghost);

    const ghostMat = (ghost.children[0] as THREE.Mesh).material as THREE.Material;
    expect(ghostMat).not.toBe(shared);
    expect(ghostMat).toMatchObject({ transparent: true, opacity: GHOST_OPACITY, depthWrite: false });
    expect(opaque.material).toMatchObject({ transparent: false, opacity: 1, depthWrite: true });
  });
});
