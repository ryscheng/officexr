import { seatOccupant, type ObjectInstance, type OfficeState, type Vec3 } from '@officexr/sdk';
import { AVATAR_YAW_OFFSET, bodyPosition, SIT_POSE_HIP_HEIGHT } from '../physics/rules.ts';
import { deskAreaMembers } from './desk-areas.ts';
import { seatPoseOf, type KindResolver } from './geometry-service.ts';
import type { InstanceGeometryService, WorldAABB } from './types.ts';

/** Slack on "the body touches the chair", for the controller's skin and float error. */
export const SEAT_TOUCH_EPSILON_M = 0.05;
/** How far past the chair's surface `approachSpot` aims. */
export const SEAT_APPROACH_OVERREACH_M = 0.1;
/** Gap between a chair's footprint and the centre of a player who stands up from it. */
export const STEP_OUT_CLEARANCE_M = 0.6;

export type SitRefusal = 'occupied' | 'not-yours' | 'blocked';
export type SitVerdict = { ok: true } | { ok: false; reason: SitRefusal };

export type SeatPose = NonNullable<ReturnType<typeof seatPoseOf>>;
export interface Seat {
  instance: ObjectInstance;
  pose: SeatPose;
}

type SitState = Pick<OfficeState, 'selfId' | 'players' | 'deskAreas' | 'deskClaims'>;

export function canSit(
  state: SitState,
  catalog: KindResolver,
  geometry: Pick<InstanceGeometryService, 'worldAABBOfInstance'>,
  instance: ObjectInstance,
  selfLogin: string,
): SitVerdict {
  if (seatOccupant(state, instance.id, state.selfId) !== null) {
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

/** The seat on the instance `id`, or null when there is no such instance or it is not sittable. */
export function seatOf(
  state: Pick<OfficeState, 'worldObjects'>,
  catalog: KindResolver,
  geometry: Pick<InstanceGeometryService, 'worldAABB'>,
  id: string,
): Seat | null {
  const instance = state.worldObjects.instances.find((i) => i.id === id);
  const kind = instance && catalog.getKind(instance.kindId);
  const pose = kind ? seatPoseOf(kind, instance, geometry) : null;
  return pose && instance ? { instance, pose } : null;
}

/**
 * Whether a body ball of `bodyRadius` standing at `feet` touches the instance's
 * yaw-aware footprint, which the character controller stops it against.
 */
export function isTouchingSeat(
  feet: Vec3,
  bodyRadius: number,
  instance: ObjectInstance,
  geometry: Pick<InstanceGeometryService, 'worldAABBOfInstance'>,
): boolean {
  const { min, max } = geometry.worldAABBOfInstance(instance);
  const dx = Math.max(min[0] - feet.x, 0, feet.x - max[0]);
  const dz = Math.max(min[2] - feet.z, 0, feet.z - max[2]);
  const overlapsVertically = feet.y <= max[1] && feet.y + 2 * bodyRadius >= min[1];
  return overlapsVertically && Math.hypot(dx, dz) <= bodyRadius + SEAT_TOUCH_EPSILON_M;
}

/** Of the seats the body at `feet` touches, the one whose seat pose is closest, whether or not it may be sat on. */
export function nearestSeat(
  state: Pick<OfficeState, 'worldObjects'>,
  catalog: KindResolver,
  geometry: Pick<InstanceGeometryService, 'worldAABB' | 'worldAABBOfInstance'>,
  feet: Vec3,
  bodyRadius: number,
): Seat | null {
  let best: Seat | null = null;
  let bestDistance = Infinity;
  for (const instance of state.worldObjects.instances) {
    const kind = catalog.getKind(instance.kindId);
    if (!kind?.seat || !isTouchingSeat(feet, bodyRadius, instance, geometry)) {
      continue;
    }
    const pose = seatPoseOf(kind, instance, geometry);
    if (!pose) {
      continue;
    }
    const [x, y, z] = pose.position;
    const distance = Math.hypot(x - feet.x, y - feet.y, z - feet.z);
    if (distance < bestDistance) {
      best = { instance, pose };
      bestDistance = distance;
    }
  }
  return best;
}

/** Spots `gap` beyond the footprint edge behind the seat, to its left and to its right, in that order. */
function sideSpots(pose: SeatPose, footprint: WorldAABB, gap: number): Vec3[] {
  const fx = Math.sin(pose.yawRad);
  const fz = Math.cos(pose.yawRad);
  const [px, , pz] = pose.position;
  return [
    { x: -fx, z: -fz },
    { x: fz, z: -fx },
    { x: -fz, z: fx },
  ].map((dir) => {
    const reach = exitDistance(px, pz, dir, footprint) + gap;
    return { x: px + dir.x * reach, y: footprint.min[1], z: pz + dir.z * reach };
  });
}

/**
 * Feet position for standing up from `pose`: clear of the chair's `footprint`
 * behind it, else to its left, else to its right, taking the first spot
 * `isFree` accepts and falling back to behind.
 */
export function stepOutSpot(pose: SeatPose, footprint: WorldAABB, isFree: (feet: Vec3) => boolean): Vec3 {
  const spots = sideSpots(pose, footprint, STEP_OUT_CLEARANCE_M);
  return spots.find(isFree) ?? spots[0];
}

/**
 * A point to walk at to sit: on the side `stepOutSpot` would pick, aimed
 * `SEAT_APPROACH_OVERREACH_M` into where the chair stops the body, so the
 * walk ends against the chair. Null when no side has room.
 */
export function approachSpot(
  pose: SeatPose,
  footprint: WorldAABB,
  bodyRadius: number,
  isFree: (feet: Vec3) => boolean,
): Vec3 | null {
  const side = sideSpots(pose, footprint, STEP_OUT_CLEARANCE_M).findIndex(isFree);
  return side < 0 ? null : sideSpots(pose, footprint, bodyRadius - SEAT_APPROACH_OVERREACH_M)[side];
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
