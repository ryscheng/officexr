import { useEffect, useMemo } from 'react';
import type { PlayerId, Store, Vec3 } from '@officexr/sdk';
import { AUTO_WALK_IDLE, autoWalkGoTo, autoWalkStep, type AutoWalkInput, type AutoWalkState } from '../nav/autoWalk.ts';
import type { NavGrid } from '../nav/grid.ts';
import { findPath } from '../nav/path.ts';
import { feetPosition } from '../physics/rules.ts';
import type { AutoWalkSource } from '../renderer/moveIntent.ts';
import type { PlayControlsSource } from './playControls.tsx';

export interface AutoWalkController extends AutoWalkSource, PlayControlsSource {
  setGrid(grid: NavGrid | null): void;
}

/**
 * Walks the self player of `store` to other players. Holds the walk
 * state itself, for the frame loop's `intent` calls, and notifies
 * subscribers only when that state changes.
 */
export function createAutoWalk(store: Store, selfId: PlayerId): AutoWalkController {
  let state: AutoWalkState = AUTO_WALK_IDLE;
  let grid: NavGrid | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: AutoWalkState) => {
    if (next !== state) {
      state = next;
      listeners.forEach((cb) => cb());
    }
  };
  const input = (targetId: PlayerId, selfPos: Vec3): AutoWalkInput => {
    const s = store.getState();
    const { charRadius } = s.worldSettings;
    const target = s.players[targetId];
    return {
      selfPos: feetPosition(selfPos, charRadius),
      targetPos: target ? feetPosition(target.pos, charRadius) : null,
      now: performance.now(),
    };
  };
  return {
    getState: () => state,
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    setGrid(next) {
      grid = next;
    },
    goTo(targetId) {
      const self = store.getState().players[selfId];
      if (self) {
        publish(autoWalkGoTo(state, targetId, input(targetId, self.pos), grid, findPath));
      }
    },
    cancel: () => publish(AUTO_WALK_IDLE),
    intent(selfPos) {
      if (state.type === 'idle') {
        return null;
      }
      const step = autoWalkStep(state, input(state.targetId, selfPos), grid, findPath);
      publish(step.state);
      return step.intent;
    },
  };
}

export function useAutoWalk(store: Store, selfId: PlayerId, grid: NavGrid | null): AutoWalkController {
  const autoWalk = useMemo(() => createAutoWalk(store, selfId), [store, selfId]);
  useEffect(() => autoWalk.setGrid(grid), [autoWalk, grid]);
  return autoWalk;
}
