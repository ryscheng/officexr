import { seatOccupant, type OfficeState } from '@officexr/sdk';
import { deskAreaMembers } from './desk-areas.ts';
import { seatOf } from './seating.ts';
import type { KindResolver } from './geometry-service.ts';
import type { Instances } from './room-bounds.ts';
import type { InstanceGeometryService, Vec3, WorldAABB } from './types.ts';

export const SCREEN_POWER_UP_SEC = 0.3;
export const SCREEN_OFF_DELAY_SEC = 1;
/** How far past the desk's near edge, along the sitter's line of sight, the monitor stands. */
export const MONITOR_INSET_M = 0.3;

export interface DeskScreenPlacement {
  deskAreaId: string;
  seatInstanceId: string;
  deskInstanceId: string;
  /** Centre of the monitor's foot, on the desk top. */
  position: Vec3;
  /** Rotation about Y that turns a +Z-facing monitor towards the chair. */
  yawRad: number;
}

type Geometry = Pick<InstanceGeometryService, 'worldAABB' | 'worldAABBOfInstance'>;

/** Distance along the unit XZ ray from (ox, oz) to where it enters and leaves the box, or null when it misses. */
function rayThroughBox(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  box: WorldAABB,
): [number, number] | null {
  let near = 0;
  let far = Infinity;
  for (const [o, d, lo, hi] of [
    [ox, dx, box.min[0], box.max[0]],
    [oz, dz, box.min[2], box.max[2]],
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const a = (lo - o) / d;
    const b = (hi - o) / d;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
  }
  return near <= far ? [near, far] : null;
}

/**
 * One monitor per desk area that has a chair and exactly one desk. The desk is the one whose
 * footprint centre lies in the area. The monitor stands on the desk top where the sitter's line
 * of sight crosses the desk, a little past the near edge, and faces the chair; a line that misses
 * the desk puts it at the desk's centre.
 */
export function deskScreenPlacements(
  areas: OfficeState['deskAreas'],
  instances: Instances,
  catalog: KindResolver,
  geometry: Geometry,
): DeskScreenPlacement[] {
  const out: DeskScreenPlacement[] = [];
  for (const area of areas) {
    if (area.seatInstanceId === null) continue;
    const { desks } = deskAreaMembers(area, instances, catalog, geometry);
    const deskInstance = desks.length === 1 ? instances.find((i) => i.id === desks[0].id) : undefined;
    const seat = seatOf({ worldObjects: { cubeSize: 0, instances } }, catalog, geometry, area.seatInstanceId);
    if (!deskInstance || !seat) continue;
    const box = geometry.worldAABBOfInstance(deskInstance);
    const fx = Math.sin(seat.pose.yawRad);
    const fz = Math.cos(seat.pose.yawRad);
    const hit = rayThroughBox(seat.pose.position[0], seat.pose.position[2], fx, fz, box);
    const centre = [(box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2] as const;
    const reach = hit ? Math.min(hit[0] + MONITOR_INSET_M, (hit[0] + hit[1]) / 2) : null;
    const x = reach === null ? centre[0] : seat.pose.position[0] + fx * reach;
    const z = reach === null ? centre[1] : seat.pose.position[2] + fz * reach;
    out.push({
      deskAreaId: area.id,
      seatInstanceId: seat.instance.id,
      deskInstanceId: deskInstance.id,
      position: [x, box.max[1], z],
      yawRad: seat.pose.yawRad + Math.PI,
    });
  }
  return out;
}

export interface ScreenPower {
  /** Lit: from the moment someone sits until `SCREEN_OFF_DELAY_SEC` after the chair empties. */
  on: boolean;
  litSec: number;
  emptySec: number;
}

export const SCREEN_OFF: ScreenPower = { on: false, litSec: 0, emptySec: 0 };

export function isScreenSettled(p: ScreenPower, occupied: boolean): boolean {
  return occupied ? p.on && p.litSec >= SCREEN_POWER_UP_SEC : !p.on;
}

/** The next power state after `dtSec`; returns `p` itself once settled. */
export function stepScreenPower(p: ScreenPower, occupied: boolean, dtSec: number): ScreenPower {
  if (isScreenSettled(p, occupied)) return p;
  if (occupied) {
    return { on: true, litSec: p.on ? Math.min(SCREEN_POWER_UP_SEC, p.litSec + dtSec) : 0, emptySec: 0 };
  }
  const emptySec = p.emptySec + dtSec;
  return emptySec >= SCREEN_OFF_DELAY_SEC ? SCREEN_OFF : { on: true, litSec: p.litSec + dtSec, emptySec };
}

const FLICKER_HZ = 40;

/** Emissive strength 0..1: dark when off, a stuttering ramp while powering up, steady once up. */
export function screenGlow(p: ScreenPower): number {
  if (!p.on) return 0;
  if (p.litSec >= SCREEN_POWER_UP_SEC) return 1;
  const ramp = p.litSec / SCREEN_POWER_UP_SEC;
  return Math.floor(p.litSec * FLICKER_HZ) % 3 === 1 ? ramp * 0.3 : ramp;
}

export function isSeatOccupied(state: Pick<OfficeState, 'players'>, seatInstanceId: string): boolean {
  return seatOccupant(state, seatInstanceId) !== null;
}
