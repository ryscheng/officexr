import { useEffect, useMemo } from 'react';
import { POSITION_CONSTANTS, type Actions, type PlayerId, type Store, type Vec3 } from '@officexr/sdk';
import { performanceNow } from '../hud/useNow';

export interface LocalActivityDeps {
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  clock(): number;
}

const browserDeps = (): LocalActivityDeps => ({ target: window, clock: performanceNow });

const INPUT_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const;
const MIN_MARK_INTERVAL_MS = 1000;

const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function angleDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

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
  const markActive = useMemo(() => {
    let lastMarkAt = -Infinity;
    return (): boolean => {
      const now = clock();
      if (now - lastMarkAt < MIN_MARK_INTERVAL_MS) {
        return false;
      }
      lastMarkAt = now;
      actions.markSelfActive(now);
      return true;
    };
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
      const moved =
        distance(me.pos, marked.pos) > POSITION_CONSTANTS.deltaP || angleDelta(me.yaw, marked.yaw) > POSITION_CONSTANTS.deltaY;
      if (moved && markActive()) {
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
