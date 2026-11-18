import { useCallback, useEffect, useRef } from 'react';
import { poseMoved, type Actions, type PlayerId, type Store } from '@officexr/sdk';
import { performanceNow } from '../hud/useNow';

export interface LocalActivityDeps {
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  clock(): number;
}

const browserDeps = (): LocalActivityDeps => ({ target: window, clock: performanceNow });

const INPUT_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const;
const MIN_MARK_INTERVAL_MS = 1000;

/**
 * Marks the local player active on input, on moving or turning past the SDK's broadcast
 * thresholds, and (via the returned `markActive`) on mic sound; at most once per second.
 * Capture listeners, because the settings modal stops `pointerdown` from bubbling.
 */
export function useLocalActivity(
  store: Pick<Store, 'getState' | 'subscribeAll'>,
  actions: Pick<Actions, 'markSelfActive'>,
  selfId: PlayerId,
  { target, clock }: LocalActivityDeps = browserDeps(),
): () => void {
  const lastMarkAt = useRef(-Infinity);
  const markActive = useCallback((): boolean => {
    const now = clock();
    if (now - lastMarkAt.current < MIN_MARK_INTERVAL_MS) {
      return false;
    }
    lastMarkAt.current = now;
    actions.markSelfActive(now);
    return true;
  }, [actions, clock]);

  useEffect(() => {
    markActive();
    const onInput = () => void markActive();
    const options = { capture: true, passive: true };
    INPUT_EVENTS.forEach((name) => target.addEventListener(name, onInput, options));

    let marked = store.getState().players[selfId];
    const stopPose = store.subscribeAll((next) => {
      const me = next.players[selfId];
      if (!me) {
        return;
      }
      marked ??= me;
      if (poseMoved(me, marked) && markActive()) {
        marked = me;
      }
    });

    return () => {
      INPUT_EVENTS.forEach((name) => target.removeEventListener(name, onInput, options));
      stopPose();
    };
  }, [store, selfId, target, markActive]);

  return markActive;
}
