import { describe, expect, it } from 'vitest';
import { createInitialOfficeState, type DeskAreaState, type ObjectInstance, type OfficeState, type Vec3 } from '@officexr/sdk';
import type { WorldObjectKind } from '../../scenes/index.ts';
import { createInstanceGeometry } from '../geometry-service.ts';
import {
  approachSpot,
  canSit,
  isTouchingSeat,
  nearestSeat,
  SEAT_APPROACH_ARRIVE_M,
  SEAT_TOUCH_EPSILON_M,
  seatedPlayerPose,
  stepOutSpot,
  STEP_OUT_CLEARANCE_M,
  type SeatPose,
} from '../seating.ts';
import { AVATAR_YAW_OFFSET, BODY_Y, SIT_POSE_HIP_HEIGHT } from '../../physics/rules.ts';

// One-metre kinds on a one-metre grid, so voxel positions are metres.
const kinds: Record<string, Partial<WorldObjectKind>> = {
  chair: { id: 'chair', dimensions: { width: 1, height: 1, depth: 1 }, seat: { offset: { x: 0.5, y: 0.5, z: 0.5 }, yawDeg: 0 } },
  bench: { id: 'bench', dimensions: { width: 2, height: 1, depth: 1 }, seat: { offset: { x: 1, y: 0.5, z: 0.5 }, yawDeg: 0 } },
  desk: { id: 'desk', dimensions: { width: 1, height: 1, depth: 1 }, isDesk: true },
};
const catalog = { getKind: (id: string) => kinds[id] as WorldObjectKind | undefined };
const geometry = createInstanceGeometry({ catalog, voxelSize: 1 });

const chair = (id: string, x: number, z: number, yawDeg?: number): ObjectInstance => ({
  id,
  sourceCommandId: id,
  kindId: 'chair',
  position: [x, 0, z],
  yawDeg,
});
const area = (id: string, seatInstanceId: string | null): DeskAreaState => ({
  id,
  label: id,
  min: { x: 0, z: 0 },
  max: { x: 4, z: 4 },
  seatInstanceId,
});

function state(patch: Partial<OfficeState> = {}): OfficeState {
  return { ...createInitialOfficeState({ selfId: 'me#1', officeId: 'o' }), ...patch };
}
const seatedPlayer = (id: string, seat: string) =>
  ({ id, seat }) as unknown as OfficeState['players'][string];

describe('canSit', () => {
  const inside = chair('c', 1, 1);
  const outside = chair('far', 10, 10);

  it('allows a chair outside every desk area, and an unclaimed desk chair', () => {
    expect(canSit(state(), catalog, geometry, outside, 'me')).toEqual({ ok: true });
    expect(canSit(state({ deskAreas: [area('d', 'c')] }), catalog, geometry, inside, 'me')).toEqual({ ok: true });
  });

  it('allows the own desk chair', () => {
    const s = state({ deskAreas: [area('d', 'c')], deskClaims: { d: 'me' } });
    expect(canSit(s, catalog, geometry, inside, 'me')).toEqual({ ok: true });
  });

  it("refuses another user's desk chair", () => {
    const s = state({ deskAreas: [area('d', 'c')], deskClaims: { d: 'bob' } });
    expect(canSit(s, catalog, geometry, inside, 'me')).toEqual({ ok: false, reason: 'not-yours' });
  });

  it("refuses a chair someone else sits on, but not one the player's own seat", () => {
    const s = state({ players: { 'bob#1': seatedPlayer('bob#1', 'far') } });
    expect(canSit(s, catalog, geometry, outside, 'me')).toEqual({ ok: false, reason: 'occupied' });
    const own = state({ players: { 'me#1': seatedPlayer('me#1', 'far') } });
    expect(canSit(own, catalog, geometry, outside, 'me')).toEqual({ ok: true });
  });

  it('refuses a chair inside a violating area or inside an area whose seat is another chair', () => {
    expect(canSit(state({ deskAreas: [area('d', null)] }), catalog, geometry, inside, 'me')).toEqual({
      ok: false,
      reason: 'blocked',
    });
    expect(canSit(state({ deskAreas: [area('d', 'other')] }), catalog, geometry, inside, 'me')).toEqual({
      ok: false,
      reason: 'blocked',
    });
  });
});

describe('isTouchingSeat', () => {
  // The chair's footprint is x 0..1, z 0..1.
  const c = chair('c', 0, 0);
  const touching = (x: number, z: number, y = 0) => isTouchingSeat({ x, y, z }, 0.4, c, geometry);

  it('counts a body against a side as touching, and one a hair further away as not', () => {
    expect(touching(0.5, -0.4)).toBe(true);
    expect(touching(1.4 + SEAT_TOUCH_EPSILON_M, 0.5)).toBe(true);
    expect(touching(0.5, -0.4 - SEAT_TOUCH_EPSILON_M - 0.01)).toBe(false);
  });

  it('measures to a corner diagonally', () => {
    const d = (0.4 + SEAT_TOUCH_EPSILON_M) / Math.SQRT2;
    expect(touching(1 + d - 0.01, 1 + d - 0.01)).toBe(true);
    expect(touching(1 + d + 0.01, 1 + d + 0.01)).toBe(false);
  });

  it('uses the rotated footprint', () => {
    // A 2 x 1 bench at yaw 90 covers x 0.5..1.5, z -0.5..1.5.
    const bench: ObjectInstance = { ...chair('b', 0, 0), kindId: 'bench', yawDeg: 90 };
    expect(isTouchingSeat({ x: 1, y: 0, z: -0.85 }, 0.4, bench, geometry)).toBe(true);
    expect(isTouchingSeat({ x: 1, y: 0, z: -0.97 }, 0.4, bench, geometry)).toBe(false);
    expect(isTouchingSeat({ x: 0.1, y: 0, z: 1 }, 0.4, bench, geometry)).toBe(true);
  });

  it('needs the body level with the chair', () => {
    expect(touching(0.5, -0.4, 2)).toBe(false);
    expect(touching(0.5, -0.4, -1)).toBe(false);
  });
});

describe('nearestSeat', () => {
  const instances = [chair('a', 0, 0), chair('b', 1.8, 0), { ...chair('t', 3, 0), kindId: 'desk' }];
  const s = state({ worldObjects: { cubeSize: 1, instances } });

  it('picks the touched seat whose pose is closest', () => {
    // Touches both chairs' facing sides; b's seat pose is nearer.
    expect(nearestSeat(s, catalog, geometry, { x: 1.45, y: 0, z: 0.5 }, 0.4)?.instance.id).toBe('b');
    expect(nearestSeat(s, catalog, geometry, { x: 1.45, y: 0, z: 0.5 }, 0.4)?.pose.position).toEqual([2.3, 0.5, 0.5]);
  });

  it('finds nothing without touching a chair', () => {
    expect(nearestSeat(s, catalog, geometry, { x: 0.5, y: 0, z: -1 }, 0.4)).toBeNull();
  });
});

describe('stepOutSpot', () => {
  // Facing +Z: behind is -Z, the avatar's left is +X.
  const pose: SeatPose = { position: [0.5, 0.5, 0.5], yawRad: 0 };
  const footprint = geometry.worldAABBOfInstance(chair('c', 0, 0));
  const reach = 0.5 + STEP_OUT_CLEARANCE_M;
  const behind = { x: 0.5, y: 0, z: 0.5 - reach };
  const left = { x: 0.5 + reach, y: 0, z: 0.5 };
  const right = { x: 0.5 - reach, y: 0, z: 0.5 };
  const freeExcept = (...blocked: Vec3[]) => (p: Vec3) => !blocked.some((b) => Math.hypot(b.x - p.x, b.z - p.z) < 1e-6);
  const rounded = (p: Vec3) => [p.x, p.y, p.z].map((v) => Math.round(v * 1e6) / 1e6 + 0);
  const near = (a: Vec3, b: Vec3) => expect(rounded(a)).toEqual(rounded(b));

  it('steps out behind the chair, clear of its footprint, at floor height', () => {
    near(stepOutSpot(pose, footprint, () => true), behind);
  });

  it('tries left, then right, when behind is blocked', () => {
    near(stepOutSpot(pose, footprint, freeExcept(behind)), left);
    near(stepOutSpot(pose, footprint, freeExcept(behind, left)), right);
  });

  it('falls back to behind when nothing is free', () => {
    near(stepOutSpot(pose, footprint, () => false), behind);
  });

  it('follows the seat facing', () => {
    // Facing +X: behind is -X, left is -Z.
    const east = { ...pose, yawRad: Math.PI / 2 };
    near(stepOutSpot(east, footprint, () => true), { x: 0.5 - reach, y: 0, z: 0.5 });
    near(stepOutSpot(east, footprint, freeExcept({ x: 0.5 - reach, y: 0, z: 0.5 })), { x: 0.5, y: 0, z: 0.5 - reach });
    // Facing -Z: behind is +Z.
    near(stepOutSpot({ ...pose, yawRad: Math.PI }, footprint, () => true), { x: 0.5, y: 0, z: 0.5 + reach });
    // Facing -X: behind is +X.
    near(stepOutSpot({ ...pose, yawRad: (3 * Math.PI) / 2 }, footprint, () => true), { x: 0.5 + reach, y: 0, z: 0.5 });
  });
});

describe('approachSpot', () => {
  const pose: SeatPose = { position: [0.5, 0.5, 0.5], yawRad: 0 };
  const c = chair('c', 0, 0);
  const footprint = geometry.worldAABBOfInstance(c);

  it('aims into the chair on the step-out side, so arriving there touches it', () => {
    const target = approachSpot(pose, footprint, 0.4, () => true);
    expect(target.x).toBeCloseTo(0.5);
    expect(target.z).toBeGreaterThan(-0.4);
    expect(target.z).toBeLessThan(0);
    expect(isTouchingSeat({ ...target, z: target.z - SEAT_APPROACH_ARRIVE_M }, 0.4, c, geometry)).toBe(true);
  });

  it('takes the side whose step-out spot is free', () => {
    const behindBlocked = (p: Vec3) => p.z > -0.5;
    expect(approachSpot(pose, footprint, 0.4, behindBlocked).x).toBeGreaterThan(1);
  });
});

describe('seatedPlayerPose', () => {
  it('puts the hips on the seat and faces the avatar the seat way', () => {
    const { pos, yaw } = seatedPlayerPose({ position: [1, 0.5, 2], yawRad: 0.3 }, 0.4);
    expect(pos.x).toBe(1);
    expect(pos.z).toBe(2);
    expect(pos.y + BODY_Y - 0.4 + SIT_POSE_HIP_HEIGHT).toBeCloseTo(0.5);
    expect(yaw + AVATAR_YAW_OFFSET).toBeCloseTo(0.3);
  });
});
