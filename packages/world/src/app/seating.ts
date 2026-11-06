import type { ObjectInstance, OfficeState, Vec3 } from '@officexr/sdk';
import { AVATAR_YAW_OFFSET, bodyPosition, SIT_POSE_HIP_HEIGHT } from '../physics/rules.ts';
import { deskAreaMembers } from './desk-areas.ts';
import { seatPoseOf, type KindResolver } from './geometry-service.ts';
import type { InstanceGeometryService, WorldAABB } from './types.ts';

/** How far from a seat's pose the player's feet may be to sit on it. */
export const SIT_RADIUS_M = 1.5;
/** Gap between a chair's footprint and the centre of a player who stands up from it. */
export const STEP_OUT_CLEARANCE_M = 0.6;

export type SitRefusal = 'occupied' | 'not-yours' | 'blocked';
export type SitVerdict = { ok: true } | { ok: false; reason: SitRefusal };

export type SeatPose = NonNullable<ReturnType<typeof seatPoseOf>>;
export interface Seat {
  instance: ObjectInstance;
  pose: SeatPose;
}

type Geometry = Pick<InstanceGeometryService, 'worldAABB' | 'worldAABBOfInstance'>;
type SeatingState = Pick<OfficeState, 'selfId' | 'players' | 'deskAreas' | 'deskClaims'>;

export function canSit(
  state: SeatingState,
  catalog: KindResolver,
  geometry: Geometry,
  instance: ObjectInstance,
  selfLogin: string,
): SitVerdict {
  const taken = Object.values(state.players).some((p) => p.id !== state.selfId && p.seat === instance.id);
  if (taken) {
    return { ok: false, reason: 'occupied' };
  }
  const desk = state.deskAreas.find((a) => a.seatInstanceId === instance.id);
  const owner = desk ? state.deskClaims[desk.id] : undefined;
  if (owner !== undefined && owner !== selfLogin) {
    return { ok: false, reason: 'not-yours' };
  }
  const blocked = state.deskAreas.some(
    (a) => a.seatInstanceId !== instance.id && deskAreaMembers(a, [instance], catalog, geometry).seats.length > 0,
  );
  return blocked ? { ok: false, reason: 'blocked' } : { ok: true };
}

/** Every sittable instance among `instances`, with its seat pose. */
export function seatsOf(
  instances: readonly ObjectInstance[],
  catalog: KindResolver,
  geometry: Pick<InstanceGeometryService, 'worldAABB'>,
): Seat[] {
  return instances.flatMap((instance) => {
    const kind = catalog.getKind(instance.kindId);
    const pose = kind ? seatPoseOf(kind, instance, geometry) : null;
    return pose ? [{ instance, pose }] : [];
  });
}

/** The seat whose pose is closest to `feet`, within `radius`, whether or not it may be sat on. */
export function nearestSeat(
  state: Pick<OfficeState, 'worldObjects'>,
  catalog: KindResolver,
  geometry: Pick<InstanceGeometryService, 'worldAABB'>,
  feet: Vec3,
  radius: number,
): Seat | null {
  return closestSeat(seatsOf(state.worldObjects.instances, catalog, geometry), feet, radius);
}

export function closestSeat(seats: readonly Seat[], feet: Vec3, radius: number): Seat | null {
  let best: Seat | null = null;
  let bestDistance = radius;
  for (const seat of seats) {
    const [x, y, z] = seat.pose.position;
    const distance = Math.hypot(x - feet.x, y - feet.y, z - feet.z);
    if (distance <= bestDistance) {
      best = seat;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Feet position for standing up from `pose`: clear of the chair's `footprint`
 * behind it, else to its left, else to its right, taking the first spot
 * `isFree` accepts and falling back to behind.
 */
export function stepOutSpot(pose: SeatPose, footprint: WorldAABB, isFree: (feet: Vec3) => boolean): Vec3 {
  const fx = Math.sin(pose.yawRad);
  const fz = Math.cos(pose.yawRad);
  const [px, , pz] = pose.position;
  const floorY = footprint.min[1];
  const spots = [
    { x: -fx, z: -fz },
    { x: fz, z: -fx },
    { x: -fz, z: fx },
  ].map((dir) => {
    const reach = exitDistance(px, pz, dir, footprint) + STEP_OUT_CLEARANCE_M;
    return { x: px + dir.x * reach, y: floorY, z: pz + dir.z * reach };
  });
  return spots.find(isFree) ?? spots[0];
}

/** Distance along unit `dir` from (`x`, `z`), inside `box`, to the box's edge. */
function exitDistance(x: number, z: number, dir: { x: number; z: number }, box: WorldAABB): number {
  const along = (p: number, d: number, min: number, max: number) =>
    Math.abs(d) < 1e-9 ? Infinity : Math.max(0, ((d > 0 ? max : min) - p) / d);
  return Math.min(along(x, dir.x, box.min[0], box.max[0]), along(z, dir.z, box.min[2], box.max[2]));
}

/** Store position and yaw that put a seated avatar's hips on `pose`, facing its way. */
export function seatedPlayerPose(pose: SeatPose, charRadius: number): { pos: Vec3; yaw: number } {
  const [x, y, z] = pose.position;
  return {
    pos: bodyPosition({ x, y: y - SIT_POSE_HIP_HEIGHT, z }, charRadius),
    yaw: pose.yawRad - AVATAR_YAW_OFFSET,
  };
}
