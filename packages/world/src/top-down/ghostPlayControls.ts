import type { PlayerId } from '@officexr/sdk';
import type { GhostController } from '../app/ghost-controller.ts';
import type { AutoWalkState } from '../nav/autoWalk.ts';
import type { PlayControlsSource } from '../react/playControls.tsx';

const IDLE: AutoWalkState = { type: 'idle' };

export interface GhostPlayControls extends PlayControlsSource {
  /** Republishes the state once the controller ends a follow on its own; call after each `step`. */
  refresh(): void;
}

/**
 * Go-to-person over a `GhostController`. A ghost walks straight, so a walk never has a route,
 * 'no-route' can't happen, and 'arrived' isn't published: the state goes back to 'idle'.
 */
export function createGhostPlayControls(controller: GhostController): GhostPlayControls {
  let state: AutoWalkState = IDLE;
  const listeners = new Set<() => void>();
  const publish = (next: AutoWalkState) => {
    state = next;
    listeners.forEach((cb) => cb());
  };
  const cancel = () => {
    controller.cancel();
    publish(IDLE);
  };
  return {
    goTo(targetId: PlayerId) {
      if (state.type !== 'idle' && state.targetId === targetId) {
        cancel();
        return;
      }
      controller.goTo(targetId);
      publish({ type: 'walking', targetId, route: [] });
    },
    cancel,
    getState: () => state,
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    refresh() {
      if (state.type !== 'idle' && controller.followTarget() === null) {
        publish(IDLE);
      }
    },
  };
}
