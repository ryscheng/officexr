import { describe, expect, it, vi } from 'vitest';
import { AUTO_WALK_IDLE, autoWalkGoTo, autoWalkStep, type PlanFn, type TrackedAutoWalkState } from './autoWalk.ts';
import type { NavGrid } from './grid.ts';

const GRID = {} as NavGrid;
const at = (x: number, z: number) => ({ x, y: 0, z });

function planner(route: { x: number; z: number }[] | null = []) {
  return vi.fn<PlanFn>(() => route);
}

type Walking = Extract<TrackedAutoWalkState, { type: 'walking' }>;

function walking(overrides: Partial<Walking> = {}): Walking {
  return { type: 'walking', targetId: 'bob', route: [], plannedAt: 0, plannedFor: { x: 0, z: 10 }, ...overrides };
}

describe('autoWalkStep', () => {
  it('drops waypoints within 0.3 m and steers at the next one', () => {
    const state = walking({ route: [{ x: 0.2, z: 0 }, { x: 0, z: 4 }, { x: 0, z: 8 }] });
    const step = autoWalkStep(state, { selfPos: at(0, 0), targetPos: at(0, 10), now: 100 }, GRID, planner());
    expect(step.state).toMatchObject({ type: 'walking', route: [{ x: 0, z: 4 }, { x: 0, z: 8 }] });
    expect(step.intent).toEqual({ x: 0, z: 1 });
  });

  it('heads straight for the target once every waypoint is behind it', () => {
    const state = walking({ route: [{ x: 0.1, z: 0 }] });
    const step = autoWalkStep(state, { selfPos: at(0, 0), targetPos: at(3, 0), now: 100 }, GRID, planner());
    expect(step.state).toMatchObject({ type: 'walking', route: [] });
    expect(step.intent).toEqual({ x: 1, z: 0 });
  });

  it('keeps the same state object while nothing changes', () => {
    const state = walking({ route: [{ x: 0, z: 4 }] });
    const input = { selfPos: at(0, 0), targetPos: at(0, 10), now: 100 };
    expect(autoWalkStep(state, input, GRID, planner()).state).toBe(state);
    const straight = walking();
    expect(autoWalkStep(straight, input, GRID, planner()).state).toBe(straight);
  });

  it('re-plans every 0.5 s', () => {
    const plan = planner([{ x: 0, z: 5 }]);
    const input = { selfPos: at(0, 0), targetPos: at(0, 10) };
    autoWalkStep(walking(), { ...input, now: 499 }, GRID, plan);
    expect(plan).not.toHaveBeenCalled();
    const step = autoWalkStep(walking(), { ...input, now: 500 }, GRID, plan);
    expect(plan).toHaveBeenCalledTimes(1);
    expect(step.state).toMatchObject({ type: 'walking', route: [{ x: 0, z: 5 }], plannedAt: 500 });
  });

  it('re-plans when the target has moved more than 1 m since the last plan', () => {
    const plan = planner();
    autoWalkStep(walking(), { selfPos: at(0, 0), targetPos: at(0, 10.9), now: 100 }, GRID, plan);
    expect(plan).not.toHaveBeenCalled();
    const step = autoWalkStep(walking(), { selfPos: at(0, 0), targetPos: at(0, 11.1), now: 100 }, GRID, plan);
    expect(plan).toHaveBeenCalledTimes(1);
    expect(step.state).toMatchObject({ plannedFor: { x: 0, z: 11.1 } });
  });

  it('keeps its route when a re-plan mid-walk finds none', () => {
    const plan = planner(null);
    const state = walking({ route: [{ x: 0, z: 4 }] });
    const step = autoWalkStep(state, { selfPos: at(0, 0), targetPos: at(0, 10), now: 500 }, GRID, plan);
    expect(plan).toHaveBeenCalledTimes(1);
    expect(step.state).toEqual({ ...state, plannedAt: 500 });
    expect(step.intent).toEqual({ x: 0, z: 1 });
  });

  it('arrives within 1.5 m with a null intent', () => {
    const step = autoWalkStep(walking(), { selfPos: at(0, 0), targetPos: at(0, 1.5), now: 100 }, GRID, planner());
    expect(step).toEqual({ state: { type: 'arrived', targetId: 'bob' }, intent: null });
  });

  it('resumes walking once the target is more than 3 m away', () => {
    const arrived: TrackedAutoWalkState = { type: 'arrived', targetId: 'bob' };
    const plan = planner();
    const near = autoWalkStep(arrived, { selfPos: at(0, 0), targetPos: at(0, 3), now: 100 }, GRID, plan);
    expect(near).toEqual({ state: arrived, intent: null });
    const far = autoWalkStep(arrived, { selfPos: at(0, 0), targetPos: at(0, 3.1), now: 100 }, GRID, plan);
    expect(far.state).toMatchObject({ type: 'walking', targetId: 'bob' });
    expect(far.intent).toEqual({ x: 0, z: 1 });
  });

  it('stands still with no route, re-plans every 0.5 s and walks once a route appears', () => {
    const plan = planner(null);
    const input = { selfPos: at(0, 0), targetPos: at(0, 10) };
    const stuck = autoWalkGoTo(AUTO_WALK_IDLE, 'bob', { ...input, now: 0 }, GRID, plan);
    expect(stuck).toEqual({ type: 'no-route', targetId: 'bob', plannedAt: 0 });

    expect(autoWalkStep(stuck, { ...input, now: 499 }, GRID, plan)).toEqual({ state: stuck, intent: null });
    expect(plan).toHaveBeenCalledTimes(1);

    plan.mockReturnValue([{ x: 0, z: 0 }, { x: 4, z: 4 }]);
    const step = autoWalkStep(stuck, { ...input, now: 500 }, GRID, plan);
    expect(step.state).toMatchObject({ type: 'walking', route: [{ x: 4, z: 4 }] });
    expect(step.intent?.x).toBeCloseTo(Math.SQRT1_2);
    expect(step.intent?.z).toBeCloseTo(Math.SQRT1_2);
  });

  it('walks straight at the target when there is no grid', () => {
    const plan = planner();
    const input = { selfPos: at(0, 0), targetPos: at(-4, 0), now: 0 };
    const state = autoWalkGoTo(AUTO_WALK_IDLE, 'bob', input, null, plan);
    expect(state).toMatchObject({ type: 'walking', route: [] });
    expect(autoWalkStep(state, input, null, plan).intent).toEqual({ x: -1, z: 0 });
    expect(plan).not.toHaveBeenCalled();
  });

  it('goes idle when the target departs', () => {
    const step = autoWalkStep(walking(), { selfPos: at(0, 0), targetPos: null, now: 100 }, GRID, planner());
    expect(step).toEqual({ state: AUTO_WALK_IDLE, intent: null });
  });
});

describe('autoWalkGoTo', () => {
  const input = { selfPos: at(0, 0), targetPos: at(0, 10), now: 0 };

  it('plans from self to the target', () => {
    const plan = planner([{ x: 0, z: 10 }]);
    expect(autoWalkGoTo(AUTO_WALK_IDLE, 'bob', input, GRID, plan)).toMatchObject({
      type: 'walking',
      targetId: 'bob',
      route: [{ x: 0, z: 10 }],
    });
    expect(plan).toHaveBeenCalledWith(GRID, input.selfPos, input.targetPos);
  });

  it('stops when asked for the current target again', () => {
    const plan = planner();
    expect(autoWalkGoTo(walking(), 'bob', input, GRID, plan)).toBe(AUTO_WALK_IDLE);
    expect(autoWalkGoTo({ type: 'arrived', targetId: 'bob' }, 'bob', input, GRID, plan)).toBe(AUTO_WALK_IDLE);
    expect(autoWalkGoTo({ type: 'no-route', targetId: 'bob', plannedAt: 0 }, 'bob', input, GRID, plan)).toBe(
      AUTO_WALK_IDLE,
    );
  });

  it('re-targets to a different player', () => {
    expect(autoWalkGoTo(walking(), 'carol', input, GRID, planner())).toMatchObject({
      type: 'walking',
      targetId: 'carol',
    });
  });

  it('stays idle for a player who is not in the room', () => {
    expect(autoWalkGoTo(AUTO_WALK_IDLE, 'bob', { ...input, targetPos: null }, GRID, planner())).toBe(AUTO_WALK_IDLE);
  });
});
