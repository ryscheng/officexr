import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildMaterialForKind,
  extractGeometryFromGltf,
  extractMaterialFromGltf,
  getKindBoundingDimensions,
  hasMaterialOverrides,
} from './cube-material.ts';
import {
  CUBE_KIND_DEFAULTS,
  type CubeKindEntry,
} from '../scenes/cube-kinds-schema.ts';

function makeKind(partial: Partial<CubeKindEntry> = {}): CubeKindEntry {
  return {
    id: 'k',
    label: 'K',
    gltfPath: '/k.gltf',
    swatch: '#000000',
    walkable: false,
    ...CUBE_KIND_DEFAULTS,
    ...partial,
  } as CubeKindEntry;
}

function makeGltfScene(): THREE.Object3D {
  // A minimal stand-in for a GLTF scene root: a Group containing one
  // Mesh with a Standard material. `traverse()` visits both nodes.
  const group = new THREE.Group();
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x00aa00,
    roughness: 0.42,
    metalness: 0.13,
  });
  const mesh = new THREE.Mesh(geom, mat);
  group.add(mesh);
  return group;
}

describe('hasMaterialOverrides', () => {
  it('returns false for a kind with default overrides', () => {
    expect(hasMaterialOverrides(makeKind())).toBe(false);
  });

  it('returns true when any single override is non-default', () => {
    expect(hasMaterialOverrides(makeKind({ tint: '#ff00ff' }))).toBe(true);
    expect(hasMaterialOverrides(makeKind({ opacity: 0.5 }))).toBe(true);
    expect(hasMaterialOverrides(makeKind({ roughness: 0.8 }))).toBe(true);
    expect(hasMaterialOverrides(makeKind({ metalness: 0.2 }))).toBe(true);
    expect(hasMaterialOverrides(makeKind({ emissive: '#ffffff' }))).toBe(true);
  });

  it('treats opacity === 1 as default (no override)', () => {
    expect(hasMaterialOverrides(makeKind({ opacity: 1 }))).toBe(false);
  });
});

describe('buildMaterialForKind', () => {
  it('returns the input material BY REFERENCE when no overrides are set', () => {
    const base = new THREE.MeshStandardMaterial();
    const out = buildMaterialForKind(base, makeKind());
    expect(out).toBe(base); // identity — critical for "default render" parity
  });

  it('clones and applies tint without touching the base', () => {
    const base = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const out = buildMaterialForKind(
      base,
      makeKind({ tint: '#0000ff' }),
    ) as THREE.MeshStandardMaterial;
    expect(out).not.toBe(base);
    expect(out.color.getHex()).toBe(0x0000ff);
    expect(base.color.getHex()).toBe(0xff0000);
  });

  it('flips transparent + opacity together when opacity < 1', () => {
    const base = new THREE.MeshStandardMaterial();
    const out = buildMaterialForKind(base, makeKind({ opacity: 0.4 }));
    expect(out.transparent).toBe(true);
    expect(out.opacity).toBeCloseTo(0.4);
  });

  it('applies roughness / metalness when set', () => {
    const base = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.5 });
    const out = buildMaterialForKind(
      base,
      makeKind({ roughness: 0.9, metalness: 0.1 }),
    ) as THREE.MeshStandardMaterial;
    expect(out.roughness).toBeCloseTo(0.9);
    expect(out.metalness).toBeCloseTo(0.1);
  });

  it('applies emissive + intensity together', () => {
    const base = new THREE.MeshStandardMaterial();
    const out = buildMaterialForKind(
      base,
      makeKind({ emissive: '#003300', emissiveIntensity: 2 }),
    ) as THREE.MeshStandardMaterial;
    expect(out.emissive.getHex()).toBe(0x003300);
    expect(out.emissiveIntensity).toBeCloseTo(2);
  });

  it('null roughness / metalness leaves the base values alone on the clone', () => {
    const base = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.7 });
    const out = buildMaterialForKind(
      base,
      makeKind({ tint: '#ff00ff' }), // forces a clone, but roughness/metalness stay null
    ) as THREE.MeshStandardMaterial;
    expect(out.roughness).toBeCloseTo(0.5);
    expect(out.metalness).toBeCloseTo(0.7);
  });
});

describe('extractGeometryFromGltf / extractMaterialFromGltf', () => {
  it('returns the first mesh geometry from a nested scene', () => {
    const scene = makeGltfScene();
    expect(extractGeometryFromGltf(scene)).toBeInstanceOf(THREE.BufferGeometry);
  });

  it('returns the first mesh material from a nested scene', () => {
    const scene = makeGltfScene();
    expect(extractMaterialFromGltf(scene)).toBeInstanceOf(THREE.Material);
  });

  it('throws when no mesh is in the scene graph', () => {
    expect(() => extractMaterialFromGltf(new THREE.Group())).toThrow(/material/);
    expect(() => extractGeometryFromGltf(new THREE.Group())).toThrow(/geometry/);
  });
});

describe('getKindBoundingDimensions', () => {
  it('returns the unit-cube extents at scale 1', () => {
    const dims = getKindBoundingDimensions(makeGltfScene(), 1);
    expect(dims.width).toBeCloseTo(1);
    expect(dims.height).toBeCloseTo(1);
    expect(dims.depth).toBeCloseTo(1);
  });

  it('multiplies each axis by the kind scale', () => {
    const dims = getKindBoundingDimensions(makeGltfScene(), 2.5);
    expect(dims.width).toBeCloseTo(2.5);
    expect(dims.height).toBeCloseTo(2.5);
    expect(dims.depth).toBeCloseTo(2.5);
  });

  it('reports per-axis extents for non-cube geometries', () => {
    const group = new THREE.Group();
    const geom = new THREE.BoxGeometry(2, 0.5, 4);
    const mat = new THREE.MeshStandardMaterial();
    group.add(new THREE.Mesh(geom, mat));
    const dims = getKindBoundingDimensions(group, 1);
    expect(dims.width).toBeCloseTo(2);
    expect(dims.height).toBeCloseTo(0.5);
    expect(dims.depth).toBeCloseTo(4);
  });
});
