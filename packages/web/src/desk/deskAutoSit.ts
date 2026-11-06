import { deskAreaAt, deskOwnedBy, loginOf, type OfficeState, type PlayerId, type Store } from '@officexr/sdk';

export const DESK_AUTO_SIT_MS = 2000;

/** Physics writes the resting position every frame, so stillness tolerates sub-millimetre jitter. */
const STILL_EPSILON_M = 1e-3;

export interface DeskAutoSitDeps {
  store: Store;
  selfId: PlayerId;
  /** Walks the player to their chair and sits them. */
  returnToDesk(): void;
  /** Whether the self player may sit on the chair `seatInstanceId` right now. */
  canSitAt(state: OfficeState, seatInstanceId: string): boolean;
}

/**
 * Sits the self player at their desk after `DESK_AUTO_SIT_MS` of standing still in their own desk area. Once it has
 * fired or the player has sat there, it stays quiet until they leave the area. Returns the stop function.
 */
export function startDeskAutoSit({ store, selfId, returnToDesk, canSitAt }: DeskAutoSitDeps): () => void {
  const login = loginOf(selfId);
  let spent = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waitingAt: { x: number; z: number } | null = null;

  const disarm = () => {
    clearTimeout(timer);
    timer = undefined;
    waitingAt = null;
  };

  const onState = (s: OfficeState) => {
    const self = s.players[selfId];
    const area = self ? deskAreaAt(s.deskAreas, self.pos) : null;
    if (!self || !area || area.id !== deskOwnedBy(s, login)) {
      spent = false;
      disarm();
      return;
    }
    if (self.seat != null) {
      spent = true;
    }
    if (spent || area.seatInstanceId === null || !canSitAt(s, area.seatInstanceId)) {
      disarm();
      return;
    }
    const { x, z } = self.pos;
    if (timer !== undefined && waitingAt && Math.hypot(x - waitingAt.x, z - waitingAt.z) < STILL_EPSILON_M) {
      return;
    }
    // ponytail: movement is read off position changes, so pushing against a wall counts as standing still.
    disarm();
    waitingAt = { x, z };
    timer = setTimeout(() => {
      spent = true;
      disarm();
      returnToDesk();
    }, DESK_AUTO_SIT_MS);
  };

  onState(store.getState());
  const unsubscribe = store.subscribeAll(onState);
  return () => {
    unsubscribe();
    disarm();
  };
}
