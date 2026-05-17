import type { Vec3, WorldObjects } from '@officexr/sdk';

/**
 * Game-physics constants + helpers that EVERY character in the world
 * obeys — the local player and every bot alike. The SOLID idea here
 * is "Open/Closed via shared rules": gameplay code (SceneFrame for
 * the player, BotPhysicsWorld/BotDriver for bots) imports these
 * pure helpers rather than each rolling its own constants. Add a
 * rule once → it applies everywhere.
 *
 * Bots are simulations of remote players; they don't get to defy
 * the game's physics.
 */

/** Vertical acceleration (m/s²) applied to a character's kinematic
 * body via Rapier's KinematicCharacterController. Snappier than
 * real-world gravity (-9.81) so falling reads as "stepping down"
 * not "floating down". */
export const GRAVITY = -20;

/** Metres above a spawn point's nominal y to drop a character when
 * (re)spawning it. Gravity carries them onto the surface. */
export const SPAWN_DROP_HEIGHT = 4;

/** Margin (m) below the lowest cube before a character counts as
 * "fallen off the map" and is forcibly respawned. Generous enough
 * that a character resting on the lowest cube's top can't trip the
 * check on a single jitter frame. */
export const RESPAWN_MARGIN = 10;

/**
 * Y-coordinate below which a character has "fallen off the map"
 * and should be respawned. Returns `-Infinity` when the map has no
 * cubes (i.e., there's nothing to fall off — never respawn).
 *
 * Cube bottom face = `inst.position[1] * cubeSize` (matches the
 * collider placement in `<MapColliders>` and
 * `worldObjectsToCuboids`).
 */
export function respawnThreshold(worldObjects: WorldObjects): number {
  if (worldObjects.instances.length === 0) return Number.NEGATIVE_INFINITY;
  let minBottom = Number.POSITIVE_INFINITY;
  for (const inst of worldObjects.instances) {
    const bottom = inst.position[1] * worldObjects.cubeSize;
    if (bottom < minBottom) minBottom = bottom;
  }
  return minBottom - RESPAWN_MARGIN;
}

/** Cuboid collider descriptor in world space. Engine-agnostic —
 * the Rapier adapter (browser-side `<MapColliders>` or bot-side
 * `BotPhysicsWorld.syncCubes`) turns this into a real collider. */
export interface CuboidDescriptor {
  center: { x: number; y: number; z: number };
  halfExtents: { x: number; y: number; z: number };
}

/** AABB lookup matching `InstanceGeometryService.worldAABB` — passed
 * in by callers that have an application api in scope. Keeps this
 * pure physics module free of the React-side context dependency. */
export interface InstanceAABBLookup {
  (
    position: readonly [number, number, number],
    kindId: string,
  ): {
    min: readonly [number, number, number];
    max: readonly [number, number, number];
  };
}

/**
 * Walk `worldObjects.instances` and emit one cuboid collider per
 * placed object. When `aabbLookup` is provided, each cuboid uses the
 * kind's true AABB (canonical convention: X/Z centered, Y bottom at
 * voxel*cubeSize). When omitted, falls back to the legacy one-voxel
 * cube — preserved so existing unit tests that don't have a catalog
 * keep working.
 */
export function worldObjectsToCuboids(
  worldObjects: WorldObjects,
  aabbLookup?: InstanceAABBLookup,
): CuboidDescriptor[] {
  const cs = worldObjects.cubeSize;
  const half = cs / 2;
  const out: CuboidDescriptor[] = [];
  for (const inst of worldObjects.instances) {
    if (aabbLookup) {
      const aabb = aabbLookup(inst.position, inst.kindId);
      out.push({
        center: {
          x: (aabb.min[0] + aabb.max[0]) / 2,
          y: (aabb.min[1] + aabb.max[1]) / 2,
          z: (aabb.min[2] + aabb.max[2]) / 2,
        },
        halfExtents: {
          x: (aabb.max[0] - aabb.min[0]) / 2,
          y: (aabb.max[1] - aabb.min[1]) / 2,
          z: (aabb.max[2] - aabb.min[2]) / 2,
        },
      });
      continue;
    }
    // Legacy fallback path — one-voxel-cube colliders. Used by old
    // bots without a catalog injected.
    out.push({
      center: {
        x: inst.position[0] * cs,
        y: inst.position[1] * cs + half,
        z: inst.position[2] * cs,
      },
      halfExtents: { x: half, y: half, z: half },
    });
  }
  return out;
}

/** Pick a spawn point + lift it by `SPAWN_DROP_HEIGHT` so the
 * character falls onto the surface instead of materialising on it.
 * Returns `null` when no spawn list is available — callers should
 * leave the character at its current position. */
export function pickRespawnPosition(
  spawns: readonly Vec3[],
  index = 0,
): Vec3 | null {
  if (spawns.length === 0) return null;
  const s = spawns[index % spawns.length];
  return { x: s.x, y: s.y + SPAWN_DROP_HEIGHT, z: s.z };
}
