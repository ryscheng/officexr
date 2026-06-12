import type { Vec3, WorldObjects } from '@officexr/sdk';
import type { ColliderShapeSpec } from '../scenes/world-object-kinds-schema.ts';

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

/** Penetration "skin" (offset) for the kinematic character controller
 * — the small gap Rapier keeps between the character collider and the
 * world during collide-and-slide. Its job is to avoid numerical
 * penetration / tunneling (a fast collider slipping through geometry
 * in one step) and contact jitter. The side effect is that the
 * collider rests this far ABOVE whatever it lands on, so the visible
 * feet float by exactly this much.
 *
 * Kept very near zero (not exactly 0 — Rapier discourages that) so the
 * character genuinely settles ON the ground rather than floating ~1 cm
 * above it. Tunneling risk is low here: world geometry is solid 2 m
 * cubes, far thicker than any per-frame movement step. Used by BOTH
 * the local player (`SceneFrame`) and bots (`BotPhysicsWorld`) so every
 * character obeys the same contact rule. */
export const CHARACTER_CONTROLLER_SKIN = 0.0001;

/** Autostep config for the kinematic character controller — lets EVERY
 * character (player and bot alike) walk up sub-threshold ledges like
 * staircase steps instead of colliding with the riser face. Without
 * autostep the Rapier KCC deflects the ball backward when it contacts a
 * step face (the slide direction nets away from the step instead of
 * over it), so the character halts at the first step.
 *
 * - `AUTOSTEP_MAX_HEIGHT` = 0.4 m (= default charRadius): the tallest
 *   ledge autostep will lift over. Steps taller than the ball radius
 *   need the KCC's autostep logic; below that the ball can sometimes
 *   slide over the corner naturally, but autostep makes it reliable.
 *   Full 2 m blocks stay unclimbable — only stair-scale thresholds.
 * - `AUTOSTEP_MIN_WIDTH` = 0.1 m: minimum landing width to step onto.
 *   Stair columns are 0.25 m wide (stepRun), comfortably above this.
 *
 * Callers that enable autostep MUST also pair it with the climb-aware
 * vertical-velocity reset (zero the integrated fall speed when the
 * corrected movement is upward/flat) — `computedGrounded()` flickers
 * false during autostep lifts, and without the reset gravity
 * accumulates across a climb until it trips the fall-respawn gate.
 * See BotPhysicsWorld.step() and SceneFrame's frame loop. */
export const AUTOSTEP_MAX_HEIGHT = 0.4;
export const AUTOSTEP_MIN_WIDTH = 0.1;

/** Margin (m) below the lowest cube before a character counts as
 * "fallen off the map" and is forcibly respawned. Generous enough
 * that a character resting on the lowest cube's top can't trip the
 * check on a single jitter frame. */
export const RESPAWN_MARGIN = 10;

/** Downward speed (m/s, positive magnitude) at which a falling character
 * is eligible for respawn. Must hold simultaneously with no floor beneath.
 * Gate (b) for {@link shouldRespawnFalling}. */
export const MAX_FALL_VELOCITY = 80;

/** Metres below character feet to probe for a floor surface.
 * If no floor is found within this range, condition (a) of the dual-gate
 * fall-respawn rule is met. Used by both {@link BotPhysicsWorld.probeFloor}
 * and the SceneFrame player controller. */
export const FLOOR_PROBE_RANGE = 2.0;

/**
 * Primary fall-respawn gate: returns true when BOTH conditions hold.
 *   (a) hasFloorUnderneath === false  (downward probe found no surface)
 *   (b) velY <= -MAX_FALL_VELOCITY    (falling fast enough)
 *
 * SRP: this function knows nothing about Rapier, React, or Three. It
 * receives pre-computed inputs from the caller (bot or player).
 *
 * Callers must ALSO check the Y-floor backstop (respawnThreshold) as a
 * last resort so a character that somehow bypasses this gate still
 * returns eventually.
 *
 * @param velY - Vertical velocity (m/s, negative = falling).
 * @param hasFloorUnderneath - True if a downward probe found ground within
 *   FLOOR_PROBE_RANGE metres of the character's feet.
 */
export function shouldRespawnFalling(
  velY: number,
  hasFloorUnderneath: boolean,
): boolean {
  return !hasFloorUnderneath && velY <= -MAX_FALL_VELOCITY;
}

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

/** Collider-shape lookup: returns the optional `colliderShape` override
 * for a given kind id. Passed by callers that have a catalog in scope.
 * ISP: only `worldObjectsToCuboids` reads this; other callers are
 * unaffected and do not need to provide it. */
export interface ColliderShapeLookup {
  (kindId: string): ColliderShapeSpec | undefined;
}

/**
 * Emit per-step compound cuboid descriptors for a staircase placed at
 * world-space origin `[ox, oy, oz]`.
 *
 * Geometry (from the Primitive_Stairs binary audit, task-05):
 *   - The staircase ascends in the −X direction (step 1 near face at
 *     local x = +maxX, step N far face at x = −maxX).
 *   - Each step column is a solid rectangular prism from y=oy (bottom)
 *     to y=oy + (i+1)*stepRise (step top), covering one step's X run
 *     and the full Z depth.
 *
 * This approximation replaces the single bounding-box cuboid with a
 * staircase topology that Rapier's kinematic character controller can
 * physically climb. The cuboid shape is a deliberate approximation —
 * the exact GLTF mesh triangles are not used because @react-three/rapier
 * does not expose TriMesh static colliders in the current version.
 * See STAIRS-INVESTIGATION-FINDING.md §4 for the full rationale.
 */
function compoundStepCuboids(
  ox: number,
  oy: number,
  oz: number,
  aabb: { min: readonly [number, number, number]; max: readonly [number, number, number] },
  spec: import('../scenes/world-object-kinds-schema.ts').CompoundStepsSpec,
): CuboidDescriptor[] {
  const { stepCount, stepRise, stepRun, stepDepth } = spec;
  const out: CuboidDescriptor[] = [];
  // World-space X extent of the whole staircase: [ox, ox + totalWidth].
  // Step 1 (lowest) near face is at worldX = ox + totalWidth - stepRun * 0; far face is
  // at worldX = ox + totalWidth - stepRun * 1, etc.
  const totalWidth = aabb.max[0] - aabb.min[0];  // in local space units (metres)
  for (let i = 0; i < stepCount; i++) {
    // Step i: column from x_far to x_near, y=oy to oy+(i+1)*stepRise, z=oz to oz+stepDepth
    const xFar = ox + totalWidth - (i + 1) * stepRun;
    const xNear = xFar + stepRun;
    const yTop = oy + (i + 1) * stepRise;
    const yBot = oy;
    const zMin = oz;
    const zMax = oz + stepDepth;
    out.push({
      center: {
        x: (xFar + xNear) / 2,
        y: (yBot + yTop) / 2,
        z: (zMin + zMax) / 2,
      },
      halfExtents: {
        x: (xNear - xFar) / 2,
        y: (yTop - yBot) / 2,
        z: (zMax - zMin) / 2,
      },
    });
  }
  return out;
}

/**
 * Walk `worldObjects.instances` and emit cuboid collider descriptors.
 *
 * When `aabbLookup` is provided, each cuboid uses the kind's true AABB
 * (canonical convention: X/Z centred, Y bottom at voxel*cubeSize).
 * When omitted, falls back to the legacy one-voxel cube — preserved so
 * existing unit tests that don't have a catalog keep working.
 *
 * When `colliderShapeLookup` is also provided, kinds that declare a
 * `colliderShape` override (e.g. `compound-steps`) emit multiple cuboids
 * instead of the single AABB box. Callers that don't supply this lookup
 * always get the single-AABB behaviour (no regression for them).
 *
 * OCP note: the default AABB path is never touched by a new collider
 * shape variant — each new shape adds a branch here without modifying
 * the existing code paths.
 */
export function worldObjectsToCuboids(
  worldObjects: WorldObjects,
  aabbLookup?: InstanceAABBLookup,
  colliderShapeLookup?: ColliderShapeLookup,
): CuboidDescriptor[] {
  const cs = worldObjects.cubeSize;
  const half = cs / 2;
  const out: CuboidDescriptor[] = [];
  for (const inst of worldObjects.instances) {
    if (aabbLookup) {
      const aabb = aabbLookup(inst.position, inst.kindId);
      // Check for a compound-steps override before falling back to single AABB.
      const shapeSpec = colliderShapeLookup?.(inst.kindId);
      if (shapeSpec?.kind === 'compound-steps') {
        const ox = aabb.min[0];
        const oy = aabb.min[1];
        const oz = aabb.min[2];
        out.push(...compoundStepCuboids(ox, oy, oz, aabb, shapeSpec));
        continue;
      }
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
