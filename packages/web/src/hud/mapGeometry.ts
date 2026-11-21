import type { Area } from './missions/missionRows';
import type { MapBox } from './mapPoint';
import type { PlanRect } from './minimapPlan';

type Point = { x: number; z: number };

const PAD_M = 3;
const EMPTY_BOX: MapBox = { x: 0, z: 0, w: 40, h: 40 };

/** The plan frames the map only when no room does, so a big ground slab never shrinks the rooms. */
export function mapBounds(areas: readonly Area[], plan: readonly PlanRect[], points: readonly Point[]): MapBox {
  const framing = areas.length > 0 ? [] : plan;
  const xs: number[] = [];
  const zs: number[] = [];
  for (const a of areas) {
    xs.push(a.min.x, a.max.x);
    zs.push(a.min.z, a.max.z);
  }
  for (const r of framing) {
    xs.push(r.x, r.x + r.w);
    zs.push(r.z, r.z + r.d);
  }
  for (const p of points) {
    xs.push(p.x);
    zs.push(p.z);
  }
  if (xs.length === 0) {
    return EMPTY_BOX;
  }
  const x = Math.min(...xs) - PAD_M;
  const z = Math.min(...zs) - PAD_M;
  return { x, z, w: Math.max(...xs) + PAD_M - x, h: Math.max(...zs) + PAD_M - z };
}

/** The map has x right and z down, so an avatar facing -z at yaw 0 points up and a positive yaw turns it counter-clockwise. */
export const headingDegrees = (yaw: number) => (-yaw * 180) / Math.PI;

export type PlanShape = { round: boolean; radius: number };

const PROP_ROUND_MAX_M = 1.2;
const PROP_ROUND_SKEW_M = 0.25;
const CORNER_MAX_M = 0.25;

export function planShape(r: PlanRect): PlanShape {
  if (r.tone === 'wall' || r.tone === 'floor') {
    return { round: false, radius: 0 };
  }
  const small = Math.max(r.w, r.d) <= PROP_ROUND_MAX_M && Math.abs(r.w - r.d) <= PROP_ROUND_SKEW_M;
  if (small && r.tone !== 'desk') {
    return { round: true, radius: Math.min(r.w, r.d) / 2 };
  }
  return { round: false, radius: Math.min(CORNER_MAX_M, Math.min(r.w, r.d) * 0.25) };
}

export type RoomLabel = { id: string; text: string; x: number; z: number };

const CHAR_EM = 0.6;
const LABEL_PAD_PX = 6;
const OBSTACLE_PX = 22;
const OVERHANG = 2.4;

type Rect = { x0: number; x1: number; z0: number; z1: number };

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;

const touchesPoint = (r: Rect, p: Point, radius: number) => {
  const dx = Math.max(r.x0 - p.x, 0, p.x - r.x1);
  const dz = Math.max(r.z0 - p.z, 0, p.z - r.z1);
  return dx * dx + dz * dz < radius * radius;
};

const fit = (label: string, roomWidthPx: number, fontPx: number) => {
  const max = Math.max(3, Math.floor((roomWidthPx * OVERHANG) / (fontPx * CHAR_EM)));
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
};

export function placeRoomLabels(rooms: readonly Area[], people: readonly Point[], metresPerPx: number, fontPx: number): RoomLabel[] {
  const placed: Rect[] = [];
  return rooms.map((room) => {
    const text = fit(room.label, (room.max.x - room.min.x) / metresPerPx, fontPx);
    const halfW = (text.length * fontPx * CHAR_EM * metresPerPx) / 2 + LABEL_PAD_PX * metresPerPx;
    const halfH = (fontPx * 0.8 + LABEL_PAD_PX / 2) * metresPerPx;
    const cx = (room.min.x + room.max.x) / 2;
    const cz = (room.min.z + room.max.z) / 2;
    const edge = (LABEL_PAD_PX + fontPx) * metresPerPx;
    const candidates = [
      { x: cx, z: room.min.z + edge },
      { x: cx, z: room.max.z - edge },
      { x: cx, z: cz },
      { x: room.min.x + halfW, z: room.min.z + edge },
      { x: room.max.x - halfW, z: room.min.z + edge },
      { x: room.min.x + halfW, z: room.max.z - edge },
      { x: room.max.x - halfW, z: room.max.z - edge },
    ];
    const rectOf = (c: Point): Rect => ({ x0: c.x - halfW, x1: c.x + halfW, z0: c.z - halfH, z1: c.z + halfH });
    const free = candidates.find((c) => {
      const r = rectOf(c);
      return !placed.some((o) => overlaps(o, r)) && !people.some((p) => touchesPoint(r, p, OBSTACLE_PX * metresPerPx));
    });
    const at = free ?? candidates[0];
    placed.push(rectOf(at));
    return { id: room.id, text, x: at.x, z: at.z };
  });
}

const NAME_CLEAR_X_PX = 72;
const NAME_CLEAR_Z_PX = 32;

export function namedPeople(people: readonly (Point & { id: string })[], metresPerPx: number): Set<string> {
  const shown: (Point & { id: string })[] = [];
  for (const p of people) {
    const clash = shown.some((q) => Math.abs(p.x - q.x) < NAME_CLEAR_X_PX * metresPerPx && Math.abs(p.z - q.z) < NAME_CLEAR_Z_PX * metresPerPx);
    if (!clash) {
      shown.push(p);
    }
  }
  return new Set(shown.map((p) => p.id));
}

const GROUND_COVERAGE = 0.5;
const GROUND_MIN_BLOCKS = 16;

/** A layout of wall-height blocks that tiles most of its area is the ground, not walls: draw it as floor. */
export function readPlan(plan: readonly PlanRect[]): readonly PlanRect[] {
  const walls = plan.filter((r) => r.tone === 'wall');
  if (walls.length < GROUND_MIN_BLOCKS) {
    return plan;
  }
  const x0 = Math.min(...walls.map((r) => r.x));
  const x1 = Math.max(...walls.map((r) => r.x + r.w));
  const z0 = Math.min(...walls.map((r) => r.z));
  const z1 = Math.max(...walls.map((r) => r.z + r.d));
  const covered = walls.reduce((sum, r) => sum + r.w * r.d, 0);
  if (covered / ((x1 - x0) * (z1 - z0)) < GROUND_COVERAGE) {
    return plan;
  }
  return plan.map((r) => (r.tone === 'wall' ? { ...r, tone: 'floor' as const } : r));
}

const FULL_SIZE_PX_PER_M = 10;
const MIN_MARKER_SIZE = 0.62;

export const markerSize = (pxPerM: number) => Math.min(1, Math.max(MIN_MARKER_SIZE, pxPerM / FULL_SIZE_PX_PER_M));
