import { parseSeatId, type OfficeState } from '@officexr/sdk';
import { deskAreaMembers } from './desk-areas.ts';
import type { KindResolver } from './geometry-service.ts';
import type { Instances } from './room-bounds.ts';
import type { InstanceGeometryService, WorldAABB } from './types.ts';

export const SCREEN_POWER_UP_SEC = 0.3;
export const SCREEN_OFF_DELAY_SEC = 1;
export const SCREEN_TOP_TOLERANCE_M = 0.1;

const SCREEN_WORDS = new Set(['monitor', 'monitors', 'screen', 'display', 'computer', 'laptop', 'pc', 'tv', 'television']);

function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
}

// Matched on the kind's id, label and model file name, so a kind needs no flag to be picked up.
export function isScreenKind(kind: { id: string; label?: string; gltfPath?: string } | undefined): boolean {
  if (!kind) return false;
  const file = kind.gltfPath?.split('?')[0].split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
  return [kind.id, kind.label ?? '', file].some((text) => words(text).some((w) => SCREEN_WORDS.has(w)));
}

export interface GroundPoint {
  x: number;
  z: number;
}

export interface DeskScreenLink {
  deskAreaId: string;
  seatId: string;
  monitorInstanceId: string;
  monitor: GroundPoint;
  chair: GroundPoint;
}

type Geometry = Pick<InstanceGeometryService, 'worldAABBOfInstance'>;

function centre(box: WorldAABB): GroundPoint {
  return { x: (box.min[0] + box.max[0]) / 2, z: (box.min[2] + box.max[2]) / 2 };
}

function within(box: WorldAABB, x: number, z: number): boolean {
  return x >= box.min[0] && x <= box.max[0] && z >= box.min[2] && z <= box.max[2];
}

// A screen belongs to a desk area when it stands on the area's single desk: its centre is inside the desk
// footprint and its underside is at desk-top height. An area without a chair, or without exactly one desk, has none.
export function deskScreenLinks(
  areas: OfficeState['deskAreas'],
  instances: Instances,
  catalog: KindResolver,
  geometry: Geometry,
): DeskScreenLink[] {
  const screens = instances.filter((i) => isScreenKind(catalog.getKind(i.kindId)));
  if (screens.length === 0) return [];
  const out: DeskScreenLink[] = [];
  for (const area of areas) {
    if (area.seatInstanceId === null) continue;
    const { desks } = deskAreaMembers(area, instances, catalog, geometry);
    const deskInstance = desks.length === 1 ? instances.find((i) => i.id === desks[0].id) : undefined;
    const chairInstance = instances.find((i) => i.id === parseSeatId(area.seatInstanceId as string).instanceId);
    if (!deskInstance || !chairInstance) continue;
    const desk = geometry.worldAABBOfInstance(deskInstance);
    const chair = centre(geometry.worldAABBOfInstance(chairInstance));
    for (const screen of screens) {
      if (screen.id === deskInstance.id) continue;
      const box = geometry.worldAABBOfInstance(screen);
      const at = centre(box);
      const inArea = at.x >= area.min.x && at.x <= area.max.x && at.z >= area.min.z && at.z <= area.max.z;
      if (inArea && within(desk, at.x, at.z) && Math.abs(box.min[1] - desk.max[1]) <= SCREEN_TOP_TOLERANCE_M) {
        out.push({ deskAreaId: area.id, seatId: area.seatInstanceId, monitorInstanceId: screen.id, monitor: at, chair });
      }
    }
  }
  return out;
}

export interface ScreenPower {
  on: boolean;
  litSec: number;
  emptySec: number;
}

export const SCREEN_OFF: ScreenPower = { on: false, litSec: 0, emptySec: 0 };

export function isScreenSettled(p: ScreenPower, occupied: boolean): boolean {
  return occupied ? p.on && p.emptySec === 0 && p.litSec >= SCREEN_POWER_UP_SEC : !p.on;
}

export function stepScreenPower(p: ScreenPower, occupied: boolean, dtSec: number): ScreenPower {
  if (isScreenSettled(p, occupied)) return p;
  if (occupied) {
    return { on: true, litSec: p.on ? Math.min(SCREEN_POWER_UP_SEC, p.litSec + dtSec) : 0, emptySec: 0 };
  }
  const emptySec = p.emptySec + dtSec;
  return emptySec >= SCREEN_OFF_DELAY_SEC ? SCREEN_OFF : { on: true, litSec: p.litSec + dtSec, emptySec };
}

const FLICKER_HZ = 40;

export function screenGlow(p: ScreenPower): number {
  if (!p.on) return 0;
  if (p.litSec >= SCREEN_POWER_UP_SEC) return 1;
  const ramp = p.litSec / SCREEN_POWER_UP_SEC;
  return Math.floor(p.litSec * FLICKER_HZ) % 3 === 1 ? ramp * 0.3 : ramp;
}

// Any seat of the chair's instance counts, since a player on seat n of a multi-seat chair holds `instanceId#n`.
export function isChairOccupied(state: Pick<OfficeState, 'players'>, seatId: string): boolean {
  const { instanceId } = parseSeatId(seatId);
  return Object.values(state.players).some((p) => p.seat != null && parseSeatId(p.seat).instanceId === instanceId);
}
