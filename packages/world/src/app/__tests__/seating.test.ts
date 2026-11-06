import { describe, expect, it } from 'vitest';
import { createInitialOfficeState, type DeskAreaState, type ObjectInstance, type OfficeState, type Vec3 } from '@officexr/sdk';
import type { WorldObjectKind } from '../../scenes/index.ts';
import { createInstanceGeometry } from '../geometry-service.ts';
import { canSit, nearestSeat, seatedPlayerPose, stepOutSpot, STEP_OUT_CLEARANCE_M, type SeatPose } from '../seating.ts';
import { AVATAR_YAW_OFFSET, BODY_Y, SIT_POSE_HIP_HEIGHT } from '../../physics/rules.ts';

// One-metre kinds on a one-metre grid, so voxel positions are metres.
const kinds: Record<string, Partial<WorldObjectKind>> = {
  chair: { id: 'chair', dimensions: { width: 1, height: 1, depth: 1 }, seat: { offset: { x: 0.5, y: 0.5, z: 0.5 }, yawDeg: 0 } },
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

describe('nearestSeat', () => {
  const instances = [chair('a', 0, 0), chair('b', 3, 0), { ...chair('t', 1, 0), kindId: 'desk' }];
  const s = state({ worldObjects: { cubeSize: 1, instances } });

  it('picks the closest seat pose within the radius', () => {
    expect(nearestSeat(s, catalog, geometry, { x: 2.6, y: 0, z: 0.5 }, 1.5)?.instance.id).toBe('b');
    expect(nearestSeat(s, catalog, geometry, { x: 2.6, y: 0, z: 0.5 }, 1.5)?.pose.position).toEqual([3.5, 0.5, 0.5]);
  });

  it('finds nothing out of reach', () => {
    expect(nearestSeat(s, catalog, geometry, { x: 10, y: 0, z: 10 }, 1.5)).toBeNull();
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
    // Facing +X: behind is -X.
    near(stepOutSpot({ ...pose, yawRad: Math.PI / 2 }, footprint, () => true), { x: 0.5 - reach, y: 0, z: 0.5 });
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
