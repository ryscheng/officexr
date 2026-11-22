import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createCharacterSilhouette } from './characterSilhouette.ts';
import { playerAccent } from './silhouetteColor.ts';
import { withinRange } from './useCharacterSilhouette.ts';

function rig() {
  const root = new THREE.Group();
  const bone = new THREE.Bone();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(count * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const skin = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  skin.add(bone);
  skin.bind(new THREE.Skeleton([bone]));
  const prop = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial());
  root.add(skin, prop);
  return { root, skin, prop };
}

describe('character silhouette', () => {
  it('adds one hidden twin per mesh that shares the skeleton', () => {
    const { root, skin, prop } = rig();
    const silhouette = createCharacterSilhouette(root, '#ff0000');
    const twin = skin.children.find((c) => (c as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh;
    expect(twin.skeleton).toBe(skin.skeleton);
    expect(twin.visible).toBe(false);
    expect(prop.children).toHaveLength(1);
    silhouette.setVisible(true);
    expect(twin.visible).toBe(true);
    expect(twin.castShadow).toBe(false);
    expect(twin.geometry).toBe(skin.geometry);
  });

  it('draws only behind nearer geometry, without writing depth', () => {
    const { root, prop } = rig();
    createCharacterSilhouette(root, '#00ff00');
    const material = (prop.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.depthFunc).toBe(THREE.GreaterDepth);
    expect(material.depthWrite).toBe(false);
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeLessThan(1);
  });

  it('leaves the source materials alone and removes its twins on dispose', () => {
    const { root, skin, prop } = rig();
    const before = [skin.material, prop.material];
    const silhouette = createCharacterSilhouette(root, '#00ff00');
    silhouette.dispose();
    expect(skin.children.filter((c) => (c as THREE.Mesh).isMesh)).toHaveLength(0);
    expect(prop.children).toHaveLength(0);
    expect([skin.material, prop.material]).toEqual(before);
  });

  it('marks the body in the stencil and restores it on dispose', () => {
    const { root, skin } = rig();
    const material = skin.material as THREE.MeshStandardMaterial;
    const silhouette = createCharacterSilhouette(root, '#00ff00');
    expect(material.stencilWrite).toBe(true);
    expect(material.stencilRef).toBe(1);
    silhouette.dispose();
    expect(material.stencilWrite).toBe(false);
    expect(material.stencilRef).toBe(0);
  });

  it('gives each player a stable accent', () => {
    expect(playerAccent('a')).toBe(playerAccent('a'));
    expect(playerAccent('a')).not.toBe(playerAccent('b'));
    expect(playerAccent('a')).toMatch(/^hsl\(\d+, 85%, 58%\)$/);
  });

  it('shows other players only within range', () => {
    expect(withinRange(3, 0, 5)).toBe(true);
    expect(withinRange(4, 4, 5)).toBe(false);
  });
});
