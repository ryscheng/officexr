/**
 * Baked-collider extras — the schema for physics colliders embedded in
 * a baked layout GLB's scene `extras`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The bake's visual geometry is merged (`join`) and optionally
 * simplified, so the runtime can no longer derive colliders from mesh
 * nodes (a merged room would yield one giant AABB box — unwalkable
 * corridors, unclimbable stairs). Instead the bake computes collider
 * descriptors from the canonical physics source
 * (`worldObjectsToColliders` — the same helper MapColliders and
 * BotPhysicsWorld use, including compound-steps stairs, scanned
 * cuboids, and slope trimeshes) and serialises them here. Physics and
 * visuals are decoupled: simplify can mangle the render mesh all it
 * wants without touching what characters stand on.
 *
 * One module owns BOTH sides of the schema (writer: `bakeLayout`;
 * reader: `BakedLayoutColliders`) so they cannot drift apart.
 *
 * VERSIONS
 * --------
 *   v1 — `{ version: 1, cuboids }` (boxes only).
 *   v2 — `{ version: 2, cuboids, trimeshes }` (adds slope trimeshes).
 * The reader accepts both; the writer emits v2. Unknown versions parse
 * to `null` → callers fall back to legacy mesh-AABB traversal.
 *
 * Round-trip: gltf-transform writes `scene.setExtras(...)` → glTF JSON
 * `scenes[i].extras` → three's GLTFLoader copies extras onto
 * `gltf.scene.userData`.
 *
 * Headless: no `three`, no `react`, no DOM.
 */

import type {
  ColliderDescriptor,
  CuboidDescriptor,
  TrimeshDescriptor,
} from '../physics/rules.ts';

/** Current written version. Readers also accept v1 (cuboids only). */
export const BAKED_COLLIDERS_VERSION = 2;

interface BakedColliderPayloadV2 {
  version: number;
  cuboids: CuboidDescriptor[];
  trimeshes: Array<{ vertices: number[]; indices: number[] }>;
}

/** Build the extras object `bakeLayout` attaches to the output scene.
 * Namespaced under `officexr` so we never collide with extras a future
 * tool (or a source asset) might carry. */
export function buildColliderExtras(colliders: ColliderDescriptor[]): {
  officexr: { colliders: BakedColliderPayloadV2 };
} {
  const cuboids: CuboidDescriptor[] = [];
  const trimeshes: BakedColliderPayloadV2['trimeshes'] = [];
  for (const c of colliders) {
    if (c.type === 'cuboid') {
      cuboids.push({ center: c.center, halfExtents: c.halfExtents });
    } else {
      trimeshes.push({ vertices: c.vertices, indices: c.indices });
    }
  }
  return {
    officexr: {
      colliders: { version: BAKED_COLLIDERS_VERSION, cuboids, trimeshes },
    },
  };
}

/**
 * Defensive parse of a loaded GLB scene's `userData`. Returns the
 * embedded collider descriptors, or `null` when the GLB carries none
 * (pre-extras bake) or the payload is malformed / from an unknown
 * schema version — callers fall back to legacy mesh-AABB traversal.
 */
export function parseEmbeddedColliders(
  userData: unknown,
): ColliderDescriptor[] | null {
  if (typeof userData !== 'object' || userData === null) return null;
  const officexr = (userData as { officexr?: unknown }).officexr;
  if (typeof officexr !== 'object' || officexr === null) return null;
  const colliders = (officexr as { colliders?: unknown }).colliders;
  if (typeof colliders !== 'object' || colliders === null) return null;
  const { version, cuboids, trimeshes } = colliders as {
    version?: unknown;
    cuboids?: unknown;
    trimeshes?: unknown;
  };
  if (version !== 1 && version !== 2) return null;
  if (!Array.isArray(cuboids)) return null;

  const out: ColliderDescriptor[] = [];
  for (const c of cuboids) {
    const center = (c as { center?: unknown })?.center;
    const halfExtents = (c as { halfExtents?: unknown })?.halfExtents;
    if (!isVec3Record(center) || !isVec3Record(halfExtents)) return null;
    out.push({ type: 'cuboid', center, halfExtents });
  }

  if (version === 2) {
    if (!Array.isArray(trimeshes)) return null;
    for (const t of trimeshes) {
      const tm = parseTrimesh(t);
      if (!tm) return null;
      out.push(tm);
    }
  }
  return out;
}

function parseTrimesh(raw: unknown): TrimeshDescriptor | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { vertices, indices } = raw as { vertices?: unknown; indices?: unknown };
  if (!Array.isArray(vertices) || !Array.isArray(indices)) return null;
  if (
    vertices.length === 0 ||
    vertices.length % 3 !== 0 ||
    indices.length === 0 ||
    indices.length % 3 !== 0
  ) {
    return null;
  }
  const vertexCount = vertices.length / 3;
  for (const v of vertices) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  }
  for (const i of indices) {
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= vertexCount) {
      return null;
    }
  }
  return {
    type: 'trimesh',
    vertices: [...(vertices as number[])],
    indices: [...(indices as number[])],
  };
}

function isVec3Record(
  v: unknown,
): v is { x: number; y: number; z: number } {
  if (typeof v !== 'object' || v === null) return false;
  const { x, y, z } = v as { x?: unknown; y?: unknown; z?: unknown };
  return (
    typeof x === 'number' &&
    Number.isFinite(x) &&
    typeof y === 'number' &&
    Number.isFinite(y) &&
    typeof z === 'number' &&
    Number.isFinite(z)
  );
}
