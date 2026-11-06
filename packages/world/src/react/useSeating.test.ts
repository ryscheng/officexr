import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ObjectInstance } from '@officexr/sdk';
import { createMultiClientHarness, type ClientHandle } from '@officexr/sdk/test-harness';
import { createInstanceGeometry } from '../app/geometry-service.ts';
import { seatedPlayerPose } from '../app/seating.ts';
import type { WorldObjectKind } from '../scenes/index.ts';
import { createAutoWalk } from './useAutoWalk.ts';
import { createSeating } from './useSeating.ts';

const kinds: Record<string, Partial<WorldObjectKind>> = {
  chair: { id: 'chair', dimensions: { width: 1, height: 1, depth: 1 }, seat: { offset: { x: 0.5, y: 0.5, z: 0.5 }, yawDeg: 0 } },
};
const catalog = { getKind: (id: string) => kinds[id] as WorldObjectKind | undefined };
const geometry = createInstanceGeometry({ catalog, voxelSize: 1 });
const chair = (id: string, x: number, z: number): ObjectInstance => ({
  id,
  sourceCommandId: id,
  kindId: 'chair',
  position: [x, 0, z],
});
const instances = [chair('near', 0, 0), chair('desk-chair', 10, 0)];

afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const h = createMultiClientHarness();
  const a = await h.add('alice');
  const b = await h.add('bob');
  for (const c of [a, b]) {
    c.actions.setWorldObjects({ cubeSize: 1, instances });
    c.actions.setDeskAreas([{ id: 'd', label: 'Desk', min: { x: 9, z: -1 }, max: { x: 12, z: 2 }, seatInstanceId: 'desk-chair' }]);
  }
  a.actions.setSelfPosition({ x: 0.5, y: -0.5, z: -0.6 }, { x: 0, y: 0, z: 0 }, 0, false);
  const autoWalk = createAutoWalk(a.store, 'alice', { now: () => 0 });
  const seating = createSeating({ store: a.store, actions: a.actions, selfId: 'alice', catalog, geometry, autoWalk });
  const stop = seating.start();
  return { a, b, autoWalk, seating, stop };
}

const self = (c: ClientHandle) => c.store.getState().players[c.id]!;

describe('createSeating', () => {
  it('sits on the nearest seat at its pose and stands back up, and a second client sees both', async () => {
    const { a, b, seating } = await setup();
    expect(seating.getState().nearbySeatId).toBe('near');

    seating.sit();
    expect(self(a).seat).toBe('near');
    expect(self(a).pos).toEqual(seatedPlayerPose({ position: [0.5, 0.5, 0.5], yawRad: 0 }, 0.4).pos);
    expect(self(a).vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(b.store.getState().players.alice?.seat).toBe('near');

    seating.stand();
    expect(self(a).seat).toBeNull();
    expect(b.store.getState().players.alice?.seat).toBeNull();
    // Behind the chair, clear of it, feet on the floor.
    expect(self(a).pos.z).toBeLessThan(-0.4);
    expect(self(a).pos.y + 0.5).toBeCloseTo(0);
  });

  it('uses the standing check to pick a spot', async () => {
    const { a, seating } = await setup();
    seating.sit();
    const off = seating.setStandingCheck((feet) => feet.z > 0);
    seating.stand();
    expect(self(a).pos.x).toBeGreaterThan(1);
    off();
  });

  it('shows the refusal for a while and leaves the player standing', async () => {
    vi.useFakeTimers();
    const { a, b, seating } = await setup();
    b.actions.setSelfSeat('near');
    expect(a.store.getState().players.bob?.seat).toBe('near');
    expect(seating.getState().nearbySeatId).toBeNull();

    seating.sit();
    expect(self(a).seat).toBeUndefined();
    expect(seating.getState().refusal).toBe('occupied');
    vi.advanceTimersByTime(2500);
    expect(seating.getState().refusal).toBeNull();
  });

  it('clears the seat when the player is teleported', async () => {
    const { a, seating } = await setup();
    seating.sit();
    a.actions.setSelfPosition({ x: 5, y: 0, z: 5 }, { x: 0, y: 0, z: 0 }, 0, false);
    expect(self(a).seat).toBeNull();
  });

  it("walks the desk owner to their chair and seats them on arrival; moving cancels it", async () => {
    const { a, autoWalk, seating } = await setup();
    expect(seating.getState().hasDesk).toBe(false);
    seating.returnToDesk();
    expect(autoWalk.getState()).toEqual({ type: 'idle' });

    a.actions.setDeskClaims({ d: 'alice' });
    expect(seating.getState().hasDesk).toBe(true);
    seating.returnToDesk();
    expect(autoWalk.getState()).toMatchObject({ type: 'walking', targetId: 'desk-chair' });
    expect(autoWalk.intent(self(a).pos)?.x).toBeGreaterThan(0);

    autoWalk.cancel();
    a.actions.setSelfPosition({ x: 10.5, y: -0.5, z: -1 }, { x: 0, y: 0, z: 0 }, 0, false);
    expect(autoWalk.intent(self(a).pos)).toBeNull();
    expect(self(a).seat).toBeUndefined();

    seating.returnToDesk();
    expect(autoWalk.intent(self(a).pos)).toBeNull();
    expect(self(a).seat).toBe('desk-chair');
    expect(autoWalk.getState()).toEqual({ type: 'idle' });
  });
});
