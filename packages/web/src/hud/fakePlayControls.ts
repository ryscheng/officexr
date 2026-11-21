import type { PlayerId } from '@officexr/sdk';
import type { AutoWalkState, PlayControlsSource } from '@officexr/world/top-down';

const NO_SEATING = { nearbySeatId: null, hasDesk: false };

/** A `PlayControlsSource` for tests: records `goTo` calls and holds whatever state the test sets. */
export function fakePlayControls(initial: AutoWalkState = { type: 'idle' }) {
  let state = initial;
  const listeners = new Set<() => void>();
  const goTos: PlayerId[] = [];
  const groundGoTos: { x: number; z: number }[] = [];
  let groundResult: ((x: number, z: number) => { x: number; z: number } | null) | null = null;
  let cancels = 0;
  const controls: PlayControlsSource = {
    goTo: (targetId) => {
      goTos.push(targetId);
    },
    goToGround: (x, z) => {
      groundGoTos.push({ x, z });
      return groundResult ? groundResult(x, z) : { x, z };
    },
    cancel: () => {
      cancels++;
    },
    sit: () => {},
    stand: () => {},
    returnToDesk: () => {},
    getSeating: () => NO_SEATING,
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
    groundGoTos,
    cancels: () => cancels,
    refuseGround: () => {
      groundResult = () => null;
    },
    set: (next: AutoWalkState) => {
      state = next;
      listeners.forEach((cb) => cb());
    },
  };
}
