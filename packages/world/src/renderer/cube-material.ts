import * as THREE from 'three';
import type { CubeKindEntry } from '../scenes/cube-kinds-schema.ts';

/**
 * Renderer-side helpers for turning a `CubeKindEntry`'s material
 * overrides into a Three.js material instance. Extracted from
 * `ObjectInstances.tsx` so the override-application logic is unit
 * testable without a WebGL context.
 *
 * The "no overrides set" branch deliberately returns the GLTF
 * material BY REFERENCE so existing renders (12 kinds × identity
 * overrides) keep the same instance + caching behavior they had
 * before Task 3 landed.
 */

/** True iff any per-kind material override is non-default. */
export function hasMaterialOverrides(kind: CubeKindEntry): boolean {
  return (
    kind.tint !== null ||
    kind.opacity < 1 ||
    kind.roughness !== null ||
    kind.metalness !== null ||
    kind.emissive !== null
  );
}

/** Clone `base` and apply the kind's per-field overrides. Returns
 * `base` unchanged when `hasMaterialOverrides(kind) === false`. */
export function buildMaterialForKind(
  base: THREE.Material,
  kind: CubeKindEntry,
): THREE.Material {
  if (!hasMaterialOverrides(kind)) return base;
  const clone = base.clone();
  const std = clone as Partial<THREE.MeshStandardMaterial> & THREE.Material;
  if (kind.tint && std.color instanceof THREE.Color) {
    std.color.set(kind.tint);
  }
  if (kind.opacity < 1) {
    clone.transparent = true;
    clone.opacity = kind.opacity;
  }
  if (kind.roughness !== null && typeof std.roughness === 'number') {
    std.roughness = kind.roughness;
  }
  if (kind.metalness !== null && typeof std.metalness === 'number') {
    std.metalness = kind.metalness;
  }
  if (kind.emissive && std.emissive instanceof THREE.Color) {
    std.emissive.set(kind.emissive);
    std.emissiveIntensity = kind.emissiveIntensity;
  }
  return clone;
}

/** Extract the first mesh material from a GLTF scene root. Throws if
 * none found — the catalog promises every entry has a renderable
 * GLTF, so this is a programming error, not a user error. */
export function extractMaterialFromGltf(scene: THREE.Object3D): THREE.Material {
  let mat: THREE.Material | null = null;
  scene.traverse((o) => {
    if (!mat && (o as THREE.Mesh).isMesh)
      mat = (o as THREE.Mesh).material as THREE.Material;
  });
  if (!mat) throw new Error('No mesh material in cube GLTF');
  return mat;
}

/** Extract the first mesh geometry from a GLTF scene root. */
export function extractGeometryFromGltf(
  scene: THREE.Object3D,
): THREE.BufferGeometry {
  let geom: THREE.BufferGeometry | null = null;
  scene.traverse((o) => {
    if (!geom && (o as THREE.Mesh).isMesh) geom = (o as THREE.Mesh).geometry;
  });
  if (!geom) throw new Error('No mesh geometry in cube GLTF');
  return geom;
}

export interface KindBoundingDimensions {
  /** X-axis extent in world meters (post-`scale`). */
  width: number;
  /** Y-axis extent in world meters (post-`scale`). */
  height: number;
  /** Z-axis extent in world meters (post-`scale`). */
  depth: number;
}

/**
 * Compute the axis-aligned bounding-box extents of a kind's GLTF
 * geometry, in meters, after applying the kind's uniform `scale`.
 * Used by the Object editor's read-only dimensions readout. Kept
 * here (next to the other GLTF helpers) so the studio panel doesn't
 * need to import THREE directly.
 */
export function getKindBoundingDimensions(
  scene: THREE.Object3D,
  scale: number,
): KindBoundingDimensions {
  const geom = extractGeometryFromGltf(scene);
  if (!geom.boundingBox) geom.computeBoundingBox();
  const bb = geom.boundingBox;
  if (!bb) {
    return { width: 0, height: 0, depth: 0 };
  }
  return {
    width: (bb.max.x - bb.min.x) * scale,
    height: (bb.max.y - bb.min.y) * scale,
    depth: (bb.max.z - bb.min.z) * scale,
  };
}
