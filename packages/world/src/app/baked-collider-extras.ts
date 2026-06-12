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
 * cuboids from the canonical physics source (`worldObjectsToCuboids`,
 * the same helper MapColliders and BotPhysicsWorld use — including the
 * compound-steps staircase override) and serialises them here. Physics
 * and visuals are decoupled: simplify can mangle the render mesh all it
 * wants without touching what characters stand on.
 *
 * One module owns BOTH sides of the schema (writer: `bakeLayout`;
 * reader: `BakedLayoutColliders`) so they cannot drift apart.
 *
 * Round-trip: gltf-transform writes `scene.setExtras(...)` → glTF JSON
 * `scenes[i].extras` → three's GLTFLoader copies extras onto
 * `gltf.scene.userData`.
 *
 * Headless: no `three`, no `react`, no DOM.
 */

import type { CuboidDescriptor } from '../physics/rules.ts';

/** Bump when the embedded shape changes incompatibly. Readers treat an
 * unknown version as "no embedded colliders" and fall back. */
export const BAKED_COLLIDERS_VERSION = 1;

interface BakedColliderPayload {
  version: number;
  cuboids: CuboidDescriptor[];
}

/** Build the extras object `bakeLayout` attaches to the output scene.
 * Namespaced under `officexr` so we never collide with extras a future
 * tool (or a source asset) might carry. */
export function buildColliderExtras(cuboids: CuboidDescriptor[]): {
  officexr: { colliders: BakedColliderPayload };
} {
  return {
    officexr: {
      colliders: { version: BAKED_COLLIDERS_VERSION, cuboids },
    },
  };
}

/**
 * Defensive parse of a loaded GLB scene's `userData`. Returns the
 * embedded cuboid descriptors, or `null` when the GLB carries none
 * (pre-extras bake) or the payload is malformed / from an unknown
 * schema version — callers fall back to legacy mesh-AABB traversal.
 */
export function parseEmbeddedColliders(
  userData: unknown,
): CuboidDescriptor[] | null {
  if (typeof userData !== 'object' || userData === null) return null;
  const officexr = (userData as { officexr?: unknown }).officexr;
  if (typeof officexr !== 'object' || officexr === null) return null;
  const colliders = (officexr as { colliders?: unknown }).colliders;
  if (typeof colliders !== 'object' || colliders === null) return null;
  const { version, cuboids } = colliders as {
    version?: unknown;
    cuboids?: unknown;
  };
  if (version !== BAKED_COLLIDERS_VERSION) return null;
  if (!Array.isArray(cuboids)) return null;

  const out: CuboidDescriptor[] = [];
  for (const c of cuboids) {
    const center = (c as { center?: unknown })?.center;
    const halfExtents = (c as { halfExtents?: unknown })?.halfExtents;
    if (!isVec3Record(center) || !isVec3Record(halfExtents)) return null;
    out.push({ center, halfExtents });
  }
  return out;
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
