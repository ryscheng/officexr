import type { Vec3 } from '../game-state/types.ts';
import { cellCenter, forEachCellInRadius } from './query.ts';
import type {
  CollisionWorld,
  MoveResolution,
  OtherCharacter,
  Vec2,
} from './types.ts';

const EPS = 1e-6;

interface ResolveArgs {
  from: Vec3;
  to: Vec3;
  charRadius: number;
  world: CollisionWorld;
  others: OtherCharacter[];
}

/**
 * Resolve a single character's proposed move. The character is a circle of
 * `charRadius` in the XZ plane; obstacles are axis-aligned cubes (narrow
 * phase = AABB-vs-circle), and other characters are circles. The resolved
 * position never overlaps any obstacle and never crosses the map edge.
 *
 * On char-vs-char contact the function returns `contact: 'character'` and
 * the contact normal — the renderer can use these to play a cosmetic bump
 * easing animation.
 *
 * No vertical handling: `pos.y = to.y` unchanged. Two slide iterations
 * suffice for L-shaped corners; deeper recursion can ping-pong.
 */
export function resolveMovement(args: ResolveArgs): MoveResolution {
  const { from, world, charRadius, others } = args;
  let pos: Vec2 = { x: args.to.x, z: args.to.z };

  // 1) Map-edge clamp.
  const limit = world.halfExtent - charRadius;
  let boundsHit = false;
  if (pos.x < -limit) {
    pos.x = -limit;
    boundsHit = true;
  } else if (pos.x > limit) {
    pos.x = limit;
    boundsHit = true;
  }
  if (pos.z < -limit) {
    pos.z = -limit;
    boundsHit = true;
  } else if (pos.z > limit) {
    pos.z = limit;
    boundsHit = true;
  }

  // 2) Char-vs-cube + slide. We push the character out along the contact
  //    normal, then project the residual movement onto the contact tangent
  //    and retry. Two iterations are enough for axis-aligned cubes; if the
  //    second attempt still overlaps, we fall back to `from`.
  let obstacleNormal: Vec2 | null = null;
  for (let iter = 0; iter < 2; iter++) {
    let didPush = false;
    // Tuple ref so the callback's mutation survives TS's closure analysis.
    const pushedRef: { value: Vec2 | null } = { value: null };
    forEachCellInRadius(world, pos.x, pos.z, charRadius, (i, j) => {
      const c = cellCenter(world, i, j);
      const halfCube = world.cubeSize / 2;
      // Closest point on cube AABB to the character circle.
      const cx = clamp(pos.x, c.x - halfCube, c.x + halfCube);
      const cz = clamp(pos.z, c.z - halfCube, c.z + halfCube);
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= charRadius * charRadius) return;
      let nx: number;
      let nz: number;
      if (d2 < EPS) {
        // Char centre is inside the cube AABB. Push to the nearest face
        // plus the char's radius — moving by `charRadius` from the (clamped)
        // closest point isn't enough because the closest point IS the char
        // itself when we're inside.
        const exitPx = c.x + halfCube + charRadius - pos.x;
        const exitNx = pos.x - (c.x - halfCube - charRadius);
        const exitPz = c.z + halfCube + charRadius - pos.z;
        const exitNz = pos.z - (c.z - halfCube - charRadius);
        const minExit = Math.min(exitPx, exitNx, exitPz, exitNz);
        if (minExit === exitPx) {
          pos = { x: c.x + halfCube + charRadius, z: pos.z };
          nx = 1;
          nz = 0;
        } else if (minExit === exitNx) {
          pos = { x: c.x - halfCube - charRadius, z: pos.z };
          nx = -1;
          nz = 0;
        } else if (minExit === exitPz) {
          pos = { x: pos.x, z: c.z + halfCube + charRadius };
          nx = 0;
          nz = 1;
        } else {
          pos = { x: pos.x, z: c.z - halfCube - charRadius };
          nx = 0;
          nz = -1;
        }
      } else {
        const d = Math.sqrt(d2);
        nx = dx / d;
        nz = dz / d;
        pos = {
          x: cx + nx * charRadius,
          z: cz + nz * charRadius,
        };
      }
      if (!pushedRef.value) pushedRef.value = { x: nx, z: nz };
      didPush = true;
    });
    if (!didPush) break;
    const n = pushedRef.value;
    if (!obstacleNormal && n) obstacleNormal = n;
    if (iter === 0 && n) {
      // Slide: project the remaining intent onto the contact tangent.
      const rx = args.to.x - from.x;
      const rz = args.to.z - from.z;
      const tx = -n.z;
      const tz = n.x;
      const dot = rx * tx + rz * tz;
      pos = {
        x: pos.x + tx * dot,
        z: pos.z + tz * dot,
      };
      if (pos.x < -limit) pos.x = -limit;
      if (pos.x > limit) pos.x = limit;
      if (pos.z < -limit) pos.z = -limit;
      if (pos.z > limit) pos.z = limit;
    } else {
      // Still overlapping after one slide attempt — give up safely.
      pos = { x: from.x, z: from.z };
    }
  }

  // 3) Char-vs-char. Same push + slide approach. We trust that both peers
  //    run identical resolves on each frame, so non-overlap converges
  //    symmetrically without a server arbiter.
  let charNormal: Vec2 | null = null;
  let charOtherId: string | null = null;
  for (let iter = 0; iter < 2; iter++) {
    let didPush = false;
    let pushedNormal: Vec2 | null = null;
    let pushedOther: string | null = null;
    for (const other of others) {
      const dx = pos.x - other.pos.x;
      const dz = pos.z - other.pos.z;
      const sumR = charRadius + other.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= sumR * sumR) continue;
      let nx: number;
      let nz: number;
      if (d2 < EPS) {
        nx = 1;
        nz = 0;
      } else {
        const d = Math.sqrt(d2);
        nx = dx / d;
        nz = dz / d;
      }
      pos = {
        x: other.pos.x + nx * sumR,
        z: other.pos.z + nz * sumR,
      };
      if (!pushedNormal) {
        pushedNormal = { x: nx, z: nz };
        pushedOther = other.id;
      }
      didPush = true;
    }
    if (!didPush) break;
    if (!charNormal && pushedNormal) {
      charNormal = pushedNormal;
      charOtherId = pushedOther;
    }
    if (iter === 0 && pushedNormal) {
      const rx = args.to.x - from.x;
      const rz = args.to.z - from.z;
      const tx = -pushedNormal.z;
      const tz = pushedNormal.x;
      const dot = rx * tx + rz * tz;
      pos = {
        x: pos.x + tx * dot,
        z: pos.z + tz * dot,
      };
      if (pos.x < -limit) pos.x = -limit;
      if (pos.x > limit) pos.x = limit;
      if (pos.z < -limit) pos.z = -limit;
      if (pos.z > limit) pos.z = limit;
    } else {
      pos = { x: from.x, z: from.z };
    }
  }

  // 4) Detect "blocked" against the original requested target.
  const moved = pos.x !== args.to.x || pos.z !== args.to.z;
  let contact: MoveResolution['contact'];
  let normal: Vec2 | undefined;
  let otherId: string | undefined;
  if (charNormal) {
    contact = 'character';
    normal = charNormal;
    otherId = charOtherId ?? undefined;
  } else if (obstacleNormal) {
    contact = 'obstacle';
    normal = obstacleNormal;
  } else if (boundsHit) {
    contact = 'bounds';
  }

  return {
    pos: { x: pos.x, y: args.to.y, z: pos.z },
    blocked: moved && contact !== undefined,
    contact,
    normal,
    otherId,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
