import { SIDEWALK, type Block, type CityLayout, type Rect } from './generate.ts';
import type { Rng } from './rng.ts';

export type PedMode = 'walk' | 'idle' | 'dodge';

export interface Pedestrian {
  id: number;
  block: number;
  s: number;
  dir: 1 | -1;
  speed: number;
  mode: PedMode;
  modeTimer: number;
  lateral: number;
  x: number;
  z: number;
  yaw: number;
  color: string;
}

export interface PedContext {
  rng: Rng;
  threatNear(x: number, z: number): boolean;
}

type Behaviour = (ped: Pedestrian, ctx: PedContext, dt: number) => void;

export const PED_RING_INSET = 2.1;
const DODGE_LATERAL = SIDEWALK - PED_RING_INSET - 0.2;
const PED_COLOURS = ['#ff8f70', '#ffd166', '#06d6a0', '#4cc9f0', '#f72585', '#b8c0ff', '#f4f1de', '#ffb703'];

export const ringPerimeter = (rect: Rect) =>
  2 * (rect.maxX - rect.minX - 2 * PED_RING_INSET + (rect.maxZ - rect.minZ - 2 * PED_RING_INSET));

export function ringPoint(rect: Rect, s: number, lateral = 0): { x: number; z: number; hx: number; hz: number } {
  const inset = PED_RING_INSET + lateral;
  const minX = rect.minX + inset;
  const maxX = rect.maxX - inset;
  const minZ = rect.minZ + inset;
  const maxZ = rect.maxZ - inset;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const total = 2 * (w + d);
  let t = ((s % total) + total) % total;
  if (t < w) return { x: minX + t, z: minZ, hx: 1, hz: 0 };
  t -= w;
  if (t < d) return { x: maxX, z: minZ + t, hx: 0, hz: 1 };
  t -= d;
  if (t < w) return { x: maxX - t, z: maxZ, hx: -1, hz: 0 };
  t -= w;
  return { x: minX, z: maxZ - t, hx: 0, hz: -1 };
}

export const PED_BEHAVIOURS: Record<PedMode, Behaviour> = {
  walk: (ped, ctx, dt) => {
    ped.s += ped.dir * ped.speed * dt;
    ped.lateral += (0 - ped.lateral) * Math.min(1, 3 * dt);
    if (ctx.threatNear(ped.x, ped.z)) {
      ped.mode = 'dodge';
      ped.modeTimer = 1.6;
    } else if (ctx.rng.chance(0.12 * dt)) {
      ped.mode = 'idle';
      ped.modeTimer = ctx.rng.range(2, 7);
    } else if (ctx.rng.chance(0.02 * dt)) {
      ped.dir = ped.dir === 1 ? -1 : 1;
    }
  },
  idle: (ped, ctx, dt) => {
    ped.modeTimer -= dt;
    if (ctx.threatNear(ped.x, ped.z)) {
      ped.mode = 'dodge';
      ped.modeTimer = 1.6;
    } else if (ped.modeTimer <= 0) {
      ped.mode = 'walk';
    }
  },
  dodge: (ped, _ctx, dt) => {
    ped.modeTimer -= dt;
    ped.lateral += (DODGE_LATERAL - ped.lateral) * Math.min(1, 4 * dt);
    ped.s += ped.dir * ped.speed * 1.8 * dt;
    if (ped.modeTimer <= 0) ped.mode = 'walk';
  },
};

export function createPedestrians(city: CityLayout, rng: Rng, count: number): Pedestrian[] {
  const eligible = city.blocks.map((block, index) => ({ block, index }));
  return Array.from({ length: count }, (_, id) => {
    const { block, index } = rng.pick(eligible) as { block: Block; index: number };
    const ped: Pedestrian = {
      id,
      block: index,
      s: rng.range(0, ringPerimeter(block.rect)),
      dir: rng.chance(0.5) ? 1 : -1,
      speed: rng.range(1.1, 1.7),
      mode: 'walk',
      modeTimer: 0,
      lateral: 0,
      x: 0,
      z: 0,
      yaw: 0,
      color: rng.pick(PED_COLOURS),
    };
    placePedestrian(city, ped);
    return ped;
  });
}

export function placePedestrian(city: CityLayout, ped: Pedestrian) {
  const p = ringPoint(city.blocks[ped.block]!.rect, ped.s, ped.lateral);
  ped.x = p.x;
  ped.z = p.z;
  ped.yaw = Math.atan2(p.hx * ped.dir, p.hz * ped.dir);
}

export function stepPedestrian(city: CityLayout, ped: Pedestrian, ctx: PedContext, dt: number) {
  PED_BEHAVIOURS[ped.mode](ped, ctx, dt);
  placePedestrian(city, ped);
}
