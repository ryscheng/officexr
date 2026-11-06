import { useEffect } from 'react';
import { loginOf, type PlayerId, type Store } from '@officexr/sdk';
import { canSit, seatOf } from '@officexr/world/app';
import { useApplication, usePlayControls } from '@officexr/world/top-down';
import { startDeskAutoSit } from './deskAutoSit';

/** Renders nothing: runs the auto-sit timer while mounted. */
export function DeskAutoSit({ store, selfId }: { store: Store; selfId: PlayerId }) {
  const { catalog, geometry } = useApplication();
  const { returnToDesk } = usePlayControls();
  useEffect(
    () =>
      startDeskAutoSit({
        store,
        selfId,
        returnToDesk,
        canSitAt: (state, seatId) => {
          const seat = seatOf(state, catalog, geometry, seatId);
          return seat !== null && canSit(state, catalog, geometry, seat.instance, loginOf(selfId)).ok;
        },
      }),
    [store, selfId, returnToDesk, catalog, geometry],
  );
  return null;
}
