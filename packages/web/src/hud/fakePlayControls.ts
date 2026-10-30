import type { PlayerId } from '@officexr/sdk';
import type { AutoWalkState, PlayControlsSource } from '@officexr/world/react';

/** A `PlayControlsSource` for tests: records `goTo` calls and holds whatever state the test sets. */
export function fakePlayControls(initial: AutoWalkState = { type: 'idle' }) {
  let state = initial;
  const listeners = new Set<() => void>();
  const goTos: PlayerId[] = [];
  const controls: PlayControlsSource = {
    goTo: (targetId) => {
      goTos.push(targetId);
    },
    goToPoint: () => {},
    cancel: () => {},
    getState: () => state,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
  return {
    controls,
    goTos,
    set: (next: AutoWalkState) => {
      state = next;
      listeners.forEach((cb) => cb());
    },
  };
}
