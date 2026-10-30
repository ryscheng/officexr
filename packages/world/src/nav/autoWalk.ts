import type { PlayerId, Vec3 } from '@officexr/sdk';
import type { NavGrid } from './grid.ts';
import type { findPath } from './path.ts';
import { planarDistance, type XZ } from './planar.ts';

const WAYPOINT_REACHED_M = 0.3;
const REPLAN_INTERVAL_MS = 500;
const REPLAN_TARGET_MOVED_M = 1;
const ARRIVE_M = 1.5;
const POINT_ARRIVE_M = 0.4;
const RESUME_M = 3;
/** Longer than a jump's airtime, when the feet are too far above the floor to plan from. */
const ROUTE_GRACE_MS = 1200;

/** `targetId` is null when the walk heads for a point on the floor instead of a player. */
export type AutoWalkState =
  | { type: 'idle' }
  | {
      type: 'walking';
      targetId: PlayerId | null;
      /** Waypoints still ahead; empty means head straight for the target. */
      route: XZ[];
    }
  | { type: 'arrived'; targetId: PlayerId | null }
  | { type: 'no-route'; targetId: PlayerId | null };

type Walking = Extract<AutoWalkState, { type: 'walking' }> & {
  plannedAt: number;
  /** When a plan last succeeded. */
  routedAt: number;
  /** Where the target stood when `route` was planned. */
  plannedFor: XZ;
};

/** `AutoWalkState` plus the re-planning bookkeeping `autoWalkStep` needs. */
export type TrackedAutoWalkState =
  | Exclude<AutoWalkState, { type: 'walking' | 'no-route' }>
  | Walking
  | { type: 'no-route'; targetId: PlayerId | null; plannedAt: number };

export interface AutoWalkInput {
  /** Feet position, as `findPath` takes it. */
  selfPos: Vec3;
  /** The target's feet position; null once it has left the room (sync removes a departing player). */
  targetPos: Vec3 | null;
  now: number;
}

export type PlanFn = typeof findPath;

export const AUTO_WALK_IDLE: TrackedAutoWalkState = { type: 'idle' };

/** Starts following `targetId`; asking for the current target again stops instead. */
export function autoWalkGoTo(
  state: TrackedAutoWalkState,
  targetId: PlayerId,
  input: AutoWalkInput,
  grid: NavGrid | null,
  plan: PlanFn,
): TrackedAutoWalkState {
  if ((state.type !== 'idle' && state.targetId === targetId) || !input.targetPos) {
    return AUTO_WALK_IDLE;
  }
  return startWalking(targetId, input.selfPos, input.targetPos, input.now, grid, plan);
}

/** Starts walking to `input.targetPos`, a point on the floor; it never follows or toggles. */
export function autoWalkGoToPoint(
  input: AutoWalkInput & { targetPos: Vec3 },
  grid: NavGrid | null,
  plan: PlanFn,
): TrackedAutoWalkState {
  return startWalking(null, input.selfPos, input.targetPos, input.now, grid, plan);
}

/**
 * Advances the walk by one frame. `intent` is a world-space unit XZ
 * direction, or null when the avatar should stand still.
 */
export function autoWalkStep(
  state: TrackedAutoWalkState,
  input: AutoWalkInput,
  grid: NavGrid | null,
  plan: PlanFn,
): { state: TrackedAutoWalkState; intent: XZ | null } {
  if (state.type === 'idle') {
    return { state, intent: null };
  }
  const { selfPos, targetPos, now } = input;
  if (!targetPos) {
    return { state: AUTO_WALK_IDLE, intent: null };
  }
  const start = () => startWalking(state.targetId, selfPos, targetPos, now, grid, plan);
  // ponytail: arrival is planar, so a target on another floor right above or below counts as reached.
  const distance = planarDistance(selfPos, targetPos);
  const arriveM = state.targetId === null ? POINT_ARRIVE_M : ARRIVE_M;
  let next: TrackedAutoWalkState;
  switch (state.type) {
    case 'arrived':
      next = state.targetId !== null && distance > RESUME_M ? start() : state;
      break;
    case 'no-route':
      // ponytail: an unreachable target makes A* flood its whole connected region every 0.5 s.
      next =
        distance <= arriveM
          ? { type: 'arrived', targetId: state.targetId }
          : now - state.plannedAt >= REPLAN_INTERVAL_MS
            ? start()
            : state;
      break;
    case 'walking':
      next =
        distance <= arriveM
          ? { type: 'arrived', targetId: state.targetId }
          : now - state.plannedAt >= REPLAN_INTERVAL_MS ||
              planarDistance(state.plannedFor, targetPos) > REPLAN_TARGET_MOVED_M
            ? replanWalk(state, selfPos, targetPos, now, grid, plan)
            : state;
      break;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
  if (next.type !== 'walking') {
    return { state: next, intent: null };
  }
  const steered = steer(next, selfPos, targetPos);
  // A point may sit off the grid; once its route is walked, the snapped end is as close as we get.
  if (next.targetId === null && next.route.length > 0 && steered.state.route.length === 0) {
    return { state: { type: 'arrived', targetId: null }, intent: null };
  }
  return steered;
}

/** Shared, so re-planning without a grid keeps the same route. */
const STRAIGHT_AT_TARGET: XZ[] = [];

/** Null when unreachable; empty, meaning straight at the target, without a grid. */
function route(selfPos: Vec3, targetPos: Vec3, grid: NavGrid | null, plan: PlanFn): XZ[] | null {
  return grid ? plan(grid, selfPos, targetPos) : STRAIGHT_AT_TARGET;
}

function startWalking(
  targetId: PlayerId | null,
  selfPos: Vec3,
  targetPos: Vec3,
  now: number,
  grid: NavGrid | null,
  plan: PlanFn,
): TrackedAutoWalkState {
  const planned = route(selfPos, targetPos, grid, plan);
  return planned ? walkingTo(targetId, planned, targetPos, now, now) : { type: 'no-route', targetId, plannedAt: now };
}

/** A failed re-plan keeps the old route for a grace period, so a jump doesn't stop the walk. */
function replanWalk(
  state: Walking,
  selfPos: Vec3,
  targetPos: Vec3,
  now: number,
  grid: NavGrid | null,
  plan: PlanFn,
): TrackedAutoWalkState {
  const planned = route(selfPos, targetPos, grid, plan);
  return planned
    ? walkingTo(state.targetId, planned, targetPos, now, now)
    : now - state.routedAt < ROUTE_GRACE_MS
      ? walkingTo(state.targetId, state.route, targetPos, now, state.routedAt)
      : { type: 'no-route', targetId: state.targetId, plannedAt: now };
}

function walkingTo(targetId: PlayerId | null, route: XZ[], targetPos: Vec3, now: number, routedAt: number): Walking {
  return {
    type: 'walking',
    targetId,
    route,
    plannedAt: now,
    routedAt,
    plannedFor: { x: targetPos.x, z: targetPos.z },
  };
}

/** Drops the waypoints already reached and aims at the next one, or at the target once none are left. */
function steer(state: Walking, selfPos: Vec3, targetPos: Vec3): { state: Walking; intent: XZ } {
  const ahead = state.route.findIndex((p) => planarDistance(selfPos, p) > WAYPOINT_REACHED_M);
  const reached = ahead < 0 ? state.route.length : ahead;
  const next = reached === 0 ? state : { ...state, route: state.route.slice(reached) };
  const aim = next.route[0] ?? targetPos;
  const dx = aim.x - selfPos.x;
  const dz = aim.z - selfPos.z;
  const length = Math.hypot(dx, dz);
  return { state: next, intent: { x: dx / length, z: dz / length } };
}
