import { useEffect, useState } from 'react';
import type { PlayerId, Store, Vec3 } from '@officexr/sdk';
import {
  AUTO_WALK_IDLE,
  autoWalkGoTo,
  autoWalkStep,
  type AutoWalkInput,
  type AutoWalkState,
  type PlanFn,
  type TrackedAutoWalkState,
} from '../nav/autoWalk.ts';
import type { NavGrid } from '../nav/grid.ts';
import { findPath } from '../nav/path.ts';
import { feetPosition } from '../physics/rules.ts';
import type { AutoWalkSource } from '../renderer/moveIntent.ts';
import type { PlayControlsSource } from './playControls.tsx';

export interface AutoWalkController extends AutoWalkSource, Pick<PlayControlsSource, 'goTo' | 'cancel'> {
  setGrid(grid: NavGrid | null): void;
  /**
   * Walks toward the fixed `feet` position, known as `id`, until `isThere` holds, then calls `onArrive` instead of
   * waiting. When no route gets there, stops and calls `onUnreachable` instead.
   */
  goToPoint(id: string, feet: Vec3, isThere: () => boolean, onArrive: () => void, onUnreachable: () => void): void;
  getState(): AutoWalkState;
  subscribe(cb: () => void): () => void;
}

export interface AutoWalkOptions {
  plan?: PlanFn;
  now?: () => number;
}

/**
 * Walks the self player of `store` to other players. Holds the walk
 * state itself, for the frame loop's `intent` calls, and notifies
 * subscribers only when that state changes.
 */
export function createAutoWalk(
  store: Store,
  selfId: PlayerId,
  { plan = findPath, now = () => performance.now() }: AutoWalkOptions = {},
): AutoWalkController {
  let state: TrackedAutoWalkState = AUTO_WALK_IDLE;
  let published: AutoWalkState = AUTO_WALK_IDLE;
  let grid: NavGrid | null = null;
  let point: {
    id: string;
    feet: Vec3;
    isThere: () => boolean;
    onArrive: () => void;
    onUnreachable: () => void;
  } | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: TrackedAutoWalkState) => {
    state = next;
    if (next.type === 'idle') {
      point = null;
    }
    if (!samePublicState(published, next)) {
      published = publicState(next);
      listeners.forEach((cb) => cb());
    }
  };
  const input = (targetId: PlayerId, selfPos: Vec3): AutoWalkInput => {
    const s = store.getState();
    const { charRadius } = s.worldSettings;
    const self = feetPosition(selfPos, charRadius);
    if (point?.id === targetId) {
      // Arrival is `isThere`'s call, not distance's.
      return { selfPos: self, targetPos: point.feet, now: now(), arriveM: 0 };
    }
    const target = s.players[targetId];
    return { selfPos: self, targetPos: target ? feetPosition(target.pos, charRadius) : null, now: now() };
  };
  /** A fixed point, unlike a player, won't move into reach, so its 'no-route' is final. */
  const giveUpIfUnreachable = () => {
    if (state.type !== 'no-route' || point?.id !== state.targetId) {
      return false;
    }
    const { onUnreachable } = point;
    publish(AUTO_WALK_IDLE);
    onUnreachable();
    return true;
  };
  return {
    getState: () => published,
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    setGrid(next) {
      grid = next;
    },
    goTo(targetId) {
      point = null;
      const self = store.getState().players[selfId];
      if (self) {
        publish(autoWalkGoTo(state, targetId, input(targetId, self.pos), grid, plan));
      }
    },
    goToPoint(id, feet, isThere, onArrive, onUnreachable) {
      const self = store.getState().players[selfId];
      if (self) {
        point = { id, feet, isThere, onArrive, onUnreachable };
        publish(autoWalkGoTo(state, id, input(id, self.pos), grid, plan));
        giveUpIfUnreachable();
      }
    },
    cancel: () => publish(AUTO_WALK_IDLE),
    intent(selfPos) {
      if (state.type === 'idle') {
        return null;
      }
      if (point?.id === state.targetId && point.isThere()) {
        const { onArrive } = point;
        publish(AUTO_WALK_IDLE);
        onArrive();
        return null;
      }
      const step = autoWalkStep(state, input(state.targetId, selfPos), grid, plan);
      publish(step.state);
      return giveUpIfUnreachable() ? null : step.intent;
    },
  };
}

function publicState(s: TrackedAutoWalkState): AutoWalkState {
  switch (s.type) {
    case 'idle':
      return AUTO_WALK_IDLE;
    case 'walking':
      return { type: s.type, targetId: s.targetId, route: s.route };
    case 'arrived':
    case 'no-route':
      return { type: s.type, targetId: s.targetId };
    default: {
      const _exhaustive: never = s;
      return _exhaustive;
    }
  }
}

function samePublicState(a: AutoWalkState, b: AutoWalkState): boolean {
  const targetOf = (s: AutoWalkState) => (s.type === 'idle' ? null : s.targetId);
  const routeOf = (s: AutoWalkState) => (s.type === 'walking' ? s.route : null);
  return a.type === b.type && targetOf(a) === targetOf(b) && routeOf(a) === routeOf(b);
}

/** One controller per `store` and `selfId`; a new pair starts a fresh, idle one. */
export function useAutoWalk(store: Store, selfId: PlayerId, grid: NavGrid | null): AutoWalkController {
  const create = () => {
    const autoWalk = createAutoWalk(store, selfId);
    autoWalk.setGrid(grid);
    return { store, selfId, autoWalk };
  };
  const [held, setHeld] = useState(create);
  let current = held;
  if (held.store !== store || held.selfId !== selfId) {
    current = create();
    setHeld(current);
  }
  const { autoWalk } = current;
  useEffect(() => {
    autoWalk.setGrid(grid);
  }, [autoWalk, grid]);
  return autoWalk;
}
